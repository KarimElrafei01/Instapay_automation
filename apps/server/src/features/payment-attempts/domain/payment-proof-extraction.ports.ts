import type { ProofMatchFacts } from "./payment-matching.js";

export const PAYMENT_PROOF_REPOSITORY = Symbol("PAYMENT_PROOF_REPOSITORY");
export const PAYMENT_PROOF_OCR = Symbol("PAYMENT_PROOF_OCR");

export type PaymentProofForExtraction = {
  attemptId: string;
  storeId: string;
  proofStorageKey: string;
  recipientIpa: string;
  accountHolderName: string;
};

export interface PaymentProofRepository {
  claimForExtraction(attemptId: string): Promise<PaymentProofForExtraction | null>;
  persistExtractedFacts(input: { attemptId: string; facts: ProofMatchFacts }): Promise<void>;
  markUnreadable(attemptId: string, reasonCode: string): Promise<void>;
  releaseExtractionClaim(attemptId: string): Promise<void>;
}

export interface PaymentProofOcr {
  extract(input: { bytes: Uint8Array; mediaType: "image/jpeg"; recipientIpa: string; accountHolderName: string }): Promise<ProofMatchFacts>;
}
