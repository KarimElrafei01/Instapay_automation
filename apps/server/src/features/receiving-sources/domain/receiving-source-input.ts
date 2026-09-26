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
  return { ...alert, amountMinor, indicatesCredit };
}

export function extractAmountMinor(value: string): number | null {
  const match = /(?:egp|ج\.?\s*م|جنيه)?\s*([0-9]{1,9})(?:[.,]([0-9]{1,2}))?\s*(?:egp|ج\.?\s*م|جنيه)/iu.exec(value);
  if (!match) return null;
  const whole = Number.parseInt(match[1] ?? "", 10);
  const fractional = (match[2] ?? "").padEnd(2, "0");
  const cents = fractional.length > 0 ? Number.parseInt(fractional, 10) : 0;
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(cents)) return null;
  return whole * 100 + cents;
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
