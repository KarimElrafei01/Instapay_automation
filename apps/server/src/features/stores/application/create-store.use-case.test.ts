import { describe, expect, it } from "vitest";
import { InMemoryStoreRepository } from "../data/in-memory-store.repository.js";
import { IpaAlreadyRegisteredError, StoreAlreadyExistsError } from "../domain/errors.js";
import type { StoreCredentialIssuer, WebhookUrlValidator } from "../domain/ports.js";
import { CreateStoreUseCase } from "./create-store.use-case.js";

const credentials: StoreCredentialIssuer = {
  async issue() {
    return {
      token: "ipk_live_test-token",
      tokenPrefix: "ipk_live_test-token",
      tokenHash: "hashed-token",
      createdAt: new Date("2026-09-26T00:00:00.000Z"),
    };
  },
};

const webhookUrls: WebhookUrlValidator = {
  async validate(value) {
    return new URL(value).toString();
  },
};

describe("CreateStoreUseCase", () => {
  it("creates one canonical store and returns the one-time integration secret", async () => {
    const useCase = new CreateStoreUseCase(new InMemoryStoreRepository(), credentials, webhookUrls);

    const result = await useCase.execute({
      ownerId: "owner-a",
      displayName: "  Amina   Market ",
      accountHolderName: " Amina   Hassan ",
      ipa: "Amina.Market@InstaPay",
      defaultWebhookUrl: "https://merchant.example/hooks/instapay",
    });

    expect(result.store).toMatchObject({
      ownerId: "owner-a",
      displayName: "Amina Market",
      accountHolderName: "Amina Hassan",
      ipa: "amina.market@instapay",
      matchingWindowMinutes: 15,
    });
    expect(result.integrationSecret.token).toBe("ipk_live_test-token");
    expect(result.store).not.toHaveProperty("integrationSecretHash");
  });

  it("rejects a second store for the same owner", async () => {
    const useCase = new CreateStoreUseCase(new InMemoryStoreRepository(), credentials, webhookUrls);
    await useCase.execute(validCommand("owner-a", "amina@instapay"));

    await expect(useCase.execute(validCommand("owner-a", "another@instapay")))
      .rejects.toBeInstanceOf(StoreAlreadyExistsError);
  });

  it("rejects an IPA already allocated to another owner", async () => {
    const useCase = new CreateStoreUseCase(new InMemoryStoreRepository(), credentials, webhookUrls);
    await useCase.execute(validCommand("owner-a", "amina@instapay"));

    await expect(useCase.execute(validCommand("owner-b", "amina@instapay")))
      .rejects.toBeInstanceOf(IpaAlreadyRegisteredError);
  });
});

function validCommand(ownerId: string, ipa: string) {
  return {
    ownerId,
    displayName: "Amina Market",
    accountHolderName: "Amina Hassan",
    ipa,
    defaultWebhookUrl: "https://merchant.example/hooks/instapay",
  };
}
