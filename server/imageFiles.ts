import path from "node:path";
import { appDb, run } from "./db";
import { warmImageDerivatives } from "./imageDerivatives";
import { readImageDimensions } from "./imageDimensions";
import { providerFetch, providerHeaders, withProviderRequestTimeout } from "./providerHttp";
import { providerResponseErrorDetail } from "./responseSnapshots";
import { readStoredFile, secureImagePath, secureImageReferencePath, writeEncryptedFile } from "./secureFiles";
import type { ImageReferenceSourceAsset, ProviderImageContext, ProviderRow, SavedImageFile } from "./types";
import { makeId, now } from "./utils";

export type ImageReferenceSnapshotInput = {
  sourceType?: "image" | "asset" | "case" | "message-source-reference" | null;
  sourceId?: string | null;
  sourceAssetId?: string | null;
  sourceCaseItemId?: string | null;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  imageWidth: number;
  imageHeight: number;
};

export async function fileToDataUrl(relativePath: string, mimeType?: string) {
  const cleanPath = relativePath.replace(/^\/+/, "");
  const base64 = Buffer.from(await readStoredFile(cleanPath)).toString("base64");
  return `data:${mimeType || mimeTypeFromPath(cleanPath)};base64,${base64}`;
}

function extractByPath(source: unknown, dataPath: string) {
  const tokens = dataPath.match(/[^.[\]]+|\[(\d+)\]/g) ?? [];
  let value: unknown = source;
  for (const token of tokens) {
    if (value == null) return null;
    const index = token.match(/^\[(\d+)\]$/);
    if (index) {
      value = Array.isArray(value) ? value[Number(index[1])] : undefined;
    } else {
      value = (value as Record<string, unknown>)[token];
    }
  }
  return typeof value === "string" ? value : null;
}

function looksLikeBase64Image(value: string) {
  const clean = value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  return (
    clean.length > 200 &&
    (value.startsWith("data:image/") ||
      clean.startsWith("iVBORw0KGgo") ||
      clean.startsWith("/9j/") ||
      clean.startsWith("UklGR"))
  );
}

function normalizeImageMimeType(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "png" || normalized === "image/png") return "image/png";
  if (normalized === "jpg" || normalized === "jpeg" || normalized === "image/jpg" || normalized === "image/jpeg") return "image/jpeg";
  if (normalized === "webp" || normalized === "image/webp") return "image/webp";
  if (normalized === "avif" || normalized === "image/avif") return "image/avif";
  return normalized.startsWith("image/") ? normalized : "";
}

function mimeTypeFromImageBuffer(buffer: Buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return "";
}

function imageMimeTypeFromRecord(source: Record<string, unknown>) {
  return normalizeImageMimeType(source.mime_type ?? source.mimeType ?? source.output_format ?? source.outputFormat);
}

function findBase64Images(source: unknown): string[] {
  if (typeof source === "string") {
    return looksLikeBase64Image(source) ? [source] : [];
  }
  if (Array.isArray(source)) {
    const found: string[] = [];
    for (const item of source) {
      found.push(...findBase64Images(item));
    }
    return found;
  }
  if (source && typeof source === "object") {
    const found: string[] = [];
    for (const [key, value] of Object.entries(source)) {
      if (["b64_json", "base64", "image_base64", "image", "result"].includes(key) && typeof value === "string") {
        if (looksLikeBase64Image(value)) found.push(value);
        continue;
      }
      found.push(...findBase64Images(value));
    }
    return found;
  }
  return [];
}

function findBase64Image(source: unknown): string | null {
  return findBase64Images(source)[0] ?? null;
}

async function saveBase64Image(base64: string, imageId: string, userId: string, sessionId: string | null, mimeTypeHint = ""): Promise<SavedImageFile> {
  const dataUrlMimeType = normalizeImageMimeType(base64.match(/^data:(image\/[a-z0-9.+-]+);base64,/i)?.[1]);
  const clean = base64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  const buffer = Buffer.from(clean, "base64");
  const mimeType = dataUrlMimeType || normalizeImageMimeType(mimeTypeHint) || mimeTypeFromImageBuffer(buffer) || "image/png";
  const dimensions = readImageDimensions(buffer);
  const relativePath = secureImagePath(userId, sessionId, imageId);
  await writeEncryptedFile(relativePath, buffer);
  void warmImageDerivatives("image", imageId, relativePath);
  return { path: relativePath, mimeType, fileSize: buffer.length, ...dimensions };
}

export function mimeTypeFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".avif") return "image/avif";
  if (extension === ".svg") return "image/svg+xml";
  return "image/png";
}

export function imageExtensionFromMime(mimeType: string | null | undefined) {
  const normalized = String(mimeType ?? "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("avif")) return "avif";
  return "png";
}

function looksLikeImageUrl(value: string) {
  const normalized = value.trim();
  return (
    /^https?:\/\//i.test(normalized) ||
    normalized.startsWith("/") ||
    normalized.startsWith("files/") ||
    /\.(png|jpe?g|webp)(?:[?#].*)?$/i.test(normalized)
  );
}

function findImageUrls(source: unknown): string[] {
  if (typeof source === "string") {
    return looksLikeImageUrl(source) ? [source] : [];
  }
  if (Array.isArray(source)) {
    const found: string[] = [];
    for (const item of source) {
      found.push(...findImageUrls(item));
    }
    return found;
  }
  if (source && typeof source === "object") {
    const found: string[] = [];
    for (const [key, value] of Object.entries(source)) {
      if (["url", "image_url"].includes(key) && typeof value === "string" && looksLikeImageUrl(value)) {
        found.push(value);
        continue;
      }
      found.push(...findImageUrls(value));
    }
    return found;
  }
  return [];
}

function findImageUrl(source: unknown): string | null {
  return findImageUrls(source)[0] ?? null;
}

function stringField(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

function providerImageContextFromRecord(source: Record<string, unknown>): ProviderImageContext {
  return {
    fileId: stringField(source, "file_id"),
    genId: stringField(source, "gen_id"),
    conversationId: stringField(source, "conversation_id"),
    parentMessageId: stringField(source, "parent_message_id"),
    sourceAccountId: stringField(source, "source_account_id")
  };
}

type ProviderImageResultItem = {
  value: string;
  kind: "base64" | "url";
  mimeType: string;
  context: ProviderImageContext;
};

function structuredImageItemFromRecord(source: Record<string, unknown>, mimeTypeHint = ""): ProviderImageResultItem | null {
  for (const key of ["b64_json", "base64", "image_base64", "image", "result"]) {
    const value = stringField(source, key);
    if (value && looksLikeBase64Image(value)) {
      return { value, kind: "base64", mimeType: imageMimeTypeFromRecord(source) || mimeTypeHint, context: providerImageContextFromRecord(source) };
    }
  }
  for (const key of ["url", "image_url"]) {
    const value = stringField(source, key);
    if (value && looksLikeImageUrl(value)) {
      return { value, kind: "url", mimeType: imageMimeTypeFromRecord(source) || mimeTypeHint, context: providerImageContextFromRecord(source) };
    }
  }
  return null;
}

function findStructuredImageItems(source: unknown, mimeTypeHint = ""): ProviderImageResultItem[] {
  if (Array.isArray(source)) {
    return source.flatMap((item) => findStructuredImageItems(item, mimeTypeHint));
  }
  if (!source || typeof source !== "object") return [];
  const record = source as Record<string, unknown>;
  const nextMimeTypeHint = imageMimeTypeFromRecord(record) || mimeTypeHint;
  const found: ProviderImageResultItem[] = [];
  const direct = structuredImageItemFromRecord(record, nextMimeTypeHint);
  if (direct) found.push(direct);
  for (const value of Object.values(record)) {
    found.push(...findStructuredImageItems(value, nextMimeTypeHint));
  }
  return found;
}

function absoluteProviderUrl(provider: ProviderRow, value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return new URL(trimmed, provider.base_url).toString();
  return new URL(trimmed, `${provider.base_url.replace(/\/+$/, "")}/`).toString();
}

async function saveImageUrl(provider: ProviderRow, imageUrl: string, imageId: string, userId: string, sessionId: string | null): Promise<SavedImageFile> {
  if (imageUrl.startsWith("data:image/")) {
    return saveBase64Image(imageUrl, imageId, userId, sessionId);
  }
  const { response, buffer } = await withProviderRequestTimeout(async (signal) => {
    const response = await providerFetch(provider, absoluteProviderUrl(provider, imageUrl), {
      method: "GET",
      headers: providerHeaders(provider, "", "image/*"),
      signal
    });
    const buffer = response.ok ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
    return { response, buffer };
  });
  if (!response.ok) {
    throw new Error(`图片下载失败 ${response.status}`);
  }
  const mimeType = response.headers.get("content-type") || "image/png";
  const relativePath = secureImagePath(userId, sessionId, imageId);
  await writeEncryptedFile(relativePath, buffer);
  void warmImageDerivatives("image", imageId, relativePath);
  return { path: relativePath, mimeType, fileSize: buffer.length, ...readImageDimensions(buffer) };
}

function missingImageDataError(responseJson: unknown) {
  const detail = providerResponseErrorDetail(responseJson);
  return detail
    ? new Error(`图片接口返回中没有找到图片数据：${detail}`)
    : new Error("图片接口返回中没有找到图片数据");
}

export async function saveProviderImageResult(
  responseJson: unknown,
  provider: ProviderRow,
  imageId: string,
  userId: string,
  sessionId: string | null
): Promise<SavedImageFile> {
  const responseMimeType = responseJson && typeof responseJson === "object" ? imageMimeTypeFromRecord(responseJson as Record<string, unknown>) : "";
  const base64 = extractByPath(responseJson, provider.response_image_path) ?? findBase64Image(responseJson);
  if (base64) return saveBase64Image(base64, imageId, userId, sessionId, responseMimeType);
  const imageUrl = findImageUrl(responseJson);
  if (imageUrl) return saveImageUrl(provider, imageUrl, imageId, userId, sessionId);
  throw missingImageDataError(responseJson);
}

function uniqueImageValues(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.startsWith("data:image/") ? value.replace(/^data:image\/\w+;base64,/, "") : value;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueImageItems(items: ProviderImageResultItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.value.startsWith("data:image/") ? item.value.replace(/^data:image\/\w+;base64,/, "") : item.value;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function saveProviderImageResults(
  responseJson: unknown,
  provider: ProviderRow,
  makeImageId: () => string,
  userId: string,
  sessionId: string | null
): Promise<Array<{ id: string; file: SavedImageFile; providerContext: ProviderImageContext }>> {
  const responseMimeType = responseJson && typeof responseJson === "object" ? imageMimeTypeFromRecord(responseJson as Record<string, unknown>) : "";
  const imageItems = uniqueImageItems(findStructuredImageItems(responseJson));
  if (imageItems.length > 0) {
    const saved: Array<{ id: string; file: SavedImageFile; providerContext: ProviderImageContext }> = [];
    for (const item of imageItems) {
      const id = makeImageId();
      const file = item.kind === "base64"
        ? await saveBase64Image(item.value, id, userId, sessionId, item.mimeType || responseMimeType)
        : await saveImageUrl(provider, item.value, id, userId, sessionId);
      saved.push({ id, file, providerContext: item.context });
    }
    return saved;
  }

  const base64Values = uniqueImageValues([
    ...(extractByPath(responseJson, provider.response_image_path) ? [extractByPath(responseJson, provider.response_image_path)!] : []),
    ...findBase64Images(responseJson)
  ]);
  if (base64Values.length > 0) {
    const saved: Array<{ id: string; file: SavedImageFile; providerContext: ProviderImageContext }> = [];
    for (const base64 of base64Values) {
      const id = makeImageId();
      saved.push({ id, file: await saveBase64Image(base64, id, userId, sessionId, responseMimeType), providerContext: providerImageContextFromRecord({}) });
    }
    return saved;
  }

  const imageUrls = uniqueImageValues(findImageUrls(responseJson));
  if (imageUrls.length > 0) {
    const saved: Array<{ id: string; file: SavedImageFile; providerContext: ProviderImageContext }> = [];
    for (const imageUrl of imageUrls) {
      const id = makeImageId();
      saved.push({ id, file: await saveImageUrl(provider, imageUrl, id, userId, sessionId), providerContext: providerImageContextFromRecord({}) });
    }
    return saved;
  }

  throw missingImageDataError(responseJson);
}

export async function snapshotImageReferences(userId: string, sessionId: string | null, imageId: string, sources: ImageReferenceSnapshotInput[]) {
  if (sources.length === 0) return;
  const createdAt = now();
  for (const [index, source] of sources.entries()) {
    const referenceId = makeId("imgref");
    const buffer = await readStoredFile(source.path);
    const dimensions = readImageDimensions(buffer);
    const imageWidth = dimensions.width || source.imageWidth || 0;
    const imageHeight = dimensions.height || source.imageHeight || 0;
    const mimeType = source.mimeType || mimeTypeFromPath(source.path);
    const referencePath = secureImageReferencePath(userId, sessionId, imageId, referenceId);
    await writeEncryptedFile(referencePath, buffer);
    void warmImageDerivatives("image-reference", referenceId, referencePath);
    run(
      appDb,
      `insert into image_asset_references (
        id, image_id, user_id, source_type, source_id, source_asset_id, source_case_item_id, source_name, path, mime_type,
        size, image_width, image_height, sort_order, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      referenceId,
      imageId,
      userId,
      source.sourceType ?? "",
      source.sourceId ?? source.sourceAssetId ?? null,
      source.sourceAssetId ?? null,
      source.sourceCaseItemId ?? null,
      source.name || "引用素材",
      referencePath,
      mimeType,
      buffer.length || source.size || 0,
      imageWidth,
      imageHeight,
      index,
      createdAt
    );
  }
}

export async function snapshotImageAssetReferences(userId: string, sessionId: string | null, imageId: string, assets: ImageReferenceSourceAsset[]) {
  return snapshotImageReferences(
    userId,
    sessionId,
    imageId,
    assets.map((asset) => ({
      sourceAssetId: asset.id,
      name: asset.name,
      path: asset.path,
      mimeType: asset.mime_type,
      size: asset.size,
      imageWidth: asset.image_width,
      imageHeight: asset.image_height
    }))
  );
}
