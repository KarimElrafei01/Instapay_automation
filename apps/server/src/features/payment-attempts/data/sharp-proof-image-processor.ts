import { createHash } from "node:crypto";
import sharp from "sharp";
import { type ImageMediaType, type ProcessedProofImage, type ProofImageProcessor } from "../domain/ports.js";
const MIN_BYTES = 1_024, MAX_BYTES = 5 * 1_024 * 1_024, MIN_EDGE = 320, MAX_EDGE = 8_000, MAX_PIXELS = 24_000_000;
const MAX_CANONICAL_BYTES = 600 * 1_024;
const COMPRESSION_PROFILES = [
  { edge: 2_000, quality: 62 }, { edge: 1_800, quality: 56 }, { edge: 1_600, quality: 50 },
  { edge: 1_400, quality: 45 }, { edge: 1_200, quality: 40 }, { edge: 1_000, quality: 35 },
  { edge: 800, quality: 30 }, { edge: 640, quality: 28 }, { edge: 480, quality: 25 }, { edge: 320, quality: 22 },
] as const;
export class SharpProofImageProcessor implements ProofImageProcessor {
  public async process(input: { bytes: Uint8Array; declaredMediaType: ImageMediaType }): Promise<ProcessedProofImage> {
    const dimensions = validateImage(input.bytes, input.declaredMediaType);
    for (const profile of COMPRESSION_PROFILES) {
      let canonical: Buffer;
      try {
        canonical = await sharp(input.bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" })
          .rotate().resize({ width: profile.edge, height: profile.edge, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: profile.quality, mozjpeg: true, chromaSubsampling: "4:2:0" }).toBuffer();
      } catch { throw new InvalidProofImageError(); }
      if (canonical.length > MAX_CANONICAL_BYTES) continue;
      const canonicalDimensions = validateImage(canonical, "image/jpeg");
      return { bytes: canonical, mediaType: "image/jpeg", inputSha256: sha256(input.bytes), canonicalSha256: sha256(canonical), ...canonicalDimensions };
    }
    throw new ProofCompressionLimitError();
  }
}
export class InvalidProofImageError extends Error {}
export class ProofCompressionLimitError extends Error {}
function sha256(value: Uint8Array): Buffer { return createHash("sha256").update(value).digest(); }
function validateImage(bytes: Uint8Array, declared: ImageMediaType): { width: number; height: number } { if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) throw new InvalidProofImageError(); const actual = detectType(bytes); if (actual !== declared) throw new InvalidProofImageError(); const dimensions = actual === "image/png" ? pngDimensions(bytes) : actual === "image/jpeg" ? jpegDimensions(bytes) : webpDimensions(bytes); if (!dimensions || dimensions.width < MIN_EDGE || dimensions.height < MIN_EDGE || dimensions.width > MAX_EDGE || dimensions.height > MAX_EDGE || dimensions.width * dimensions.height > MAX_PIXELS) throw new InvalidProofImageError(); return dimensions; }
function detectType(b: Uint8Array): ImageMediaType | null { if (at(b, 0) === 0x89 && at(b, 1) === 0x50 && at(b, 2) === 0x4e && at(b, 3) === 0x47 && at(b, 4) === 0x0d && at(b, 5) === 0x0a && at(b, 6) === 0x1a && at(b, 7) === 0x0a) return "image/png"; if (at(b, 0) === 0xff && at(b, 1) === 0xd8 && at(b, 2) === 0xff) return "image/jpeg"; if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp"; return null; }
function pngDimensions(b: Uint8Array) { return b.length >= 24 && ascii(b, 12, 4) === "IHDR" ? { width: read32(b, 16), height: read32(b, 20) } : null; }
function jpegDimensions(b: Uint8Array) { for (let i = 2; i + 9 < b.length;) { if (at(b, i) !== 0xff) return null; while (at(b, i) === 0xff) i++; const marker = at(b, i++); if (marker === 0xd9 || marker === 0xda) return null; const length = (at(b, i) << 8) | at(b, i + 1); if (length < 2 || i + length > b.length) return null; if (marker >= 0xc0 && marker <= 0xc3) return { height: (at(b, i + 3) << 8) | at(b, i + 4), width: (at(b, i + 5) << 8) | at(b, i + 6) }; i += length; } return null; }
function webpDimensions(b: Uint8Array) { const kind = ascii(b, 12, 4); if (kind === "VP8X" && b.length >= 30) return { width: 1 + at(b, 24) + (at(b, 25) << 8) + (at(b, 26) << 16), height: 1 + at(b, 27) + (at(b, 28) << 8) + (at(b, 29) << 16) }; return null; }
function ascii(b: Uint8Array, start: number, length: number): string { return Buffer.from(b.subarray(start, start + length)).toString("ascii"); }
function at(b: Uint8Array, index: number): number { return b[index] ?? 0; }
function read32(b: Uint8Array, index: number): number { return ((at(b, index) << 24) >>> 0) + (at(b, index + 1) << 16) + (at(b, index + 2) << 8) + at(b, index + 3); }
