import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { GetCurrentOwnerUseCase } from "../application/get-current-owner.use-case.js";
import { RequestOwnerOtpUseCase } from "../application/request-owner-otp.use-case.js";
import { SignOutOwnerUseCase } from "../application/sign-out-owner.use-case.js";
import { VerifyOwnerOtpUseCase } from "../application/verify-owner-otp.use-case.js";
import {
  OwnerAlreadyExistsError,
  OwnerAuthenticationError,
  OtpVerificationError,
} from "../domain/errors.js";
import { InvalidPhoneNumberError } from "../domain/phone.js";
import type { Owner } from "../domain/ports.js";
import {
  OWNER_SESSION_COOKIE_NAME,
  refreshOwnerSessionCookie,
} from "./owner-session-cookie.js";

const requestOtpSchema = z.object({
  phoneNumber: z.string().min(1).max(32),
  purpose: z.enum(["sign_up", "sign_in"]),
  displayName: z.string().trim().min(1).max(120).optional(),
}).strict().superRefine((value, context) => {
  if (value.purpose === "sign_up" && !value.displayName) {
    context.addIssue({ code: "custom", path: ["displayName"], message: "Required for sign-up." });
  }
  if (value.purpose === "sign_in" && value.displayName) {
    context.addIssue({ code: "custom", path: ["displayName"], message: "Not accepted for sign-in." });
  }
});
const verifyOtpSchema = z.object({
  verificationId: z.string().uuid(),
  code: z.string().regex(/^[0-9]{4,10}$/),
}).strict();

@Controller("v1/owner/auth")
export class OwnerAuthController {
  public constructor(
    private readonly requestOwnerOtp: RequestOwnerOtpUseCase,
    private readonly verifyOwnerOtp: VerifyOwnerOtpUseCase,
    private readonly getCurrentOwner: GetCurrentOwnerUseCase,
    private readonly signOutOwner: SignOutOwnerUseCase,
  ) {}

  @Post("otp/request")
  @HttpCode(HttpStatus.ACCEPTED)
  public async requestOtp(@Body() body: unknown): Promise<{ data: { verificationId: string; expiresAt: string } }> {
    const input = parseRequest(requestOtpSchema, body);
    try {
      const challenge = await this.requestOwnerOtp.execute(input);
      return { data: { verificationId: challenge.verificationId, expiresAt: challenge.expiresAt.toISOString() } };
    } catch (error) {
      if (error instanceof InvalidPhoneNumberError) {
        throw new BadRequestException({ code: "INVALID_REQUEST" });
      }
      throw error;
    }
  }

  @Post("otp/verify")
  @HttpCode(HttpStatus.OK)
  public async verifyOtp(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: { owner: ReturnType<typeof ownerProjection> } }> {
    const input = parseRequest(verifyOtpSchema, body);
    try {
      const result = await this.verifyOwnerOtp.execute(input);
      refreshOwnerSessionCookie(reply, result.session);
      return { data: { owner: ownerProjection(result.owner) } };
    } catch (error) {
      if (error instanceof OwnerAlreadyExistsError) {
        throw new ConflictException({ code: "PHONE_ALREADY_REGISTERED" });
      }
      if (error instanceof OtpVerificationError || error instanceof OwnerAuthenticationError) {
        throw new UnauthorizedException({ code: "INVALID_OTP_OR_AUTH" });
      }
      throw error;
    }
  }

  @Get("me")
  public async me(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: { owner: ReturnType<typeof ownerProjection> } }> {
    const currentOwner = await this.getCurrentOwner.execute(request.cookies[OWNER_SESSION_COOKIE_NAME]);
    if (!currentOwner || currentOwner.owner.disabledAt) {
      throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
    }
    refreshOwnerSessionCookie(reply, currentOwner.session);
    return { data: { owner: ownerProjection(currentOwner.owner) } };
  }

  @Post("sign-out")
  @HttpCode(HttpStatus.NO_CONTENT)
  public async signOut(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.signOutOwner.execute(request.cookies[OWNER_SESSION_COOKIE_NAME]);
    reply.clearCookie(OWNER_SESSION_COOKIE_NAME, { httpOnly: true, path: "/" });
  }
}

function parseRequest<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({ code: "INVALID_REQUEST" });
  }
  return parsed.data;
}

function ownerProjection(owner: Owner): { id: string; phoneNumber: string; displayName: string } {
  return { id: owner.id, phoneNumber: owner.phoneE164, displayName: owner.displayName };
}
