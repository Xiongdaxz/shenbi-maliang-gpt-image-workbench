import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { SAFE_IMAGE_MAX_PIXELS } from "./imageValidation";
import { absoluteDataPath, IMAGE_MASK_DIR } from "./paths";

function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("遮罩图片数据格式不正确");
  const payload = match[3] ?? "";
  return {
    mimeType: match[1] || "image/png",
    buffer: match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload))
  };
}

function maskMimeTypeFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

function maskExtension(mimeType: string) {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

export async function normalizeImageEditMaskDataUrl(dataUrl: string, sourceImageDataUrl = "") {
  const { buffer } = dataUrlToBuffer(dataUrl);
  const { data, info } = await sharp(buffer, { limitInputPixels: SAFE_IMAGE_MAX_PIXELS, sequentialRead: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels || 4;
  let hasEditablePixel = false;

  if (sourceImageDataUrl) {
    const source = dataUrlToBuffer(sourceImageDataUrl);
    const sourceMetadata = await sharp(source.buffer, { limitInputPixels: SAFE_IMAGE_MAX_PIXELS, sequentialRead: true }).metadata();
    const sourceWidth = Number(sourceMetadata.width ?? 0);
    const sourceHeight = Number(sourceMetadata.height ?? 0);
    if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error("原图尺寸读取失败");
    if (info.width !== sourceWidth || info.height !== sourceHeight) {
      throw new Error(`遮罩尺寸必须与原图一致（原图 ${sourceWidth}×${sourceHeight}，遮罩 ${info.width}×${info.height}）`);
    }
  }

  for (let index = 0; index < data.length; index += channels) {
    const alphaIndex = index + channels - 1;
    const alpha = data[alphaIndex] ?? 255;
    const editable = alpha < 255;
    hasEditablePixel ||= editable;
    data[index] = editable ? 0 : 255;
    data[index + 1] = editable ? 0 : 255;
    data[index + 2] = editable ? 0 : 255;
    data[alphaIndex] = alpha <= 8 ? 0 : alpha;
  }
  if (!hasEditablePixel) throw new Error("遮罩中没有可编辑区域，请重新涂抹");

  const normalized = await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels
    },
    limitInputPixels: SAFE_IMAGE_MAX_PIXELS
  })
    .png()
    .toBuffer();

  return `data:image/png;base64,${normalized.toString("base64")}`;
}

export async function saveImageEditMaskSnapshot(jobId: string, dataUrl: string) {
  if (!jobId || !dataUrl.trim()) return null;
  const { mimeType, buffer } = dataUrlToBuffer(dataUrl);
  const extension = maskExtension(mimeType);
  const fileName = `${jobId}.${extension}`;
  const absolutePath = path.join(IMAGE_MASK_DIR, fileName);
  await mkdir(IMAGE_MASK_DIR, { recursive: true });
  await writeFile(absolutePath, buffer);
  return {
    path: `files/image-masks/${fileName}`,
    mimeType
  };
}

type ImageEditMaskSnapshotSaver = typeof saveImageEditMaskSnapshot;

export async function requireImageEditMaskSnapshot(
  jobId: string,
  dataUrl: string,
  saveSnapshot: ImageEditMaskSnapshotSaver = saveImageEditMaskSnapshot
) {
  try {
    const snapshot = await saveSnapshot(jobId, dataUrl);
    if (!snapshot) throw new Error("empty snapshot");
    return snapshot;
  } catch {
    throw new Error("图片编辑遮罩保存失败，请重试");
  }
}

export async function imageEditMaskSnapshotDataUrl(relativePath: string) {
  const cleanPath = relativePath.trim().replace(/^\/+/, "");
  if (!cleanPath || cleanPath.includes("..")) return "";
  const absolutePath = absoluteDataPath(cleanPath);
  const buffer = await readFile(absolutePath);
  return `data:${maskMimeTypeFromPath(cleanPath)};base64,${buffer.toString("base64")}`;
}
