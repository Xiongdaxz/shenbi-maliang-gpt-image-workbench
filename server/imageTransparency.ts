import sharp from "sharp";
import { SAFE_IMAGE_MAX_PIXELS } from "./imageValidation";

export async function detectImageTransparency(buffer: Buffer) {
  const stats = await sharp(buffer, {
    animated: true,
    limitInputPixels: SAFE_IMAGE_MAX_PIXELS,
    sequentialRead: true
  }).stats();
  return !stats.isOpaque;
}
