export type OtpPurpose = "sign_up" | "sign_in";

export type Owner = {
  id: string;
  phoneE164: string;
  displayName: string;
  phoneVerifiedAt: Date;
  disabledAt: Date | null;
  createdAt: Date;
};

export type OtpChallenge = {
  verificationId: string;
  expiresAt: Date;
};

export type OtpRequest = {
  phoneE164: string;
  purpose: OtpPurpose;
  displayName?: string | undefined;
};

export type OwnerSession = {
  token: string;
  ownerId: string;
  expiresAt: Date;
};

export interface OtpProvider {
  request(input: OtpRequest): Promise<OtpChallenge>;
  verify(input: { verificationId: string; code: string }): Promise<OtpRequest>;
}

export interface OwnerRepository {
  findByPhoneE164(phoneE164: string): Promise<Owner | null>;
  findById(id: string): Promise<Owner | null>;
  create(input: { phoneE164: string; displayName: string; phoneVerifiedAt: Date }): Promise<Owner>;
}

export interface OwnerSessionRepository {
  create(ownerId: string): Promise<OwnerSession>;
  findByToken(token: string): Promise<OwnerSession | null>;
  revoke(token: string): Promise<void>;
}

export const OTP_PROVIDER = Symbol("OTP_PROVIDER");
export const OWNER_REPOSITORY = Symbol("OWNER_REPOSITORY");
export const OWNER_SESSION_REPOSITORY = Symbol("OWNER_SESSION_REPOSITORY");
