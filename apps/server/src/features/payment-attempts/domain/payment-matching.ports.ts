import type { MatchableAttempt } from "./payment-matching.js";

export const PAYMENT_MATCHING_REPOSITORY = Symbol("PAYMENT_MATCHING_REPOSITORY");

export type PersistedMatchDecision = {
  outcome: "awaiting_bank_alert" | "automatically_approved" | "ambiguous_match" | "manual_verification_required";
  reasonCode: string;
  alertId: string | null;
  ruleResults: Record<string, boolean | string | number | null>;
};

export interface PaymentMatchingRepository {
  findAttemptForMatch(attemptId: string): Promise<MatchableAttempt | null>;
  findUnallocatedAlertsForAttempt(attempt: MatchableAttempt): Promise<import("./payment-matching.js").MatchableAlert[]>;
  persistDecision(attempt: MatchableAttempt, decision: PersistedMatchDecision, evaluatedAt: Date): Promise<{ allocationWon: boolean }>;
  findAwaitingAttemptIdsForAlert(alertId: string): Promise<string[]>;
}
