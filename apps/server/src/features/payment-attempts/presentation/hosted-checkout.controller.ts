import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, UnauthorizedException } from "@nestjs/common";
import { z } from "zod";
import { PlatformEventLogger } from "../../../shared/observability/platform-event-logger.js";
import { CreateMerchantHostedCheckoutUseCase, GetHostedCheckoutUseCase, InvalidCheckoutSubmissionError, InvalidMerchantCredentialError, SubmitCheckoutProofUseCase } from "../application/checkout-payment.use-cases.js";

const merchantCheckoutSchema = z.object({ merchantOrderId: z.string().min(1).max(128), orderReference: z.string().min(1).max(100).optional(), amountMinor: z.number().int().min(100).max(10_000_000) }).strict();
const proofSchema = z.object({ checkoutToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]), imageBase64: z.string().min(4).max(6_990_508) }).strict();

@Controller("v1")
export class HostedCheckoutController {
  public constructor(private readonly create: CreateMerchantHostedCheckoutUseCase, private readonly get: GetHostedCheckoutUseCase, private readonly submit: SubmitCheckoutProofUseCase, private readonly events: PlatformEventLogger) {}
  @Post("merchant/checkout-sessions")
  @HttpCode(HttpStatus.CREATED)
  public async createSession(@Headers("authorization") authorization: string | undefined, @Body() body: unknown) {
    const credential = authorization?.match(/^Bearer (ipk_live_[A-Za-z0-9_-]{43})$/u)?.[1];
    if (!credential) throw new UnauthorizedException({ code: "INVALID_MERCHANT_CREDENTIAL" });
    try {
      const created = await this.create.execute(credential, parse(merchantCheckoutSchema, body));
      const origin = validatedOrigin(process.env.HOSTED_CHECKOUT_ORIGIN ?? "http://localhost:3000");
      this.events.record({ action: "hosted_checkout_created", outcome: "completed", resourceId: created.publicId });
      return { data: { checkoutId: created.publicId, checkoutUrl: `${origin}/checkout/${created.publicId}#token=${created.checkoutToken}`, expiresAt: created.expiresAt.toISOString() } };
    } catch (error) { this.events.record({ action: "hosted_checkout_created", outcome: "denied", reasonCode: error instanceof InvalidMerchantCredentialError ? "INVALID_MERCHANT_CREDENTIAL" : "INVALID_REQUEST" }); if (error instanceof InvalidMerchantCredentialError) throw new UnauthorizedException({ code: "INVALID_MERCHANT_CREDENTIAL" }); throw new BadRequestException({ code: "INVALID_REQUEST" }); }
  }
  @Get("checkout-sessions/:checkoutId")
  public async checkoutDetails(@Param("checkoutId") checkoutId: string, @Headers("x-checkout-token") checkoutToken: string | undefined) {
    try { const session = await this.get.execute(checkoutId, checkoutToken ?? ""); this.events.record({ action: "hosted_checkout_viewed", outcome: "completed", resourceId: session.publicId }); return { data: { checkoutId: session.publicId, amountMinor: session.amountMinor, currency: "EGP", recipientIpa: session.recipientIpa, accountHolderName: session.accountHolderName, expiresAt: session.expiresAt.toISOString() } }; } catch { this.events.record({ action: "hosted_checkout_viewed", outcome: "denied", resourceId: checkoutId, reasonCode: "INVALID_OR_EXPIRED_CHECKOUT" }); throw new BadRequestException({ code: "INVALID_OR_EXPIRED_CHECKOUT" }); }
  }
  @Post("checkout-sessions/:checkoutId/proof")
  @HttpCode(HttpStatus.ACCEPTED)
  public async submitProof(@Param("checkoutId") checkoutId: string, @Body() body: unknown) {
    const input = parse(proofSchema, body);
    try { const attempt = await this.submit.execute({ checkoutPublicId: checkoutId, checkoutToken: input.checkoutToken, mediaType: input.mediaType, bytes: decodeImage(input.imageBase64) }); this.events.record({ action: "payment_proof_submitted", outcome: "accepted", resourceId: attempt.publicId }); return { data: { paymentAttemptId: attempt.publicId, status: attempt.status } }; } catch (error) { this.events.record({ action: "payment_proof_submitted", outcome: "denied", resourceId: checkoutId, reasonCode: error instanceof InvalidCheckoutSubmissionError ? "INVALID_OR_EXPIRED_CHECKOUT" : "INVALID_PROOF" }); if (error instanceof InvalidCheckoutSubmissionError) throw new BadRequestException({ code: "INVALID_OR_EXPIRED_CHECKOUT" }); throw new BadRequestException({ code: "INVALID_PROOF" }); }
  }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new BadRequestException({ code: "INVALID_REQUEST" }); return result.data; }
function decodeImage(value: string): Uint8Array { if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0) throw new BadRequestException({ code: "INVALID_PROOF" }); const bytes = Buffer.from(value, "base64"); if (bytes.length < 1_024 || bytes.length > 5 * 1_024 * 1_024 || bytes.toString("base64") !== value) throw new BadRequestException({ code: "INVALID_PROOF" }); return bytes; }
function validatedOrigin(value: string): string { try { const url = new URL(value); if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error(); return url.origin; } catch { throw new Error("HOSTED_CHECKOUT_ORIGIN must be HTTPS."); } }
