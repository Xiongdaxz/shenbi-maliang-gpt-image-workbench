import { appDb, getAll, getOne, run } from "./db";
import { warmImageDerivatives } from "./imageDerivatives";
import { readImageDimensions } from "./imageDimensions";
import { mimeTypeFromPath } from "./imageFiles";
import { readStoredFile, secureImageReferencePath, writeEncryptedFile } from "./secureFiles";
import type { MessageSourceReferenceRow } from "./types";
import { makeId, now } from "./utils";

type MessageSourceVariant = "original" | "preview" | "thumb";

export type MessageSourceReferenceInput = {
  sourceType: "image" | "asset" | "case";
  sourceId: string | null;
  sourceCaseItemId?: string | null;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  imageWidth: number;
  imageHeight: number;
};

export function messageSourceReferenceUrlFromId(referenceId: string, variant: MessageSourceVariant = "original") {
  const baseUrl = `/api/files/message-source-references/${encodeURIComponent(referenceId)}`;
  return variant === "original" ? baseUrl : `${baseUrl}?variant=${variant}`;
}

export function publicMessageSourceReference(row: MessageSourceReferenceRow) {
  const originalUrl = messageSourceReferenceUrlFromId(row.id);
  const sourceType = row.source_type;
  return {
    id: `message-source:${row.id}`,
    sourceReferenceId: row.id,
    sourceAssetId: sourceType === "asset" ? row.source_id : null,
    sourceCaseItemId: row.source_case_item_id,
    sourceType,
    sourceId: row.source_id,
    kind: row.source_case_item_id || sourceType !== "image" ? ("asset" as const) : ("image" as const),
    name: row.source_name,
    url: originalUrl,
    originalUrl,
    previewUrl: messageSourceReferenceUrlFromId(row.id, "preview"),
    thumbnailUrl: messageSourceReferenceUrlFromId(row.id, "thumb"),
    imageWidth: row.image_width,
    imageHeight: row.image_height
  };
}

export function messageSourceReferencesByIds(referenceIds: string[], userId: string) {
  const uniqueIds = Array.from(new Set(referenceIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const rows = getAll<MessageSourceReferenceRow>(
    appDb,
    `select *
     from message_source_references
     where user_id = ? and id in (${uniqueIds.map(() => "?").join(", ")})`,
    userId,
    ...uniqueIds
  );
  const rowById = new Map(rows.map((row) => [row.id, row]));
  return uniqueIds.map((id) => rowById.get(id) ?? null);
}

export function messageSourceReferencesByMessageMetadata(metadata: Record<string, unknown>, userId: string) {
  const ids = Array.isArray(metadata.sourceReferenceIds)
    ? metadata.sourceReferenceIds.map((id) => String(id ?? "").trim()).filter(Boolean)
    : [];
  return messageSourceReferencesByIds(ids, userId).filter(Boolean) as MessageSourceReferenceRow[];
}

export async function snapshotMessageSourceReferences({
  userId,
  sessionId,
  messageId,
  jobId,
  sources
}: {
  userId: string;
  sessionId: string | null;
  messageId: string;
  jobId: string;
  sources: MessageSourceReferenceInput[];
}) {
  if (sources.length === 0) return [];
  const createdAt = now();
  const rows: MessageSourceReferenceRow[] = [];
  for (const [index, source] of sources.entries()) {
    const referenceId = makeId("msgref");
    const buffer = await readStoredFile(source.path);
    const dimensions = readImageDimensions(buffer);
    const imageWidth = dimensions.width || source.imageWidth || 0;
    const imageHeight = dimensions.height || source.imageHeight || 0;
    const mimeType = source.mimeType || mimeTypeFromPath(source.path);
    const referencePath = secureImageReferencePath(userId, sessionId, messageId, referenceId);
    await writeEncryptedFile(referencePath, buffer);
    void warmImageDerivatives("message-source-reference", referenceId, referencePath);
    run(
      appDb,
      `insert into message_source_references (
        id, message_id, job_id, user_id, source_type, source_id, source_case_item_id,
        source_name, path, mime_type, size, image_width, image_height, sort_order, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      referenceId,
      messageId,
      jobId,
      userId,
      source.sourceType,
      source.sourceId,
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
    const row = getOne<MessageSourceReferenceRow>(appDb, "select * from message_source_references where id = ?", referenceId);
    if (row) rows.push(row);
  }
  return rows.map(publicMessageSourceReference);
}
