export type ProofMatchFacts = {
  successful: boolean;
  amountMinor?: number | undefined;
  recipientNormalized?: string | undefined;
  claimedAt?: string | undefined;
  payerNormalized?: string | undefined;
  transactionReferenceNormalized?: string | undefined;
  extractorVersion: string;
};

export type MatchableAttempt = {
  id: string; storeId: string; amountMinor: number; recipientIpa: string; accountHolderName: string;
  proofSubmittedAt: Date; expiresAt: Date; matchingWindowMinutes: 5 | 10 | 15 | 20 | 30; proof: ProofMatchFacts;
};

export type MatchableAlert = {
  id: string; sourceId: string; amountMinor: number | null; receivedAt: Date; indicatesCredit: boolean; sourceIsActive: boolean;
  payerNameNormalized: string | null; transactionReferenceNormalized: string | null;
};

export type MatchDecision = {
  outcome: "awaiting_bank_alert" | "automatically_approved" | "ambiguous_match" | "manual_verification_required";
  reasonCode: string;
  alertId: string | null;
  ruleResults: Record<string, boolean | string | number | null>;
};

export function decidePaymentMatch(attempt: MatchableAttempt, alerts: readonly MatchableAlert[], evaluatedAt: Date): MatchDecision {
  const proofRules = evaluateProof(attempt);
  if (!proofRules.successful || !proofRules.exactAmount || !proofRules.recipientMatches) {
    return decision("manual_verification_required", "PROOF_RULES_NOT_SATISFIED", null, proofRules);
  }
  if (attempt.expiresAt <= evaluatedAt) return decision("manual_verification_required", "MATCH_WINDOW_EXPIRED", null, proofRules);

  const anchor = claimedAtOrSubmission(attempt.proof.claimedAt, attempt.proofSubmittedAt);
  const halfWindow = attempt.matchingWindowMinutes * 60_000;
  const eligible = alerts.filter((alert) => isEligibleAlert(alert, attempt, anchor, halfWindow));
  const ruleResults = { ...proofRules, alertCandidateCount: eligible.length, bidirectionalWindow: true, noBlockingRiskFlag: true };
  if (eligible.length === 0) return decision("awaiting_bank_alert", "NO_UNIQUE_ELIGIBLE_ALERT", null, ruleResults);
  if (eligible.length > 1) return decision("ambiguous_match", "MULTIPLE_ELIGIBLE_ALERTS", null, ruleResults);
  const candidate = eligible[0];
  if (!candidate) return decision("awaiting_bank_alert", "NO_UNIQUE_ELIGIBLE_ALERT", null, ruleResults);
  return decision("automatically_approved", "ALL_REQUIRED_RULES_PASSED", candidate.id, { ...ruleResults, alertCredit: true, alertSourceActive: true, alertAmountMatches: true });
}

function evaluateProof(attempt: MatchableAttempt): Record<string, boolean | string | number | null> {
  const recipient = normalize(attempt.proof.recipientNormalized ?? "");
  const expectedIpa = normalize(attempt.recipientIpa);
  const expectedName = normalize(attempt.accountHolderName);
  return {
    successful: attempt.proof.successful,
    exactAmount: attempt.proof.amountMinor === attempt.amountMinor,
    recipientMatches: recipient === expectedIpa || recipient === expectedName,
  };
}

function isEligibleAlert(alert: MatchableAlert, attempt: MatchableAttempt, anchor: Date, halfWindowMs: number): boolean {
  if (!alert.sourceIsActive || !alert.indicatesCredit || alert.amountMinor !== attempt.amountMinor) return false;
  if (Math.abs(alert.receivedAt.getTime() - anchor.getTime()) > halfWindowMs) return false;
  if (!sameWhenBothPresent(attempt.proof.payerNormalized, alert.payerNameNormalized)) return false;
  return sameWhenBothPresent(attempt.proof.transactionReferenceNormalized, alert.transactionReferenceNormalized);
}

function claimedAtOrSubmission(claimedAt: string | undefined, submittedAt: Date): Date {
  if (!claimedAt) return submittedAt;
  const parsed = new Date(claimedAt);
  return Number.isNaN(parsed.getTime()) ? submittedAt : parsed;
}

function sameWhenBothPresent(left: string | undefined, right: string | null): boolean { return !left || !right || normalize(left) === normalize(right); }
function normalize(value: string): string { return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim(); }
function decision(outcome: MatchDecision["outcome"], reasonCode: string, alertId: string | null, ruleResults: Record<string, boolean | string | number | null>): MatchDecision { return { outcome, reasonCode, alertId, ruleResults }; }
