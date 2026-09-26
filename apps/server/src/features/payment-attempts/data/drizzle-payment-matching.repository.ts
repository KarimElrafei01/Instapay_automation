import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATA_ENCRYPTOR, type DataEncryptor } from "../../../shared/crypto/data-encryptor.js";
import { DATABASE, type Database } from "../../../shared/database/database.module.js";
import { alertEvents, auditRecords, paymentAttempts, receivingSources } from "../../../shared/database/schema.js";
import type { MatchableAlert, MatchableAttempt, ProofMatchFacts } from "../domain/payment-matching.js";
import type { PaymentMatchingRepository, PersistedMatchDecision } from "../domain/payment-matching.ports.js";

@Injectable()
export class DrizzlePaymentMatchingRepository implements PaymentMatchingRepository {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DATA_ENCRYPTOR) private readonly encryptor: DataEncryptor,
  ) {}

  public async findAttemptForMatch(attemptId: string): Promise<MatchableAttempt | null> {
    const [row] = await this.database.select().from(paymentAttempts)
      .where(and(eq(paymentAttempts.id, attemptId), eq(paymentAttempts.status, "awaiting_bank_alert"), eq(paymentAttempts.proofState, "extracted"))).limit(1);
    if (!row || !row.proofSubmittedAt || !row.proofMatchFactsEncrypted) return null;
    const proof = decryptProofFacts(row.proofMatchFactsEncrypted, this.encryptor);
    if (!proof) return null;
    return {
      id: row.id, storeId: row.storeId, amountMinor: row.amountMinor, recipientIpa: row.recipientIpaSnapshot,
      accountHolderName: row.accountHolderNameSnapshot, proofSubmittedAt: row.proofSubmittedAt, expiresAt: row.expiresAt,
      matchingWindowMinutes: row.matchingWindowMinutesSnapshot as MatchableAttempt["matchingWindowMinutes"], proof,
    };
  }

  public async findUnallocatedAlertsForAttempt(attempt: MatchableAttempt): Promise<MatchableAlert[]> {
    const rows = await this.database.select({ alert: alertEvents, sourceStatus: receivingSources.status })
      .from(alertEvents).innerJoin(receivingSources, eq(alertEvents.sourceId, receivingSources.id))
      .where(and(
        eq(receivingSources.storeId, attempt.storeId),
        eq(alertEvents.isTest, false),
        isNull(alertEvents.matchedAttemptId),
        eq(alertEvents.parseState, "parsed"),
        eq(alertEvents.amountMinor, attempt.amountMinor),
      ));
    return rows.map(({ alert, sourceStatus }) => ({
      id: alert.id, sourceId: alert.sourceId, amountMinor: alert.amountMinor, receivedAt: alert.receivedAt,
      indicatesCredit: alert.direction === "credit", sourceIsActive: sourceStatus === "active",
      payerNameNormalized: alert.payerNameNormalized, transactionReferenceNormalized: alert.transactionReferenceNormalized,
    }));
  }

  public async persistDecision(attempt: MatchableAttempt, decision: PersistedMatchDecision, evaluatedAt: Date): Promise<{ allocationWon: boolean }> {
    return this.database.transaction(async (transaction) => {
      let allocationWon = true;
      if (decision.outcome === "automatically_approved") {
        if (!decision.alertId) throw new Error("Automatic approval is missing an alert allocation.");
        const [claimedAlert] = await transaction.update(alertEvents).set({ matchedAttemptId: attempt.id })
          .where(and(eq(alertEvents.id, decision.alertId), isNull(alertEvents.matchedAttemptId))).returning({ id: alertEvents.id });
        allocationWon = Boolean(claimedAlert);
        if (!allocationWon) return { allocationWon: false };
      }

      if (decision.outcome !== "awaiting_bank_alert") {
        const [updatedAttempt] = await transaction.update(paymentAttempts).set({
          status: decision.outcome,
          approvedAt: decision.outcome === "automatically_approved" ? evaluatedAt : null,
          statusUpdatedAt: evaluatedAt,
          updatedAt: evaluatedAt,
          version: sql`${paymentAttempts.version} + 1`,
        }).where(and(eq(paymentAttempts.id, attempt.id), eq(paymentAttempts.status, "awaiting_bank_alert"))).returning({ id: paymentAttempts.id });
        if (!updatedAttempt) throw new ConcurrentMatchStateChangedError();
      }

      await transaction.insert(auditRecords).values({
        storeId: attempt.storeId,
        attemptId: attempt.id,
        alertEventId: decision.alertId,
        actorType: "system",
        action: "payment_match_evaluated",
        outcome: decision.outcome,
        reasonCode: decision.reasonCode,
        ruleResults: decision.ruleResults,
      });
      return { allocationWon };
    });
  }

  public async findAwaitingAttemptIdsForAlert(alertId: string): Promise<string[]> {
    const [alert] = await this.database.select({ sourceId: alertEvents.sourceId, amountMinor: alertEvents.amountMinor })
      .from(alertEvents).where(eq(alertEvents.id, alertId)).limit(1);
    if (!alert || alert.amountMinor === null) return [];
    const rows = await this.database.select({ id: paymentAttempts.id }).from(paymentAttempts)
      .innerJoin(receivingSources, eq(receivingSources.storeId, paymentAttempts.storeId))
      .where(and(
        eq(receivingSources.id, alert.sourceId),
        eq(paymentAttempts.status, "awaiting_bank_alert"),
        eq(paymentAttempts.amountMinor, alert.amountMinor),
      ));
    return rows.map((row) => row.id);
  }
}

class ConcurrentMatchStateChangedError extends Error {}

function decryptProofFacts(ciphertext: Buffer, encryptor: DataEncryptor): ProofMatchFacts | null {
  try {
    const value: unknown = JSON.parse(encryptor.decrypt(ciphertext));
    if (typeof value !== "object" || value === null) return null;
    const facts = value as Record<string, unknown>;
    if (typeof facts.successful !== "boolean" || typeof facts.extractorVersion !== "string") return null;
    return {
      successful: facts.successful,
      amountMinor: typeof facts.amountMinor === "number" ? facts.amountMinor : undefined,
      recipientNormalized: typeof facts.recipientNormalized === "string" ? facts.recipientNormalized : undefined,
      claimedAt: typeof facts.claimedAt === "string" ? facts.claimedAt : undefined,
      payerNormalized: typeof facts.payerNormalized === "string" ? facts.payerNormalized : undefined,
      transactionReferenceNormalized: typeof facts.transactionReferenceNormalized === "string" ? facts.transactionReferenceNormalized : undefined,
      extractorVersion: facts.extractorVersion,
    };
  } catch { return null; }
}
