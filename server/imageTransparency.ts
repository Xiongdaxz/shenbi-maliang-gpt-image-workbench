import sharp from "sharp";

export async function detectImageTransparency(buffer: Buffer) {
  const stats = await sharp(buffer, { animated: true }).stats();
  return !stats.isOpaque;
}
