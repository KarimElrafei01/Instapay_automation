import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnvironmentAesGcmDataEncryptor } from "./data-encryptor.js";

describe("EnvironmentAesGcmDataEncryptor", () => {
  it("round-trips data with a fresh authenticated encryption payload", () => {
    const encryptor = new EnvironmentAesGcmDataEncryptor(randomBytes(32).toString("base64"));
    const first = encryptor.encrypt("https://merchant.example/webhooks/payments");
    const second = encryptor.encrypt("https://merchant.example/webhooks/payments");

    expect(first.equals(second)).toBe(false);
    expect(encryptor.decrypt(first)).toBe("https://merchant.example/webhooks/payments");
  });

  it("rejects a malformed encryption key and tampered ciphertext", () => {
    expect(() => new EnvironmentAesGcmDataEncryptor("not-a-valid-key")).toThrow();

    const encryptor = new EnvironmentAesGcmDataEncryptor(randomBytes(32).toString("base64"));
    const encrypted = encryptor.encrypt("private value");
    const finalByteIndex = encrypted.length - 1;
    encrypted[finalByteIndex] = (encrypted[finalByteIndex] ?? 0) ^ 1;
    expect(() => encryptor.decrypt(encrypted)).toThrow();
  });
});
