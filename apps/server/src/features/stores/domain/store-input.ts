import type { MatchingWindowMinutes } from "./ports.js";

const matchingWindows: readonly MatchingWindowMinutes[] = [5, 10, 15, 20, 30];
const ipaPattern = /^[a-z0-9][a-z0-9._-]{2,63}@instapay$/;

export function canonicalizeStoreName(value: string): string {
  return canonicalizeText(value, 1, 120, "Store name");
}

export function canonicalizeAccountHolderName(value: string): string {
  return canonicalizeText(value, 2, 160, "Account-holder name");
}

export function canonicalizeIpa(value: string): string {
  const canonical = value.trim().toLowerCase();
  if (!ipaPattern.test(canonical)) {
    throw new Error("Invalid InstaPay address.");
  }
  return canonical;
}

export function matchingWindowOrDefault(value: number | undefined): MatchingWindowMinutes {
  if (value === undefined) {
    return 15;
  }
  if (!matchingWindows.includes(value as MatchingWindowMinutes)) {
    throw new Error("Invalid matching window.");
  }
  return value as MatchingWindowMinutes;
}

function canonicalizeText(value: string, minScalars: number, maxScalars: number, field: string): string {
  const canonical = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  const length = Array.from(canonical).length;
  if (length < minScalars || length > maxScalars) {
    throw new Error(`${field} has an invalid length.`);
  }
  return canonical;
}
