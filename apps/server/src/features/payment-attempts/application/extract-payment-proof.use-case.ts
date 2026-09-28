import { Inject, Injectable } from "@nestjs/common";
import { MatchPaymentAttemptUseCase } from "./match-payment-attempt.use-case.js";
import { PRIVATE_OBJECT_STORAGE, type PrivateObjectStorage } from "../domain/ports.js";
import { PAYMENT_PROOF_OCR, PAYMENT_PROOF_REPOSITORY, type PaymentProofOcr, type PaymentProofRepository } from "../domain/payment-proof-extraction.ports.js";
import { PaymentProofOcrUnavailableError } from "../data/azure-vision-payment-proof-ocr.js";

@Injectable()
export class ExtractPaymentProofUseCase {
  public constructor(
    @Inject(PAYMENT_PROOF_REPOSITORY) private readonly proofs: PaymentProofRepository,
    @Inject(PAYMENT_PROOF_OCR) private readonly ocr: PaymentProofOcr,
    @Inject(PRIVATE_OBJECT_STORAGE) private readonly storage: PrivateObjectStorage,
    private readonly matcher: MatchPaymentAttemptUseCase,
  ) {}
  public async execute(attemptId: string): Promise<void> {
    const proof = await this.proofs.claimForExtraction(attemptId);
    if (!proof) return;
    try {
      const image = await this.storage.get(proof.proofStorageKey);
      if (image.contentType !== "image/jpeg") throw new Error("Canonical proof has an invalid media type.");
      const facts = await this.ocr.extract({ bytes: image.body, mediaType: image.contentType, recipientIpa: proof.recipientIpa, accountHolderName: proof.accountHolderName });
      if (!facts.successful || facts.amountMinor === undefined || facts.recipientNormalized === undefined) {
        await this.proofs.markUnreadable(attemptId, "PROOF_EXTRACTION_INSUFFICIENT");
        return;
      }
      await this.proofs.persistExtractedFacts({ attemptId, facts });
      await this.matcher.execute(attemptId);
    } catch (error) {
      if (error instanceof PaymentProofOcrUnavailableError) { await this.proofs.releaseExtractionClaim(attemptId); throw error; }
      await this.proofs.markUnreadable(attemptId, "PROOF_EXTRACTION_FAILED");
    }
  }
}
