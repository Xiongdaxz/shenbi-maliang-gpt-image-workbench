import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { normalizeImageEditMaskDataUrl, requireImageEditMaskSnapshot } from "./imageMasks";

function dataUrl(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function rgbaImage(width: number, height: number, alphaValues?: number[]) {
  const data = Buffer.alloc(width * height * 4, 255);
  for (const [index, alpha] of (alphaValues ?? []).entries()) {
    data[index * 4 + 3] = alpha;
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe("image edit masks", () => {
  test("rejects a mask without editable pixels", async () => {
    const mask = await rgbaImage(2, 2);

    await expect(normalizeImageEditMaskDataUrl(dataUrl(mask))).rejects.toThrow("遮罩中没有可编辑区域");
  });

  test("rejects a mask whose dimensions differ from the source image", async () => {
    const mask = await rgbaImage(2, 2, [0]);
    const source = await rgbaImage(3, 2);

    await expect(normalizeImageEditMaskDataUrl(dataUrl(mask), dataUrl(source))).rejects.toThrow(
      "遮罩尺寸必须与原图一致（原图 3×2，遮罩 2×2）"
    );
  });

  test("normalizes a valid same-size mask", async () => {
    const mask = await rgbaImage(2, 2, [0]);
    const source = await rgbaImage(2, 2);

    const normalized = await normalizeImageEditMaskDataUrl(dataUrl(mask), dataUrl(source));
    const { data, info } = await sharp(Buffer.from(normalized.split(",")[1], "base64"))
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.width).toBe(2);
    expect(info.height).toBe(2);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
  });

  test("turns snapshot persistence failures into a required submission error", async () => {
    await expect(requireImageEditMaskSnapshot("job-test", "data:image/png;base64,AA==", async () => {
      throw new Error("disk full");
    })).rejects.toThrow("图片编辑遮罩保存失败，请重试");
  });
});
