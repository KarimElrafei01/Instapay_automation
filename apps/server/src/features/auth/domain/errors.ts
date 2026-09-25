export class OtpVerificationError extends Error {
  public constructor() {
    super("The verification code is invalid or expired.");
  }
}

export class OwnerAlreadyExistsError extends Error {
  public constructor() {
    super("An owner already exists for this phone number.");
  }
}

export class OwnerAuthenticationError extends Error {
  public constructor() {
    super("The owner could not be authenticated.");
  }
}
