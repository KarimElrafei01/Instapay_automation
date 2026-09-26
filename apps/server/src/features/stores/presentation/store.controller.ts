import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { GetCurrentOwnerUseCase } from "../../auth/application/get-current-owner.use-case.js";
import {
  OWNER_SESSION_COOKIE_NAME,
  refreshOwnerSessionCookie,
} from "../../auth/presentation/owner-session-cookie.js";
import { CreateStoreUseCase } from "../application/create-store.use-case.js";
import { IpaAlreadyRegisteredError, StoreAlreadyExistsError } from "../domain/errors.js";
import type { MatchingWindowMinutes, Store } from "../domain/ports.js";
import { PlatformEventLogger } from "../../../shared/observability/platform-event-logger.js";

const createStoreSchema = z.object({
  displayName: z.string().max(480),
  accountHolderName: z.string().max(640),
  ipa: z.string().max(160),
  matchingWindowMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30)]).optional(),
  defaultWebhookUrl: z.string().max(2_048),
}).strict();

@Controller("v1/owner/stores")
export class StoreController {
  public constructor(
    private readonly getCurrentOwner: GetCurrentOwnerUseCase,
    private readonly createStore: CreateStoreUseCase,
    private readonly events: PlatformEventLogger,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: { store: ReturnType<typeof storeProjection>; integrationSecret: IntegrationSecretProjection } }> {
    const currentOwner = await this.getCurrentOwner.execute(request.cookies[OWNER_SESSION_COOKIE_NAME]);
    if (!currentOwner || currentOwner.owner.disabledAt || !currentOwner.owner.phoneVerifiedAt) {
      this.events.record({ action: "store_created", outcome: "denied", requestId: request.id, reasonCode: "UNAUTHENTICATED" });
      throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
    }
    const input = parseRequest(createStoreSchema, body);
    try {
      const created = await this.createStore.execute({ ownerId: currentOwner.owner.id, ...input });
      refreshOwnerSessionCookie(reply, currentOwner.session);
      this.events.record({
        action: "store_created", outcome: "completed", requestId: request.id,
        actorOwnerId: currentOwner.owner.id, resourceId: created.store.id,
      });
      return {
        data: {
          store: storeProjection(created.store),
          integrationSecret: {
            token: created.integrationSecret.token,
            tokenPrefix: created.integrationSecret.tokenPrefix,
            createdAt: created.integrationSecret.createdAt.toISOString(),
          },
        },
      };
    } catch (error) {
      if (error instanceof StoreAlreadyExistsError || error instanceof IpaAlreadyRegisteredError) {
        this.events.record({
          action: "store_created", outcome: "denied", requestId: request.id,
          actorOwnerId: currentOwner.owner.id, reasonCode: "STORE_CONFIGURATION_CONFLICT",
        });
        throw new ConflictException({ code: "STORE_CONFIGURATION_CONFLICT" });
      }
      if (error instanceof Error) {
        this.events.record({
          action: "store_created", outcome: "failed", requestId: request.id,
          actorOwnerId: currentOwner.owner.id, reasonCode: "INVALID_REQUEST",
        });
        throw new BadRequestException({ code: "INVALID_REQUEST" });
      }
      throw error;
    }
  }
}

type IntegrationSecretProjection = { token: string; tokenPrefix: string; createdAt: string };

function parseRequest<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({ code: "INVALID_REQUEST" });
  }
  return parsed.data;
}

function storeProjection(store: Store): {
  id: string;
  displayName: string;
  accountHolderName: string;
  ipa: string;
  matchingWindowMinutes: MatchingWindowMinutes;
  defaultWebhookUrl: string;
  receivingSourceStatus: "not_configured";
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: store.id,
    displayName: store.displayName,
    accountHolderName: store.accountHolderName,
    ipa: store.ipa,
    matchingWindowMinutes: store.matchingWindowMinutes,
    defaultWebhookUrl: store.defaultWebhookUrl,
    receivingSourceStatus: "not_configured",
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString(),
  };
}
