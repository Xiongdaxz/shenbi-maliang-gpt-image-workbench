import sharp from "sharp";
import { appDb, getAll, getOne, run } from "./db";
import { readImageDimensions } from "./imageDimensions";
import { readStoredFile, writeEncryptedFile } from "./secureFiles";
import type { ImageDerivativeRow } from "./types";
import { now } from "./utils";

export type ImageVariant = "original" | "preview" | "thumb";
export type ImageDerivativeSourceType = "image" | "asset" | "image-reference" | "message-source-reference";

type DerivativeConfig = {
  maxSize: number;
  quality: number;
};

type DerivativeSource = {
  sourceType: ImageDerivativeSourceType;
  sourceId: string;
  path: string;
};

export type ImageDerivativeSourceGroup = {
  sourceType: ImageDerivativeSourceType;
  sourceIds: string[];
};

type StoredDerivative = {
  buffer: Buffer;
  mimeType: string;
  size: number;
  width: number;
  height: number;
};

const DERIVATIVE_CONFIG: Record<Exclude<ImageVariant, "original">, DerivativeConfig> = {
  thumb: { maxSize: 512, quality: 75 },
  preview: { maxSize: 1600, quality: 82 }
};

const DERIVATIVE_MIME_TYPE = "image/webp";

export function normalizeImageVariant(value: unknown): ImageVariant {
  const normalized = String(value ?? "original").trim().toLowerCase();
  if (normalized === "thumb" || normalized === "thumbnail") return "thumb";
  if (normalized === "preview") return "preview";
  return "original";
}

function sanitizeSegment(value: string, fallback: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || fallback;
}

function derivativePath(source: DerivativeSource, variant: Exclude<ImageVariant, "original">) {
  return [
    "files",
    "secure",
    "derivatives",
    sanitizeSegment(source.sourceType, "source"),
    sanitizeSegment(source.sourceId, "item"),
    `${variant}.gimg`
  ].join("/");
}

function derivativeRow(source: DerivativeSource, variant: Exclude<ImageVariant, "original">) {
  return getOne<ImageDerivativeRow>(
    appDb,
    "select * from image_derivatives where source_type = ? and source_id = ? and variant = ?",
    source.sourceType,
    source.sourceId,
    variant
  );
}

function derivativeSourceWhere(groups: ImageDerivativeSourceGroup[]) {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const group of groups) {
    const sourceIds = Array.from(new Set(group.sourceIds.map((id) => id.trim()).filter(Boolean)));
    if (sourceIds.length === 0) continue;
    clauses.push(`(source_type = ? and source_id in (${sourceIds.map(() => "?").join(", ")}))`);
    params.push(group.sourceType, ...sourceIds);
  }
  return clauses.length > 0 ? { sql: clauses.join(" or "), params } : null;
}

export function imageDerivativePathsForSources(groups: ImageDerivativeSourceGroup[]) {
  const where = derivativeSourceWhere(groups);
  if (!where) return [];
  return getAll<{ path: string }>(appDb, `select path from image_derivatives where ${where.sql}`, ...where.params);
}

export function deleteImageDerivativesForSources(groups: ImageDerivativeSourceGroup[]) {
  const where = derivativeSourceWhere(groups);
  if (!where) return;
  run(appDb, `delete from image_derivatives where ${where.sql}`, ...where.params);
}

function upsertDerivative(source: DerivativeSource, variant: Exclude<ImageVariant, "original">, file: Omit<StoredDerivative, "buffer"> & { path: string }) {
  const timestamp = now();
  run(
    appDb,
    `insert into image_derivatives (
      source_type, source_id, variant, path, mime_type, size,
      image_width, image_height, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(source_type, source_id, variant) do update set
      path = excluded.path,
      mime_type = excluded.mime_type,
      size = excluded.size,
      image_width = excluded.image_width,
      image_height = excluded.image_height,
      updated_at = excluded.updated_at`,
    source.sourceType,
    source.sourceId,
    variant,
    file.path,
    file.mimeType,
    file.size,
    file.width,
    file.height,
    timestamp,
    timestamp
  );
}

async function createDerivative(source: DerivativeSource, variant: Exclude<ImageVariant, "original">): Promise<StoredDerivative> {
  const config = DERIVATIVE_CONFIG[variant];
  const sourceBuffer = await readStoredFile(source.path);
  const buffer = await sharp(sourceBuffer, { limitInputPixels: false })
    .rotate()
    .resize({
      width: config.maxSize,
      height: config.maxSize,
      fit: "inside",
      withoutEnlargement: true
    })
    .webp({ quality: config.quality })
    .toBuffer();
  const path = derivativePath(source, variant);
  const dimensions = readImageDimensions(buffer);
  await writeEncryptedFile(path, buffer);
  const file = {
    path,
    mimeType: DERIVATIVE_MIME_TYPE,
    size: buffer.length,
    width: dimensions.width,
    height: dimensions.height
  };
  upsertDerivative(source, variant, file);
  return { buffer, mimeType: file.mimeType, size: file.size, width: file.width, height: file.height };
}

export async function getOrCreateImageDerivative(source: DerivativeSource, variant: Exclude<ImageVariant, "original">): Promise<StoredDerivative> {
  const existing = derivativeRow(source, variant);
  if (existing) {
    try {
      const buffer = await readStoredFile(existing.path);
      return {
        buffer,
        mimeType: existing.mime_type,
        size: existing.size,
        width: existing.image_width,
        height: existing.image_height
      };
    } catch {
      run(
        appDb,
        "delete from image_derivatives where source_type = ? and source_id = ? and variant = ?",
        source.sourceType,
        source.sourceId,
        variant
      );
    }
  }
  return createDerivative(source, variant);
}

export async function warmImageDerivatives(sourceType: ImageDerivativeSourceType, sourceId: string, path: string) {
  for (const variant of Object.keys(DERIVATIVE_CONFIG) as Array<Exclude<ImageVariant, "original">>) {
    try {
      await getOrCreateImageDerivative({ sourceType, sourceId, path }, variant);
    } catch (error) {
      console.warn("图片派生图预热失败", sourceType, sourceId, variant, error);
    }
  }
}
