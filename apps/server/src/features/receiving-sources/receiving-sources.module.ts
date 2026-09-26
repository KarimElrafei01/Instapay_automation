import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StoresModule } from "../stores/stores.module.js";
import {
  CreateReceivingSourceUseCase,
  GetReceivingSourceUseCase,
  IngestDeviceTestAlertUseCase,
  IngestDeviceAlertUseCase,
  SubmitTestProofUseCase,
} from "./application/receiving-source.use-cases.js";
import { PaymentAttemptsModule } from "../payment-attempts/payment-attempts.module.js";
import { Argon2DeviceCredentialIssuer } from "./data/argon2-device-credential-issuer.js";
import { AzureVisionTestProofOcr } from "./data/azure-vision-test-proof-ocr.js";
import { DrizzleReceivingSourceRepository } from "./data/drizzle-receiving-source.repository.js";
import { S3ReceivingSourceProofStorage } from "./data/s3-receiving-source-proof-storage.js";
import { DEVICE_CREDENTIAL_ISSUER, RECEIVING_SOURCE_PROOF_STORAGE, RECEIVING_SOURCE_REPOSITORY, TEST_PROOF_OCR } from "./domain/ports.js";
import { ReceivingSourceController } from "./presentation/receiving-source.controller.js";

@Module({
  imports: [AuthModule, StoresModule, PaymentAttemptsModule],
  controllers: [ReceivingSourceController],
  providers: [
    CreateReceivingSourceUseCase,
    GetReceivingSourceUseCase,
    SubmitTestProofUseCase,
    IngestDeviceTestAlertUseCase,
    IngestDeviceAlertUseCase,
    { provide: RECEIVING_SOURCE_REPOSITORY, useClass: DrizzleReceivingSourceRepository },
    { provide: DEVICE_CREDENTIAL_ISSUER, useFactory: () => new Argon2DeviceCredentialIssuer() },
    { provide: TEST_PROOF_OCR, useFactory: () => new AzureVisionTestProofOcr(process.env.AZURE_VISION_ENDPOINT, process.env.AZURE_VISION_KEY) },
    { provide: RECEIVING_SOURCE_PROOF_STORAGE, useFactory: () => new S3ReceivingSourceProofStorage() },
  ],
})
export class ReceivingSourcesModule {}
