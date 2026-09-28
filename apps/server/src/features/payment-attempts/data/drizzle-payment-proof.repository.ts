import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DATA_ENCRYPTOR, type DataEncryptor } from "../../../shared/crypto/data-encryptor.js";
import { DATABASE, type Database } from "../../../shared/database/database.module.js";
import { auditRecords, paymentAttempts } from "../../../shared/database/schema.js";
import type { PaymentProofForExtraction, PaymentProofRepository } from "../domain/payment-proof-extraction.ports.js";
import type { ProofMatchFacts } from "../domain/payment-matching.js";

@Injectable()
export class DrizzlePaymentProofRepository implements PaymentProofRepository {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DATA_ENCRYPTOR) private readonly encryptor: DataEncryptor,
  ) {}

  public async claimForExtraction(attemptId: string): Promise<PaymentProofForExtraction | null> {
    const [row] = await this.database.update(paymentAttempts)
      .set({ proofState: "extracting", updatedAt: new Date(), version: sql`${paymentAttempts.version} + 1` })
      .where(and(
        eq(paymentAttempts.id, attemptId),
        eq(paymentAttempts.status, "awaiting_bank_alert"),
        eq(paymentAttempts.proofState, "uploaded"),
      ))
      .returning({
        attemptId: paymentAttempts.id,
        storeId: paymentAttempts.storeId,
        proofStorageKey: paymentAttempts.proofStorageKey,
        recipientIpa: paymentAttempts.recipientIpaSnapshot,
        accountHolderName: paymentAttempts.accountHolderNameSnapshot,
      });
    if (!row?.proofStorageKey) return null;
    return {
      attemptId: row.attemptId,
      storeId: row.storeId,
      proofStorageKey: row.proofStorageKey,
      recipientIpa: row.recipientIpa,
      accountHolderName: row.accountHolderName,
    };
  }

  public async persistExtractedFacts(input: { attemptId: string; facts: ProofMatchFacts }): Promise<void> {
    const now = new Date();
    await this.database.transaction(async (transaction) => {
      const [attempt] = await transaction.update(paymentAttempts)
        .set({
          proofState: "extracted",
          proofMatchFactsEncrypted: this.encryptor.encrypt(JSON.stringify(input.facts)),
          updatedAt: now,
          version: sql`${paymentAttempts.version} + 1`,
        })
        .where(and(eq(paymentAttempts.id, input.attemptId), eq(paymentAttempts.status, "awaiting_bank_alert"), eq(paymentAttempts.proofState, "extracting")))
        .returning({
          id: paymentAttempts.id,
          storeId: paymentAttempts.storeId,
          proofRevision: paymentAttempts.proofRevision,
          proofCanonicalSha256: paymentAttempts.proofCanonicalSha256,
        });
      if (!attempt) throw new PaymentProofStateChangedError();
      await transaction.insert(auditRecords).values({
        storeId: attempt.storeId,
        attemptId: attempt.id,
        actorType: "system",
        action: "payment_proof_extracted",
        outcome: "completed",
        reasonCode: "EXTRACTION_FACTS_PERSISTED",
        ruleResults: {
          successfulTransfer: input.facts.successful,
          amountExtracted: input.facts.amountMinor !== undefined,
          recipientExtracted: input.facts.recipientNormalized !== undefined,
          payerExtracted: input.facts.payerNormalized !== undefined,
          referenceExtracted: input.facts.transactionReferenceNormalized !== undefined,
        },
        proofRevision: attempt.proofRevision,
        proofCanonicalSha256: attempt.proofCanonicalSha256,
      });
    });
  }

  public async markUnreadable(attemptId: string, reasonCode: string): Promise<void> {
    const now = new Date();
    await this.database.transaction(async (transaction) => {
      const [attempt] = await transaction.update(paymentAttempts)
        .set({
          proofState: "unreadable",
          status: "manual_verification_required",
          statusUpdatedAt: now,
          updatedAt: now,
          version: sql`${paymentAttempts.version} + 1`,
        })
        .where(and(eq(paymentAttempts.id, attemptId), eq(paymentAttempts.status, "awaiting_bank_alert"), eq(paymentAttempts.proofState, "extracting")))
        .returning({
          id: paymentAttempts.id,
          storeId: paymentAttempts.storeId,
          proofRevision: paymentAttempts.proofRevision,
          proofCanonicalSha256: paymentAttempts.proofCanonicalSha256,
        });
      if (!attempt) return;
      await transaction.insert(auditRecords).values({
        storeId: attempt.storeId,
        attemptId: attempt.id,
        actorType: "system",
        action: "payment_proof_extracted",
        outcome: "manual_verification_required",
        reasonCode,
        ruleResults: { proofReadable: false },
        proofRevision: attempt.proofRevision,
        proofCanonicalSha256: attempt.proofCanonicalSha256,
      });
    });
  }

  public async releaseExtractionClaim(attemptId: string): Promise<void> {
    await this.database.update(paymentAttempts)
      .set({ proofState: "uploaded", updatedAt: new Date(), version: sql`${paymentAttempts.version} + 1` })
      .where(and(eq(paymentAttempts.id, attemptId), eq(paymentAttempts.status, "awaiting_bank_alert"), eq(paymentAttempts.proofState, "extracting")));
  }
}

class PaymentProofStateChangedError extends Error {}
