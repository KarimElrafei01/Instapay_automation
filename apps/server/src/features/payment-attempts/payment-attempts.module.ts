import { Module } from "@nestjs/common";
import { CreateHostedCheckoutUseCase, CreateMerchantHostedCheckoutUseCase, GetHostedCheckoutUseCase, SubmitCheckoutProofUseCase } from "./application/checkout-payment.use-cases.js";
import { ExtractPaymentProofUseCase } from "./application/extract-payment-proof.use-case.js";
import { MatchNewAlertUseCase, MatchPaymentAttemptUseCase } from "./application/match-payment-attempt.use-case.js";
import { AzureVisionPaymentProofOcr } from "./data/azure-vision-payment-proof-ocr.js";
import { DrizzlePaymentProofRepository } from "./data/drizzle-payment-proof.repository.js";
import { DrizzlePaymentMatchingRepository } from "./data/drizzle-payment-matching.repository.js";
import { DrizzlePaymentAttemptRepository } from "./data/drizzle-payment-attempt.repository.js";
import { S3PrivateObjectStorage } from "./data/s3-private-object-storage.js";
import { SharpProofImageProcessor } from "./data/sharp-proof-image-processor.js";
import { PAYMENT_ATTEMPT_REPOSITORY, PRIVATE_OBJECT_STORAGE, PROOF_IMAGE_PROCESSOR } from "./domain/ports.js";
import { PAYMENT_MATCHING_REPOSITORY } from "./domain/payment-matching.ports.js";
import { PAYMENT_PROOF_OCR, PAYMENT_PROOF_REPOSITORY } from "./domain/payment-proof-extraction.ports.js";
import { HostedCheckoutController } from "./presentation/hosted-checkout.controller.js";
@Module({ controllers: [HostedCheckoutController], providers: [CreateHostedCheckoutUseCase, CreateMerchantHostedCheckoutUseCase, GetHostedCheckoutUseCase, SubmitCheckoutProofUseCase, ExtractPaymentProofUseCase, MatchPaymentAttemptUseCase, MatchNewAlertUseCase, DrizzlePaymentAttemptRepository, DrizzlePaymentProofRepository, DrizzlePaymentMatchingRepository, { provide: PAYMENT_ATTEMPT_REPOSITORY, useExisting: DrizzlePaymentAttemptRepository }, { provide: PAYMENT_PROOF_REPOSITORY, useExisting: DrizzlePaymentProofRepository }, { provide: PAYMENT_MATCHING_REPOSITORY, useExisting: DrizzlePaymentMatchingRepository }, { provide: PRIVATE_OBJECT_STORAGE, useFactory: () => new S3PrivateObjectStorage() }, { provide: PROOF_IMAGE_PROCESSOR, useFactory: () => new SharpProofImageProcessor() }, { provide: PAYMENT_PROOF_OCR, useFactory: () => new AzureVisionPaymentProofOcr() }], exports: [CreateHostedCheckoutUseCase, SubmitCheckoutProofUseCase, ExtractPaymentProofUseCase, MatchPaymentAttemptUseCase, MatchNewAlertUseCase] })
export class PaymentAttemptsModule {}
