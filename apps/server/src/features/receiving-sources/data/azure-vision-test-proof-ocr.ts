import { Injectable } from "@nestjs/common";
import { TestProofUnavailableError } from "../domain/errors.js";
import { extractAmountMinor } from "../domain/receiving-source-input.js";
import type { OcrTestProofResult, TestProofOcr } from "../domain/ports.js";

@Injectable()
export class AzureVisionTestProofOcr implements TestProofOcr {
  public constructor(private readonly endpoint: string | undefined, private readonly apiKey: string | undefined) {}

  public async extract(input: { bytes: Uint8Array; mediaType: "image/jpeg" | "image/png" | "image/webp" }): Promise<OcrTestProofResult> {
    if (!this.endpoint || !this.apiKey) throw new TestProofUnavailableError();
    const baseUrl = this.endpoint.replace(/\/$/u, "");
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read`, {
        method: "POST",
        headers: { "Ocp-Apim-Subscription-Key": this.apiKey, "Content-Type": input.mediaType },
        body: new Uint8Array(input.bytes).buffer,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new TestProofUnavailableError();
    }
    if (!response.ok) throw new TestProofUnavailableError();
    const payload: unknown = await response.json().catch(() => null);
    const text = collectOcrText(payload);
    const normalized = text.normalize("NFKC").toLocaleLowerCase("en-US");
    return {
      text,
      amountMinor: extractAmountMinor(text),
      indicatesSuccess: /\b(successful|completed|success)\b|تمت (?:العملية|بنجاح)/iu.test(normalized),
    };
  }
}

function collectOcrText(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.readResult) || !Array.isArray(payload.readResult.blocks)) return "";
  const lines: string[] = [];
  for (const block of payload.readResult.blocks) {
    if (!isRecord(block) || !Array.isArray(block.lines)) continue;
    for (const line of block.lines) if (isRecord(line) && typeof line.text === "string") lines.push(line.text);
  }
  return lines.join("\n").slice(0, 20_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
