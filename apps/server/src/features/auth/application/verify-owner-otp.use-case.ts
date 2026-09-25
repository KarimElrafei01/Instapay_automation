import { Inject, Injectable } from "@nestjs/common";
import {
  OWNER_REPOSITORY,
  OWNER_SESSION_REPOSITORY,
  OTP_PROVIDER,
  type Owner,
  type OwnerRepository,
  type OwnerSession,
  type OwnerSessionRepository,
  type OtpProvider,
} from "../domain/ports.js";
import { OwnerAlreadyExistsError, OwnerAuthenticationError } from "../domain/errors.js";

export type VerifyOwnerOtpCommand = {
  verificationId: string;
  code: string;
};

export type AuthenticatedOwner = {
  owner: Owner;
  session: OwnerSession;
};

@Injectable()
export class VerifyOwnerOtpUseCase {
  public constructor(
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
    @Inject(OWNER_REPOSITORY) private readonly owners: OwnerRepository,
    @Inject(OWNER_SESSION_REPOSITORY) private readonly sessions: OwnerSessionRepository,
  ) {}

  public async execute(command: VerifyOwnerOtpCommand): Promise<AuthenticatedOwner> {
    const challenge = await this.otpProvider.verify(command);
    const existingOwner = await this.owners.findByPhoneE164(challenge.phoneE164);
    let owner: Owner;

    if (challenge.purpose === "sign_up") {
      if (existingOwner) {
        throw new OwnerAlreadyExistsError();
      }
      owner = await this.owners.create({
        phoneE164: challenge.phoneE164,
        displayName: challenge.displayName ?? "Store owner",
        phoneVerifiedAt: new Date(),
      });
    } else {
      if (!existingOwner || existingOwner.disabledAt) {
        throw new OwnerAuthenticationError();
      }
      owner = existingOwner;
    }

    return { owner, session: await this.sessions.create(owner.id) };
  }
}
