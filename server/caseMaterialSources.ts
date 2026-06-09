import { appDb, getOne } from "./db";
import { assetUrlFromAssetId, imageUrlFromImageId } from "./serializers";
import type { ImageReferenceSourceAsset, ImageRow } from "./types";
import { approvedCaseSql, visibleCaseSql } from "./utils";

type CaseSourceRow = {
  id: string;
  group_id: string | null;
  user_id: string | null;
  image_id: string | null;
  asset_id: string | null;
  title: string;
  prompt: string;
  image_url: string;
};

export type CaseMaterialSource = {
  caseItemId: string;
  title: string;
  prompt: string;
  sourceType: "image" | "asset";
  sourceId: string;
  path: string;
  mimeType: string;
  fileSize: number;
  imageWidth: number;
  imageHeight: number;
  url: string;
  originalUrl: string;
  previewUrl: string;
  thumbnailUrl: string;
  image: ImageRow | null;
  asset: ImageReferenceSourceAsset | null;
};

export function caseMaterialSourceById(caseItemId: string, userId?: string) {
  const normalizedCaseItemId = caseItemId.trim();
  if (!normalizedCaseItemId) return null;
  const visibilitySql = userId ? visibleCaseSql("case_items") : approvedCaseSql("case_items");
  const params = userId ? [normalizedCaseItemId, normalizedCaseItemId, userId] : [normalizedCaseItemId, normalizedCaseItemId];
  const item = getOne<CaseSourceRow>(
    appDb,
    `select id, group_id, user_id, image_id, asset_id, title, prompt, image_url
     from case_items
     where (id = ? or group_id = ?)
       and ${visibilitySql}
     order by rowid asc
     limit 1`,
    ...params
  );
  if (!item) return null;
  const cover = item.group_id
    ? getOne<{ image_id: string | null; asset_id: string | null; image_url: string }>(
        appDb,
        `select image_id, asset_id, image_url
         from case_group_images
         where group_id = ?
         order by is_cover desc, sort_order asc, rowid asc
         limit 1`,
        item.group_id
      )
    : null;
  const imageId = cover?.image_id ?? item.image_id;
  const assetId = cover?.asset_id ?? item.asset_id;

  if (imageId) {
    const image = getOne<ImageRow>(appDb, "select * from images where id = ?", imageId);
    if (!image) return null;
    const originalUrl = imageUrlFromImageId(image.id);
    return {
      caseItemId: item.group_id || item.id,
      title: item.title,
      prompt: item.prompt,
      sourceType: "image" as const,
      sourceId: image.id,
      path: image.path,
      mimeType: image.mime_type,
      fileSize: image.image_file_size,
      imageWidth: image.image_width,
      imageHeight: image.image_height,
      url: originalUrl,
      originalUrl,
      previewUrl: imageUrlFromImageId(image.id, "preview"),
      thumbnailUrl: imageUrlFromImageId(image.id, "thumb"),
      image,
      asset: null
    };
  }

  if (assetId) {
    const asset = getOne<ImageReferenceSourceAsset>(
      appDb,
      "select id, name, path, mime_type, size, image_width, image_height from assets where id = ?",
      assetId
    );
    if (!asset) return null;
    const originalUrl = assetUrlFromAssetId(asset.id);
    return {
      caseItemId: item.group_id || item.id,
      title: item.title,
      prompt: item.prompt,
      sourceType: "asset" as const,
      sourceId: asset.id,
      path: asset.path,
      mimeType: asset.mime_type,
      fileSize: asset.size,
      imageWidth: asset.image_width,
      imageHeight: asset.image_height,
      url: originalUrl,
      originalUrl,
      previewUrl: assetUrlFromAssetId(asset.id, "preview"),
      thumbnailUrl: assetUrlFromAssetId(asset.id, "thumb"),
      image: null,
      asset
    };
  }

  return null;
}

export function caseMaterialSourcesByIds(caseItemIds: string[], userId?: string) {
  return caseItemIds.map((caseItemId) => caseMaterialSourceById(caseItemId, userId));
}

export function caseMaterialReferenceFromSource(source: CaseMaterialSource) {
  return {
    id: `case:${source.caseItemId}`,
    sourceAssetId: null,
    sourceCaseItemId: source.caseItemId,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    kind: "asset" as const,
    name: source.title || source.prompt || "灵感素材",
    url: source.url,
    originalUrl: source.originalUrl,
    previewUrl: source.previewUrl,
    thumbnailUrl: source.thumbnailUrl,
    imageWidth: source.imageWidth,
    imageHeight: source.imageHeight
  };
}
