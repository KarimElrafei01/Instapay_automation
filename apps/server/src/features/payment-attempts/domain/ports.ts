export const PAYMENT_ATTEMPT_REPOSITORY = Symbol("PAYMENT_ATTEMPT_REPOSITORY");
export const PROOF_IMAGE_PROCESSOR = Symbol("PROOF_IMAGE_PROCESSOR");
export const PRIVATE_OBJECT_STORAGE = Symbol("PRIVATE_OBJECT_STORAGE");

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp";
export type CheckoutStore = { id: string; ipa: string; accountHolderName: string; defaultWebhookUrl: string; matchingWindowMinutes: 5 | 10 | 15 | 20 | 30 };
export type HostedCheckoutSession = {
  id: string; publicId: string; storeId: string; merchantOrderId: string; orderReference: string; amountMinor: number; currency: "EGP";
  recipientIpa: string; accountHolderName: string; expiresAt: Date; status: "active" | "submitted" | "expired"; createdAt: Date;
};
export type StoredHostedCheckoutSession = HostedCheckoutSession & { checkoutTokenHash: Buffer; webhookUrl: string; matchingWindowMinutes: 5 | 10 | 15 | 20 | 30 };
export type PaymentAttempt = {
  id: string; publicId: string; checkoutSessionId: string; storeId: string; merchantOrderId: string; orderReference: string; amountMinor: number;
  currency: "EGP"; status: "awaiting_bank_alert"; proofStorageKey: string; proofInputSha256: Buffer; proofCanonicalSha256: Buffer;
  recipientIpa: string; accountHolderName: string; expiresAt: Date; createdAt: Date;
};
export type SubmittedProof = { storageKey: string; inputSha256: Buffer; canonicalSha256: Buffer; submittedAt: Date; retentionDeleteAt: Date };
export interface PaymentAttemptRepository {
  authenticateMerchantCredential(token: string): Promise<CheckoutStore | null>;
  createCheckoutSession(input: StoredHostedCheckoutSession): Promise<HostedCheckoutSession>;
  findCheckoutSession(publicId: string): Promise<StoredHostedCheckoutSession | null>;
  createAttemptFromSubmittedProof(session: StoredHostedCheckoutSession, proof: SubmittedProof): Promise<PaymentAttempt>;
}
export type ProcessedProofImage = { bytes: Uint8Array; mediaType: "image/jpeg"; inputSha256: Buffer; canonicalSha256: Buffer; width: number; height: number };
export interface ProofImageProcessor { process(input: { bytes: Uint8Array; declaredMediaType: ImageMediaType }): Promise<ProcessedProofImage>; }
export interface PrivateObjectStorage {
  put(input: { key: string; body: Uint8Array; contentType: ImageMediaType }): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: ImageMediaType }>;
  delete(key: string): Promise<void>;
}
