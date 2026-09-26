import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StoresModule } from "../stores/stores.module.js";
import {
  CreateReceivingSourceUseCase,
  GetReceivingSourceUseCase,
  IngestDeviceTestAlertUseCase,
  SubmitTestProofUseCase,
} from "./application/receiving-source.use-cases.js";
import { Argon2DeviceCredentialIssuer } from "./data/argon2-device-credential-issuer.js";
import { AzureVisionTestProofOcr } from "./data/azure-vision-test-proof-ocr.js";
import { InMemoryReceivingSourceRepository } from "./data/in-memory-receiving-source.repository.js";
import { DEVICE_CREDENTIAL_ISSUER, RECEIVING_SOURCE_REPOSITORY, TEST_PROOF_OCR } from "./domain/ports.js";
import { ReceivingSourceController } from "./presentation/receiving-source.controller.js";

@Module({
  imports: [AuthModule, StoresModule],
  controllers: [ReceivingSourceController],
  providers: [
    CreateReceivingSourceUseCase,
    GetReceivingSourceUseCase,
    SubmitTestProofUseCase,
    IngestDeviceTestAlertUseCase,
    { provide: RECEIVING_SOURCE_REPOSITORY, useFactory: () => new InMemoryReceivingSourceRepository() },
    { provide: DEVICE_CREDENTIAL_ISSUER, useFactory: () => new Argon2DeviceCredentialIssuer() },
    { provide: TEST_PROOF_OCR, useFactory: () => new AzureVisionTestProofOcr(process.env.AZURE_VISION_ENDPOINT, process.env.AZURE_VISION_KEY) },
  ],
})
export class ReceivingSourcesModule {}
