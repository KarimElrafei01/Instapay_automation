import { describe, expect, it } from "vitest";
import { parseTestAlert } from "./receiving-source-input.js";

describe("parseTestAlert", () => {
  it("derives matching facts only from the actual received notification body", () => {
    const parsed = parseTestAlert({
      eventId: "00000000-0000-4000-8000-000000000001",
      channel: "sms",
      senderIdentity: "Bank Alerts",
      rawText: "EGP 125.00 credited to your account from: Customer One. Reference: TXN-1234",
      receivedAt: new Date("2026-09-27T10:00:00.000Z"),
    });
    expect(parsed.amountMinor).toBe(12_500);
    expect(parsed.indicatesCredit).toBe(true);
    expect(parsed.payerNameNormalized).toBe("customer one");
    expect(parsed.transactionReferenceNormalized).toBe("txn-1234");
  });

  it("understands Arabic numerals in a notification body", () => {
    const parsed = parseTestAlert({
      eventId: "00000000-0000-4000-8000-000000000002",
      channel: "notification",
      senderIdentity: "Bank Alerts",
      rawText: "تمت إضافة ١٢٥٫٥٠ جنيه إلى حسابك من: أحمد علي. رقم المرجع: TXN-5678",
      receivedAt: new Date("2026-09-27T10:00:00.000Z"),
    });
    expect(parsed.amountMinor).toBe(12_550);
    expect(parsed.indicatesCredit).toBe(true);
    expect(parsed.payerNameNormalized).toBe("أحمد علي");
    expect(parsed.transactionReferenceNormalized).toBe("txn-5678");
  });
});
