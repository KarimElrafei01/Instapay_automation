import { Inject, Injectable } from "@nestjs/common";
import {
  OTP_PROVIDER,
  type OtpChallenge,
  type OtpProvider,
  type OtpPurpose,
} from "../domain/ports.js";
import { canonicalizePhoneNumber } from "../domain/phone.js";

export type RequestOwnerOtpCommand = {
  phoneNumber: string;
  purpose: OtpPurpose;
  displayName?: string | undefined;
};

@Injectable()
export class RequestOwnerOtpUseCase {
  public constructor(@Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider) {}

  public async execute(command: RequestOwnerOtpCommand): Promise<OtpChallenge> {
    const phoneE164 = canonicalizePhoneNumber(command.phoneNumber);
    const displayName = command.displayName?.trim();
    if (command.purpose === "sign_up" && (!displayName || displayName.length > 120)) {
      throw new Error("A display name is required for sign-up.");
    }

    return this.otpProvider.request({
      phoneE164,
      purpose: command.purpose,
      displayName,
    });
  }
}
