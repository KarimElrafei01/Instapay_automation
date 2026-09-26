import "dotenv/config";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import csrfProtection from "@fastify/csrf-protection";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import { Logger as PinoNestLogger, LoggerModule } from "nestjs-pino";
import { AuthModule } from "../features/auth/auth.module.js";
import { StoresModule } from "../features/stores/stores.module.js";
import { ReceivingSourcesModule } from "../features/receiving-sources/receiving-sources.module.js";
import { CryptoModule } from "../shared/crypto/crypto.module.js";
import { DatabaseModule } from "../shared/database/database.module.js";
import { HttpSecurityModule } from "../shared/http/http-security.module.js";
import {
  normalizedRequestPath,
  rateLimitPolicyForRequest,
  shouldProtectAgainstCsrf,
  type RateLimitPolicy,
} from "../shared/http/http-security.js";
import { ObservabilityModule } from "../shared/observability/observability.module.js";
import { PlatformEventLogger } from "../shared/observability/platform-event-logger.js";

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        genReqId: () => randomUUID(),
        customReceivedMessage: () => "http.request.received",
        customSuccessMessage: () => "http.request.completed",
        customErrorMessage: () => "http.request.failed",
        serializers: {
          req: (request) => ({
            id: pinoRequestId(request),
            method: request.method,
            path: normalizedRequestPath(request.url ?? "/"),
            remoteAddress: request.socket?.remoteAddress,
          }),
          res: (response) => ({ statusCode: response.statusCode }),
        },
        redact: {
          paths: ["req.headers.authorization", "req.headers.cookie", "req.headers.x-csrf-token", "res.headers.set-cookie"],
          remove: true,
        },
      },
    }),
    ObservabilityModule,
    DatabaseModule,
    CryptoModule,
    HttpSecurityModule,
    AuthModule,
    StoresModule,
    ReceivingSourcesModule,
  ],
})
class ServerModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    ServerModule,
    new FastifyAdapter({ logger: false, bodyLimit: 6 * 1_024 * 1_024, genReqId: () => randomUUID() }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(PinoNestLogger));
  app.enableShutdownHooks();

  const events = app.get(PlatformEventLogger);
  const server = app.getHttpAdapter().getInstance();
  await app.register(cookie);
  await server.register(rateLimit, {
    global: false,
    skipOnError: false,
  });
  await server.register(csrfProtection, {
    cookieKey: "instapay_csrf_secret",
    cookieOpts: {
      httpOnly: true,
      secure: process.env.NODE_ENV !== "development",
      sameSite: "strict",
      path: "/",
    },
    getToken: (request) => {
      const token = request.headers["x-csrf-token"];
      return typeof token === "string" ? token : undefined;
    },
  });

  const globalRateLimiter = createRateLimiter(server, 120, "1 minute");
  const sensitiveRateLimiters = createSensitiveRateLimiters(server);
  server.addHook("onRequest", async (request, reply) => {
    if (await enforceRateLimit(globalRateLimiter, request, reply, events, "global")) return reply;
  });
  server.addHook("onRequest", (request, reply, done) => {
    if (!shouldProtectAgainstCsrf(request)) return done();
    return server.csrfProtection(request, reply, done);
  });
  server.addHook("preHandler", async (request, reply) => {
    const policy = rateLimitPolicyForRequest(request);
    const limiter = policy ? sensitiveRateLimiters[policy] : undefined;
    if (!limiter || !policy) return;
    if (await enforceRateLimit(limiter, request, reply, events, policy)) return reply;
  });
  server.addHook("onError", async (request, _reply, error) => {
    events.record({
      action: securityErrorAction(error),
      outcome: "denied",
      requestId: request.id,
      reasonCode: errorCode(error),
    });
  });
  server.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode === 403 && shouldProtectAgainstCsrf(request)) {
      events.record({ action: "csrf_protected_request_rejected", outcome: "denied", requestId: request.id, reasonCode: "FORBIDDEN" });
    }
  });
  const port = Number.parseInt(process.env.SERVER_PORT ?? "3001", 10);

  server.get("/health/live", async () => ({ status: "ok" }));
  await app.listen({ host: "127.0.0.1", port });
  events.record({ action: "server_started", outcome: "completed" });
}

void bootstrap();

function createSensitiveRateLimiters(
  server: FastifyInstance,
): Record<RateLimitPolicy, ReturnType<typeof server.createRateLimit>> {
  return {
    authentication: createRateLimiter(server, 5, "15 minutes"),
    device: createRateLimiter(server, 60, "1 minute"),
    "proof-upload": createRateLimiter(server, 12, "1 minute"),
  };
}

function createRateLimiter(
  server: FastifyInstance,
  max: number,
  timeWindow: string,
): ReturnType<typeof server.createRateLimit> {
  return server.createRateLimit({
    max,
    timeWindow,
  });
}

function securityErrorAction(error: Error): string {
  return errorCode(error) === "FST_CSRF_INVALID_TOKEN" ? "csrf_validation_failed" : "http_request_failed";
}

function errorCode(error: Error): string {
  if ("code" in error && typeof error.code === "string") return error.code;
  return "HTTP_REQUEST_ERROR";
}

type RateLimitChecker = ReturnType<FastifyInstance["createRateLimit"]>;

async function enforceRateLimit(
  limiter: RateLimitChecker,
  request: FastifyRequest,
  reply: FastifyReply,
  events: PlatformEventLogger,
  policy: string,
): Promise<boolean> {
  const result = await limiter(request, {});
  if (result.isAllowed || !result.isExceeded) return false;
  events.record({ action: "rate_limit_exceeded", outcome: "denied", requestId: request.id, reasonCode: policy });
  reply.header("retry-after", result.ttlInSeconds).code(429).send({ statusCode: 429, code: "RATE_LIMITED" });
  return true;
}

function pinoRequestId(request: unknown): string | undefined {
  if (typeof request !== "object" || request === null || !("id" in request)) return undefined;
  return typeof request.id === "string" ? request.id : undefined;
}
