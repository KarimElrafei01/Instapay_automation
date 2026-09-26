import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { GetCurrentOwnerUseCase } from "../../auth/application/get-current-owner.use-case.js";
import { OWNER_SESSION_COOKIE_NAME, refreshOwnerSessionCookie } from "../../auth/presentation/owner-session-cookie.js";
import { GetOwnerStoreUseCase } from "../../stores/application/create-store.use-case.js";
import {
  CreateReceivingSourceUseCase,
  GetReceivingSourceUseCase,
  IngestDeviceTestAlertUseCase,
  IngestDeviceAlertUseCase,
  SubmitTestProofUseCase,
} from "../application/receiving-source.use-cases.js";
import {
  DuplicateDeviceEventError,
  InvalidDeviceCredentialError,
  InvalidDeviceSignatureError,
  ReceivingSourceAlreadyExistsError,
  ReceivingSourceNotFoundError,
  TestProofUnavailableError,
  TestWindowExpiredError,
} from "../domain/errors.js";
import type { ReceivingSource } from "../domain/ports.js";
import { PlatformEventLogger } from "../../../shared/observability/platform-event-logger.js";

const createSourceSchema = z.object({
  bankName: z.string().max(120),
  channels: z.array(z.enum(["sms", "notification"])).min(1).max(2),
  platform: z.enum(["android", "ios"]).default("android"),
}).strict();
const uploadProofSchema = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  imageBase64: z.string().min(4).max(6_990_508),
}).strict();
const deviceAlertPayloadSchema = z.object({
  payload: z.string().regex(/^[A-Za-z0-9_-]+$/).max(8_192),
}).strict();
const deviceAlertSchema = z.object({
  eventId: z.string().uuid(),
  channel: z.enum(["sms", "notification"]),
  senderIdentity: z.string().trim().min(1).max(120),
  rawText: z.string().min(1).max(4_096),
  receivedAt: z.string().datetime({ offset: true }),
}).strict();

@Controller("v1")
export class ReceivingSourceController {
  public constructor(
    private readonly getCurrentOwner: GetCurrentOwnerUseCase,
    private readonly getOwnerStore: GetOwnerStoreUseCase,
    private readonly createSource: CreateReceivingSourceUseCase,
    private readonly getSource: GetReceivingSourceUseCase,
    private readonly submitProof: SubmitTestProofUseCase,
    private readonly ingestTestAlert: IngestDeviceTestAlertUseCase,
    private readonly ingestAlert: IngestDeviceAlertUseCase,
    private readonly events: PlatformEventLogger,
  ) {}

  @Post("owner/receiving-source")
  @HttpCode(HttpStatus.CREATED)
  public async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: { source: ReceivingSourceProjection; deviceProvisioning: DeviceProvisioning } }> {
    const owner = await this.requireOwner(request, reply);
    const store = await this.getOwnerStore.execute(owner.id);
    if (!store) {
      this.events.record({ action: "receiving_source_created", outcome: "denied", requestId: request.id, actorOwnerId: owner.id, reasonCode: "STORE_REQUIRED" });
      throw new BadRequestException({ code: "STORE_REQUIRED" });
    }
    const input = parseRequest(createSourceSchema, body);
    try {
      const created = await this.createSource.execute({
        ownerId: owner.id, storeId: store.id, ipa: store.ipa,
        bankName: input.bankName, selectedChannels: input.channels, devicePlatform: input.platform,
      });
      this.events.record({
        action: "receiving_source_created", outcome: "completed", requestId: request.id,
        actorOwnerId: owner.id, resourceId: created.source.id,
      });
      return { data: { source: sourceProjection(created.source), deviceProvisioning: provisioning(created.source, created.deviceCredential, created.deviceSigningKey) } };
    } catch (error) {
      if (error instanceof ReceivingSourceAlreadyExistsError) {
        this.events.record({ action: "receiving_source_created", outcome: "denied", requestId: request.id, actorOwnerId: owner.id, reasonCode: "RECEIVING_SOURCE_ALREADY_CONFIGURED" });
        throw new ConflictException({ code: "RECEIVING_SOURCE_ALREADY_CONFIGURED" });
      }
      if (error instanceof Error) {
        this.events.record({ action: "receiving_source_created", outcome: "failed", requestId: request.id, actorOwnerId: owner.id, reasonCode: "INVALID_REQUEST" });
        throw new BadRequestException({ code: "INVALID_REQUEST" });
      }
      throw error;
    }
  }

  @Get("owner/receiving-source")
  public async current(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: { source: ReceivingSourceProjection | null } }> {
    const owner = await this.requireOwner(request, reply);
    const store = await this.getOwnerStore.execute(owner.id);
    if (!store) return { data: { source: null } };
    const source = await this.getSource.execute(owner.id, store.id);
    this.events.record({ action: "receiving_source_viewed", outcome: "completed", requestId: request.id, actorOwnerId: owner.id });
    return { data: { source: projectOrNull(source) } };
  }

  @Post("owner/receiving-source/:sourceId/test-proof")
  @HttpCode(HttpStatus.OK)
  public async uploadTestProof(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: { source: ReceivingSourceProjection } }> {
    const owner = await this.requireOwner(request, reply);
    const sourceId = request.params as { sourceId?: unknown };
    if (typeof sourceId.sourceId !== "string" || !z.string().uuid().safeParse(sourceId.sourceId).success) throw new BadRequestException({ code: "INVALID_REQUEST" });
    const input = parseRequest(uploadProofSchema, body);
    try {
      const source = await this.submitProof.execute({ ownerId: owner.id, sourceId: sourceId.sourceId, mediaType: input.mediaType, bytes: decodeImage(input.imageBase64) });
      this.events.record({ action: "receiving_source_test_proof_submitted", outcome: "completed", requestId: request.id, actorOwnerId: owner.id, resourceId: source.id });
      return { data: { source: sourceProjection(source) } };
    } catch (error) {
      this.events.record({ action: "receiving_source_test_proof_submitted", outcome: "failed", requestId: request.id, actorOwnerId: owner.id, resourceId: sourceId.sourceId, reasonCode: "PROOF_REJECTED" });
      throw sourceError(error);
    }
  }

  @Post("device/receiving-sources/:sourceId/test-alert")
  @HttpCode(HttpStatus.ACCEPTED)
  public async receiveDeviceTestAlert(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-device-signature") signature: string | undefined,
  ): Promise<{ data: { status: "accepted" } }> {
    const sourceId = request.params as { sourceId?: unknown };
    if (typeof sourceId.sourceId !== "string" || !z.string().uuid().safeParse(sourceId.sourceId).success) throw new BadRequestException({ code: "INVALID_REQUEST" });
    const input = parseDeviceAlert(parseRequest(deviceAlertPayloadSchema, body).payload);
    const credential = authorization?.match(/^Bearer (dvc_live_[A-Za-z0-9_-]{43})$/u)?.[1];
    try {
      await this.ingestTestAlert.execute({
        sourceId: sourceId.sourceId, credential, signature, signedPayload: input.signedPayload,
        alert: { ...input, receivedAt: new Date(input.receivedAt) },
      });
      this.events.record({ action: "device_test_alert_ingested", outcome: "accepted", requestId: request.id, resourceId: sourceId.sourceId });
      return { data: { status: "accepted" } };
    } catch (error) {
      this.events.record({ action: "device_test_alert_ingested", outcome: "denied", requestId: request.id, resourceId: sourceId.sourceId, reasonCode: "DEVICE_EVENT_REJECTED" });
      throw sourceError(error);
    }
  }

  @Post("device/receiving-sources/:sourceId/alerts")
  @HttpCode(HttpStatus.ACCEPTED)
  public async receiveDeviceAlert(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-device-signature") signature: string | undefined,
  ): Promise<{ data: { status: "accepted" } }> {
    const sourceId = request.params as { sourceId?: unknown };
    if (typeof sourceId.sourceId !== "string" || !z.string().uuid().safeParse(sourceId.sourceId).success) throw new BadRequestException({ code: "INVALID_REQUEST" });
    const input = parseDeviceAlert(parseRequest(deviceAlertPayloadSchema, body).payload);
    const credential = authorization?.match(/^Bearer (dvc_live_[A-Za-z0-9_-]{43})$/u)?.[1];
    try {
      await this.ingestAlert.execute({ sourceId: sourceId.sourceId, credential, signature, signedPayload: input.signedPayload, alert: { ...input, receivedAt: new Date(input.receivedAt) } });
      this.events.record({ action: "device_alert_ingested", outcome: "accepted", requestId: request.id, resourceId: sourceId.sourceId });
      return { data: { status: "accepted" } };
    } catch (error) {
      this.events.record({ action: "device_alert_ingested", outcome: "denied", requestId: request.id, resourceId: sourceId.sourceId, reasonCode: "DEVICE_EVENT_REJECTED" });
      throw sourceError(error);
    }
  }

  private async requireOwner(request: FastifyRequest, reply: FastifyReply): Promise<{ id: string }> {
    const current = await this.getCurrentOwner.execute(request.cookies[OWNER_SESSION_COOKIE_NAME]);
    if (!current || current.owner.disabledAt || !current.owner.phoneVerifiedAt) {
      this.events.record({ action: "owner_authorization_checked", outcome: "denied", requestId: request.id, reasonCode: "UNAUTHENTICATED" });
      throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
    }
    refreshOwnerSessionCookie(reply, current.session);
    this.events.record({ action: "owner_authorization_checked", outcome: "completed", requestId: request.id, actorOwnerId: current.owner.id });
    return { id: current.owner.id };
  }
}

type ReceivingSourceProjection = {
  id: string; bankName: string; selectedChannels: ReceivingSource["selectedChannels"]; status: ReceivingSource["status"];
  channels: { channel: string; status: string; verifiedAt: string | null; lastFailureCode: string | null }[];
  testExpiresAt: string; proof: "not_uploaded" | "uploaded"; createdAt: string;
};
type DeviceProvisioning = { sourceId: string; credential: string; signingKey: string; androidInstructions: string[]; iosInstructions: string[] };

function sourceProjection(source: ReceivingSource): ReceivingSourceProjection {
  return {
    id: source.id, bankName: source.bankName, selectedChannels: source.selectedChannels, status: source.status,
    channels: source.channelVerification.map((channel) => ({ ...channel, verifiedAt: channel.verifiedAt?.toISOString() ?? null })),
    testExpiresAt: source.testExpiresAt.toISOString(), proof: source.testProof ? "uploaded" : "not_uploaded", createdAt: source.createdAt.toISOString(),
  };
}

function projectOrNull(source: ReceivingSource | null): ReceivingSourceProjection | null { return source ? sourceProjection(source) : null; }

function provisioning(source: ReceivingSource, credential: string, signingKey: string): DeviceProvisioning {
  return {
    sourceId: source.id, credential, signingKey,
    androidInstructions: [
      "Open the merchant Android bridge and grant only the selected SMS and notification-listener permissions.",
      `Enter the bank sender/application name exactly as received: ${source.bankName}.`,
      "Transfer a small real amount to this store, then upload the resulting InstaPay transaction screenshot here.",
    ],
    iosInstructions: [
      "Create a personal Shortcut automation for each selected channel; never forward customer messages.",
      "Limit the automation to alerts from the exact bank name entered above and send only the alert fields to the device endpoint.",
      "Transfer a small real amount and upload the InstaPay transaction screenshot to run the same verification test.",
    ],
  };
}

function decodeImage(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0) throw new BadRequestException({ code: "INVALID_REQUEST" });
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 16 || bytes.length > 5 * 1_024 * 1_024 || bytes.toString("base64") !== value) throw new BadRequestException({ code: "INVALID_REQUEST" });
  return bytes;
}

function parseRequest<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException({ code: "INVALID_REQUEST" });
  return parsed.data;
}

function parseDeviceAlert(payload: string): z.infer<typeof deviceAlertSchema> & { signedPayload: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new BadRequestException({ code: "INVALID_REQUEST" });
  }
  return { ...parseRequest(deviceAlertSchema, decoded), signedPayload: payload };
}

function sourceError(error: unknown): Error {
  if (error instanceof ReceivingSourceNotFoundError) return new BadRequestException({ code: "INVALID_REQUEST" });
  if (error instanceof InvalidDeviceCredentialError || error instanceof InvalidDeviceSignatureError) return new UnauthorizedException({ code: "INVALID_DEVICE_AUTH" });
  if (error instanceof DuplicateDeviceEventError) return new ConflictException({ code: "DUPLICATE_DEVICE_EVENT" });
  if (error instanceof TestWindowExpiredError) return new ConflictException({ code: "TEST_WINDOW_EXPIRED" });
  if (error instanceof TestProofUnavailableError) return new ServiceUnavailableException({ code: "OCR_UNAVAILABLE" });
  if (error instanceof Error) return new BadRequestException({ code: "INVALID_REQUEST" });
  return new BadRequestException({ code: "INVALID_REQUEST" });
}
