import { describe, expect, it, vi } from "vitest";
import { ExtractPaymentProofUseCase } from "./extract-payment-proof.use-case.js";
import { PaymentProofOcrUnavailableError } from "../data/azure-vision-payment-proof-ocr.js";
import type { PaymentProofOcr, PaymentProofRepository } from "../domain/payment-proof-extraction.ports.js";
import type { PrivateObjectStorage } from "../domain/ports.js";

const claimedProof = { attemptId: "attempt-1", storeId: "store-1", proofStorageKey: "payment-attempt-proofs/session/proof.jpg", recipientIpa: "merchant@instapay", accountHolderName: "Merchant Name" };
const storage: PrivateObjectStorage = { put: async () => undefined, get: async () => ({ body: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" }), delete: async () => undefined };

describe("ExtractPaymentProofUseCase", () => {
  it("persists compact facts then evaluates the attempt against stored alerts", async () => {
    const repository = new FakeProofRepository(claimedProof);
    const matcher = { execute: vi.fn(async () => null) };
    const ocr: PaymentProofOcr = { extract: async () => ({ successful: true, amountMinor: 12_500, recipientNormalized: "merchant@instapay", payerNormalized: "customer", transactionReferenceNormalized: "ref-1234", extractorVersion: "test" }) };
    await new ExtractPaymentProofUseCase(repository, ocr, storage, matcher as never).execute("attempt-1");
    expect(repository.persisted).toHaveLength(1);
    expect(repository.unreadable).toEqual([]);
    expect(matcher.execute).toHaveBeenCalledWith("attempt-1");
  });

  it("requires a readable successful transfer, exact extraction is evaluated separately", async () => {
    const repository = new FakeProofRepository(claimedProof);
    const matcher = { execute: vi.fn(async () => null) };
    const ocr: PaymentProofOcr = { extract: async () => ({ successful: false, amountMinor: undefined, recipientNormalized: undefined, extractorVersion: "test" }) };
    await new ExtractPaymentProofUseCase(repository, ocr, storage, matcher as never).execute("attempt-1");
    expect(repository.persisted).toEqual([]);
    expect(repository.unreadable).toEqual(["PROOF_EXTRACTION_INSUFFICIENT"]);
    expect(matcher.execute).not.toHaveBeenCalled();
  });

  it("releases the claim when OCR is temporarily unavailable so a worker can retry", async () => {
    const repository = new FakeProofRepository(claimedProof);
    const matcher = { execute: vi.fn(async () => null) };
    const ocr: PaymentProofOcr = { extract: async () => { throw new PaymentProofOcrUnavailableError(); } };
    await expect(new ExtractPaymentProofUseCase(repository, ocr, storage, matcher as never).execute("attempt-1")).rejects.toBeInstanceOf(PaymentProofOcrUnavailableError);
    expect(repository.released).toEqual(["attempt-1"]);
  });
});

class FakeProofRepository implements PaymentProofRepository {
  public persisted: Array<{ attemptId: string }> = [];
  public unreadable: string[] = [];
  public released: string[] = [];
  public constructor(private readonly proof: typeof claimedProof | null) {}
  public async claimForExtraction() { return this.proof; }
  public async persistExtractedFacts(input: { attemptId: string }) { this.persisted.push({ attemptId: input.attemptId }); }
  public async markUnreadable(_attemptId: string, reasonCode: string) { this.unreadable.push(reasonCode); }
  public async releaseExtractionClaim(attemptId: string) { this.released.push(attemptId); }
}
