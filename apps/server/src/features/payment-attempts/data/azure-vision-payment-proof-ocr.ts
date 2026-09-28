import { Injectable } from "@nestjs/common";
import { extractAmountMinor, extractPayerName, extractTransactionReference, normalizePaymentIdentity } from "../../receiving-sources/domain/receiving-source-input.js";
import type { ProofMatchFacts } from "../domain/payment-matching.js";
import type { PaymentProofOcr } from "../domain/payment-proof-extraction.ports.js";

@Injectable()
export class AzureVisionPaymentProofOcr implements PaymentProofOcr {
  public constructor(private readonly endpoint = process.env.AZURE_VISION_ENDPOINT, private readonly apiKey = process.env.AZURE_VISION_KEY) {}
  public async extract(input: { bytes: Uint8Array; mediaType: "image/jpeg"; recipientIpa: string; accountHolderName: string }): Promise<ProofMatchFacts> {
    if (!this.endpoint || !this.apiKey) throw new PaymentProofOcrUnavailableError();
    let response: Response;
    try {
      response = await fetch(`${this.endpoint.replace(/\/$/u, "")}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read`, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": this.apiKey, "Content-Type": input.mediaType }, body: new Uint8Array(input.bytes).buffer, signal: AbortSignal.timeout(15_000) });
    } catch { throw new PaymentProofOcrUnavailableError(); }
    if (!response.ok) throw new PaymentProofOcrUnavailableError();
    const text = collectText(await response.json().catch(() => null));
    const normalizedText = normalizePaymentIdentity(text);
    const expectedIpa = normalizePaymentIdentity(input.recipientIpa);
    const expectedName = normalizePaymentIdentity(input.accountHolderName);
    return {
      successful: /\b(successful|completed|success)\b|تمت\s+(?:العملية|بنجاح)/iu.test(text),
      amountMinor: extractAmountMinor(text) ?? undefined,
      recipientNormalized: normalizedText.includes(expectedIpa) ? expectedIpa : normalizedText.includes(expectedName) ? expectedName : undefined,
      payerNormalized: extractPayerName(text) ?? undefined,
      transactionReferenceNormalized: extractTransactionReference(text) ?? undefined,
      extractorVersion: "azure-vision-read-v1",
    };
  }
}

export class PaymentProofOcrUnavailableError extends Error {}
function collectText(payload: unknown): string { if (!record(payload) || !record(payload.readResult) || !Array.isArray(payload.readResult.blocks)) return ""; const lines: string[] = []; for (const block of payload.readResult.blocks) { if (!record(block) || !Array.isArray(block.lines)) continue; for (const line of block.lines) if (record(line) && typeof line.text === "string") lines.push(line.text); } return lines.join("\n").slice(0, 20_000); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
