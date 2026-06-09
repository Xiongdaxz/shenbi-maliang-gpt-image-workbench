import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { readImageDimensions } from "./imageDimensions";
import { IMAGE_EDIT_DEBUG_DIR } from "./paths";
import { debugSettings } from "./settingsStore";
import type { ImageReferenceSourceAsset, ImageRow, ProviderRow } from "./types";
import { now } from "./utils";

type SourceReferenceDebugInfo = {
  original_file_id?: string;
  original_gen_id?: string;
  conversation_id?: string;
  parent_message_id?: string;
  source_account_id?: string;
};

type SaveImageEditMaskDebugInput = {
  jobId: string;
  userId: string;
  sessionId: string | null;
  prompt: string;
  requestPrompt: string;
  size: string;
  quality: string;
  imageCount: number;
  maskDataUrl: string;
  sourceImages: ImageRow[];
  sourceAssets: ImageReferenceSourceAsset[];
  provider: ProviderRow;
  sourceReference: SourceReferenceDebugInfo | null;
};

function fileFromDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("调试遮罩数据格式不正确");
  const mimeType = match[1] || "image/png";
  const payload = match[3] ?? "";
  const buffer = match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload));
  return { buffer, mimeType };
}

async function maskAlphaStats(buffer: Buffer) {
  const { data, info } = await sharp(buffer, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels || 4;
  let transparent = 0;
  let partial = 0;
  let opaque = 0;
  for (let index = channels - 1; index < data.length; index += channels) {
    const alpha = data[index];
    if (alpha === 0) {
      transparent += 1;
    } else if (alpha === 255) {
      opaque += 1;
    } else {
      partial += 1;
    }
  }
  const total = transparent + partial + opaque;
  return {
    transparent,
    partial,
    opaque,
    total,
    transparentRatio: total > 0 ? transparent / total : 0,
    partialRatio: total > 0 ? partial / total : 0,
    opaqueRatio: total > 0 ? opaque / total : 0
  };
}

function providerContext(row: ImageRow) {
  return {
    fileId: row.provider_file_id,
    genId: row.provider_gen_id,
    conversationId: row.provider_conversation_id,
    parentMessageId: row.provider_parent_message_id,
    sourceAccountId: row.provider_source_account_id,
    hasRequiredSourceReference: Boolean(row.provider_file_id && row.provider_gen_id && row.provider_source_account_id)
  };
}

export async function saveImageEditMaskDebugArtifacts(input: SaveImageEditMaskDebugInput) {
  if (!input.maskDataUrl.trim() || !debugSettings().imageEditMask) return null;

  const { buffer, mimeType } = fileFromDataUrl(input.maskDataUrl);
  const dimensions = readImageDimensions(buffer);
  const alpha = await maskAlphaStats(buffer).catch(() => null);
  const outputDir = path.join(IMAGE_EDIT_DEBUG_DIR, input.jobId);
  const maskPath = path.join(outputDir, "mask.png");
  const metadataPath = path.join(outputDir, "request.json");

  await mkdir(outputDir, { recursive: true });
  await writeFile(maskPath, buffer);
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        createdAt: now(),
        jobId: input.jobId,
        userId: input.userId,
        sessionId: input.sessionId,
        provider: {
          id: input.provider.id,
          name: input.provider.name,
          channel: input.provider.channel,
          routeMode: input.provider.route_mode,
          model: input.provider.model,
          editPath: input.provider.edit_path
        },
        request: {
          prompt: input.prompt,
          requestPrompt: input.requestPrompt,
          size: input.size,
          quality: input.quality,
          imageCount: input.imageCount,
          hasSourceReference: Boolean(input.sourceReference),
          sourceReference: input.sourceReference
        },
        mask: {
          file: "mask.png",
          mimeType,
          byteSize: buffer.length,
          width: dimensions.width,
          height: dimensions.height,
          alpha,
          alphaRule: "Transparent or dark pixels are edited; opaque white pixels are preserved."
        },
        sourceImages: input.sourceImages.map((image) => ({
          id: image.id,
          path: image.path,
          mimeType: image.mime_type,
          width: image.image_width,
          height: image.image_height,
          fileSize: image.image_file_size,
          providerContext: providerContext(image)
        })),
        sourceAssets: input.sourceAssets.map((asset) => ({
          id: asset.id,
          name: asset.name,
          path: asset.path,
          mimeType: asset.mime_type,
          width: asset.image_width,
          height: asset.image_height,
          fileSize: asset.size
        }))
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return { outputDir, maskPath, metadataPath };
}
