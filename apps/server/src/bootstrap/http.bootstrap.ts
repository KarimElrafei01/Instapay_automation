import "dotenv/config";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { AuthModule } from "../features/auth/auth.module.js";
import { StoresModule } from "../features/stores/stores.module.js";
import { ReceivingSourcesModule } from "../features/receiving-sources/receiving-sources.module.js";

@Module({
  imports: [AuthModule, StoresModule, ReceivingSourcesModule],
})
class ServerModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    ServerModule,
    new FastifyAdapter({ logger: false, bodyLimit: 6 * 1_024 * 1_024 }),
  );
  await app.register(cookie);
  const port = Number.parseInt(process.env.SERVER_PORT ?? "3001", 10);

  app.getHttpAdapter().getInstance().get("/health/live", async () => ({ status: "ok" }));
  await app.listen({ host: "127.0.0.1", port });
  Logger.log(`Server listening on http://127.0.0.1:${port}`, "Bootstrap");
}

void bootstrap();
