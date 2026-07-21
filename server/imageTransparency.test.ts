import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { detectImageTransparency } from "./imageTransparency";

describe("detectImageTransparency", () => {
  test("returns false when every pixel is opaque", async () => {
    const buffer = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    }).png().toBuffer();

    expect(await detectImageTransparency(buffer)).toBe(false);
  });

  test("returns true when the image contains a transparent pixel", async () => {
    const buffer = await sharp(Buffer.from([
      255, 255, 255, 255,
      255, 255, 255, 0
    ]), {
      raw: { width: 2, height: 1, channels: 4 }
    }).png().toBuffer();

    expect(await detectImageTransparency(buffer)).toBe(true);
  });
});
