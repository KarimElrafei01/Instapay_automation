import { describe, expect, it } from "vitest";
import { HttpsWebhookUrlValidator } from "./https-webhook-url.validator.js";

describe("HttpsWebhookUrlValidator", () => {
  it("accepts an HTTPS webhook that resolves only to public addresses", async () => {
    const validator = new HttpsWebhookUrlValidator(async () => [{ address: "8.8.8.8" }]);

    await expect(validator.validate("https://merchant.example/callback"))
      .resolves.toBe("https://merchant.example/callback");
  });

  it("rejects a webhook that resolves to a private address", async () => {
    const validator = new HttpsWebhookUrlValidator(async () => [{ address: "10.0.0.7" }]);

    await expect(validator.validate("https://merchant.example/callback"))
      .rejects.toThrow("public address");
  });

  it("rejects a webhook that resolves to a reserved address", async () => {
    const validator = new HttpsWebhookUrlValidator(async () => [{ address: "198.51.100.3" }]);

    await expect(validator.validate("https://merchant.example/callback"))
      .rejects.toThrow("public address");
  });

  it("rejects localhost, HTTP, and credential-bearing URLs", async () => {
    const validator = new HttpsWebhookUrlValidator(async () => [{ address: "8.8.8.8" }]);

    await expect(validator.validate("https://127.0.0.1/callback")).rejects.toThrow("public address");
    await expect(validator.validate("http://merchant.example/callback")).rejects.toThrow("HTTPS");
    await expect(validator.validate("https://user:pass@merchant.example/callback")).rejects.toThrow("HTTPS");
  });
});
