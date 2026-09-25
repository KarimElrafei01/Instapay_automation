const e164PhonePattern = /^\+[1-9][0-9]{7,14}$/;

export class InvalidPhoneNumberError extends Error {
  public constructor() {
    super("Phone number must be in E.164 format.");
  }
}

export function canonicalizePhoneNumber(value: string): string {
  const canonical = value.trim().replace(/[\s()-]/g, "");
  if (!e164PhonePattern.test(canonical)) {
    throw new InvalidPhoneNumberError();
  }
  return canonical;
}
