import { appDb, getAll, getOne, run } from "./db";
import { snapshotImageReferences, type ImageReferenceSnapshotInput } from "./imageFiles";
import type { ImageRow } from "./types";
import { safeJson } from "./utils";

function imageReferenceInputFromImage(image: ImageRow): ImageReferenceSnapshotInput {
  return {
    sourceType: "image",
    sourceId: image.id,
    sourceAssetId: null,
    name: image.prompt || "引用图片",
    path: image.path,
    mimeType: image.mime_type,
    size: image.image_file_size,
    imageWidth: image.image_width,
    imageHeight: image.image_height
  };
}

function sourceImageIdsForImage(image: ImageRow) {
  const ids: string[] = [];
  if (image.parent_image_id) ids.push(image.parent_image_id);
  if (image.job_id) {
    const job = getOne<{ source_image_ids: string | null }>(appDb, "select source_image_ids from image_jobs where id = ?", image.job_id);
    const sourceIds = safeJson<{ imageIds?: unknown }>(job?.source_image_ids, {});
    if (Array.isArray(sourceIds.imageIds)) {
      ids.push(...sourceIds.imageIds.map((id) => String(id ?? "").trim()).filter(Boolean));
    }
  }
  return Array.from(new Set(ids.filter((id) => id && id !== image.id)));
}

export async function ensureImageSourceReferences(userId: string, image: ImageRow) {
  const sourceImageIds = sourceImageIdsForImage(image);
  if (sourceImageIds.length === 0) return 0;

  const existingImageSourceIds = new Set(
    getAll<{ source_id: string | null }>(
      appDb,
      "select source_id from image_asset_references where image_id = ? and source_type = 'image'",
      image.id
    )
      .map((row) => row.source_id ?? "")
      .filter(Boolean)
  );
  const missingSourceIds = sourceImageIds.filter((id) => !existingImageSourceIds.has(id));
  if (missingSourceIds.length === 0) return 0;

  const sourceImages = getAll<ImageRow>(
    appDb,
    `select * from images where user_id = ? and id in (${missingSourceIds.map(() => "?").join(", ")})`,
    userId,
    ...missingSourceIds
  );
  const sourceImageById = new Map(sourceImages.map((sourceImage) => [sourceImage.id, sourceImage]));
  const orderedSourceImages = missingSourceIds.map((id) => sourceImageById.get(id)).filter((item): item is ImageRow => Boolean(item));
  if (orderedSourceImages.length === 0) return 0;

  run(appDb, "update image_asset_references set sort_order = sort_order + ? where image_id = ?", orderedSourceImages.length, image.id);
  await snapshotImageReferences(userId, image.session_id, image.id, orderedSourceImages.map(imageReferenceInputFromImage));
  return orderedSourceImages.length;
}
