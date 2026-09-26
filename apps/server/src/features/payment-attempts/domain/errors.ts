export class PaymentAttemptAlreadyExistsError extends Error {
  public constructor() {
    super("A payment attempt already exists for this merchant order.");
  }
}
