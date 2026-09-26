export class StoreAlreadyExistsError extends Error {
  public constructor() {
    super("A store has already been configured for this owner.");
  }
}

export class IpaAlreadyRegisteredError extends Error {
  public constructor() {
    super("The IPA is already registered.");
  }
}
