import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  STORE_CREDENTIAL_ISSUER,
  STORE_REPOSITORY,
  WEBHOOK_URL_VALIDATOR,
  type IssuedIntegrationSecret,
  type MatchingWindowMinutes,
  type Store,
  type StoreCredentialIssuer,
  type StoreRepository,
  type WebhookUrlValidator,
} from "../domain/ports.js";
import {
  canonicalizeAccountHolderName,
  canonicalizeIpa,
  canonicalizeStoreName,
  matchingWindowOrDefault,
} from "../domain/store-input.js";

export type CreateStoreCommand = {
  ownerId: string;
  displayName: string;
  accountHolderName: string;
  ipa: string;
  matchingWindowMinutes?: MatchingWindowMinutes | undefined;
  defaultWebhookUrl: string;
};

export type CreatedStore = {
  store: Store;
  integrationSecret: IssuedIntegrationSecret;
};

@Injectable()
export class CreateStoreUseCase {
  public constructor(
    @Inject(STORE_REPOSITORY) private readonly stores: StoreRepository,
    @Inject(STORE_CREDENTIAL_ISSUER) private readonly credentials: StoreCredentialIssuer,
    @Inject(WEBHOOK_URL_VALIDATOR) private readonly webhookUrls: WebhookUrlValidator,
  ) {}

  public async execute(command: CreateStoreCommand): Promise<CreatedStore> {
    const integrationSecret = await this.credentials.issue();
    const store = await this.stores.create({
      ownerId: command.ownerId,
      displayName: canonicalizeStoreName(command.displayName),
      accountHolderName: canonicalizeAccountHolderName(command.accountHolderName),
      ipa: canonicalizeIpa(command.ipa),
      matchingWindowMinutes: matchingWindowOrDefault(command.matchingWindowMinutes),
      defaultWebhookUrl: await this.webhookUrls.validate(command.defaultWebhookUrl),
      webhookSecret: randomBytes(32).toString("base64url"),
      integrationSecretHash: integrationSecret.tokenHash,
      integrationSecretPrefix: integrationSecret.tokenPrefix,
    });
    return { store, integrationSecret };
  }
}

/** Reads the authenticated owner's store without exposing its integration credentials. */
@Injectable()
export class GetOwnerStoreUseCase {
  public constructor(@Inject(STORE_REPOSITORY) private readonly stores: StoreRepository) {}

  public async execute(ownerId: string): Promise<Store | null> {
    return this.stores.findByOwnerId(ownerId);
  }
}
