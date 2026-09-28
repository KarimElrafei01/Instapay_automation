import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CreateHostedCheckoutUseCase, InvalidCheckoutSubmissionError, SubmitCheckoutProofUseCase } from "./checkout-payment.use-cases.js";
import type { CheckoutStore, PaymentAttemptRepository, PrivateObjectStorage, ProofImageProcessor, StoredHostedCheckoutSession, SubmittedProof } from "../domain/ports.js";
const store: CheckoutStore = { id: "store", ipa: "merchant@instapay", accountHolderName: "Amina", defaultWebhookUrl: "https://merchant.test/webhook", matchingWindowMinutes: 15 };
const processor: ProofImageProcessor = { process: async ({ bytes }) => ({ bytes: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg", inputSha256: sha(bytes), canonicalSha256: sha("canonical"), width: 1080, height: 1920 }) };
const storage: PrivateObjectStorage = { put: async () => undefined, get: async () => ({ body: new Uint8Array(), contentType: "image/jpeg" }), delete: async () => undefined };
describe("hosted checkout proof submission", () => {
  it("does not create an attempt until the customer submits the screenshot", async () => {
    const repository = new FakeRepository(); const create = new CreateHostedCheckoutUseCase(repository); const submit = new SubmitCheckoutProofUseCase(repository, processor, storage);
    const checkout = await create.execute(store, { merchantOrderId: "ORD-1", amountMinor: 12_550 });
    expect(repository.attempts).toHaveLength(0);
    const attempt = await submit.execute({ checkoutPublicId: checkout.publicId, checkoutToken: checkout.checkoutToken, bytes: new Uint8Array(2_000), mediaType: "image/png" });
    expect(attempt).toMatchObject({ merchantOrderId: "ORD-1", amountMinor: 12_550, status: "awaiting_bank_alert", recipientIpa: store.ipa });
    expect(repository.attempts).toHaveLength(1);
  });
  it("rejects submissions with a missing or invalid checkout token", async () => {
    const repository = new FakeRepository(); const create = new CreateHostedCheckoutUseCase(repository); const submit = new SubmitCheckoutProofUseCase(repository, processor, storage); const checkout = await create.execute(store, { merchantOrderId: "ORD-2", amountMinor: 100 });
    await expect(submit.execute({ checkoutPublicId: checkout.publicId, checkoutToken: "x", bytes: new Uint8Array(2_000), mediaType: "image/png" })).rejects.toBeInstanceOf(InvalidCheckoutSubmissionError);
  });
});
class FakeRepository implements PaymentAttemptRepository {
  public readonly sessions = new Map<string, StoredHostedCheckoutSession>(); public readonly attempts: SubmittedProof[] = [];
  public async authenticateMerchantCredential() { return null; }
  public async createCheckoutSession(input: StoredHostedCheckoutSession) { this.sessions.set(input.publicId, input); const { checkoutTokenHash: _hash, webhookUrl: _url, matchingWindowMinutes: _window, ...session } = input; return session; }
  public async findCheckoutSession(publicId: string) { return this.sessions.get(publicId) ?? null; }
  public async createAttemptFromSubmittedProof(session: StoredHostedCheckoutSession, proof: SubmittedProof) { this.attempts.push(proof); return { id: "attempt", publicId: "pat_test", checkoutSessionId: session.id, storeId: session.storeId, merchantOrderId: session.merchantOrderId, orderReference: session.orderReference, amountMinor: session.amountMinor, currency: "EGP" as const, status: "awaiting_bank_alert" as const, proofStorageKey: proof.storageKey, proofInputSha256: proof.inputSha256, proofCanonicalSha256: proof.canonicalSha256, recipientIpa: session.recipientIpa, accountHolderName: session.accountHolderName, expiresAt: session.expiresAt, createdAt: new Date() }; }
}
function sha(value: Uint8Array | string): Buffer { return createHash("sha256").update(value).digest(); }
