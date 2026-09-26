import { Module } from "@nestjs/common";
import { GetCurrentOwnerUseCase } from "./application/get-current-owner.use-case.js";
import { RequestOwnerOtpUseCase } from "./application/request-owner-otp.use-case.js";
import { SignOutOwnerUseCase } from "./application/sign-out-owner.use-case.js";
import { VerifyOwnerOtpUseCase } from "./application/verify-owner-otp.use-case.js";
import { DevelopmentOtpProvider } from "./data/development-otp.provider.js";
import { DrizzleOwnerRepository } from "./data/drizzle-owner.repository.js";
import { DrizzleOwnerSessionRepository } from "./data/drizzle-owner-session.repository.js";
import {
  OTP_PROVIDER,
  OWNER_REPOSITORY,
  OWNER_SESSION_REPOSITORY,
} from "./domain/ports.js";
import { OwnerAuthController } from "./presentation/owner-auth.controller.js";

@Module({
  controllers: [OwnerAuthController],
  providers: [
    RequestOwnerOtpUseCase,
    VerifyOwnerOtpUseCase,
    GetCurrentOwnerUseCase,
    SignOutOwnerUseCase,
    { provide: OTP_PROVIDER, useFactory: () => new DevelopmentOtpProvider(process.env.NODE_ENV) },
    DrizzleOwnerRepository,
    DrizzleOwnerSessionRepository,
    { provide: OWNER_REPOSITORY, useExisting: DrizzleOwnerRepository },
    { provide: OWNER_SESSION_REPOSITORY, useExisting: DrizzleOwnerSessionRepository },
  ],
  exports: [GetCurrentOwnerUseCase],
})
export class AuthModule {}
