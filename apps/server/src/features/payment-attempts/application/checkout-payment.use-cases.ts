import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { PAYMENT_ATTEMPT_REPOSITORY, PRIVATE_OBJECT_STORAGE, PROOF_IMAGE_PROCESSOR, type CheckoutStore, type HostedCheckoutSession, type ImageMediaType, type PaymentAttempt, type PaymentAttemptRepository, type PrivateObjectStorage, type ProofImageProcessor } from "../domain/ports.js";

const CHECKOUT_SESSION_WINDOW_MS = 30 * 60 * 1_000;
const PROOF_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export type CreateHostedCheckoutCommand = { merchantOrderId: string; orderReference?: string | undefined; amountMinor: number };

@Injectable()
export class CreateHostedCheckoutUseCase {
  public constructor(@Inject(PAYMENT_ATTEMPT_REPOSITORY) private readonly repository: PaymentAttemptRepository) {}
  public async execute(store: CheckoutStore, command: CreateHostedCheckoutCommand): Promise<HostedCheckoutSession & { checkoutToken: string }> {
    validateCheckout(command);
    const checkoutToken = randomBytes(32).toString("base64url");
    const createdAt = new Date();
    const session = await this.repository.createCheckoutSession({
      id: randomUUID(), publicId: `pcs_${randomBytes(18).toString("base64url")}`, storeId: store.id, merchantOrderId: command.merchantOrderId,
      orderReference: command.orderReference ?? command.merchantOrderId, amountMinor: command.amountMinor, currency: "EGP", recipientIpa: store.ipa,
      accountHolderName: store.accountHolderName, status: "active", expiresAt: new Date(createdAt.getTime() + CHECKOUT_SESSION_WINDOW_MS), createdAt,
      checkoutTokenHash: hashToken(checkoutToken), webhookUrl: store.defaultWebhookUrl, matchingWindowMinutes: store.matchingWindowMinutes,
    });
    return { ...session, checkoutToken };
  }
}

@Injectable()
export class CreateMerchantHostedCheckoutUseCase {
  public constructor(@Inject(PAYMENT_ATTEMPT_REPOSITORY) private readonly repository: PaymentAttemptRepository, private readonly create: CreateHostedCheckoutUseCase) {}
  public async execute(credential: string, command: CreateHostedCheckoutCommand): Promise<HostedCheckoutSession & { checkoutToken: string }> {
    const store = await this.repository.authenticateMerchantCredential(credential);
    if (!store) throw new InvalidMerchantCredentialError();
    return this.create.execute(store, command);
  }
}

@Injectable()
export class GetHostedCheckoutUseCase {
  public constructor(@Inject(PAYMENT_ATTEMPT_REPOSITORY) private readonly repository: PaymentAttemptRepository) {}
  public async execute(publicId: string, checkoutToken: string): Promise<HostedCheckoutSession> {
    const session = await this.repository.findCheckoutSession(publicId);
    if (!session || !validToken(session.checkoutTokenHash, checkoutToken) || session.status !== "active" || session.expiresAt <= new Date()) throw new InvalidCheckoutSubmissionError();
    const { checkoutTokenHash: _hash, webhookUrl: _url, matchingWindowMinutes: _window, ...publicSession } = session;
    return publicSession;
  }
}

@Injectable()
export class SubmitCheckoutProofUseCase {
  public constructor(
    @Inject(PAYMENT_ATTEMPT_REPOSITORY) private readonly repository: PaymentAttemptRepository,
    @Inject(PROOF_IMAGE_PROCESSOR) private readonly images: ProofImageProcessor,
    @Inject(PRIVATE_OBJECT_STORAGE) private readonly storage: PrivateObjectStorage,
  ) {}
  public async execute(input: { checkoutPublicId: string; checkoutToken: string; bytes: Uint8Array; mediaType: ImageMediaType }): Promise<PaymentAttempt> {
    const session = await this.repository.findCheckoutSession(input.checkoutPublicId);
    if (!session || !validToken(session.checkoutTokenHash, input.checkoutToken) || session.status !== "active" || session.expiresAt <= new Date()) throw new InvalidCheckoutSubmissionError();
    const image = await this.images.process({ bytes: input.bytes, declaredMediaType: input.mediaType });
    const objectKey = `payment-attempt-proofs/${session.id}/${randomUUID()}.jpg`;
    await this.storage.put({ key: objectKey, body: image.bytes, contentType: image.mediaType });
    try {
      const submittedAt = new Date();
      return await this.repository.createAttemptFromSubmittedProof(session, { storageKey: objectKey, inputSha256: image.inputSha256, canonicalSha256: image.canonicalSha256, submittedAt, retentionDeleteAt: new Date(submittedAt.getTime() + PROOF_RETENTION_MS) });
    } catch (error) {
      await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
  }
}
export class InvalidCheckoutSubmissionError extends Error {}
export class InvalidMerchantCredentialError extends Error {}
function validateCheckout(command: CreateHostedCheckoutCommand): void {
  if (!/^[\x21-\x7e]{1,128}$/u.test(command.merchantOrderId)) throw new Error("Invalid merchant order ID.");
  if (command.orderReference !== undefined && !/^[\x20-\x7e]{1,100}$/u.test(command.orderReference)) throw new Error("Invalid order reference.");
  if (!Number.isSafeInteger(command.amountMinor) || command.amountMinor < 100 || command.amountMinor > 10_000_000) throw new Error("Invalid amount.");
}
function hashToken(value: string): Buffer { return createHash("sha256").update(value, "utf8").digest(); }
function validToken(expected: Buffer, supplied: string): boolean { const candidate = hashToken(supplied); return /^[A-Za-z0-9_-]{43}$/u.test(supplied) && candidate.length === expected.length && timingSafeEqual(candidate, expected); }
