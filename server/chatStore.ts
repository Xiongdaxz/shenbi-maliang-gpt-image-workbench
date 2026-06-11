import { IMAGE_JOB_RUNNING_TIMEOUT_MS, IMAGE_JOB_TIMEOUT_ERROR } from "./constants";
import { appDb, getAll, getOne, run } from "./db";
import { deleteImageDerivativesForSources, imageDerivativePathsForSources } from "./imageDerivatives";
import { messageSourceReferencesByMessageMetadata, publicMessageSourceReference } from "./messageSourceReferences";
import { fallbackTitleFromPrompt, generatePromptSummaryTitle } from "./promptTitle";
import { deleteStoredFilesIfUnreferenced } from "./secureFiles";
import { assetUrlFromAssetId, imageUrlFromImageId } from "./serializers";
import { localTimestamp, makeId, normalizeIdList, now, parseJsonArray, safeJson, visibleAssetSql } from "./utils";

export function expireStaleImageJobs(userId: string, sessionId?: string) {
  const cutoff = localTimestamp(new Date(Date.now() - IMAGE_JOB_RUNNING_TIMEOUT_MS));
  if (sessionId) {
    run(
      appDb,
      "update image_jobs set status = ?, error = ?, updated_at = ? where user_id = ? and session_id = ? and status = ? and updated_at < ?",
      "failed",
      IMAGE_JOB_TIMEOUT_ERROR,
      now(),
      userId,
      sessionId,
      "running",
      cutoff
    );
    return;
  }
  run(
    appDb,
    "update image_jobs set status = ?, error = ?, updated_at = ? where user_id = ? and status = ? and updated_at < ?",
    "failed",
    IMAGE_JOB_TIMEOUT_ERROR,
    now(),
    userId,
    "running",
    cutoff
  );
}

const DEFAULT_CHAT_TITLE = "新的图像对话";

export function immediateChatTitleFromPrompt(prompt: string, fallbackTitle = DEFAULT_CHAT_TITLE) {
  const normalizedPrompt = prompt.trim();
  return normalizedPrompt ? fallbackTitleFromPrompt(normalizedPrompt, fallbackTitle, null) || fallbackTitle : fallbackTitle;
}

export function generateChatTitleFromPrompt(prompt: string) {
  return generatePromptSummaryTitle(prompt, {
    fallbackTitle: DEFAULT_CHAT_TITLE,
    logLabel: "对话标题自动生成失败",
    logSource: "chat-title",
    maxLength: null,
    systemPrompt: "你是对话标题整理助手。请把用户的生图或图片编辑提示词精简成一个中文对话标题，让用户一眼知道这段对话要生成或修改什么内容。标题应概括画面主题、类型、用途或场景，保持简短清晰；英文产品名不要截断。只输出标题，不要引号、标点、说明或 Markdown。"
  });
}

export function refreshChatTitleInBackground(userId: string, sessionId: string, prompt: string, currentTitle: string) {
  if (!prompt.trim()) return;
  void generateChatTitleFromPrompt(prompt)
    .then((title) => {
      const nextTitle = title.trim();
      if (!nextTitle || nextTitle === currentTitle) return;
      run(
        appDb,
        "update sessions set title = ? where id = ? and user_id = ? and title = ? and deleted_at is null",
        nextTitle,
        sessionId,
        userId,
        currentTitle
      );
    })
    .catch((error) => {
      console.warn("对话标题后台更新失败", error);
    });
}

export function ownedSession(userId: string, sessionId: string | null | undefined) {
  if (!sessionId) return null;
  return getOne<{ id: string }>(
    appDb,
    "select id from sessions where id = ? and user_id = ? and deleted_at is null",
    sessionId,
    userId
  );
}

export function serializeSession(row: {
  id: string;
  title: string;
  archived_at?: string | null;
  running_job_count?: number | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    title: row.title,
    archivedAt: row.archived_at ?? null,
    runningImageJobCount: row.running_job_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function ensureChatSession(userId: string, sessionId: string | null | undefined, prompt: string) {
  const existing = ownedSession(userId, sessionId);
  if (existing) return existing.id;
  const id = makeId("chat");
  const timestamp = now();
  const title = immediateChatTitleFromPrompt(prompt);
  run(
    appDb,
    "insert into sessions (id, user_id, title, created_at, updated_at) values (?, ?, ?, ?, ?)",
    id,
    userId,
    title,
    timestamp,
    timestamp
  );
  refreshChatTitleInBackground(userId, id, prompt, title);
  return id;
}

export function insertMessage(
  userId: string,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  imageId: string | null = null,
  metadata: unknown = {}
) {
  const id = makeId("msg");
  run(
    appDb,
    "insert into messages (id, session_id, user_id, role, content, image_id, metadata, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    sessionId,
    userId,
    role,
    content,
    imageId,
    JSON.stringify(metadata),
    now()
  );
  run(appDb, "update sessions set updated_at = ? where id = ?", now(), sessionId);
  return id;
}

export function archiveSession(userId: string, sessionId: string, archived: boolean) {
  const session = getOne<{ id: string }>(appDb, "select id from sessions where id = ? and user_id = ? and deleted_at is null", sessionId, userId);
  if (!session) return null;
  const timestamp = now();
  if (archived) {
    run(appDb, "update sessions set archived_at = ? where id = ? and user_id = ? and deleted_at is null", timestamp, sessionId, userId);
  } else {
    run(appDb, "update sessions set archived_at = null, updated_at = ? where id = ? and user_id = ? and deleted_at is null", timestamp, sessionId, userId);
  }
  return getOne<{
    id: string;
    title: string;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
  }>(appDb, "select id, title, archived_at, created_at, updated_at from sessions where id = ? and user_id = ? and deleted_at is null", sessionId, userId);
}

export function renameSession(userId: string, sessionId: string, title: string) {
  const nextTitle = title.replace(/\s+/g, " ").trim();
  if (!nextTitle) return null;
  const session = getOne<{ id: string }>(appDb, "select id from sessions where id = ? and user_id = ? and deleted_at is null", sessionId, userId);
  if (!session) return null;
  run(appDb, "update sessions set title = ? where id = ? and user_id = ? and deleted_at is null", nextTitle, sessionId, userId);
  return getOne<{
    id: string;
    title: string;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
  }>(appDb, "select id, title, archived_at, created_at, updated_at from sessions where id = ? and user_id = ? and deleted_at is null", sessionId, userId);
}

export function archiveAllSessions(userId: string) {
  const timestamp = now();
  const result = run(appDb, "update sessions set archived_at = ? where user_id = ? and archived_at is null and deleted_at is null", timestamp, userId);
  return Number(result.changes ?? 0);
}

export function unarchiveAllSessions(userId: string) {
  const timestamp = now();
  const result = run(
    appDb,
    "update sessions set archived_at = null, updated_at = ? where user_id = ? and archived_at is not null and deleted_at is null",
    timestamp,
    userId
  );
  return Number(result.changes ?? 0);
}

function uniquePaths(rows: Array<{ path: string | null }>) {
  return Array.from(new Set(rows.map((row) => String(row.path ?? "").trim()).filter(Boolean)));
}

async function deleteImagesMatching(userId: string, imageFilterSql: string, params: string[]) {
  const assetFilterSql = `select id from assets where user_id = ? and path in (select path from images where id in (${imageFilterSql}))`;
  const assetParams = [userId, ...params];
  const imageIds = getAll<{ id: string }>(appDb, `select id from images where id in (${imageFilterSql})`, ...params).map((row) => row.id);
  const assetIds = getAll<{ id: string }>(appDb, `select id from assets where id in (${assetFilterSql})`, ...assetParams).map((row) => row.id);
  const referenceIds = getAll<{ id: string }>(appDb, `select id from image_asset_references where image_id in (${imageFilterSql})`, ...params).map((row) => row.id);
  const derivativeSources = [
    { sourceType: "image" as const, sourceIds: imageIds },
    { sourceType: "asset" as const, sourceIds: assetIds },
    { sourceType: "image-reference" as const, sourceIds: referenceIds }
  ];
  const pathsToDelete = uniquePaths([
    ...getAll<{ path: string }>(appDb, `select path from images where id in (${imageFilterSql})`, ...params),
    ...getAll<{ path: string }>(appDb, `select path from assets where id in (${assetFilterSql})`, ...assetParams),
    ...getAll<{ path: string }>(appDb, `select path from image_asset_references where image_id in (${imageFilterSql})`, ...params),
    ...imageDerivativePathsForSources(derivativeSources)
  ]);
  run(appDb, `delete from case_prompt_usage_events where case_item_id in (select id from case_items where image_id in (${imageFilterSql}))`, ...params);
  run(appDb, `delete from case_prompt_usage_events where source_type = 'image' and source_id in (${imageFilterSql})`, ...params);
  run(appDb, `delete from case_prompt_usage_events where source_type = 'case_group' and source_id in (select group_id from case_group_images where image_id in (${imageFilterSql}))`, ...params);
  run(appDb, `delete from case_prompt_usage_events where case_item_id in (select id from case_items where asset_id in (${assetFilterSql}))`, ...assetParams);
  run(appDb, `delete from case_prompt_usage_events where source_type = 'asset' and source_id in (${assetFilterSql})`, ...assetParams);
  run(appDb, `delete from case_prompt_usage_events where source_type = 'case_group' and source_id in (select group_id from case_group_images where asset_id in (${assetFilterSql}))`, ...assetParams);
  run(appDb, `delete from case_favorites where source_type = 'image' and source_id in (${imageFilterSql})`, ...params);
  run(appDb, `delete from case_favorites where source_type = 'case_group' and source_id in (select group_id from case_group_images where image_id in (${imageFilterSql}))`, ...params);
  run(appDb, `delete from case_favorites where source_type = 'asset' and source_id in (${assetFilterSql})`, ...assetParams);
  run(appDb, `delete from case_favorites where source_type = 'case_group' and source_id in (select group_id from case_group_images where asset_id in (${assetFilterSql}))`, ...assetParams);
  run(appDb, `delete from case_items where group_id in (select group_id from case_group_images where image_id in (${imageFilterSql}))`, ...params);
  run(appDb, `delete from case_items where group_id in (select group_id from case_group_images where asset_id in (${assetFilterSql}))`, ...assetParams);
  run(appDb, `delete from case_group_images where group_id in (select group_id from case_group_images where image_id in (${imageFilterSql}))`, ...params);
  run(appDb, `delete from case_group_images where group_id in (select group_id from case_group_images where asset_id in (${assetFilterSql}))`, ...assetParams);
  run(appDb, `delete from case_items where image_id in (${imageFilterSql})`, ...params);
  run(appDb, `delete from case_items where asset_id in (${assetFilterSql})`, ...assetParams);
  run(appDb, `update image_asset_references set source_asset_id = null where source_asset_id in (${assetFilterSql})`, ...assetParams);
  run(appDb, `delete from asset_categories where asset_id in (${assetFilterSql})`, ...assetParams);
  run(appDb, `delete from assets where id in (${assetFilterSql})`, ...assetParams);
  run(appDb, `delete from messages where image_id in (${imageFilterSql})`, ...params);
  run(appDb, `update images set parent_image_id = null where parent_image_id in (${imageFilterSql})`, ...params);
  run(appDb, `update image_jobs set result_image_id = null where result_image_id in (${imageFilterSql})`, ...params);
  run(appDb, `delete from image_edit_suggestions where image_id in (${imageFilterSql})`, ...params);
  run(appDb, `delete from image_favorites where image_id in (${imageFilterSql})`, ...params);
  run(appDb, `delete from image_asset_references where image_id in (${imageFilterSql})`, ...params);
  deleteImageDerivativesForSources(derivativeSources);
  const result = run(appDb, `delete from images where id in (${imageFilterSql})`, ...params);
  await deleteStoredFilesIfUnreferenced(pathsToDelete);
  return Number(result.changes ?? 0);
}

function deleteSessionImages(userId: string, sessionId: string) {
  return deleteImagesMatching(userId, "select id from images where user_id = ? and session_id = ?", [userId, sessionId]);
}

function deleteUserSessionImages(userId: string) {
  return deleteImagesMatching(
    userId,
    "select id from images where user_id = ? and session_id in (select id from sessions where user_id = ?)",
    [userId, userId]
  );
}

export async function deleteImageRecords(userId: string, imageId: string) {
  const image = getOne<{ id: string }>(appDb, "select id from images where id = ? and user_id = ?", imageId, userId);
  if (!image) return false;
  const deleted = await deleteImagesMatching(userId, "select id from images where user_id = ? and id = ?", [userId, imageId]);
  return deleted > 0;
}

export async function deleteSessionRecords(userId: string, sessionId: string) {
  const session = getOne<{ id: string }>(appDb, "select id from sessions where id = ? and user_id = ? and deleted_at is null", sessionId, userId);
  if (!session) return false;
  await deleteSessionImages(userId, sessionId);
  run(appDb, "delete from image_jobs where user_id = ? and session_id = ?", userId, sessionId);
  run(appDb, "delete from messages where user_id = ? and session_id = ?", userId, sessionId);
  const result = run(appDb, "delete from sessions where user_id = ? and id = ? and deleted_at is null", userId, sessionId);
  return Number(result.changes ?? 0) > 0;
}

export async function deleteAllSessionRecords(userId: string) {
  await deleteUserSessionImages(userId);
  run(appDb, "delete from image_jobs where user_id = ? and session_id in (select id from sessions where user_id = ?)", userId, userId);
  run(appDb, "delete from messages where user_id = ? and session_id in (select id from sessions where user_id = ?)", userId, userId);
  const result = run(appDb, "delete from sessions where user_id = ?", userId);
  return Number(result.changes ?? 0);
}

function sourceAssetReference(metadata: Record<string, unknown>, userId: string) {
  const assetId = String(metadata.referenceAssetId ?? "").trim() || normalizeIdList(metadata.sourceAssetIds)[0];
  if (!assetId) return null;
  return getOne<{
    id: string;
    name: string;
    path: string;
    image_width: number | null;
    image_height: number | null;
  }>(
    appDb,
    `select id, name, path, image_width, image_height from assets where id = ? and ${visibleAssetSql("assets")}`,
    assetId,
    userId
  );
}

function sourceAssetReferences(metadata: Record<string, unknown>, userId: string) {
  const assetIds = normalizeIdList(metadata.sourceAssetIds);
  if (assetIds.length === 0) return [];
  const rows = getAll<{
    id: string;
    name: string;
    path: string;
    image_width: number | null;
    image_height: number | null;
  }>(
    appDb,
    `select id, name, path, image_width, image_height from assets
     where id in (${assetIds.map(() => "?").join(", ")})
       and ${visibleAssetSql("assets")}`,
    ...assetIds,
    userId
  );
  const rowById = new Map(rows.map((row) => [row.id, row]));
  return assetIds
    .map((assetId) => rowById.get(assetId))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({
      id: `asset:${row.id}`,
      sourceAssetId: row.id,
      sourceType: "asset",
      sourceId: row.id,
      kind: "asset",
      name: row.name,
      url: assetUrlFromAssetId(row.id),
      originalUrl: assetUrlFromAssetId(row.id),
      previewUrl: assetUrlFromAssetId(row.id, "preview"),
      thumbnailUrl: assetUrlFromAssetId(row.id, "thumb"),
      imageWidth: row.image_width ?? 0,
      imageHeight: row.image_height ?? 0
    }));
}

function sourceCaseReferences(metadata: Record<string, unknown>) {
  const rawReferences = Array.isArray(metadata.sourceCaseReferences) ? metadata.sourceCaseReferences : [];
  return rawReferences
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const caseItemId = String(record.sourceCaseItemId ?? "").trim();
      const url = String(record.url ?? "").trim();
      if (!caseItemId || !url) return null;
      return {
        id: String(record.id ?? `case:${caseItemId}`),
        sourceAssetId: null,
        sourceCaseItemId: caseItemId,
        sourceReferenceId: typeof record.sourceReferenceId === "string" ? record.sourceReferenceId : null,
        sourceType: typeof record.sourceType === "string" ? record.sourceType : null,
        sourceId: typeof record.sourceId === "string" ? record.sourceId : null,
        kind: "asset",
        name: String(record.name ?? "灵感素材").trim() || "灵感素材",
        url,
        originalUrl: String(record.originalUrl ?? url),
        previewUrl: String(record.previewUrl ?? url),
        thumbnailUrl: String(record.thumbnailUrl ?? record.previewUrl ?? url),
        imageWidth: Number(record.imageWidth ?? 0) || 0,
        imageHeight: Number(record.imageHeight ?? 0) || 0
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function sourceReferenceSnapshots(metadata: Record<string, unknown>, userId: string) {
  const rows = messageSourceReferencesByMessageMetadata(metadata, userId);
  if (rows.length > 0) return rows.map(publicMessageSourceReference);
  const rawReferences = Array.isArray(metadata.sourceReferenceImages) ? metadata.sourceReferenceImages : [];
  return rawReferences
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const sourceReferenceId = String(record.sourceReferenceId ?? "").trim();
      const url = String(record.url ?? "").trim();
      if (!sourceReferenceId || !url) return null;
      const sourceType = String(record.sourceType ?? "").trim();
      return {
        id: String(record.id ?? `message-source:${sourceReferenceId}`),
        sourceReferenceId,
        sourceAssetId: typeof record.sourceAssetId === "string" ? record.sourceAssetId : null,
        sourceCaseItemId: typeof record.sourceCaseItemId === "string" ? record.sourceCaseItemId : null,
        sourceType: sourceType || null,
        sourceId: typeof record.sourceId === "string" ? record.sourceId : null,
        kind: record.kind === "image" ? ("image" as const) : ("asset" as const),
        name: String(record.name ?? "引用素材").trim() || "引用素材",
        url,
        originalUrl: String(record.originalUrl ?? url),
        previewUrl: String(record.previewUrl ?? url),
        thumbnailUrl: String(record.thumbnailUrl ?? record.previewUrl ?? url),
        imageWidth: Number(record.imageWidth ?? 0) || 0,
        imageHeight: Number(record.imageHeight ?? 0) || 0
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

export function serializeMessage(row: {
  id: string;
  user_id: string;
  role: string;
  content: string;
  image_id: string | null;
  metadata: string | null;
  created_at: string;
  image_path?: string | null;
  image_prompt?: string | null;
  image_kind?: string | null;
  image_size?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  image_file_size?: number | null;
  image_quality?: string | null;
  image_provider_id?: string | null;
  parent_image_id?: string | null;
  image_origin_prompt?: string | null;
  image_suggested_case_title?: string | null;
  image_suggested_case_category_ids_json?: string | null;
  image_suggested_asset_category_ids_json?: string | null;
}) {
  const metadata = safeJson<Record<string, unknown>>(row.metadata, {});
  const messageImageUrl = row.image_id && row.image_path ? imageUrlFromImageId(row.image_id) : null;
  const messagePreviewUrl = row.image_id && row.image_path ? imageUrlFromImageId(row.image_id, "preview") : null;
  const messageThumbnailUrl = row.image_id && row.image_path ? imageUrlFromImageId(row.image_id, "thumb") : null;
  const hasReferenceAssetId = typeof metadata.referenceAssetId === "string" && metadata.referenceAssetId.trim().length > 0;
  const snapshotReferences = row.role === "user" ? sourceReferenceSnapshots(metadata, row.user_id) : [];
  const liveMaterialReferences = row.role === "user" && snapshotReferences.length === 0
    ? [...sourceCaseReferences(metadata), ...sourceAssetReferences(metadata, row.user_id)]
    : [];
  const sourceReferenceImages = row.role === "user" ? [...snapshotReferences, ...liveMaterialReferences] : [];
  const primaryMaterialReference = sourceReferenceImages[0] ?? null;
  const useMaterialAsPrimary = Boolean(primaryMaterialReference && !messageImageUrl);
  const sourceAsset = row.role === "user" && !primaryMaterialReference && (hasReferenceAssetId || !messageImageUrl) ? sourceAssetReference(metadata, row.user_id) : null;
  const referenceImageUrl = row.role === "user"
    ? useMaterialAsPrimary
      ? primaryMaterialReference?.url ?? null
      : sourceAsset
        ? assetUrlFromAssetId(sourceAsset.id)
        : messageImageUrl
    : null;
  const referenceImagePreviewUrl = row.role === "user"
    ? useMaterialAsPrimary
      ? primaryMaterialReference?.previewUrl ?? null
      : sourceAsset
        ? assetUrlFromAssetId(sourceAsset.id, "preview")
        : messagePreviewUrl
    : null;
  const referenceImageThumbnailUrl = row.role === "user"
    ? useMaterialAsPrimary
      ? primaryMaterialReference?.thumbnailUrl ?? null
      : sourceAsset
        ? assetUrlFromAssetId(sourceAsset.id, "thumb")
        : messageThumbnailUrl
    : null;
  const referenceImagePrompt = row.role === "user" ? (useMaterialAsPrimary ? primaryMaterialReference?.name : row.image_prompt ?? sourceAsset?.name) ?? null : null;
  const referenceImageKind = row.role === "user" && referenceImageUrl ? (useMaterialAsPrimary || sourceAsset ? "asset" : "image") : null;

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    imageId: row.image_id,
    imageUrl: messageImageUrl,
    imageOriginalUrl: messageImageUrl,
    imagePreviewUrl: messagePreviewUrl,
    imageThumbnailUrl: messageThumbnailUrl,
    imagePrompt: row.image_prompt ?? null,
    imageOriginPrompt: row.image_origin_prompt ?? row.image_prompt ?? null,
    referenceImageUrl,
    referenceImageOriginalUrl: referenceImageUrl,
    referenceImagePreviewUrl,
    referenceImageThumbnailUrl,
    referenceImagePrompt,
    referenceImageKind,
    referenceImageWidth: useMaterialAsPrimary ? primaryMaterialReference?.imageWidth ?? 0 : sourceAsset?.image_width ?? row.image_width ?? 0,
    referenceImageHeight: useMaterialAsPrimary ? primaryMaterialReference?.imageHeight ?? 0 : sourceAsset?.image_height ?? row.image_height ?? 0,
    sourceReferenceImages,
    imageKind: row.image_kind ?? null,
    imageSize: row.image_size ?? null,
    imageWidth: row.image_width ?? 0,
    imageHeight: row.image_height ?? 0,
    imageFileSize: row.image_file_size ?? 0,
    imageQuality: row.image_quality ?? null,
    imageProviderId: row.image_provider_id ?? null,
    parentImageId: row.parent_image_id ?? null,
    imageSuggestedCaseTitle: row.image_suggested_case_title ?? "",
    imageSuggestedCaseCategoryIds: parseJsonArray(row.image_suggested_case_category_ids_json, []),
    imageSuggestedAssetName: row.image_suggested_case_title ?? "",
    imageSuggestedAssetCategoryIds: parseJsonArray(row.image_suggested_asset_category_ids_json, []),
    metadata,
    createdAt: row.created_at
  };
}

export function serializeJob(row: {
  id: string;
  type: string;
  status: string;
  prompt: string;
  provider_id: string;
  error: string | null;
  result_image_id: string | null;
  branchId?: string;
  parentBranchId?: string;
  branchForkMessageId?: string;
  branchRootMessageId?: string;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    prompt: row.prompt,
    providerId: row.provider_id,
    error: row.error,
    resultImageId: row.result_image_id,
    ...(row.branchId ? { branchId: row.branchId } : {}),
    ...(row.parentBranchId ? { parentBranchId: row.parentBranchId } : {}),
    ...(row.branchForkMessageId ? { branchForkMessageId: row.branchForkMessageId } : {}),
    ...(row.branchRootMessageId ? { branchRootMessageId: row.branchRootMessageId } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
