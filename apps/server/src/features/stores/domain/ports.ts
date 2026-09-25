export type MatchingWindowMinutes = 5 | 10 | 15 | 20 | 30;

export type Store = {
  id: string;
  ownerId: string;
  displayName: string;
  accountHolderName: string;
  ipa: string;
  matchingWindowMinutes: MatchingWindowMinutes;
  defaultWebhookUrl: string;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredStore = Store & {
  webhookSecret: string;
  integrationSecretHash: string;
  integrationSecretPrefix: string;
};

export type CreateStoreInput = {
  ownerId: string;
  displayName: string;
  accountHolderName: string;
  ipa: string;
  matchingWindowMinutes: MatchingWindowMinutes;
  defaultWebhookUrl: string;
  webhookSecret: string;
  integrationSecretHash: string;
  integrationSecretPrefix: string;
};

export type IssuedIntegrationSecret = {
  token: string;
  tokenPrefix: string;
  tokenHash: string;
  createdAt: Date;
};

export interface StoreRepository {
  create(input: CreateStoreInput): Promise<Store>;
  findByOwnerId(ownerId: string): Promise<Store | null>;
}

export interface StoreCredentialIssuer {
  issue(): Promise<IssuedIntegrationSecret>;
}

export interface WebhookUrlValidator {
  validate(value: string): Promise<string>;
}

export const STORE_REPOSITORY = Symbol("STORE_REPOSITORY");
export const STORE_CREDENTIAL_ISSUER = Symbol("STORE_CREDENTIAL_ISSUER");
export const WEBHOOK_URL_VALIDATOR = Symbol("WEBHOOK_URL_VALIDATOR");
