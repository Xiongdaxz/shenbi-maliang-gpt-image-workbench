import type { Hono } from "hono";
import { applyAssetFieldSuggestionsToImages, ensureAssetFieldSuggestionsForImage } from "./assetSuggestions";
import { caseMaterialReferenceFromSource, caseMaterialSourcesByIds } from "./caseMaterialSources";
import { applyCaseFieldSuggestionsToImages, ensureCaseFieldSuggestionsForImage } from "./caseSuggestions";
import { AUTO_PROVIDER_ID, requestImageCount, requestImageSize, resolveImageResultRetryCount } from "./constants";
import { recordCasePromptUsage } from "./caseUsage";
import { appDb, getAll, getOne, run } from "./db";
import { fileToDataUrl, saveProviderImageResults, snapshotImageReferences, type ImageReferenceSnapshotInput } from "./imageFiles";
import { emitImageJobEvent, type ImageJobEventStatus } from "./imageJobEvents";
import {
  ensureImageEditSuggestionsForImageWithTone,
  prepareImageEditSuggestionsForPrompt,
  savePreparedImageEditSuggestionsForImages,
  type PreparedImageEditSuggestions
} from "./imageEditSuggestions";
import { saveImageEditMaskDebugArtifacts } from "./imageEditDebug";
import { imageEditMaskSnapshotDataUrl, normalizeImageEditMaskDataUrl, saveImageEditMaskSnapshot } from "./imageMasks";
import { readImageDimensions } from "./imageDimensions";
import {
  messageSourceReferencesByIds,
  publicMessageSourceReference,
  snapshotMessageSourceReferences,
  type MessageSourceReferenceInput
} from "./messageSourceReferences";
import { pageInfo, paginationFromQuery } from "./pagination";
import { callProviderChain, providerChainById } from "./providerRuntime";
import { providerResponseSnapshot } from "./responseSnapshots";
import { reviewConversationPrompt } from "./safetyReview";
import {
  imageOriginPromptsByImageIds,
  imagePromptHistoriesByImageIds,
  imageReferencesByImageIds,
  publicImageReference,
  publicImagesWithReferences
} from "./serializers";
import { imageGenerationSettings } from "./settingsStore";
import type { ImageReferenceSourceAsset, ImageRow, ProviderImageContext, ProviderRow, RuntimeProviderRow } from "./types";
import { userPreferences } from "./userPreferences";
import { inferChannelFromType, makeId, normalizeIdList, normalizeProviderChannel, now, safeJson, visibleAssetSql } from "./utils";
import { requireUser } from "./auth";
import { markProviderRequestPostProcessFailure } from "./auditLog";
import { deleteImageRecords, ensureChatSession, expireStaleImageJobs, insertMessage, serializeJob } from "./chatStore";

function providerPrompt(prompt: string, imageCount: number) {
  if (imageCount <= 1) return prompt;
  return [
    prompt,
    "",
    `数量由接口参数 n=${imageCount} 控制。请把每个结果都生成成一张独立完整的单图，不要在单张图片中做四宫格、拼贴、分屏或多张图片排版。`
  ].join("\n");
}

type ImageBackgroundOption = "auto" | "opaque" | "transparent";
type ImageOutputFormatOption = "png" | "webp";
type ImageInputFidelityOption = "low" | "high";

function requestOptionText(body: Record<string, unknown>, ...fields: string[]) {
  for (const field of fields) {
    const value = body[field];
    if (value !== undefined && value !== null) return String(value).trim();
  }
  return "";
}

function normalizedImageRequestOptions(body: Record<string, unknown>, includeInputFidelity = false) {
  const background = requestOptionText(body, "background").toLowerCase();
  const outputFormat = requestOptionText(body, "outputFormat", "output_format").toLowerCase();
  const inputFidelity = requestOptionText(body, "inputFidelity", "input_fidelity").toLowerCase();
  const payload: {
    background?: ImageBackgroundOption;
    output_format?: ImageOutputFormatOption;
    input_fidelity?: ImageInputFidelityOption;
  } = {};

  if (background) {
    if (background !== "auto" && background !== "opaque" && background !== "transparent") {
      return { error: "background 仅支持 auto、opaque 或 transparent", payload };
    }
    payload.background = background;
  }

  if (outputFormat) {
    if (outputFormat !== "png" && outputFormat !== "webp") {
      return { error: "透明背景输出格式仅支持 png 或 webp", payload };
    }
    if (background !== "transparent") {
      return { error: "outputFormat 目前仅支持 background=transparent 时使用", payload };
    }
    payload.output_format = outputFormat;
  } else if (background === "transparent") {
    payload.output_format = "png";
  }

  if (includeInputFidelity && inputFidelity) {
    if (inputFidelity !== "low" && inputFidelity !== "high") {
      return { error: "inputFidelity 仅支持 low 或 high", payload };
    }
    payload.input_fidelity = inputFidelity;
  }

  return { error: "", payload };
}

function providerImageContextValues(context: ProviderImageContext) {
  return [context.fileId, context.genId, context.conversationId, context.parentMessageId, context.sourceAccountId];
}

function emitJobStatus(
  userId: string,
  sessionId: string | null | undefined,
  jobId: string,
  status: ImageJobEventStatus,
  type?: string,
  details: { resultImageId?: string | null; error?: string | null } = {}
) {
  const normalizedSessionId = String(sessionId ?? "").trim();
  if (!normalizedSessionId) return;
  emitImageJobEvent(userId, {
    jobId,
    sessionId: normalizedSessionId,
    status,
    type,
    ...(details.resultImageId !== undefined ? { resultImageId: details.resultImageId } : {}),
    ...(details.error !== undefined ? { error: details.error } : {}),
    updatedAt: now()
  });
}

async function applyImageFieldSuggestions(imageIds: string[], prompt?: string) {
  const ids = Array.from(new Set(imageIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return;
  const promptMap = prompt?.trim()
    ? new Map(ids.map((id) => [id, prompt.trim()]))
    : imageOriginPromptsByImageIds(ids);
  const idsByPrompt = new Map<string, string[]>();
  for (const id of ids) {
    const targetPrompt = (promptMap.get(id) ?? "").trim();
    if (!targetPrompt) continue;
    const group = idsByPrompt.get(targetPrompt) ?? [];
    group.push(id);
    idsByPrompt.set(targetPrompt, group);
  }
  try {
    await Promise.all(
      Array.from(idsByPrompt.entries()).flatMap(([targetPrompt, targetImageIds]) => [
        applyCaseFieldSuggestionsToImages(targetImageIds, targetPrompt),
        applyAssetFieldSuggestionsToImages(targetImageIds, targetPrompt)
      ])
    );
  } catch (error) {
    console.warn("图片灵感/素材字段自动生成失败", error);
  }
}

async function ensureImageEditSuggestionsForImages(
  userId: string,
  imageIds: string[],
  prepared?: PreparedImageEditSuggestions | null
) {
  const ids = Array.from(new Set(imageIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return;

  try {
    const preferences = userPreferences(userId);
    if (!preferences.editSuggestionsEnabled) return;
    if (prepared) {
      await savePreparedImageEditSuggestionsForImages(userId, ids, prepared);
      return;
    }
    const images = getAll<ImageRow>(
      appDb,
      `select * from images where user_id = ? and id in (${ids.map(() => "?").join(", ")})`,
      userId,
      ...ids
    );
    if (images.length === 0) return;
    const promptHistories = imagePromptHistoriesByImageIds(images.map((image) => image.id));
    const results = await Promise.allSettled(
      images.map((image) => {
        const promptHistory = promptHistories.get(image.id) ?? [image.prompt];
        const originPrompt = promptHistory[0] ?? image.prompt;
        return ensureImageEditSuggestionsForImageWithTone(
          image,
          originPrompt,
          preferences.editSuggestionTone,
          promptHistory
        );
      })
    );
    const rejected = results.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    if (rejected.length > 0) {
      console.warn(`图片续改建议预生成失败：${rejected.length}/${images.length}`, rejected[0]?.reason);
    }
  } catch (error) {
    console.warn("图片续改建议预生成任务失败", error);
  }
}

function prepareImageEditSuggestionsForJob({
  userId,
  prompt,
  kind,
  promptHistory
}: {
  userId: string;
  prompt: string;
  kind: "generation" | "edit";
  promptHistory: string[];
}) {
  const preferences = userPreferences(userId);
  if (!preferences.editSuggestionsEnabled) return null;
  const normalizedPromptHistory = promptHistory.map((item) => item.trim()).filter(Boolean);
  const effectivePromptHistory = normalizedPromptHistory.length > 0 ? normalizedPromptHistory : [prompt];
  return prepareImageEditSuggestionsForPrompt({
    prompt,
    originPrompt: effectivePromptHistory[0] ?? prompt,
    promptHistory: effectivePromptHistory,
    kind,
    tone: preferences.editSuggestionTone
  });
}

function editPromptHistoryForSourceImage(sourceImage: ImageRow | null, prompt: string) {
  if (!sourceImage) return [prompt];
  const sourceHistory = imagePromptHistoriesByImageIds([sourceImage.id]).get(sourceImage.id) ?? [sourceImage.prompt];
  return [...sourceHistory, prompt].map((item) => item.trim()).filter(Boolean);
}

function isCpaProvider(provider: ProviderRow) {
  return normalizeProviderChannel(provider.channel || inferChannelFromType(provider.type)) === "cpa";
}

function supportsSourceReference(provider: ProviderRow) {
  const channel = normalizeProviderChannel(provider.channel || inferChannelFromType(provider.type));
  return channel === "cpa" || channel === "chatgpt_web";
}

function providerSourceReference(provider: ProviderRow, image: ImageRow | null) {
  if (!supportsSourceReference(provider) || !image) return null;
  const fileId = String(image.provider_file_id ?? "").trim();
  const genId = String(image.provider_gen_id ?? "").trim();
  const sourceAccountId = String(image.provider_source_account_id ?? "").trim();
  if (!fileId || !sourceAccountId) return null;
  return {
    original_file_id: fileId,
    ...(genId ? { original_gen_id: genId } : {}),
    conversation_id: String(image.provider_conversation_id ?? "").trim(),
    parent_message_id: String(image.provider_parent_message_id ?? "").trim(),
    source_account_id: sourceAccountId
  };
}

type WebConversationPlacement = "branch" | "tail" | "source";

function providerConversationContextFromImage(image: ImageRow | null, placement: WebConversationPlacement) {
  if (!image) return null;
  const conversationId = String(image.provider_conversation_id ?? "").trim();
  const parentMessageId = String(image.provider_parent_message_id ?? "").trim();
  const sourceAccountId = String(image.provider_source_account_id ?? "").trim();
  if (!conversationId || !parentMessageId || !sourceAccountId) return null;
  return {
    placement,
    conversation_id: conversationId,
    parent_message_id: parentMessageId,
    source_account_id: sourceAccountId
  };
}

function providerConversationContextFromMessage(
  userId: string,
  sessionId: string | null,
  messageId: string,
  placement: WebConversationPlacement
) {
  if (!sessionId || !messageId) return null;
  const row = getOne<{ image_id: string | null; metadata: string | null }>(
    appDb,
    "select image_id, metadata from messages where id = ? and user_id = ? and session_id = ?",
    messageId,
    userId,
    sessionId
  );
  if (!row) return null;
  const metadata = safeJson<Record<string, unknown>>(row.metadata, {});
  const jobId = String(metadata.jobId ?? "").trim();
  const image = jobId
    ? getOne<ImageRow>(
        appDb,
        "select * from images where job_id = ? and user_id = ? order by created_at desc, rowid desc",
        jobId,
        userId
      )
    : row.image_id
      ? getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", row.image_id, userId)
      : null;
  return providerConversationContextFromImage(image, placement);
}

function latestProviderConversationContextForBranch(userId: string, sessionId: string | null, branchId: string, sourceAccountId = "") {
  if (!sessionId || !branchId || branchId === "main") return null;
  const rows = getAll<{ image_id: string | null; metadata: string | null }>(
    appDb,
    "select image_id, metadata from messages where user_id = ? and session_id = ? and role = 'assistant' and image_id is not null order by created_at desc, rowid desc",
    userId,
    sessionId
  );
  for (const row of rows) {
    const metadata = safeJson<Record<string, unknown>>(row.metadata, {});
    if (String(metadata.branchId ?? "").trim() !== branchId) continue;
    const image = row.image_id ? getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", row.image_id, userId) : null;
    if (sourceAccountId && String(image?.provider_source_account_id ?? "").trim() !== sourceAccountId) continue;
    const context = providerConversationContextFromImage(image, "tail");
    if (context) return context;
  }
  return null;
}

function latestProviderConversationContextForSession(userId: string, sessionId: string | null, branchId = "main", sourceAccountId = "") {
  if (!sessionId) return null;
  const rows = getAll<{ image_id: string | null; metadata: string | null }>(
    appDb,
    "select image_id, metadata from messages where user_id = ? and session_id = ? and role = 'assistant' and image_id is not null order by created_at desc, rowid desc",
    userId,
    sessionId
  );
  const normalizedBranchId = branchId && branchId !== "main" ? branchId : "main";
  for (const row of rows) {
    const metadata = safeJson<Record<string, unknown>>(row.metadata, {});
    const messageBranchId = String(metadata.branchId ?? "main").trim() || "main";
    if (messageBranchId !== normalizedBranchId) continue;
    const image = row.image_id ? getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", row.image_id, userId) : null;
    if (sourceAccountId && String(image?.provider_source_account_id ?? "").trim() !== sourceAccountId) continue;
    const context = providerConversationContextFromImage(image, "tail");
    if (context) return context;
  }
  return null;
}

async function messageMaskSnapshotDataUrl(userId: string, sessionId: string | null, messageId: string) {
  if (!sessionId || !messageId) return "";
  const row = getOne<{ metadata: string | null }>(
    appDb,
    "select metadata from messages where id = ? and user_id = ? and session_id = ?",
    messageId,
    userId,
    sessionId
  );
  const metadata = safeJson<Record<string, unknown>>(row?.metadata, {});
  const maskPath = String(metadata.maskPath ?? "").trim();
  if (!maskPath) return "";
  return imageEditMaskSnapshotDataUrl(maskPath).catch((error) => {
    console.warn("图片编辑遮罩快照读取失败", error);
    return "";
  });
}

function requestBranchMetadata(body: Record<string, unknown>) {
  const branchId = String(body.branchId ?? "").trim();
  if (!branchId) return {};
  const parentBranchId = String(body.parentBranchId ?? "").trim();
  const branchForkMessageId = String(body.branchForkMessageId ?? "").trim();
  const branchRootMessageId = String(body.branchRootMessageId ?? "").trim();
  return {
    branchId,
    ...(parentBranchId ? { parentBranchId } : {}),
    ...(branchForkMessageId ? { branchForkMessageId } : {}),
    ...(branchRootMessageId ? { branchRootMessageId } : {})
  };
}

function providerEditPrompt(prompt: string, imageCount: number, provider: ProviderRow, hasMask: boolean) {
  const basePrompt = providerPrompt(prompt, imageCount);
  if (!hasMask || !supportsSourceReference(provider)) return basePrompt;
  return [
    basePrompt,
    "",
    "严格只在遮罩选区内修改，新增或替换内容必须与选区位置对齐，并符合原图透视、光影、材质和风格，自然融合到画面中，不得移到选区外；未选区域保持原图不变。遮罩不是画面内容，不要生成遮罩颜色、边框或涂抹痕迹。"
  ].join("\n");
}

function imageOperationLabel(mode: "generation" | "edit") {
  return mode === "edit" ? "图片编辑" : "图片生成";
}

type RetryTaggedError = Error & {
  attemptNo?: number;
  retryCount?: number;
  autoRetryCount?: number;
};

function tagRetryError(error: unknown, attemptNo: number, retryCount: number) {
  const retryError: RetryTaggedError = error instanceof Error ? error : new Error(String(error));
  retryError.attemptNo = attemptNo;
  retryError.retryCount = retryCount;
  retryError.autoRetryCount = Math.max(0, attemptNo - 1);
  return retryError;
}

function autoRetryCountFromError(error: unknown, fallback: number) {
  if (error instanceof Error) {
    const value = (error as RetryTaggedError).autoRetryCount;
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  }
  return Math.max(0, fallback);
}

function providerSelectionId(value: unknown) {
  return String(value ?? "").trim() || AUTO_PROVIDER_ID;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    const nested = record.error;
    if (typeof nested === "string" && nested.trim()) return nested;
    if (nested && typeof nested === "object") {
      const nestedMessage = (nested as Record<string, unknown>).message;
      if (typeof nestedMessage === "string" && nestedMessage.trim()) return nestedMessage;
    }
  }
  const text = String(error ?? "").trim();
  return text || fallback;
}

async function saveProviderImagesWithRetry({
  providers,
  mode,
  requestPayload,
  userId,
  sessionId,
  jobId,
  retryCount: retryCountInput,
  onResponseJson
}: {
  providers: RuntimeProviderRow[];
  mode: "generation" | "edit";
  requestPayload: Record<string, unknown>;
  userId: string;
  sessionId: string | null;
  jobId?: string;
  retryCount?: number;
  onResponseJson?: (responseJson: unknown) => void;
}) {
  let firstError: unknown = null;
  const retryCount = retryCountInput ?? resolveImageResultRetryCount(imageGenerationSettings().resultRetryCount);
  const maxAttempts = retryCount + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { provider, responseJson, result: savedImages } = await callProviderChain<Awaited<ReturnType<typeof saveProviderImageResults>>>(
        providers,
        mode,
        requestPayload,
        {
          userId,
          jobId,
          attemptNo: attempt,
          maxAttempts,
          isRetry: attempt > 1
        },
        async ({ provider, responseJson }) => {
          onResponseJson?.(responseJson);
          try {
            return await saveProviderImageResults(responseJson, provider, () => makeId("img"), userId, sessionId);
          } catch (error) {
            markProviderRequestPostProcessFailure({
              provider,
              operation: mode,
              jobId,
              attemptNo: attempt,
              error: errorMessage(error, `${imageOperationLabel(mode)}失败`),
              responseSnapshot: providerResponseSnapshot(responseJson)
            });
            throw error;
          }
        }
      );
      if (!savedImages) {
        throw new Error(`${imageOperationLabel(mode)}失败：渠道没有返回可保存的图片`);
      }
      return { provider, responseJson, savedImages, attemptNo: attempt, retryCount, maxAttempts };
    } catch (error) {
      if (attempt < maxAttempts) {
        firstError = error;
        const retryLabel = retryCount === 1 ? "一次" : `第 ${attempt}/${retryCount} 次`;
        console.warn(`${imageOperationLabel(mode)}失败，自动重试${retryLabel}`, errorMessage(error, `${imageOperationLabel(mode)}失败`));
        continue;
      }
      if (firstError) {
        console.warn(`${imageOperationLabel(mode)}重试后仍失败`, {
          first: errorMessage(firstError, `${imageOperationLabel(mode)}失败`),
          second: errorMessage(error, `${imageOperationLabel(mode)}失败`)
        });
      }
      throw tagRetryError(error, attempt, retryCount);
    }
  }
  throw tagRetryError(firstError ?? new Error(`${imageOperationLabel(mode)}失败`), maxAttempts, retryCount);
}

function requestRevisionMetadata(metadata: Record<string, unknown>) {
  const revisionRootId = String(metadata.revisionRootId ?? "").trim();
  const editedMessageId = String(metadata.editedMessageId ?? "").trim();
  return revisionRootId ? { revisionRootId, ...(editedMessageId ? { editedMessageId } : {}) } : {};
}

type InlineSourceImage = {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  buffer: Buffer;
  size: number;
  imageWidth: number;
  imageHeight: number;
};

const MAX_INLINE_SOURCE_IMAGES = 8;
const MAX_INLINE_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;

function inlineSourceImageFromRecord(record: unknown, index: number): InlineSourceImage | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const source = record as Record<string, unknown>;
  const dataUrl = String(source.dataUrl ?? "").trim();
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("粘贴图片数据格式不正确");
  const mimeType = String(match[1] || "image/png").toLowerCase();
  if (!mimeType.startsWith("image/")) throw new Error("只能使用图片素材");
  const payload = match[3] ?? "";
  const buffer = match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload));
  if (buffer.length <= 0) throw new Error("粘贴图片数据为空");
  if (buffer.length > MAX_INLINE_SOURCE_IMAGE_BYTES) throw new Error("粘贴图片不能超过 20MB");
  const dimensions = readImageDimensions(buffer);
  return {
    id: String(source.id ?? `inline-${index + 1}`).trim() || `inline-${index + 1}`,
    name: String(source.name ?? "").trim() || `粘贴图片 ${index + 1}`,
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    mimeType,
    buffer,
    size: buffer.length,
    imageWidth: dimensions.width,
    imageHeight: dimensions.height
  };
}

function inlineSourceImagesFromPayload(value: unknown) {
  const records = Array.isArray(value) ? value : [];
  const sources: InlineSourceImage[] = [];
  for (const [index, record] of records.entries()) {
    if (sources.length >= MAX_INLINE_SOURCE_IMAGES) break;
    const source = inlineSourceImageFromRecord(record, index);
    if (source) sources.push(source);
  }
  return sources;
}

function numberFromPayload(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function retrySourceIds(value: string | null) {
  const parsed = safeJson<unknown>(value, []);
  if (Array.isArray(parsed)) {
    return {
      imageIds: parsed.map((item) => String(item ?? "").trim()).filter(Boolean),
      assetIds: [],
      caseItemIds: [],
      referenceIds: []
    };
  }
  if (!parsed || typeof parsed !== "object") return { imageIds: [], assetIds: [], caseItemIds: [], referenceIds: [] };
  const record = parsed as Record<string, unknown>;
  return {
    imageIds: normalizeIdList(record.imageIds),
    assetIds: normalizeIdList(record.assetIds),
    caseItemIds: normalizeIdList(record.caseItemIds),
    referenceIds: normalizeIdList(record.referenceIds)
  };
}

function messageSourceInputsFromAssets(assets: ImageReferenceSourceAsset[]): MessageSourceReferenceInput[] {
  return assets.map((asset) => ({
    sourceType: "asset",
    sourceId: asset.id,
    sourceCaseItemId: null,
    name: asset.name,
    path: asset.path,
    mimeType: asset.mime_type,
    size: asset.size,
    imageWidth: asset.image_width,
    imageHeight: asset.image_height
  }));
}

function messageSourceInputsFromCases(cases: NonNullable<ReturnType<typeof caseMaterialSourcesByIds>[number]>[]): MessageSourceReferenceInput[] {
  return cases.map((source) => ({
    sourceType: "case",
    sourceId: source.sourceId,
    sourceCaseItemId: source.caseItemId,
    name: source.title || source.prompt || "灵感素材",
    path: source.path,
    mimeType: source.mimeType,
    size: source.fileSize,
    imageWidth: source.imageWidth,
    imageHeight: source.imageHeight
  }));
}

function messageSourceInputsFromInlineImages(sources: InlineSourceImage[]): MessageSourceReferenceInput[] {
  return sources.map((source) => ({
    sourceType: "asset",
    sourceId: null,
    sourceCaseItemId: null,
    name: source.name,
    buffer: source.buffer,
    mimeType: source.mimeType,
    size: source.size,
    imageWidth: source.imageWidth,
    imageHeight: source.imageHeight
  }));
}

function imageReferenceInputsFromAssets(assets: ImageReferenceSourceAsset[]): ImageReferenceSnapshotInput[] {
  return assets.map((asset) => ({
    sourceType: "asset",
    sourceId: asset.id,
    sourceAssetId: asset.id,
    name: asset.name,
    path: asset.path,
    mimeType: asset.mime_type,
    size: asset.size,
    imageWidth: asset.image_width,
    imageHeight: asset.image_height
  }));
}

function imageReferenceInputsFromInlineImages(sources: InlineSourceImage[]): ImageReferenceSnapshotInput[] {
  return sources.map((source) => ({
    sourceType: "asset",
    sourceId: null,
    sourceAssetId: null,
    sourceCaseItemId: null,
    name: source.name,
    buffer: source.buffer,
    mimeType: source.mimeType,
    size: source.size,
    imageWidth: source.imageWidth,
    imageHeight: source.imageHeight
  }));
}

function imageReferenceInputsFromImages(images: ImageRow[]): ImageReferenceSnapshotInput[] {
  return images.map((image) => ({
    sourceType: "image",
    sourceId: image.id,
    sourceAssetId: null,
    name: image.prompt || "引用图片",
    path: image.path,
    mimeType: image.mime_type,
    size: image.image_file_size,
    imageWidth: image.image_width,
    imageHeight: image.image_height
  }));
}

function imageReferenceInputsFromCases(cases: NonNullable<ReturnType<typeof caseMaterialSourcesByIds>[number]>[]): ImageReferenceSnapshotInput[] {
  return cases.map((source) => ({
    sourceType: "case",
    sourceId: source.sourceId,
    sourceAssetId: source.sourceType === "asset" ? source.sourceId : null,
    sourceCaseItemId: source.caseItemId,
    name: source.title || source.prompt || "灵感素材",
    path: source.path,
    mimeType: source.mimeType,
    size: source.fileSize,
    imageWidth: source.imageWidth,
    imageHeight: source.imageHeight
  }));
}

function imageReferenceInputsFromMessageSources(
  references: NonNullable<ReturnType<typeof messageSourceReferencesByIds>[number]>[]
): ImageReferenceSnapshotInput[] {
  return references.map((reference) => ({
    sourceType: "message-source-reference",
    sourceId: reference.id,
    sourceAssetId: reference.source_type === "asset" ? reference.source_id : null,
    sourceCaseItemId: reference.source_case_item_id,
    name: reference.source_name || "引用素材",
    path: reference.path,
    mimeType: reference.mime_type,
    size: reference.size,
    imageWidth: reference.image_width,
    imageHeight: reference.image_height
  }));
}

function jobUserMessageMetadata(userId: string, sessionId: string | null, jobId: string) {
  if (!sessionId) return {};
  const rows = getAll<{ metadata: string | null }>(
    appDb,
    "select metadata from messages where user_id = ? and session_id = ? and role = 'user' and metadata is not null order by created_at asc, rowid asc",
    userId,
    sessionId
  );
  for (const row of rows) {
    const metadata = safeJson<Record<string, unknown>>(row.metadata, {});
    if (String(metadata.jobId ?? "").trim() === jobId) return metadata;
  }
  return {};
}

const IMAGE_WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function registerImageRoutes(api: Hono) {
api.get("/images", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const pagination = paginationFromQuery(c);
  const keyword = String(c.req.query("keyword") ?? "").trim().toLowerCase();
  const sort = String(c.req.query("sort") ?? "desc").trim() === "asc" ? "asc" : "desc";
  const favoriteOnly = c.req.query("favoriteOnly") === "true" || c.req.query("favoriteOnly") === "1";
  const where = ["user_id = ?"];
  const params: Array<string | number> = [user.id];
  if (keyword) {
    const like = `%${keyword}%`;
    const kindClauses: string[] = [];
    const dateClauses: string[] = [];
    const dateParams: string[] = [];
    if ("生成".includes(keyword) || keyword.includes("生成")) kindClauses.push("kind = 'generation'");
    if ("编辑".includes(keyword) || keyword.includes("编辑")) kindClauses.push("kind = 'edit'");
    const matchedWeekdays = IMAGE_WEEKDAY_LABELS.map((label, index) => ({ label, index }))
      .filter((item) => item.label.includes(keyword) || keyword.includes(item.label))
      .map((item) => String(item.index));
    if (matchedWeekdays.length > 0) {
      dateClauses.push(`strftime('%w', created_at) in (${matchedWeekdays.map(() => "?").join(", ")})`);
      dateParams.push(...matchedWeekdays);
    }
    const normalizedDateKeyword = keyword.replace("年", "-").replace("月", "-").replace(/[日号]/g, "");
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalizedDateKeyword)) {
      const [year, month, day] = normalizedDateKeyword.split("-");
      dateClauses.push("created_at like ?");
      dateParams.push(`%${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}%`);
    }
    where.push(
      `(
        lower(prompt) like ?
        or lower(kind) like ?
        or lower(size) like ?
        or lower(quality) like ?
        or lower(provider_id) like ?
        or lower(created_at) like ?
        ${kindClauses.length > 0 ? `or ${kindClauses.join(" or ")}` : ""}
        ${dateClauses.length > 0 ? `or ${dateClauses.join(" or ")}` : ""}
      )`
    );
    params.push(like, like, like, like, like, like, ...dateParams);
  }
  const baseWhereSql = where.join(" and ");
  const favoriteExistsSql = "exists (select 1 from image_favorites where image_favorites.user_id = ? and image_favorites.image_id = images.id)";
  const visibleWhereSql = favoriteOnly ? `${baseWhereSql} and ${favoriteExistsSql}` : baseWhereSql;
  const visibleParams = favoriteOnly ? [...params, user.id] : params;
  const total = getOne<{ count: number }>(appDb, `select count(*) as count from images where ${visibleWhereSql}`, ...visibleParams)?.count ?? 0;
  const allCount = getOne<{ count: number }>(appDb, `select count(*) as count from images where ${baseWhereSql}`, ...params)?.count ?? 0;
  const favoriteCount =
    getOne<{ count: number }>(
      appDb,
      `select count(*) as count from images where ${baseWhereSql} and ${favoriteExistsSql}`,
      ...params,
      user.id
    )?.count ?? 0;
  const limitSql = pagination.enabled ? " limit ? offset ?" : "";
  const limitParams = pagination.enabled ? [pagination.limit, pagination.offset] : [];
  const rows = getAll<ImageRow>(
    appDb,
    `select * from images where ${visibleWhereSql} order by created_at ${sort}, rowid ${sort}${limitSql}`,
    ...visibleParams,
    ...limitParams
  );
  const favoriteRows = rows.length > 0
    ? getAll<{ image_id: string; favorite_count: number; current_user_favorited: number }>(
        appDb,
        `select image_id, count(*) as favorite_count,
                max(case when user_id = ? then 1 else 0 end) as current_user_favorited
         from image_favorites
         where image_id in (${rows.map(() => "?").join(", ")})
         group by image_id`,
        user.id,
        ...rows.map((row) => row.id)
      )
    : [];
  const favoriteInfoByImageId = new Map(
    favoriteRows.map((row) => [row.image_id, { favoriteCount: row.favorite_count, favorited: Boolean(row.current_user_favorited) }])
  );
  const referenceMap = imageReferencesByImageIds(rows.map((row) => row.id));
  const publicImages = publicImagesWithReferences(rows, referenceMap);
  return c.json({
    images: publicImages.map((image) => ({
      ...image,
      ...(favoriteInfoByImageId.get(image.id) ?? { favoriteCount: 0, favorited: false })
    })),
    counts: {
      all: allCount,
      favorite: favoriteCount
    },
    pageInfo: pageInfo(total, pagination)
  });
});

api.post("/images/:imageId/asset-suggestions", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const imageId = c.req.param("imageId");
  const image = getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", imageId, user.id);
  if (!image) return c.json({ error: "图片不存在" }, 404);
  const originPrompt = imageOriginPromptsByImageIds([image.id]).get(image.id) ?? image.prompt;
  const suggestion = await ensureAssetFieldSuggestionsForImage(image, originPrompt);
  const updatedImage = getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", image.id, user.id) ?? image;
  const referenceMap = imageReferencesByImageIds([updatedImage.id]);
  const publicImages = publicImagesWithReferences([updatedImage], referenceMap);
  return c.json({
    ...suggestion,
    image: publicImages[0] ?? null
  });
});

api.post("/images/:imageId/case-suggestions", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const imageId = c.req.param("imageId");
  const image = getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", imageId, user.id);
  if (!image) return c.json({ error: "图片不存在" }, 404);
  const originPrompt = imageOriginPromptsByImageIds([image.id]).get(image.id) ?? image.prompt;
  const suggestion = await ensureCaseFieldSuggestionsForImage(image, originPrompt);
  const updatedImage = getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", image.id, user.id) ?? image;
  const referenceMap = imageReferencesByImageIds([updatedImage.id]);
  const publicImages = publicImagesWithReferences([updatedImage], referenceMap);
  return c.json({
    ...suggestion,
    image: publicImages[0] ?? null
  });
});

api.get("/images/:imageId/edit-suggestions", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const preferences = userPreferences(user.id);
  const imageId = c.req.param("imageId");
  if (!preferences.editSuggestionsEnabled) return c.json({ imageId, suggestions: [], generated: false });
  const image = getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", imageId, user.id);
  if (!image) return c.json({ error: "图片不存在" }, 404);
  const promptHistory = imagePromptHistoriesByImageIds([image.id]).get(image.id) ?? [image.prompt];
  const originPrompt = promptHistory[0] ?? image.prompt;
  const result = await ensureImageEditSuggestionsForImageWithTone(
    image,
    originPrompt,
    preferences.editSuggestionTone,
    promptHistory
  );
  return c.json(result);
});

api.put("/images/:imageId/favorite", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const imageId = c.req.param("imageId");
  const body = await c.req.json().catch(() => ({}));
  const favorited = Boolean(body.favorited);
  const image = getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", imageId, user.id);
  if (!image) return c.json({ error: "图片不存在" }, 404);
  if (favorited) {
    run(
      appDb,
      "insert or ignore into image_favorites (id, user_id, image_id, created_at) values (?, ?, ?, ?)",
      makeId("imgfav"),
      user.id,
      image.id,
      now()
    );
  } else {
    run(appDb, "delete from image_favorites where user_id = ? and image_id = ?", user.id, image.id);
  }
  const favoriteCount =
    getOne<{ total: number }>(appDb, "select count(*) as total from image_favorites where image_id = ?", image.id)?.total ?? 0;
  return c.json({ favorited, favoriteCount });
});

api.delete("/images/:imageId", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const deleted = await deleteImageRecords(user.id, c.req.param("imageId"));
  if (!deleted) return c.json({ error: "图片不存在" }, 404);
  return c.json({ ok: true });
});

api.post("/images/generate", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const prompt = String(body.prompt ?? "").trim();
  const caseItemId = String(body.caseItemId ?? "").trim();
  const revisionRootId = String(body.revisionRootId ?? "").trim();
  const editedMessageId = String(body.editedMessageId ?? "").trim();
  const revisionMetadata = revisionRootId ? { revisionRootId, ...(editedMessageId ? { editedMessageId } : {}) } : {};
  const branchId = String(body.branchId ?? "").trim();
  const branchForkMessageId = String(body.branchForkMessageId ?? "").trim();
  const branchMetadata = requestBranchMetadata(body);
  if (!prompt) return c.json({ error: "请输入图片描述" }, 400);
  const safetyReview = await reviewConversationPrompt({
    userId: user.id,
    sessionId: String(body.sessionId ?? "").trim(),
    scene: "image_generation",
    prompt
  });
  if (safetyReview.blocked) {
    return c.json({ error: safetyReview.message || "当前提示词可能存在安全风险，请调整后再试。" }, 400);
  }

  const selectedProviderId = providerSelectionId(body.providerId);
  let providers: ReturnType<typeof providerChainById>;
  try {
    providers = providerChainById(selectedProviderId);
  } catch (error) {
    return c.json({ error: errorMessage(error, "渠道配置不可用") }, 400);
  }
  const provider = providers[0];
  const size = requestImageSize(body.size);
  const quality = String(body.quality ?? provider.default_quality);
  const imageCount = requestImageCount(body.n ?? body.imageCount);
  const imageOptions = normalizedImageRequestOptions(body);
  if (imageOptions.error) return c.json({ error: imageOptions.error }, 400);
  const sessionId = await ensureChatSession(user.id, String(body.sessionId ?? "") || null, prompt);
  const webConversationContext = branchForkMessageId
    ? providerConversationContextFromMessage(user.id, sessionId, branchForkMessageId, "branch") ?? { placement: "branch" }
    : latestProviderConversationContextForBranch(user.id, sessionId, branchId);
  const timestamp = now();
  const jobId = makeId("job");
  const requestPayload = {
    prompt: providerPrompt(prompt, imageCount),
    size,
    quality,
    n: imageCount,
    ...imageOptions.payload,
    ...(webConversationContext ? { webConversationContext } : {})
  };
  const maxAutoRetries = resolveImageResultRetryCount(imageGenerationSettings().resultRetryCount);

  insertMessage(user.id, sessionId, "user", prompt, null, {
    mode: "generation",
    jobId,
    size,
    quality,
    n: imageCount,
    providerId: selectedProviderId,
    ...(caseItemId ? { caseItemId } : {}),
    ...revisionMetadata,
    ...branchMetadata
  });
  run(
    appDb,
    `insert into image_jobs (
      id, user_id, session_id, type, status, prompt, source_image_ids,
      provider_id, request_json, max_auto_retries, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    jobId,
    user.id,
    sessionId,
    "generation",
    "running",
    prompt,
    "[]",
    selectedProviderId,
    JSON.stringify(requestPayload),
    maxAutoRetries,
    timestamp,
    timestamp
  );
  emitJobStatus(user.id, sessionId, jobId, "running", "generation");
  recordCasePromptUsage({
    caseItemId,
    submittedPrompt: prompt,
    usedByUserId: user.id,
    jobId,
    requestType: "generation"
  });

  const runGenerationJob = async () => {
    const savedImageIds: string[] = [];
    try {
      const preparedEditSuggestions = prepareImageEditSuggestionsForJob({
        userId: user.id,
        prompt,
        kind: "generation",
        promptHistory: [prompt]
      });
      const { provider: actualProvider, responseJson, savedImages, attemptNo, retryCount } = await saveProviderImagesWithRetry({
        providers,
        mode: "generation",
        requestPayload,
        userId: user.id,
        sessionId,
        jobId,
        retryCount: maxAutoRetries
      });
      const autoRetryCount = Math.max(0, attemptNo - 1);
      const generatedByRetry = autoRetryCount > 0 ? 1 : 0;
      for (const saved of savedImages) {
        const imageIndex = savedImageIds.length + 1;
        const createdAt = now();
        run(
          appDb,
          `insert into images (
            id, user_id, session_id, job_id, path, prompt, kind, size, quality,
            provider_id, mime_type, parent_image_id,
            provider_file_id, provider_gen_id, provider_conversation_id, provider_parent_message_id, provider_source_account_id,
            image_width, image_height, image_file_size, generated_attempt_no, generated_by_retry, created_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          saved.id,
          user.id,
          sessionId,
          jobId,
          saved.file.path,
          prompt,
          "generation",
          size,
          quality,
          actualProvider.id,
          saved.file.mimeType,
          null,
          ...providerImageContextValues(saved.providerContext),
          saved.file.width,
          saved.file.height,
          saved.file.fileSize,
          attemptNo,
          generatedByRetry,
          createdAt
        );
        savedImageIds.push(saved.id);
        insertMessage(user.id, sessionId, "assistant", "已生成图片", saved.id, {
          mode: "generation",
          jobId,
          n: imageCount,
          imageIndex,
          imageTotal: imageCount,
          ...revisionMetadata,
          ...branchMetadata
        });
        run(
          appDb,
          "update image_jobs set result_image_id = coalesce(result_image_id, ?), updated_at = ? where id = ?",
          saved.id,
          now(),
          jobId
        );
      }
      await applyImageFieldSuggestions(savedImageIds, prompt);
      await ensureImageEditSuggestionsForImages(user.id, savedImageIds, preparedEditSuggestions);
      run(
        appDb,
        "update image_jobs set status = ?, result_image_id = ?, response_json = ?, auto_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = ?, updated_at = ? where id = ?",
        "succeeded",
        savedImageIds[0] ?? null,
        providerResponseSnapshot(responseJson),
        autoRetryCount,
        retryCount,
        generatedByRetry,
        now(),
        jobId
      );
      emitJobStatus(user.id, sessionId, jobId, "succeeded", "generation", { resultImageId: savedImageIds[0] ?? null });
      return savedImageIds;
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      const failedAutoRetryCount = autoRetryCountFromError(error, maxAutoRetries);
      run(
        appDb,
        "update image_jobs set status = ?, error = ?, auto_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = 0, updated_at = ? where id = ?",
        "failed",
        message,
        failedAutoRetryCount,
        maxAutoRetries,
        now(),
        jobId
      );
      emitJobStatus(user.id, sessionId, jobId, "failed", "generation", { error: message });
      throw error;
    }
  };

  const job = getOne<{
    id: string;
    type: string;
    status: string;
    prompt: string;
    provider_id: string;
    error: string | null;
    result_image_id: string | null;
    created_at: string;
    updated_at: string;
  }>(appDb, "select * from image_jobs where id = ?", jobId);
  void runGenerationJob().catch((error) => {
    console.warn("图片生成后台任务失败", error);
  });
  return c.json({ sessionId, job: job ? serializeJob(job) : null, image: null, images: [] }, 202);
});

api.post("/images/edit", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const prompt = String(body.prompt ?? "").trim();
  const caseItemId = String(body.caseItemId ?? "").trim();
  const sourceImageIds = normalizeIdList(body.sourceImageIds);
  const sourceAssetIds = normalizeIdList(body.sourceAssetIds);
  const sourceCaseItemIds = normalizeIdList(body.sourceCaseItemIds);
  const sourceReferenceIds = normalizeIdList(body.sourceReferenceIds);
  let sourceInlineImages: InlineSourceImage[] = [];
  try {
    sourceInlineImages = inlineSourceImagesFromPayload(body.sourceInlineImages);
  } catch (error) {
    return c.json({ error: errorMessage(error, "粘贴图片处理失败") }, 400);
  }
  const requestedReferenceAssetId = String(body.referenceAssetId ?? "").trim();
  const referenceAssetId = sourceAssetIds.includes(requestedReferenceAssetId) ? requestedReferenceAssetId : "";
  const rawMaskDataUrl = String(body.maskDataUrl ?? "").trim();
  let maskDataUrl = rawMaskDataUrl;
  const hideReference = body.hideReference === true;
  const revisionRootId = String(body.revisionRootId ?? "").trim();
  const editedMessageId = String(body.editedMessageId ?? "").trim();
  const revisionMetadata = revisionRootId ? { revisionRootId, ...(editedMessageId ? { editedMessageId } : {}) } : {};
  const branchId = String(body.branchId ?? "").trim();
  const branchForkMessageId = String(body.branchForkMessageId ?? "").trim();
  const branchMetadata = requestBranchMetadata(body);
  if (!prompt) return c.json({ error: "请输入编辑描述" }, 400);
  if (
    sourceImageIds.length === 0
    && sourceAssetIds.length === 0
    && sourceCaseItemIds.length === 0
    && sourceReferenceIds.length === 0
    && sourceInlineImages.length === 0
  ) return c.json({ error: "请选择要编辑的图片或素材" }, 400);
  const safetyReview = await reviewConversationPrompt({
    userId: user.id,
    sessionId: String(body.sessionId ?? "").trim(),
    scene: "image_edit",
    prompt
  });
  if (safetyReview.blocked) {
    return c.json({ error: safetyReview.message || "当前提示词可能存在安全风险，请调整后再试。" }, 400);
  }
  if (rawMaskDataUrl) {
    try {
      maskDataUrl = await normalizeImageEditMaskDataUrl(rawMaskDataUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "遮罩图片处理失败";
      return c.json({ error: message }, 400);
    }
  }

  const selectedProviderId = providerSelectionId(body.providerId);
  let providers: ReturnType<typeof providerChainById>;
  try {
    providers = providerChainById(selectedProviderId);
  } catch (error) {
    return c.json({ error: errorMessage(error, "渠道配置不可用") }, 400);
  }
  const provider = providers[0];
  const size = requestImageSize(body.size);
  const quality = String(body.quality ?? provider.default_quality);
  const imageCount = requestImageCount(body.n ?? body.imageCount);
  const imageOptions = normalizedImageRequestOptions(body, true);
  if (imageOptions.error) return c.json({ error: imageOptions.error }, 400);
  const sourceImages = sourceImageIds.map((id) =>
    getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", id, user.id)
  );
  const sourceAssets = sourceAssetIds.map((id) =>
    getOne<ImageReferenceSourceAsset>(
      appDb,
      `select id, name, path, mime_type, size, image_width, image_height from assets where id = ? and ${visibleAssetSql("assets")}`,
      id,
      user.id
    )
  );
  const sourceCases = caseMaterialSourcesByIds(sourceCaseItemIds, user.id);
  const sourceReferences = messageSourceReferencesByIds(sourceReferenceIds, user.id);
  if (sourceImages.some((item) => !item)) return c.json({ error: "源图片不存在" }, 404);
  if (sourceAssets.some((item) => !item)) return c.json({ error: "素材不存在" }, 404);
  if (sourceCases.some((item) => !item)) return c.json({ error: "灵感不存在或来源不可用" }, 404);
  if (sourceReferences.some((item) => !item)) return c.json({ error: "引用素材不存在或来源不可用" }, 404);
  const validSourceImages = sourceImages.filter(Boolean) as ImageRow[];
  const validSourceAssets = sourceAssets.filter(Boolean) as ImageReferenceSourceAsset[];
  const validSourceCases = sourceCases.filter(Boolean) as NonNullable<(typeof sourceCases)[number]>[];
  const validSourceReferences = sourceReferences.filter(Boolean) as NonNullable<(typeof sourceReferences)[number]>[];
  const sourceCaseReferences = validSourceCases.map(caseMaterialReferenceFromSource);
  const existingSourceReferences = validSourceReferences.map(publicMessageSourceReference);
  const imageReferenceSources = [
    ...imageReferenceInputsFromImages(validSourceImages),
    ...imageReferenceInputsFromAssets(validSourceAssets),
    ...imageReferenceInputsFromCases(validSourceCases),
    ...imageReferenceInputsFromMessageSources(validSourceReferences),
    ...imageReferenceInputsFromInlineImages(sourceInlineImages)
  ];
  const imageUrls = [
    ...(await Promise.all(validSourceImages.map((item) => fileToDataUrl(item.path, item.mime_type)))),
    ...(await Promise.all(validSourceAssets.map((item) => fileToDataUrl(item.path, item.mime_type)))),
    ...(await Promise.all(validSourceCases.map((item) => fileToDataUrl(item.path, item.mimeType)))),
    ...(await Promise.all(validSourceReferences.map((item) => fileToDataUrl(item.path, item.mime_type)))),
    ...sourceInlineImages.map((item) => item.dataUrl)
  ];
  const primarySourceImage = validSourceImages[0] ?? null;
  const sessionId = await ensureChatSession(user.id, String(body.sessionId ?? primarySourceImage?.session_id ?? "") || null, prompt);
  if (!maskDataUrl && editedMessageId) {
    maskDataUrl = await messageMaskSnapshotDataUrl(user.id, sessionId, editedMessageId);
  }
  const hasChatGptWebProvider = providers.some(
    (item) => normalizeProviderChannel(item.channel || inferChannelFromType(item.type)) === "chatgpt_web"
  );
  const sourceReference = maskDataUrl || hasChatGptWebProvider ? providerSourceReference(provider, primarySourceImage) : null;
  const sourceReferenceAccountId =
    sourceReference && typeof sourceReference.source_account_id === "string" ? sourceReference.source_account_id : "";
  const sourceImageConversationContext = providerConversationContextFromImage(primarySourceImage, "source");
  const latestSessionConversationContext =
    latestProviderConversationContextForBranch(user.id, sessionId, branchId, sourceReferenceAccountId) ??
    latestProviderConversationContextForSession(user.id, sessionId, branchId || "main", sourceReferenceAccountId);
  const fallbackConversationContext = branchForkMessageId
    ? providerConversationContextFromMessage(user.id, sessionId, branchForkMessageId, "branch") ?? { placement: "branch" }
    : latestSessionConversationContext ?? sourceImageConversationContext;
  const webConversationContext = fallbackConversationContext;
  const jobId = makeId("job");
  const maskSnapshot = maskDataUrl
    ? await saveImageEditMaskSnapshot(jobId, maskDataUrl).catch((error) => {
        console.warn("图片编辑遮罩快照保存失败", error);
        return null;
      })
    : null;
  const timestamp = now();
  const requestPrompt = providerEditPrompt(prompt, imageCount, provider, Boolean(maskDataUrl));
  const requestPayload = {
    prompt: requestPrompt,
    size,
    quality,
    n: imageCount,
    images: imageUrls.map((image_url) => ({ image_url })),
    ...imageOptions.payload,
    ...(maskDataUrl ? { mask: maskDataUrl } : {}),
    ...(sourceReference ? { sourceReference } : {}),
    ...(webConversationContext ? { webConversationContext } : {})
  };
  const maxAutoRetries = resolveImageResultRetryCount(imageGenerationSettings().resultRetryCount);
  const debugArtifacts = maskDataUrl
    ? await saveImageEditMaskDebugArtifacts({
        jobId,
        userId: user.id,
        sessionId,
        prompt,
        requestPrompt,
        size,
        quality,
        imageCount,
        maskDataUrl,
        sourceImages: validSourceImages,
        sourceAssets: validSourceAssets,
        provider,
        sourceReference
      }).catch((error) => {
        console.warn("图片编辑遮罩调试保存失败", error);
        return null;
      })
    : null;

  const userMessageId = insertMessage(
    user.id,
    sessionId,
    "user",
    prompt,
    hideReference || (!primarySourceImage && (sourceCaseReferences.length > 0 || existingSourceReferences.length > 0)) ? null : primarySourceImage?.id ?? null,
    {
      mode: "edit",
      jobId,
      sourceImageIds,
      sourceAssetIds,
      sourceCaseItemIds,
      sourceReferenceIds,
      ...(sourceCaseReferences.length > 0 ? { sourceCaseReferences } : {}),
      ...(existingSourceReferences.length > 0 ? { sourceReferenceImages: existingSourceReferences } : {}),
      ...(referenceAssetId ? { referenceAssetId } : {}),
      hasMask: Boolean(maskDataUrl),
      ...(maskSnapshot ? { maskPath: maskSnapshot.path, maskMimeType: maskSnapshot.mimeType } : {}),
      hideReference,
      size,
      quality,
      n: imageCount,
      providerId: selectedProviderId,
      ...(caseItemId ? { caseItemId } : {}),
      ...revisionMetadata,
      ...branchMetadata
    }
  );
  const snapshotReferences = await snapshotMessageSourceReferences({
    userId: user.id,
    sessionId,
    messageId: userMessageId,
    jobId,
    sources: [
      ...messageSourceInputsFromAssets(validSourceAssets),
      ...messageSourceInputsFromCases(validSourceCases),
      ...messageSourceInputsFromInlineImages(sourceInlineImages)
    ]
  });
  const messageSourceReferences = [...existingSourceReferences, ...snapshotReferences];
  if (messageSourceReferences.length > 0) {
    const metadata = {
      mode: "edit",
      jobId,
      sourceImageIds,
      sourceAssetIds,
      sourceCaseItemIds,
      sourceReferenceIds: messageSourceReferences.map((item) => item.sourceReferenceId).filter(Boolean),
      sourceReferenceImages: messageSourceReferences,
      ...(sourceCaseReferences.length > 0 ? { sourceCaseReferences } : {}),
      ...(referenceAssetId ? { referenceAssetId } : {}),
      hasMask: Boolean(maskDataUrl),
      ...(maskSnapshot ? { maskPath: maskSnapshot.path, maskMimeType: maskSnapshot.mimeType } : {}),
      hideReference,
      size,
      quality,
      n: imageCount,
      providerId: selectedProviderId,
      ...(caseItemId ? { caseItemId } : {}),
      ...revisionMetadata,
      ...branchMetadata
    };
    run(appDb, "update messages set metadata = ? where id = ? and user_id = ?", JSON.stringify(metadata), userMessageId, user.id);
  }
  run(
    appDb,
    `insert into image_jobs (
      id, user_id, session_id, type, status, prompt, source_image_ids,
      provider_id, request_json, max_auto_retries, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    jobId,
    user.id,
    sessionId,
    "edit",
    "running",
    prompt,
    JSON.stringify({
      imageIds: sourceImageIds,
      assetIds: messageSourceReferences.length > 0 ? [] : sourceAssetIds,
      caseItemIds: messageSourceReferences.length > 0 ? [] : sourceCaseItemIds,
      referenceIds: messageSourceReferences.map((item) => item.sourceReferenceId).filter(Boolean)
    }),
    selectedProviderId,
    JSON.stringify({
      ...requestPayload,
      images: requestPayload.images.map(() => ({ image_url: "[data-url]" })),
      ...(maskDataUrl ? { mask: "[data-url]" } : {}),
      ...(maskSnapshot ? { maskPath: maskSnapshot.path } : {}),
      ...(debugArtifacts ? { debug: { maskPath: debugArtifacts.maskPath, metadataPath: debugArtifacts.metadataPath } } : {})
    }),
    maxAutoRetries,
    timestamp,
    timestamp
  );
  emitJobStatus(user.id, sessionId, jobId, "running", "edit");
  recordCasePromptUsage({
    caseItemId,
    submittedPrompt: prompt,
    usedByUserId: user.id,
    jobId,
    requestType: "edit"
  });

  const runningJob = getOne<{
    id: string;
    type: string;
    status: string;
    prompt: string;
    provider_id: string;
    error: string | null;
    result_image_id: string | null;
    created_at: string;
    updated_at: string;
  }>(appDb, "select * from image_jobs where id = ?", jobId);

  const runEditJob = async () => {
  let responseJson: unknown = null;
  try {
    const preparedEditSuggestions = prepareImageEditSuggestionsForJob({
      userId: user.id,
      prompt,
      kind: "edit",
      promptHistory: editPromptHistoryForSourceImage(primarySourceImage, prompt)
    });
    const result = await saveProviderImagesWithRetry({
      providers,
      mode: "edit",
      requestPayload,
      userId: user.id,
      sessionId,
      jobId,
      retryCount: maxAutoRetries,
      onResponseJson: (value) => {
        responseJson = value;
      }
    });
    responseJson = result.responseJson;
    const actualProvider = result.provider;
    const savedImages = result.savedImages;
    const autoRetryCount = Math.max(0, result.attemptNo - 1);
    const generatedByRetry = autoRetryCount > 0 ? 1 : 0;
    for (const [index, saved] of savedImages.entries()) {
      const createdAt = now();
      run(
        appDb,
        `insert into images (
          id, user_id, session_id, job_id, path, prompt, kind, size, quality,
          provider_id, mime_type, parent_image_id,
          provider_file_id, provider_gen_id, provider_conversation_id, provider_parent_message_id, provider_source_account_id,
          image_width, image_height, image_file_size, generated_attempt_no, generated_by_retry, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        saved.id,
        user.id,
        sessionId,
        jobId,
        saved.file.path,
        prompt,
        "edit",
        size,
        quality,
        actualProvider.id,
        saved.file.mimeType,
        primarySourceImage?.id ?? null,
        ...providerImageContextValues(saved.providerContext),
        saved.file.width,
        saved.file.height,
        saved.file.fileSize,
        result.attemptNo,
        generatedByRetry,
        createdAt
      );
      try {
        await snapshotImageReferences(user.id, sessionId, saved.id, imageReferenceSources);
      } catch (error) {
        console.warn("图片素材引用快照保存失败", error);
      }
      insertMessage(user.id, sessionId, "assistant", "已完成图片编辑", saved.id, {
        mode: "edit",
        jobId,
        parentImageId: primarySourceImage?.id ?? null,
        sourceAssetIds,
        hasMask: Boolean(maskDataUrl),
        n: imageCount,
        imageIndex: index + 1,
        imageTotal: savedImages.length,
        ...revisionMetadata,
        ...branchMetadata
      });
    }
    const savedImageIds = savedImages.map((image) => image.id);
    await applyImageFieldSuggestions(savedImageIds);
    await ensureImageEditSuggestionsForImages(user.id, savedImageIds, preparedEditSuggestions);
    const resultImageId = savedImageIds[0] ?? null;
    run(
      appDb,
      "update image_jobs set status = ?, result_image_id = ?, response_json = ?, auto_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = ?, updated_at = ? where id = ?",
      "succeeded",
      resultImageId,
      providerResponseSnapshot(responseJson),
      autoRetryCount,
      result.retryCount,
      generatedByRetry,
      now(),
      jobId
    );
    emitJobStatus(user.id, sessionId, jobId, "succeeded", "edit", { resultImageId });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : "编辑失败";
    const responseJsonText = responseJson === null ? null : providerResponseSnapshot(responseJson);
    const failedAutoRetryCount = autoRetryCountFromError(error, maxAutoRetries);
    run(
      appDb,
      "update image_jobs set status = ?, error = ?, response_json = coalesce(?, response_json), auto_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = 0, updated_at = ? where id = ?",
      "failed",
      message,
      responseJsonText,
      failedAutoRetryCount,
      maxAutoRetries,
      now(),
      jobId
    );
    emitJobStatus(user.id, sessionId, jobId, "failed", "edit", { error: message });
    return;
  }
  };

  void runEditJob().catch((error) => {
    console.warn("图片编辑后台任务失败", error);
  });
  return c.json({ sessionId, job: runningJob ? serializeJob(runningJob) : null, image: null, images: [] }, 202);
});

api.post("/image-jobs/:id/retry", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const jobId = c.req.param("id");
  const job = getOne<{
    id: string;
    user_id: string;
    session_id: string | null;
    type: "generation" | "edit";
    status: string;
    prompt: string;
    source_image_ids: string | null;
    provider_id: string;
    error: string | null;
    result_image_id: string | null;
    request_json: string | null;
    response_json: string | null;
    auto_retry_count: number | null;
    manual_retry_count: number | null;
    max_auto_retries: number | null;
    succeeded_on_retry: number | null;
    created_at: string;
    updated_at: string;
  }>(appDb, "select * from image_jobs where id = ? and user_id = ?", jobId, user.id);
  if (!job) return c.json({ error: "任务不存在" }, 404);
  if (!job.session_id) return c.json({ error: "任务缺少对话信息，无法重试" }, 400);
  const retrySessionId = job.session_id;
  if (job.status === "running") return c.json({ error: "任务正在处理中" }, 409);
  if (job.status !== "failed") return c.json({ error: "只有失败的任务可以重试" }, 400);

  const requestPayload = safeJson<Record<string, unknown>>(job.request_json, {});
  if (Object.keys(requestPayload).length === 0) return c.json({ error: "任务请求信息不完整，无法重试" }, 400);
  if (job.type === "edit" && requestPayload.mask) {
    return c.json({ error: "带遮罩的编辑无法自动重试，请重新涂抹后发送" }, 400);
  }

  let providers: RuntimeProviderRow[];
  try {
    providers = providerChainById(job.provider_id);
  } catch (error) {
    return c.json({ error: errorMessage(error, "渠道配置不可用") }, 400);
  }
  const provider = providers[0];

  const messageMetadata = jobUserMessageMetadata(user.id, retrySessionId, job.id);
  const revisionMetadata = requestRevisionMetadata(messageMetadata);
  const branchMetadata = requestBranchMetadata(messageMetadata);
  const size = String(requestPayload.size ?? "");
  const quality = String(requestPayload.quality ?? provider.default_quality ?? "");
  const imageCount = numberFromPayload(requestPayload.n, 1);
  const maxAutoRetries = resolveImageResultRetryCount(imageGenerationSettings().resultRetryCount);
  const previousAutoRetryCount = Math.max(0, Math.trunc(Number(job.auto_retry_count ?? 0)) || 0);
  const nextManualRetryCount = Math.max(0, Math.trunc(Number(job.manual_retry_count ?? 0)) || 0) + 1;

  run(
    appDb,
    "update image_jobs set status = ?, error = null, result_image_id = null, response_json = null, manual_retry_count = ?, max_auto_retries = ?, updated_at = ? where id = ?",
    "running",
    nextManualRetryCount,
    maxAutoRetries,
    now(),
    job.id
  );
  emitJobStatus(user.id, retrySessionId, job.id, "running", job.type);

  const runningJob = getOne<typeof job>(appDb, "select * from image_jobs where id = ?", job.id);
  const runRetryJob = async () => {
  try {
    if (job.type === "generation") {
      const savedImageIds: string[] = [];
      const preparedEditSuggestions = prepareImageEditSuggestionsForJob({
        userId: user.id,
        prompt: job.prompt,
        kind: "generation",
        promptHistory: [job.prompt]
      });
      const { provider: actualProvider, responseJson, savedImages, attemptNo, retryCount } = await saveProviderImagesWithRetry({
        providers,
        mode: "generation",
        requestPayload,
        userId: user.id,
        sessionId: retrySessionId,
        jobId: job.id,
        retryCount: maxAutoRetries
      });
      const autoRetryCount = previousAutoRetryCount + Math.max(0, attemptNo - 1);
      for (const saved of savedImages) {
        const imageIndex = savedImageIds.length + 1;
        const createdAt = now();
        run(
          appDb,
          `insert into images (
            id, user_id, session_id, job_id, path, prompt, kind, size, quality,
            provider_id, mime_type, parent_image_id,
            provider_file_id, provider_gen_id, provider_conversation_id, provider_parent_message_id, provider_source_account_id,
            image_width, image_height, image_file_size, generated_attempt_no, generated_by_retry, created_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          saved.id,
          user.id,
          retrySessionId,
          job.id,
          saved.file.path,
          job.prompt,
          "generation",
          size,
          quality,
          actualProvider.id,
          saved.file.mimeType,
          null,
          ...providerImageContextValues(saved.providerContext),
          saved.file.width,
          saved.file.height,
          saved.file.fileSize,
          attemptNo,
          1,
          createdAt
        );
        savedImageIds.push(saved.id);
        insertMessage(user.id, retrySessionId, "assistant", "已生成图片", saved.id, {
          mode: "generation",
          jobId: job.id,
          n: imageCount,
          imageIndex,
          imageTotal: imageCount,
          ...revisionMetadata,
          ...branchMetadata
        });
        run(
          appDb,
          "update image_jobs set result_image_id = coalesce(result_image_id, ?), updated_at = ? where id = ?",
          saved.id,
          now(),
          job.id
        );
      }
      await applyImageFieldSuggestions(savedImageIds, job.prompt);
      await ensureImageEditSuggestionsForImages(user.id, savedImageIds, preparedEditSuggestions);
      run(
        appDb,
        "update image_jobs set status = ?, result_image_id = ?, response_json = ?, auto_retry_count = ?, manual_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = 1, updated_at = ? where id = ?",
        "succeeded",
        savedImageIds[0] ?? null,
        providerResponseSnapshot(responseJson),
        autoRetryCount,
        nextManualRetryCount,
        retryCount,
        now(),
        job.id
      );
      emitJobStatus(user.id, retrySessionId, job.id, "succeeded", "generation", { resultImageId: savedImageIds[0] ?? null });
      return;
    }

    const sourceIds = retrySourceIds(job.source_image_ids);
    const sourceImages = sourceIds.imageIds.map((id) =>
      getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", id, user.id)
    );
    const sourceAssets = sourceIds.assetIds.map((id) =>
      getOne<ImageReferenceSourceAsset>(
        appDb,
        `select id, name, path, mime_type, size, image_width, image_height from assets where id = ? and ${visibleAssetSql("assets")}`,
        id,
        user.id
      )
    );
    const sourceCases = caseMaterialSourcesByIds(sourceIds.caseItemIds, user.id);
    const sourceReferences = messageSourceReferencesByIds(sourceIds.referenceIds, user.id);
    if (sourceImages.some((item) => !item)) throw new Error("源图片不存在");
    if (sourceAssets.some((item) => !item)) throw new Error("素材不存在");
    if (sourceCases.some((item) => !item)) throw new Error("灵感不存在或来源不可用");
    if (sourceReferences.some((item) => !item)) throw new Error("引用素材不存在或来源不可用");
    const validSourceImages = sourceImages.filter(Boolean) as ImageRow[];
    const validSourceAssets = sourceAssets.filter(Boolean) as ImageReferenceSourceAsset[];
    const validSourceCases = sourceCases.filter(Boolean) as NonNullable<(typeof sourceCases)[number]>[];
    const validSourceReferences = sourceReferences.filter(Boolean) as NonNullable<(typeof sourceReferences)[number]>[];
    const imageReferenceSources = [
      ...imageReferenceInputsFromImages(validSourceImages),
      ...imageReferenceInputsFromAssets(validSourceAssets),
      ...imageReferenceInputsFromCases(validSourceCases),
      ...imageReferenceInputsFromMessageSources(validSourceReferences)
    ];
    const imageUrls = [
      ...(await Promise.all(validSourceImages.map((item) => fileToDataUrl(item.path, item.mime_type)))),
      ...(await Promise.all(validSourceAssets.map((item) => fileToDataUrl(item.path, item.mime_type)))),
      ...(await Promise.all(validSourceCases.map((item) => fileToDataUrl(item.path, item.mimeType)))),
      ...(await Promise.all(validSourceReferences.map((item) => fileToDataUrl(item.path, item.mime_type))))
    ];
    if (imageUrls.length === 0) throw new Error("请选择要编辑的图片或素材");
    const retryPayload = {
      ...requestPayload,
      images: imageUrls.map((image_url) => ({ image_url }))
    };
    const primarySourceImage = validSourceImages[0] ?? null;
    const preparedEditSuggestions = prepareImageEditSuggestionsForJob({
      userId: user.id,
      prompt: job.prompt,
      kind: "edit",
      promptHistory: editPromptHistoryForSourceImage(primarySourceImage, job.prompt)
    });
    const { provider: actualProvider, responseJson, savedImages, attemptNo, retryCount } = await saveProviderImagesWithRetry({
      providers,
      mode: "edit",
      requestPayload: retryPayload,
      userId: user.id,
      sessionId: retrySessionId,
      jobId: job.id,
      retryCount: maxAutoRetries
    });
    const autoRetryCount = previousAutoRetryCount + Math.max(0, attemptNo - 1);
    for (const [index, saved] of savedImages.entries()) {
      const createdAt = now();
      run(
        appDb,
        `insert into images (
          id, user_id, session_id, job_id, path, prompt, kind, size, quality,
          provider_id, mime_type, parent_image_id,
          provider_file_id, provider_gen_id, provider_conversation_id, provider_parent_message_id, provider_source_account_id,
          image_width, image_height, image_file_size, generated_attempt_no, generated_by_retry, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        saved.id,
        user.id,
        retrySessionId,
        job.id,
        saved.file.path,
        job.prompt,
        "edit",
        size,
        quality,
        actualProvider.id,
        saved.file.mimeType,
        primarySourceImage?.id ?? null,
        ...providerImageContextValues(saved.providerContext),
        saved.file.width,
        saved.file.height,
        saved.file.fileSize,
        attemptNo,
        1,
        createdAt
      );
      try {
        await snapshotImageReferences(user.id, retrySessionId, saved.id, imageReferenceSources);
      } catch (error) {
        console.warn("图片素材引用快照保存失败", error);
      }
      insertMessage(user.id, retrySessionId, "assistant", "已完成图片编辑", saved.id, {
        mode: "edit",
        jobId: job.id,
        parentImageId: primarySourceImage?.id ?? null,
        sourceAssetIds: sourceIds.assetIds,
        sourceReferenceIds: sourceIds.referenceIds,
        hasMask: false,
        n: imageCount,
        imageIndex: index + 1,
        imageTotal: savedImages.length,
        ...revisionMetadata,
        ...branchMetadata
      });
    }
    const savedImageIds = savedImages.map((image) => image.id);
    await applyImageFieldSuggestions(savedImageIds);
    await ensureImageEditSuggestionsForImages(user.id, savedImageIds, preparedEditSuggestions);
    const resultImageId = savedImageIds[0] ?? null;
    run(
      appDb,
      "update image_jobs set status = ?, result_image_id = ?, response_json = ?, auto_retry_count = ?, manual_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = 1, updated_at = ? where id = ?",
      "succeeded",
      resultImageId,
      providerResponseSnapshot(responseJson),
      autoRetryCount,
      nextManualRetryCount,
      retryCount,
      now(),
      job.id
    );
    emitJobStatus(user.id, retrySessionId, job.id, "succeeded", "edit", { resultImageId });
    return;
  } catch (error) {
    const message = errorMessage(error, job.type === "edit" ? "编辑失败" : "生成失败");
    const failedAutoRetryCount = previousAutoRetryCount + autoRetryCountFromError(error, 0);
    run(
      appDb,
      "update image_jobs set status = ?, error = ?, auto_retry_count = ?, manual_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = 0, updated_at = ? where id = ?",
      "failed",
      message,
      failedAutoRetryCount,
      nextManualRetryCount,
      maxAutoRetries,
      now(),
      job.id
    );
    emitJobStatus(user.id, retrySessionId, job.id, "failed", job.type, { error: message });
    return;
  }
  };

  void runRetryJob().catch((error) => {
    console.warn("图片任务后台重试失败", error);
  });
  return c.json({
    sessionId: retrySessionId,
    job: runningJob ? serializeJob({ ...runningJob, ...branchMetadata }) : null,
    image: null,
    images: []
  }, 202);
});

api.get("/image-jobs/:id", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  expireStaleImageJobs(user.id);
  const row = getOne<{
    id: string;
    type: string;
    status: string;
    prompt: string;
    provider_id: string;
    error: string | null;
    result_image_id: string | null;
    created_at: string;
    updated_at: string;
  }>(appDb, "select * from image_jobs where id = ? and user_id = ?", c.req.param("id"), user.id);
  if (!row) return c.json({ error: "任务不存在" }, 404);
  const image = row.result_image_id
    ? getOne<ImageRow>(appDb, "select * from images where id = ?", row.result_image_id)
    : null;
  const referenceMap = image ? imageReferencesByImageIds([image.id]) : new Map<string, ReturnType<typeof publicImageReference>[]>();
  const publicImages = image ? publicImagesWithReferences([image], referenceMap) : [];
  return c.json({ job: serializeJob(row), image: publicImages[0] ?? null });
});
}
