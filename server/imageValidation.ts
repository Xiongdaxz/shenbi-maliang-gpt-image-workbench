import sharp from "sharp";

export const SAFE_IMAGE_MAX_PIXELS = 64 * 1024 * 1024;
export const SAFE_IMAGE_MAX_DIMENSION = 16_384;
export const SAFE_UPLOAD_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const SHARP_FORMAT_MIME_TYPES: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export class InvalidUploadedImageError extends Error {
  constructor(message = "invalid_uploaded_image") {
    super(message);
    this.name = "InvalidUploadedImageError";
  }
}

export function detectUploadedImageMimeType(buffer: Buffer) {
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer.subarray(1, 4).toString("ascii") === "PNG"
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  return "";
}

export async function validateUploadedImage(buffer: Buffer, declaredMimeType: string) {
  const detectedMimeType = detectUploadedImageMimeType(buffer);
  if (!SAFE_UPLOAD_IMAGE_MIME_TYPES.has(detectedMimeType) || detectedMimeType !== declaredMimeType) {
    throw new InvalidUploadedImageError("image_type_mismatch");
  }
  try {
    const image = sharp(buffer, {
      limitInputPixels: SAFE_IMAGE_MAX_PIXELS,
      sequentialRead: true
    });
    const metadata = await image.metadata();
    const width = Number(metadata.width ?? 0);
    const height = Number(metadata.height ?? 0);
    const pages = Number(metadata.pages ?? 1);
    const sharpMimeType = SHARP_FORMAT_MIME_TYPES[String(metadata.format ?? "")];
    if (
      sharpMimeType !== detectedMimeType
      || !Number.isSafeInteger(width)
      || !Number.isSafeInteger(height)
      || width <= 0
      || height <= 0
      || width > SAFE_IMAGE_MAX_DIMENSION
      || height > SAFE_IMAGE_MAX_DIMENSION
      || width * height > SAFE_IMAGE_MAX_PIXELS
      || !Number.isSafeInteger(pages)
      || pages !== 1
    ) throw new InvalidUploadedImageError();
    await image.clone().resize({ width: 1, height: 1, fit: "fill" }).toBuffer();
    return { mimeType: detectedMimeType, width, height };
  } catch (error) {
    if (error instanceof InvalidUploadedImageError) throw error;
    throw new InvalidUploadedImageError();
  }
}
