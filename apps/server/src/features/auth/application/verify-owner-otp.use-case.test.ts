import { describe, expect, it } from "vitest";
import { DevelopmentOtpProvider } from "../data/development-otp.provider.js";
import { InMemoryOwnerRepository } from "../data/in-memory-owner.repository.js";
import { InMemoryOwnerSessionRepository } from "../data/in-memory-owner-session.repository.js";
import { OtpVerificationError } from "../domain/errors.js";
import { GetCurrentOwnerUseCase } from "./get-current-owner.use-case.js";
import { RequestOwnerOtpUseCase } from "./request-owner-otp.use-case.js";
import { VerifyOwnerOtpUseCase } from "./verify-owner-otp.use-case.js";

describe("owner OTP authentication", () => {
  it("creates an owner and session only after the development code is verified", async () => {
    const otp = new DevelopmentOtpProvider("development");
    const owners = new InMemoryOwnerRepository();
    const sessions = new InMemoryOwnerSessionRepository();
    const requestOtp = new RequestOwnerOtpUseCase(otp);
    const verifyOtp = new VerifyOwnerOtpUseCase(otp, owners, sessions);

    const challenge = await requestOtp.execute({
      phoneNumber: "+201234567890",
      purpose: "sign_up",
      displayName: "Amina",
    });
    const result = await verifyOtp.execute({ verificationId: challenge.verificationId, code: "0000" });

    expect(result.owner.phoneE164).toBe("+201234567890");
    expect(result.owner.displayName).toBe("Amina");
    expect(await sessions.findByToken(result.session.token)).not.toBeNull();
  });

  it("rejects a wrong code without creating an owner", async () => {
    const otp = new DevelopmentOtpProvider("development");
    const owners = new InMemoryOwnerRepository();
    const sessions = new InMemoryOwnerSessionRepository();
    const requestOtp = new RequestOwnerOtpUseCase(otp);
    const verifyOtp = new VerifyOwnerOtpUseCase(otp, owners, sessions);
    const challenge = await requestOtp.execute({
      phoneNumber: "+201234567890",
      purpose: "sign_up",
      displayName: "Amina",
    });

    await expect(verifyOtp.execute({ verificationId: challenge.verificationId, code: "1234" }))
      .rejects.toBeInstanceOf(OtpVerificationError);
    expect(await owners.findByPhoneE164("+201234567890")).toBeNull();
  });

  it("renews an active session when its owner is resolved", async () => {
    const otp = new DevelopmentOtpProvider("development");
    const owners = new InMemoryOwnerRepository();
    const sessions = new InMemoryOwnerSessionRepository();
    const requestOtp = new RequestOwnerOtpUseCase(otp);
    const verifyOtp = new VerifyOwnerOtpUseCase(otp, owners, sessions);
    const getCurrentOwner = new GetCurrentOwnerUseCase(owners, sessions);
    const challenge = await requestOtp.execute({
      phoneNumber: "+201234567890",
      purpose: "sign_up",
      displayName: "Amina",
    });
    const authenticated = await verifyOtp.execute({ verificationId: challenge.verificationId, code: "0000" });

    const currentOwner = await getCurrentOwner.execute(authenticated.session.token);

    expect(currentOwner?.owner.id).toBe(authenticated.owner.id);
    expect(currentOwner?.session.expiresAt.getTime()).toBeGreaterThanOrEqual(
      authenticated.session.expiresAt.getTime(),
    );
  });

  it("cannot be constructed outside development", () => {
    expect(() => new DevelopmentOtpProvider("production")).toThrow(
      "DevelopmentOtpProvider may only be used when NODE_ENV=development.",
    );
  });
});
