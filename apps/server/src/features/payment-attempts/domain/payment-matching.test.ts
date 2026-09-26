import { describe, expect, it } from "vitest";
import { decidePaymentMatch, type MatchableAlert, type MatchableAttempt } from "./payment-matching.js";

const now = new Date("2026-09-27T10:00:00.000Z");
const attempt = (): MatchableAttempt => ({
  id: "attempt", storeId: "store", amountMinor: 12_550, recipientIpa: "merchant@instapay", accountHolderName: "Amina Store",
  proofSubmittedAt: now, expiresAt: new Date("2026-09-27T10:15:00.000Z"), matchingWindowMinutes: 15,
  proof: { successful: true, amountMinor: 12_550, recipientNormalized: "merchant@instapay", claimedAt: now.toISOString(), extractorVersion: "test" },
});
const alert = (receivedAt = new Date("2026-09-27T09:58:00.000Z")): MatchableAlert => ({
  id: "alert", sourceId: "source", amountMinor: 12_550, receivedAt, indicatesCredit: true, sourceIsActive: true,
  payerNameNormalized: null, transactionReferenceNormalized: null,
});

describe("deterministic payment matching", () => {
  it("approves when a trusted alert arrived before the screenshot submission but is inside the bidirectional window", () => {
    expect(decidePaymentMatch(attempt(), [alert()], now)).toMatchObject({ outcome: "automatically_approved", alertId: "alert" });
  });

  it("keeps an attempt awaiting a bank alert when the screenshot arrives first", () => {
    expect(decidePaymentMatch(attempt(), [], now)).toMatchObject({ outcome: "awaiting_bank_alert" });
  });

  it("marks otherwise eligible same-amount candidates ambiguous instead of guessing", () => {
    expect(decidePaymentMatch(attempt(), [alert(), { ...alert(), id: "second-alert" }], now)).toMatchObject({ outcome: "ambiguous_match" });
  });

  it("requires readable successful proof and an exact recipient match", () => {
    expect(decidePaymentMatch({ ...attempt(), proof: { ...attempt().proof, successful: false } }, [alert()], now)).toMatchObject({ outcome: "manual_verification_required" });
    expect(decidePaymentMatch({ ...attempt(), proof: { ...attempt().proof, recipientNormalized: "other@instapay" } }, [alert()], now)).toMatchObject({ outcome: "manual_verification_required" });
  });

  it("moves expired unmatched attempts to manual verification", () => {
    expect(decidePaymentMatch(attempt(), [], new Date("2026-09-27T10:16:00.000Z"))).toMatchObject({ outcome: "manual_verification_required", reasonCode: "MATCH_WINDOW_EXPIRED" });
  });
});
