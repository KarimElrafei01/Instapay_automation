import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CreateStoreUseCase, GetOwnerStoreUseCase } from "./application/create-store.use-case.js";
import { Argon2StoreCredentialIssuer } from "./data/argon2-store-credential-issuer.js";
import { HttpsWebhookUrlValidator } from "./data/https-webhook-url.validator.js";
import { DrizzleStoreRepository } from "./data/drizzle-store.repository.js";
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
    GetOwnerStoreUseCase,
    DrizzleStoreRepository,
    { provide: STORE_REPOSITORY, useExisting: DrizzleStoreRepository },
    { provide: STORE_CREDENTIAL_ISSUER, useFactory: () => new Argon2StoreCredentialIssuer() },
    { provide: WEBHOOK_URL_VALIDATOR, useFactory: () => new HttpsWebhookUrlValidator() },
  ],
  exports: [GetOwnerStoreUseCase],
})
export class StoresModule {}
