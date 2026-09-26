import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { SharpProofImageProcessor } from "./sharp-proof-image-processor.js";

describe("SharpProofImageProcessor", () => {
  it("keeps a valid customer upload's canonical stored image at or below 600 KB", async () => {
    const width = 1_000;
    const height = 1_200;
    const pixels = Buffer.alloc(width * height * 3);
    for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index * 37 + (index >>> 8) * 17) % 256;
    const original = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const processed = await new SharpProofImageProcessor().process({ bytes: original, declaredMediaType: "image/png" });

    expect(processed.mediaType).toBe("image/jpeg");
    expect(processed.bytes.byteLength).toBeLessThanOrEqual(600 * 1_024);
    expect(processed.width).toBeGreaterThanOrEqual(320);
    expect(processed.height).toBeGreaterThanOrEqual(320);
  });
});
