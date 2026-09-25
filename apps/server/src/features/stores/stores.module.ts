import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CreateStoreUseCase } from "./application/create-store.use-case.js";
import { Argon2StoreCredentialIssuer } from "./data/argon2-store-credential-issuer.js";
import { HttpsWebhookUrlValidator } from "./data/https-webhook-url.validator.js";
import { InMemoryStoreRepository } from "./data/in-memory-store.repository.js";
import {
  STORE_CREDENTIAL_ISSUER,
  STORE_REPOSITORY,
  WEBHOOK_URL_VALIDATOR,
} from "./domain/ports.js";
import { StoreController } from "./presentation/store.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [StoreController],
  providers: [
    CreateStoreUseCase,
    { provide: STORE_REPOSITORY, useFactory: () => new InMemoryStoreRepository() },
    { provide: STORE_CREDENTIAL_ISSUER, useFactory: () => new Argon2StoreCredentialIssuer() },
    { provide: WEBHOOK_URL_VALIDATOR, useFactory: () => new HttpsWebhookUrlValidator() },
  ],
})
export class StoresModule {}
