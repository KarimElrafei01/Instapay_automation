import { createHmac, timingSafeEqual } from "node:crypto";
import type { DeviceTestAlert, ParsedTestAlert, ReceivingChannel } from "./ports.js";

const channelSet = new Set<ReceivingChannel>(["sms", "notification"]);

export function canonicalizeBankName(value: string): string {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized.length < 2 || normalized.length > 120) throw new Error("Invalid bank name.");
  return normalized;
}

export function normalizeBankIdentity(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

export function canonicalizeChannels(channels: readonly string[]): ReceivingChannel[] {
  if (channels.length < 1 || channels.length > 2 || new Set(channels).size !== channels.length) {
    throw new Error("At least one distinct channel is required.");
  }
  if (!channels.every((channel): channel is ReceivingChannel => channelSet.has(channel as ReceivingChannel))) {
    throw new Error("Unsupported channel.");
  }
  return [...channels] as ReceivingChannel[];
}

export function parseTestAlert(alert: DeviceTestAlert): ParsedTestAlert {
  const amountMinor = extractAmountMinor(alert.rawText);
  const text = alert.rawText.normalize("NFKC").toLocaleLowerCase("en-US");
  const indicatesCredit = /\b(credited|received|deposit|transferred to)\b|تم (?:إيداع|استلام)|تمت إضافة/iu.test(text);
  return { ...alert, amountMinor, indicatesCredit, payerNameNormalized: extractPayerName(alert.rawText), transactionReferenceNormalized: extractTransactionReference(alert.rawText) };
}

export function extractTransactionReference(value: string): string | null {
  const match = /(?:reference|ref\.?|transaction(?:\s+id)?|txn|رقم\s+(?:المرجع|العملية))\s*[:#-]?\s*([a-z0-9-]{4,80})/iu.exec(normalizeDigits(value));
  return match?.[1] ? normalizePaymentIdentity(match[1]) : null;
}

export function extractPayerName(value: string): string | null {
  const match = /(?:from|sender|payer|من)\s*[:\-]?\s*([\p{L}][\p{L}\s'-]{1,80}?)(?=\s*(?:[.,;،؛]|(?:reference|ref\.?|transaction|txn|رقم)\b|$))/iu.exec(value.normalize("NFKC"));
  if (!match?.[1]) return null;
  const normalized = normalizePaymentIdentity(match[1]);
  return normalized.length >= 2 ? normalized : null;
}

export function normalizePaymentIdentity(value: string): string {
  return normalizeDigits(value).toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

export function extractAmountMinor(value: string): number | null {
  const normalized = normalizeDigits(value);
  const match = /(?:egp|ج\.?\s*م|جنيه)\s*([0-9]{1,9})(?:[.,]([0-9]{1,2}))?/iu.exec(normalized)
    ?? /([0-9]{1,9})(?:[.,]([0-9]{1,2}))?\s*(?:egp|ج\.?\s*م|جنيه)/iu.exec(normalized);
  if (!match) return null;
  const whole = Number.parseInt(match[1] ?? "", 10);
  const fractional = (match[2] ?? "").padEnd(2, "0");
  const cents = fractional.length > 0 ? Number.parseInt(fractional, 10) : 0;
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(cents)) return null;
  return whole * 100 + cents;
}

function normalizeDigits(value: string): string {
  return value.normalize("NFKC").replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0)).replace(/٫/gu, ".").replace(/٬/gu, ",");
}

export function signatureFor(body: string, signingKey: string): string {
  return createHmac("sha256", signingKey).update(body, "utf8").digest("base64url");
}

export function canonicalDeviceAlertPayload(alert: DeviceTestAlert): string {
  return JSON.stringify({
    eventId: alert.eventId,
    channel: alert.channel,
    senderIdentity: alert.senderIdentity,
    rawText: alert.rawText,
    receivedAt: alert.receivedAt.toISOString(),
  });
}

export function hasValidSignature(body: string, signingKey: string, signature: string | undefined): boolean {
  if (!signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const expected = Buffer.from(signatureFor(body, signingKey));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
