import { randomUUID, timingSafeEqual } from "node:crypto";
import { OtpVerificationError } from "../domain/errors.js";
import type { OtpChallenge, OtpProvider, OtpRequest } from "../domain/ports.js";

type StoredChallenge = OtpRequest & {
  expiresAt: Date;
  failedAttempts: number;
};

/**
 * Development-only adapter. Production startup must wire a provider that
 * delivers and verifies real OTPs; this adapter has no production fallback.
 */
export class DevelopmentOtpProvider implements OtpProvider {
  private readonly challenges = new Map<string, StoredChallenge>();
  private readonly expiresInMs = 10 * 60 * 1_000;
  private readonly maximumAttempts = 5;

  public constructor(environment: string | undefined) {
    if (environment !== "development") {
      throw new Error("DevelopmentOtpProvider may only be used when NODE_ENV=development.");
    }
  }

  public async request(input: OtpRequest): Promise<OtpChallenge> {
    const verificationId = randomUUID();
    const expiresAt = new Date(Date.now() + this.expiresInMs);
    this.challenges.set(verificationId, { ...input, expiresAt, failedAttempts: 0 });
    return { verificationId, expiresAt };
  }

  public async verify(input: { verificationId: string; code: string }): Promise<OtpRequest> {
    const challenge = this.challenges.get(input.verificationId);
    if (!challenge || challenge.expiresAt <= new Date()) {
      this.challenges.delete(input.verificationId);
      throw new OtpVerificationError();
    }

    if (!matchesDevelopmentCode(input.code)) {
      challenge.failedAttempts += 1;
      if (challenge.failedAttempts >= this.maximumAttempts) {
        this.challenges.delete(input.verificationId);
      }
      throw new OtpVerificationError();
    }

    this.challenges.delete(input.verificationId);
    return {
      phoneE164: challenge.phoneE164,
      purpose: challenge.purpose,
      displayName: challenge.displayName,
    };
  }
}

function matchesDevelopmentCode(submittedCode: string): boolean {
  const expected = Buffer.from("0000", "utf8");
  const submitted = Buffer.from(submittedCode, "utf8");
  return submitted.length === expected.length && timingSafeEqual(submitted, expected);
}
