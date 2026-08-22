import type { Hono } from "hono";
import { applyAssetFieldSuggestionsToImages, ensureAssetFieldSuggestionsForImage } from "./assetSuggestions";
import { caseMaterialReferenceFromSource, caseMaterialSourcesByIds } from "./caseMaterialSources";
import { applyCaseFieldSuggestionsToImages, ensureCaseFieldSuggestionsForImage } from "./caseSuggestions";
import {
  AUTO_PROVIDER_ID,
  IMAGE_JOB_RUNNING_TIMEOUT_MS,
  IMAGE_JOB_TIMEOUT_ERROR,
  requestImageQuality,
  requestMultiImageConcurrency,
  requestImageSize,
  resolveImageResultRetryCount
} from "./constants";
import { recordCasePromptUsage } from "./caseUsage";
import { appDb, getAll, getOne, run } from "./db";
import { fileToDataUrl, saveProviderImageResults, snapshotImageReferences, type ImageReferenceSnapshotInput } from "./imageFiles";
import { runImageCompletion, type ImageCompletionBatchCommit } from "./imageCompletion";
import { emitImageJobEvent, type ImageJobEventStatus } from "./imageJobEvents";
import { storedImageCompletionState, storedImageSlotIndexes } from "./imageSlots";
import {
  abortImageJobExecution,
  beginImageJobExecution,
  cleanupExpiredImageJobCancelIntents,
  clearImageJobCancelIntent,
  finishImageJobExecution,
  imageJobCancelRequested,
  rememberImageJobCancelIntent
} from "./imageJobCancellation";
import {
  ensureImageEditSuggestionsForImageWithTone,
  prepareImageEditSuggestionsForPrompt,
  savePreparedImageEditSuggestionsForImages,
  type PreparedImageEditSuggestions
} from "./imageEditSuggestions";
import { saveImageEditMaskDebugArtifacts } from "./imageEditDebug";
import { imageEditMaskSnapshotDataUrl, normalizeImageEditMaskDataUrl, requireImageEditMaskSnapshot } from "./imageMasks";
import { readImageDimensions } from "./imageDimensions";
import {
  messageSourceReferencesByIds,
  publicMessageSourceReference,
  snapshotMessageSourceReferences,
  type MessageSourceReferenceInput
} from "./messageSourceReferences";
import { boundedPaginationFromQuery, pageInfo } from "./pagination";
import { invalidateLibraryFacetCache } from "./libraryRoutes";
import { imageDateSearchConditions } from "./imageSearch";
import { callProviderChain, providerChainById, providerRequestWasCancelled } from "./providerRuntime";
import { providerResponseSnapshot } from "./responseSnapshots";
import { reviewConversationPrompt } from "./safetyReview";
import {
  fallbackImagePromptPlan,
  resolveImagePromptPlan,
  storedImagePromptPlan,
  type ImagePromptPlan
} from "./imagePromptPlan";
import { deleteStoredFilesIfUnreferenced } from "./secureFiles";
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
import {
  inferChannelFromType,
  localTimestamp,
  makeId,
  normalizeIdList,
  normalizeProviderChannel,
  now,
  safeJson,
  visibleAssetSql
} from "./utils";
import { requireUser } from "./auth";
import { requireImageRouteUser } from "./externalMcpAuth";
import { markProviderRequestPostProcessFailure } from "./auditLog";
import {
  deleteImageRecords,
  deleteImageRecordsBatch,
  deleteImageJobArtifacts,
  deleteCancelledEmptySessionRecord,
  deleteRequestEmptySessionRecord,
  ensureChatSession,
  expireStaleImageJobs,
  imageDeleteImpact,
  insertMessage,
  serializeJob
} from "./chatStore";
import { imageBatchResult, parseImageBatchIds } from "./imageBatch";
import { finalizeProviderEditPrompt, normalizeImageEditRequest } from "./imageEditRequest";
import { resolvePromptImageCount, resolveSelectedImageCount } from "../src/lib/imagePromptCount";
import type { ImageEditIntent } from "../src/lib/imageAnnotations";
import {
  isImageBackgroundOption,
  type ImageBackgroundOption,
  type TransparentImageOutputFormat
} from "../src/lib/imageBackground";

function providerPrompt(prompt: string, imageCount: number) {
  if (imageCount <= 1) return prompt;
  return [
    prompt,
    "",
    `数量由接口参数 n=${imageCount} 控制。请把每个结果都生成成一张独立完整的单图，不要在单张图片中做四宫格、拼贴、分屏或多张图片排版。`
  ].join("\n");
}

const IMAGE_PROMPT_PLAN_REQUEST_KEY = "_imagePromptPlan";
const IMAGE_COMPLETION_CONCURRENCY_REQUEST_KEY = "_multiImageConcurrency";

function requestImagePromptPlan(requestPayload: Record<string, unknown>) {
  const imageCount = numberFromPayload(requestPayload.n, 1);
  return storedImagePromptPlan(requestPayload[IMAGE_PROMPT_PLAN_REQUEST_KEY], imageCount);
}

function providerRequestPayload(requestPayload: Record<string, unknown>) {
  const payload = { ...requestPayload };
  delete payload[IMAGE_PROMPT_PLAN_REQUEST_KEY];
  delete payload[IMAGE_COMPLETION_CONCURRENCY_REQUEST_KEY];
  return payload;
}

function requestImageCompletionConcurrency(requestPayload: Record<string, unknown>) {
  return requestMultiImageConcurrency(
    requestPayload[IMAGE_COMPLETION_CONCURRENCY_REQUEST_KEY] ?? imageGenerationSettings().multiImageConcurrency
  );
}

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
    output_format?: TransparentImageOutputFormat;
    input_fidelity?: ImageInputFidelityOption;
  } = {};

  if (background) {
    if (!isImageBackgroundOption(background)) {
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

function imageRequestMessageMetadata(options: ReturnType<typeof normalizedImageRequestOptions>["payload"]) {
  return {
    ...(options.background ? { background: options.background } : {}),
    ...(options.output_format ? { outputFormat: options.output_format } : {})
  };
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
  details: {
    resultImageId?: string | null;
    error?: string | null;
    requestedImageCount?: number;
    completedImageCount?: number;
    completedImageIndices?: number[];
  } = {}
) {
  const normalizedSessionId = String(sessionId ?? "").trim();
  if (!normalizedSessionId) return;
  const storedTimestamp = getOne<{ updated_at: string }>(
    appDb,
    "select updated_at from image_jobs where id = ? and status = ?",
    jobId,
    status
  )?.updated_at?.trim();
  emitImageJobEvent(userId, {
    jobId,
    sessionId: normalizedSessionId,
    status,
    type,
    ...(details.resultImageId !== undefined ? { resultImageId: details.resultImageId } : {}),
    ...(details.error !== undefined ? { error: details.error } : {}),
    ...(details.requestedImageCount !== undefined ? { requestedImageCount: details.requestedImageCount } : {}),
    ...(details.completedImageCount !== undefined ? { completedImageCount: details.completedImageCount } : {}),
    ...(details.completedImageIndices !== undefined ? { completedImageIndices: details.completedImageIndices } : {}),
    updatedAt: storedTimestamp || now()
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
          promptHistory,
          preferences.language
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
  promptHistory,
  language
}: {
  userId: string;
  prompt: string;
  kind: "generation" | "edit";
  promptHistory: string[];
  language?: unknown;
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
    tone: preferences.editSuggestionTone,
    language: language ?? preferences.language
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

function providerEditPrompt(
  prompt: string,
  imageCount: number,
  hasMask: boolean,
  editIntent: ImageEditIntent = "standard"
) {
  return finalizeProviderEditPrompt({
    basePrompt: providerPrompt(prompt, imageCount),
    editIntent,
    hasMask
  });
}

function storedImageEditIntent(value: unknown): ImageEditIntent {
  return value === "annotation" || value === "remove" ? value : "standard";
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

function requestClientRequestId(body: Record<string, unknown>) {
  return String(body.clientRequestId ?? "").trim().slice(0, 160);
}

async function saveProviderImagesWithRetry({
  providers,
  mode,
  requestPayload,
  userId,
  sessionId,
  jobId,
  retryCount: retryCountInput,
  onResponseJson,
  signal
}: {
  providers: RuntimeProviderRow[];
  mode: "generation" | "edit";
  requestPayload: Record<string, unknown>;
  userId: string;
  sessionId: string | null;
  jobId?: string;
  retryCount?: number;
  onResponseJson?: (responseJson: unknown) => void;
  signal?: AbortSignal;
}) {
  let firstError: unknown = null;
  const retryCount = retryCountInput ?? resolveImageResultRetryCount(imageGenerationSettings().resultRetryCount);
  const maxAttempts = retryCount + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) throw new Error("图片任务已取消");
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
          isRetry: attempt > 1,
          signal
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
      if (signal?.aborted) {
        await deleteStoredFilesIfUnreferenced(savedImages.map((image) => image.file.path));
        throw new Error("图片任务已取消");
      }
      return { provider, responseJson, savedImages, attemptNo: attempt, retryCount, maxAttempts };
    } catch (error) {
      if (providerRequestWasCancelled(error, signal)) throw error;
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

type SavedProviderImages = Awaited<ReturnType<typeof saveProviderImageResults>>;

type ProviderImageCompletionBatch = {
  provider: RuntimeProviderRow;
  responseJson: unknown;
  attemptNo: number;
  retryCount: number;
  maxAttempts: number;
};

async function runProviderImageCompletion({
  providers,
  mode,
  requestPayload,
  promptPlan,
  originalPrompt,
  existingImageCount,
  existingImageIndexes,
  concurrency,
  userId,
  sessionId,
  jobId,
  retryCount,
  buildPrompt,
  onBatch,
  onResponseJson,
  signal
}: {
  providers: RuntimeProviderRow[];
  mode: "generation" | "edit";
  requestPayload: Record<string, unknown>;
  promptPlan: ImagePromptPlan;
  originalPrompt: string;
  existingImageCount: number;
  existingImageIndexes?: number[];
  concurrency: number;
  userId: string;
  sessionId: string | null;
  jobId: string;
  retryCount: number;
  buildPrompt: (prompt: string, imageCount: number) => string;
  onBatch: (batch: ImageCompletionBatchCommit<SavedProviderImages[number], ProviderImageCompletionBatch>) => Promise<void>;
  onResponseJson?: (responseJson: unknown) => void;
  signal?: AbortSignal;
}) {
  let accumulatedAutoRetryCount = 0;
  let lastResponseJson: unknown = null;
  let resolvedRetryCount = retryCount;
  const basePayload = providerRequestPayload(requestPayload);
  let completion: Awaited<ReturnType<typeof runImageCompletion<SavedProviderImages[number], ProviderImageCompletionBatch>>>;
  try {
    completion = await runImageCompletion<SavedProviderImages[number], ProviderImageCompletionBatch>({
      plan: promptPlan,
      originalPrompt,
      existingImageCount,
      existingImageIndexes,
      concurrency,
      requestBatch: async ({ prompt, imageCount, roundIndex }) => {
        if (signal?.aborted) throw new Error("图片任务已取消");
        const payload = {
          ...basePayload,
          prompt: buildPrompt(prompt, imageCount),
          n: imageCount
        };
        try {
          const result = await saveProviderImagesWithRetry({
            providers,
            mode,
            requestPayload: payload,
            userId,
            sessionId,
            jobId,
            retryCount,
            onResponseJson,
            signal
          });
          accumulatedAutoRetryCount += Math.max(0, result.attemptNo - 1);
          lastResponseJson = result.responseJson;
          resolvedRetryCount = result.retryCount;
          console.info("图片任务完成一轮请求", {
            jobId,
            mode,
            promptPlanMode: promptPlan.mode,
            roundIndex,
            requested: imageCount,
            received: result.savedImages.length
          });
          return {
            items: result.savedImages,
            result: {
              provider: result.provider,
              responseJson: result.responseJson,
              attemptNo: result.attemptNo,
              retryCount: result.retryCount,
              maxAttempts: result.maxAttempts
            }
          };
        } catch (error) {
          const tagged = (error instanceof Error ? error : new Error(String(error))) as RetryTaggedError;
          accumulatedAutoRetryCount += autoRetryCountFromError(error, 0);
          tagged.autoRetryCount = accumulatedAutoRetryCount;
          throw tagged;
        }
      },
      commitBatch: onBatch,
      discardItems: async (items) => {
        await deleteStoredFilesIfUnreferenced(items.map((item) => item.file.path)).catch((error) => {
          console.warn("清理多图任务未采用的图片文件失败", error);
        });
      }
    });
  } catch (error) {
    const tagged = (error instanceof Error ? error : new Error(String(error))) as RetryTaggedError;
    tagged.autoRetryCount = accumulatedAutoRetryCount;
    throw tagged;
  }
  return {
    ...completion,
    autoRetryCount: accumulatedAutoRetryCount,
    retryCount: resolvedRetryCount,
    responseJson: lastResponseJson
  };
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

function imageReferenceSnapshotKey(source: {
  sourceType?: string | null;
  sourceId?: string | null;
  sourceAssetId?: string | null;
  sourceCaseItemId?: string | null;
}) {
  return JSON.stringify([
    source.sourceType ?? "",
    source.sourceId ?? source.sourceAssetId ?? "",
    source.sourceAssetId ?? "",
    source.sourceCaseItemId ?? ""
  ]);
}

async function ensureImageReferenceSnapshots(
  userId: string,
  sessionId: string,
  imageId: string,
  sources: ImageReferenceSnapshotInput[]
) {
  if (sources.length === 0) return;
  const existing = getAll<{
    source_type: string | null;
    source_id: string | null;
    source_asset_id: string | null;
    source_case_item_id: string | null;
  }>(
    appDb,
    `select source_type, source_id, source_asset_id, source_case_item_id
     from image_asset_references where image_id = ? and user_id = ?`,
    imageId,
    userId
  );
  const existingKeys = new Set(
    existing.map((item) => imageReferenceSnapshotKey({
      sourceType: item.source_type,
      sourceId: item.source_id,
      sourceAssetId: item.source_asset_id,
      sourceCaseItemId: item.source_case_item_id
    }))
  );
  const missing = sources.filter((source) => !existingKeys.has(imageReferenceSnapshotKey(source)));
  if (missing.length > 0) await snapshotImageReferences(userId, sessionId, imageId, missing);
}

function storedEditImageReferenceSources(job: StoredImageJobRow) {
  const sourceIds = retrySourceIds(job.source_image_ids);
  const sourceImages = sourceIds.imageIds
    .map((id) => getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", id, job.user_id))
    .filter(Boolean) as ImageRow[];
  const sourceAssets = sourceIds.assetIds
    .map((id) => getOne<ImageReferenceSourceAsset>(
      appDb,
      `select id, name, path, mime_type, size, image_width, image_height from assets where id = ? and ${visibleAssetSql("assets")}`,
      id,
      job.user_id
    ))
    .filter(Boolean) as ImageReferenceSourceAsset[];
  const sourceCases = caseMaterialSourcesByIds(sourceIds.caseItemIds, job.user_id).filter(Boolean) as NonNullable<
    ReturnType<typeof caseMaterialSourcesByIds>[number]
  >[];
  const sourceReferences = messageSourceReferencesByIds(sourceIds.referenceIds, job.user_id).filter(Boolean) as NonNullable<
    ReturnType<typeof messageSourceReferencesByIds>[number]
  >[];
  return [
    ...imageReferenceInputsFromImages(sourceImages),
    ...imageReferenceInputsFromAssets(sourceAssets),
    ...imageReferenceInputsFromCases(sourceCases),
    ...imageReferenceInputsFromMessageSources(sourceReferences)
  ];
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

type StoredImageJobRow = {
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
  recovery_count: number | null;
  max_auto_retries: number | null;
  succeeded_on_retry: number | null;
  created_at: string;
  updated_at: string;
};

type StoredImageJobTrigger = "manual" | "startup";

class ImageJobClaimError extends Error {}
class ImageJobExecutionSupersededError extends Error {}

const MAX_STARTUP_IMAGE_JOB_RECOVERIES = 1;

function imageJobExecutionIsActive(jobId: string, manualRetryCount: number, recoveryCount: number) {
  return Boolean(
    getOne<{ id: string }>(
      appDb,
      `select id from image_jobs
       where id = ? and status = ?
         and coalesce(manual_retry_count, 0) = ?
         and coalesce(recovery_count, 0) = ?`,
      jobId,
      "running",
      manualRetryCount,
      recoveryCount
    )
  );
}

function assertImageJobExecutionIsActive(jobId: string, manualRetryCount: number, recoveryCount: number) {
  if (!imageJobExecutionIsActive(jobId, manualRetryCount, recoveryCount)) {
    throw new ImageJobExecutionSupersededError("任务执行已被新的重试接管");
  }
}

async function ensureStoredImagePromptPlan({
  jobId,
  userId,
  prompt,
  taskType,
  requestPayload,
  existingImageCount,
  manualRetryCount,
  recoveryCount,
  signal
}: {
  jobId: string;
  userId: string;
  prompt: string;
  taskType: "generation" | "edit";
  requestPayload: Record<string, unknown>;
  existingImageCount: number;
  manualRetryCount: number;
  recoveryCount: number;
  signal?: AbortSignal;
}) {
  const imageCount = numberFromPayload(requestPayload.n, 1);
  const existingPlan = requestImagePromptPlan(requestPayload);
  if (existingPlan) return existingPlan;

  const plan = existingImageCount > 0
    ? fallbackImagePromptPlan(imageCount, "兼容未保存提示词计划的历史部分结果")
    : await resolveImagePromptPlan({ prompt, imageCount, taskType, userId, jobId, signal });
  assertImageJobExecutionIsActive(jobId, manualRetryCount, recoveryCount);
  const storedRequest = getOne<{ request_json: string | null }>(
    appDb,
    "select request_json from image_jobs where id = ? and user_id = ?",
    jobId,
    userId
  );
  const storedPayloadValue = safeJson<unknown>(storedRequest?.request_json, null);
  if (!storedPayloadValue || typeof storedPayloadValue !== "object" || Array.isArray(storedPayloadValue)) {
    throw new Error("图片任务请求快照缺失，无法安全保存多图提示词计划");
  }
  const storedPayload = storedPayloadValue as Record<string, unknown>;
  const updated = run(
    appDb,
    `update image_jobs set request_json = ?, updated_at = ?
     where id = ? and user_id = ? and status = ?
       and coalesce(manual_retry_count, 0) = ? and coalesce(recovery_count, 0) = ?`,
    JSON.stringify({ ...storedPayload, [IMAGE_PROMPT_PLAN_REQUEST_KEY]: plan }),
    now(),
    jobId,
    userId,
    "running",
    manualRetryCount,
    recoveryCount
  );
  if (Number(updated.changes ?? 0) === 0) throw new ImageJobExecutionSupersededError("任务执行已被新的重试接管");
  if (plan.mode === "fallback_shared" && plan.fallbackReason) {
    console.warn("多图提示词规划已降级为共享提示词", {
      jobId,
      imageCount,
      reason: plan.fallbackReason
    });
  }
  return plan;
}

async function assertImageJobExecutionIsActiveAfterSave(
  jobId: string,
  manualRetryCount: number,
  recoveryCount: number,
  savedImages: Awaited<ReturnType<typeof saveProviderImageResults>>
) {
  try {
    assertImageJobExecutionIsActive(jobId, manualRetryCount, recoveryCount);
  } catch (error) {
    await deleteStoredFilesIfUnreferenced(savedImages.map((image) => image.file.path)).catch((cleanupError) => {
      console.warn("清理已取消图片任务的临时文件失败", cleanupError);
    });
    throw error;
  }
}

function storedImageJobImages(job: StoredImageJobRow) {
  return getAll<ImageRow>(
    appDb,
    "select * from images where job_id = ? and user_id = ? order by coalesce(job_image_index, 2147483647) asc, created_at asc, rowid asc",
    job.id,
    job.user_id
  );
}

function storedImageJobImagesById(jobId: string, userId: string) {
  return getAll<ImageRow>(
    appDb,
    "select * from images where job_id = ? and user_id = ? order by coalesce(job_image_index, 2147483647) asc, created_at asc, rowid asc",
    jobId,
    userId
  );
}

function incompleteImageCountMessage(requestedImageCount: number, images: ImageRow[], detail: string) {
  const state = storedImageCompletionState(images, requestedImageCount);
  if (state.remainingRequestedSlotCount === 0) return detail;
  return `图片数量未补全：期望 ${requestedImageCount} 张，已完成 ${state.completedRequestedSlotCount} 个目标槽位（共保存 ${state.totalStoredImageCount} 张），还缺 ${state.remainingRequestedSlotCount} 张；${detail}`;
}

function emitImageJobProgress(
  userId: string,
  sessionId: string,
  jobId: string,
  type: "generation" | "edit",
  requestedImageCount: number
) {
  const images = getAll<ImageRow>(
    appDb,
    "select * from images where job_id = ? and user_id = ? order by coalesce(job_image_index, 2147483647) asc, created_at asc, rowid asc",
    jobId,
    userId
  );
  const completedImageIndices = Array.from(storedImageSlotIndexes(images, requestedImageCount).values())
    .sort((left, right) => left - right);
  emitJobStatus(userId, sessionId, jobId, "running", type, {
    requestedImageCount,
    completedImageCount: completedImageIndices.length,
    completedImageIndices
  });
}

function reconcileStoredImageJobMessages({
  job,
  requestPayload,
  images,
  retrySessionId,
  revisionMetadata,
  branchMetadata
}: {
  job: StoredImageJobRow;
  requestPayload: Record<string, unknown>;
  images: ImageRow[];
  retrySessionId: string;
  revisionMetadata: Record<string, unknown>;
  branchMetadata: Record<string, unknown>;
}) {
  const requestedImageCount = numberFromPayload(requestPayload.n, 1);
  const imageSlotIndexes = storedImageSlotIndexes(images, requestedImageCount);
  const sourceIds = retrySourceIds(job.source_image_ids);
  for (const image of images) {
    const existingMessage = getOne<{ id: string }>(
      appDb,
      "select id from messages where user_id = ? and session_id = ? and role = ? and image_id = ? limit 1",
      job.user_id,
      retrySessionId,
      "assistant",
      image.id
    );
    if (existingMessage) continue;
    insertMessage(
      job.user_id,
      retrySessionId,
      "assistant",
      job.type === "edit" ? "已完成图片编辑" : "已生成图片",
      image.id,
      {
        mode: job.type,
        jobId: job.id,
        ...(job.type === "edit"
          ? {
              parentImageId: image.parent_image_id ?? null,
              sourceAssetIds: sourceIds.assetIds,
              sourceReferenceIds: sourceIds.referenceIds,
              hasMask: Boolean(requestPayload.mask)
            }
          : {}),
        n: requestedImageCount,
        imageIndex: imageSlotIndexes.get(image.id) ?? 1,
        imageTotal: requestedImageCount,
        ...revisionMetadata,
        ...branchMetadata
      }
    );
  }
}

async function finalizeStoredImageJobFromExisting({
  job,
  requestPayload,
  images,
  retrySessionId,
  revisionMetadata,
  branchMetadata,
  maxAutoRetries,
  previousAutoRetryCount,
  nextManualRetryCount,
  expectedRecoveryCount,
  signal
}: {
  job: StoredImageJobRow;
  requestPayload: Record<string, unknown>;
  images: ImageRow[];
  retrySessionId: string;
  revisionMetadata: Record<string, unknown>;
  branchMetadata: Record<string, unknown>;
  maxAutoRetries: number;
  previousAutoRetryCount: number;
  nextManualRetryCount: number;
  expectedRecoveryCount: number;
  signal?: AbortSignal;
}) {
  if (job.type === "edit") {
    try {
      const referenceSources = storedEditImageReferenceSources(job);
      for (const image of images) {
        await ensureImageReferenceSnapshots(job.user_id, retrySessionId, image.id, referenceSources);
      }
    } catch (error) {
      console.warn("恢复编辑图片素材引用失败", error);
    }
  }
  reconcileStoredImageJobMessages({
    job,
    requestPayload,
    images,
    retrySessionId,
    revisionMetadata,
    branchMetadata
  });
  const imageIds = images.map((image) => image.id);
  await applyImageFieldSuggestions(imageIds);
  await ensureImageEditSuggestionsForImages(job.user_id, imageIds);
  const resultImageId = imageIds[0] ?? job.result_image_id;
  const completed = run(
    appDb,
    `update image_jobs
     set status = ?, error = null, result_image_id = ?, auto_retry_count = ?, manual_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = 1, updated_at = ?
     where id = ? and status = ? and coalesce(manual_retry_count, 0) = ? and coalesce(recovery_count, 0) = ?`,
    "succeeded",
    resultImageId,
    previousAutoRetryCount,
    nextManualRetryCount,
    maxAutoRetries,
    now(),
    job.id,
    "running",
    nextManualRetryCount,
    expectedRecoveryCount
  );
  if (Number(completed.changes ?? 0) > 0) {
    emitJobStatus(job.user_id, retrySessionId, job.id, "succeeded", job.type, { resultImageId });
  }
}

function markInterruptedImageJobFailed(job: StoredImageJobRow, message: string) {
  const result = run(
    appDb,
    "update image_jobs set status = ?, error = ?, updated_at = ? where id = ? and status = ?",
    "failed",
    message,
    now(),
    job.id,
    "running"
  );
  if (Number(result.changes ?? 0) > 0) {
    emitJobStatus(job.user_id, job.session_id, job.id, "failed", job.type, { error: message });
  }
}

async function runStoredImageJob({
  job,
  providers,
  provider,
  requestPayload,
  retrySessionId,
  revisionMetadata,
  branchMetadata,
  maxAutoRetries,
  previousAutoRetryCount,
  nextManualRetryCount,
  expectedRecoveryCount,
  signal
}: {
  job: StoredImageJobRow;
  providers: RuntimeProviderRow[];
  provider: RuntimeProviderRow;
  requestPayload: Record<string, unknown>;
  retrySessionId: string;
  revisionMetadata: Record<string, unknown>;
  branchMetadata: Record<string, unknown>;
  maxAutoRetries: number;
  previousAutoRetryCount: number;
  nextManualRetryCount: number;
  expectedRecoveryCount: number;
  signal?: AbortSignal;
}) {
  try {
    const existingImages = storedImageJobImages(job);
    const requestedImageCount = numberFromPayload(requestPayload.n, 1);
    const existingCompletionState = storedImageCompletionState(existingImages, requestedImageCount);
    const existingImageIndexes = existingCompletionState.slotIndexes;
    const sourceIds = retrySourceIds(job.source_image_ids);

    if (existingCompletionState.remainingRequestedSlotCount === 0) {
      await finalizeStoredImageJobFromExisting({
        job,
        requestPayload,
        images: existingImages,
        retrySessionId,
        revisionMetadata,
        branchMetadata,
        maxAutoRetries,
        previousAutoRetryCount,
        nextManualRetryCount,
        expectedRecoveryCount
      });
      return;
    }

    reconcileStoredImageJobMessages({
      job,
      requestPayload,
      images: existingImages,
      retrySessionId,
      revisionMetadata,
      branchMetadata
    });
    const size = String(requestPayload.size ?? "");
    const quality = requestImageQuality(requestPayload.quality, provider.default_quality);

    if (job.type === "generation") {
      const promptPlan = await ensureStoredImagePromptPlan({
        jobId: job.id,
        userId: job.user_id,
        prompt: job.prompt,
        taskType: "generation",
        requestPayload,
        existingImageCount: existingImages.length,
        manualRetryCount: nextManualRetryCount,
        recoveryCount: expectedRecoveryCount,
        signal
      });
      const preparedEditSuggestions = promptPlan.mode === "grouped"
        ? null
        : prepareImageEditSuggestionsForJob({
            userId: job.user_id,
            prompt: job.prompt,
            kind: "generation",
            promptHistory: [job.prompt]
          });
      const savedImageIds: string[] = [];
      const completion = await runProviderImageCompletion({
        providers,
        mode: "generation",
        requestPayload,
        promptPlan,
        originalPrompt: job.prompt,
        existingImageCount: existingImages.length,
        existingImageIndexes,
        concurrency: requestImageCompletionConcurrency(requestPayload),
        userId: job.user_id,
        sessionId: retrySessionId,
        jobId: job.id,
        retryCount: maxAutoRetries,
        buildPrompt: providerPrompt,
        onBatch: async ({ prompt: imagePrompt, imageIndexStart, imageIndexes, items, result }) => {
          await assertImageJobExecutionIsActiveAfterSave(
            job.id,
            nextManualRetryCount,
            expectedRecoveryCount,
            items
          );
          for (const [batchIndex, saved] of items.entries()) {
            assertImageJobExecutionIsActive(job.id, nextManualRetryCount, expectedRecoveryCount);
            const imageIndex = imageIndexes[batchIndex] ?? imageIndexStart + batchIndex;
            const createdAt = now();
            run(
              appDb,
              `insert into images (
                id, user_id, session_id, job_id, job_image_index, path, prompt, kind, size, quality,
                provider_id, mime_type, parent_image_id,
                provider_file_id, provider_gen_id, provider_conversation_id, provider_parent_message_id, provider_source_account_id,
                image_width, image_height, image_file_size, generated_attempt_no, generated_by_retry, created_at
              ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              saved.id,
              job.user_id,
              retrySessionId,
              job.id,
              imageIndex,
              saved.file.path,
              imagePrompt,
              "generation",
              size,
              quality,
              result.provider.id,
              saved.file.mimeType,
              null,
              ...providerImageContextValues(saved.providerContext),
              saved.file.width,
              saved.file.height,
              saved.file.fileSize,
              result.attemptNo,
              1,
              createdAt
            );
            savedImageIds.push(saved.id);
            insertMessage(job.user_id, retrySessionId, "assistant", "已生成图片", saved.id, {
              mode: "generation",
              jobId: job.id,
              n: requestedImageCount,
              imageIndex,
              imageTotal: requestedImageCount,
              promptPlanMode: promptPlan.mode,
              ...revisionMetadata,
              ...branchMetadata
            });
            run(
              appDb,
              `update image_jobs set result_image_id = coalesce(result_image_id, ?), updated_at = ?
               where id = ? and status = ? and coalesce(manual_retry_count, 0) = ? and coalesce(recovery_count, 0) = ?`,
              saved.id,
              now(),
              job.id,
              "running",
              nextManualRetryCount,
              expectedRecoveryCount
            );
            emitImageJobProgress(job.user_id, retrySessionId, job.id, "generation", requestedImageCount);
          }
          if (items.length > 0) invalidateLibraryFacetCache("images");
        },
        signal
      });
      const allImageIds = [...existingImages.map((image) => image.id), ...savedImageIds];
      await applyImageFieldSuggestions(allImageIds);
      await ensureImageEditSuggestionsForImages(job.user_id, allImageIds, preparedEditSuggestions);
      const resultImageId = allImageIds[0] ?? null;
      const autoRetryCount = previousAutoRetryCount + completion.autoRetryCount;
      const completed = run(
        appDb,
        `update image_jobs
         set status = ?, result_image_id = ?, response_json = ?, auto_retry_count = ?, manual_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = 1, updated_at = ?
         where id = ? and status = ? and coalesce(manual_retry_count, 0) = ? and coalesce(recovery_count, 0) = ?`,
        "succeeded",
        resultImageId,
        providerResponseSnapshot(completion.responseJson),
        autoRetryCount,
        nextManualRetryCount,
        completion.retryCount,
        now(),
        job.id,
        "running",
        nextManualRetryCount,
        expectedRecoveryCount
      );
      if (Number(completed.changes ?? 0) > 0) {
        emitJobStatus(job.user_id, retrySessionId, job.id, "succeeded", "generation", { resultImageId });
      }
      return;
    }

    const sourceImages = sourceIds.imageIds.map((id) =>
      getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", id, job.user_id)
    );
    const sourceAssets = sourceIds.assetIds.map((id) =>
      getOne<ImageReferenceSourceAsset>(
        appDb,
        `select id, name, path, mime_type, size, image_width, image_height from assets where id = ? and ${visibleAssetSql("assets")}`,
        id,
        job.user_id
      )
    );
    const sourceCases = caseMaterialSourcesByIds(sourceIds.caseItemIds, job.user_id);
    const sourceReferences = messageSourceReferencesByIds(sourceIds.referenceIds, job.user_id);
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
    for (const image of existingImages) {
      await ensureImageReferenceSnapshots(job.user_id, retrySessionId, image.id, imageReferenceSources);
      assertImageJobExecutionIsActive(job.id, nextManualRetryCount, expectedRecoveryCount);
    }
    const imageUrls = [
      ...(await Promise.all(validSourceImages.map((item) => fileToDataUrl(item.path, item.mime_type)))),
      ...(await Promise.all(validSourceAssets.map((item) => fileToDataUrl(item.path, item.mime_type)))),
      ...(await Promise.all(validSourceCases.map((item) => fileToDataUrl(item.path, item.mimeType)))),
      ...(await Promise.all(validSourceReferences.map((item) => fileToDataUrl(item.path, item.mime_type))))
    ];
    if (imageUrls.length === 0) throw new Error("请选择要编辑的图片或素材");

    const messageMetadata = jobUserMessageMetadata(job.user_id, retrySessionId, job.id);
    const maskWasRequested = Boolean(requestPayload.mask);
    const maskPath = String(requestPayload.maskPath ?? messageMetadata.maskPath ?? "").trim();
    const storedMaskDataUrl = maskWasRequested && maskPath
      ? await imageEditMaskSnapshotDataUrl(maskPath).catch(() => "")
      : "";
    if (maskWasRequested && !storedMaskDataUrl) throw new Error("原编辑遮罩已丢失，请重新涂抹后发送");
    const maskDataUrl = storedMaskDataUrl
      ? await normalizeImageEditMaskDataUrl(storedMaskDataUrl, imageUrls[0])
      : "";

    const retryPayload: Record<string, unknown> = {
      ...requestPayload,
      images: imageUrls.map((image_url) => ({ image_url }))
    };
    delete retryPayload.maskPath;
    delete retryPayload.debug;
    if (maskDataUrl) retryPayload.mask = maskDataUrl;
    else delete retryPayload.mask;
    const retryEditIntent = storedImageEditIntent(requestPayload.editIntent);

    const primarySourceImage = validSourceImages[0] ?? null;
    const promptPlan = await ensureStoredImagePromptPlan({
      jobId: job.id,
      userId: job.user_id,
      prompt: job.prompt,
      taskType: "edit",
      requestPayload,
      existingImageCount: existingImages.length,
      manualRetryCount: nextManualRetryCount,
      recoveryCount: expectedRecoveryCount,
      signal
    });
    const preparedEditSuggestions = promptPlan.mode === "grouped"
      ? null
      : prepareImageEditSuggestionsForJob({
          userId: job.user_id,
          prompt: job.prompt,
          kind: "edit",
          promptHistory: editPromptHistoryForSourceImage(primarySourceImage, job.prompt)
        });
    assertImageJobExecutionIsActive(job.id, nextManualRetryCount, expectedRecoveryCount);
    const savedImageIds: string[] = [];
    const completion = await runProviderImageCompletion({
      providers,
      mode: "edit",
      requestPayload: retryPayload,
      promptPlan,
      originalPrompt: job.prompt,
      existingImageCount: existingImages.length,
      existingImageIndexes,
      concurrency: requestImageCompletionConcurrency(requestPayload),
      userId: job.user_id,
      sessionId: retrySessionId,
      jobId: job.id,
      retryCount: maxAutoRetries,
      buildPrompt: (batchPrompt, count) => providerEditPrompt(batchPrompt, count, Boolean(maskDataUrl), retryEditIntent),
      onBatch: async ({ prompt: imagePrompt, imageIndexStart, imageIndexes, items, result }) => {
        await assertImageJobExecutionIsActiveAfterSave(
          job.id,
          nextManualRetryCount,
          expectedRecoveryCount,
          items
        );
        for (const [batchIndex, saved] of items.entries()) {
          assertImageJobExecutionIsActive(job.id, nextManualRetryCount, expectedRecoveryCount);
          const imageIndex = imageIndexes[batchIndex] ?? imageIndexStart + batchIndex;
          const createdAt = now();
          run(
            appDb,
            `insert into images (
              id, user_id, session_id, job_id, job_image_index, path, prompt, kind, size, quality,
              provider_id, mime_type, parent_image_id,
              provider_file_id, provider_gen_id, provider_conversation_id, provider_parent_message_id, provider_source_account_id,
              image_width, image_height, image_file_size, generated_attempt_no, generated_by_retry, created_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            saved.id,
            job.user_id,
            retrySessionId,
            job.id,
            imageIndex,
            saved.file.path,
            imagePrompt,
            "edit",
            size,
            quality,
            result.provider.id,
            saved.file.mimeType,
            primarySourceImage?.id ?? null,
            ...providerImageContextValues(saved.providerContext),
            saved.file.width,
            saved.file.height,
            saved.file.fileSize,
            result.attemptNo,
            1,
            createdAt
          );
          try {
            await snapshotImageReferences(job.user_id, retrySessionId, saved.id, imageReferenceSources);
          } catch (error) {
            console.warn("图片素材引用快照保存失败", error);
          }
          assertImageJobExecutionIsActive(job.id, nextManualRetryCount, expectedRecoveryCount);
          savedImageIds.push(saved.id);
          insertMessage(job.user_id, retrySessionId, "assistant", "已完成图片编辑", saved.id, {
            mode: "edit",
            jobId: job.id,
            parentImageId: primarySourceImage?.id ?? null,
            sourceAssetIds: sourceIds.assetIds,
            sourceReferenceIds: sourceIds.referenceIds,
            hasMask: Boolean(maskDataUrl),
            n: requestedImageCount,
            imageIndex,
            imageTotal: requestedImageCount,
            promptPlanMode: promptPlan.mode,
            ...revisionMetadata,
            ...branchMetadata
          });
          run(
            appDb,
            `update image_jobs set result_image_id = coalesce(result_image_id, ?), updated_at = ?
             where id = ? and status = ? and coalesce(manual_retry_count, 0) = ? and coalesce(recovery_count, 0) = ?`,
            saved.id,
            now(),
            job.id,
            "running",
            nextManualRetryCount,
            expectedRecoveryCount
          );
          emitImageJobProgress(job.user_id, retrySessionId, job.id, "edit", requestedImageCount);
        }
        if (items.length > 0) invalidateLibraryFacetCache("images");
      },
      signal
    });
    const allImageIds = [...existingImages.map((image) => image.id), ...savedImageIds];
    await applyImageFieldSuggestions(allImageIds);
    await ensureImageEditSuggestionsForImages(job.user_id, allImageIds, preparedEditSuggestions);
    const resultImageId = allImageIds[0] ?? null;
    const autoRetryCount = previousAutoRetryCount + completion.autoRetryCount;
    const completed = run(
      appDb,
      `update image_jobs
       set status = ?, result_image_id = ?, response_json = ?, auto_retry_count = ?, manual_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = 1, updated_at = ?
       where id = ? and status = ? and coalesce(manual_retry_count, 0) = ? and coalesce(recovery_count, 0) = ?`,
      "succeeded",
      resultImageId,
      providerResponseSnapshot(completion.responseJson),
      autoRetryCount,
      nextManualRetryCount,
      completion.retryCount,
      now(),
      job.id,
      "running",
      nextManualRetryCount,
      expectedRecoveryCount
    );
    if (Number(completed.changes ?? 0) > 0) {
      emitJobStatus(job.user_id, retrySessionId, job.id, "succeeded", "edit", { resultImageId });
    }
  } catch (error) {
    if (error instanceof ImageJobExecutionSupersededError || providerRequestWasCancelled(error, signal)) return;
    const detail = errorMessage(error, job.type === "edit" ? "编辑失败" : "生成失败");
    const requestedImageCount = numberFromPayload(requestPayload.n, 1);
    const message = incompleteImageCountMessage(requestedImageCount, storedImageJobImages(job), detail);
    const failedAutoRetryCount = previousAutoRetryCount + autoRetryCountFromError(error, 0);
    const failed = run(
      appDb,
      `update image_jobs
       set status = ?, error = ?, auto_retry_count = ?, manual_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = 0, updated_at = ?
       where id = ? and status = ? and coalesce(manual_retry_count, 0) = ? and coalesce(recovery_count, 0) = ?`,
      "failed",
      message,
      failedAutoRetryCount,
      nextManualRetryCount,
      maxAutoRetries,
      now(),
      job.id,
      "running",
      nextManualRetryCount,
      expectedRecoveryCount
    );
    if (Number(failed.changes ?? 0) > 0) {
      emitJobStatus(job.user_id, retrySessionId, job.id, "failed", job.type, { error: message });
    }
  }
}

function startStoredImageJob(job: StoredImageJobRow, trigger: StoredImageJobTrigger) {
  if (!job.session_id) throw new Error("任务缺少对话信息，无法重试");
  const retrySessionId = job.session_id;
  const requestPayload = safeJson<Record<string, unknown>>(job.request_json, {});
  if (Object.keys(requestPayload).length === 0) throw new Error("任务请求信息不完整，无法重试");
  const providers = providerChainById(job.provider_id);
  const provider = providers[0];
  const messageMetadata = jobUserMessageMetadata(job.user_id, retrySessionId, job.id);
  const revisionMetadata = requestRevisionMetadata(messageMetadata);
  const branchMetadata = requestBranchMetadata(messageMetadata);
  const maxAutoRetries = trigger === "startup"
    ? 0
    : resolveImageResultRetryCount(imageGenerationSettings().resultRetryCount);
  const previousAutoRetryCount = Math.max(0, Math.trunc(Number(job.auto_retry_count ?? 0)) || 0);
  const currentManualRetryCount = Math.max(0, Math.trunc(Number(job.manual_retry_count ?? 0)) || 0);
  const currentRecoveryCount = Math.max(0, Math.trunc(Number(job.recovery_count ?? 0)) || 0);
  const nextManualRetryCount = trigger === "manual" ? currentManualRetryCount + 1 : currentManualRetryCount;
  const expectedRecoveryCount = trigger === "startup" ? currentRecoveryCount + 1 : 0;

  const claim = trigger === "manual"
    ? run(
        appDb,
        "update image_jobs set status = ?, error = null, response_json = null, manual_retry_count = ?, recovery_count = 0, max_auto_retries = ?, updated_at = ? where id = ? and status = ?",
        "running",
        nextManualRetryCount,
        maxAutoRetries,
        now(),
        job.id,
        "failed"
      )
    : run(
        appDb,
        "update image_jobs set error = null, response_json = null, recovery_count = ?, max_auto_retries = ?, updated_at = ? where id = ? and status = ? and coalesce(recovery_count, 0) = ?",
        expectedRecoveryCount,
        maxAutoRetries,
        now(),
        job.id,
        "running",
        currentRecoveryCount
      );
  if (Number(claim.changes ?? 0) === 0) throw new ImageJobClaimError("任务状态已变化");

  emitJobStatus(job.user_id, retrySessionId, job.id, "running", job.type);
  const runningJob = getOne<StoredImageJobRow>(appDb, "select * from image_jobs where id = ?", job.id);
  const executionController = beginImageJobExecution(job.id);
  void runStoredImageJob({
    job,
    providers,
    provider,
    requestPayload,
    retrySessionId,
    revisionMetadata,
    branchMetadata,
    maxAutoRetries,
    previousAutoRetryCount,
    nextManualRetryCount,
    expectedRecoveryCount,
    signal: executionController.signal
  }).catch((error) => {
    const message = errorMessage(error, "图片任务后台执行失败");
    console.warn("图片任务后台执行失败", error);
    const latestJob = getOne<StoredImageJobRow>(appDb, "select * from image_jobs where id = ?", job.id);
    if (latestJob && imageJobExecutionIsActive(job.id, nextManualRetryCount, expectedRecoveryCount)) {
      markInterruptedImageJobFailed(latestJob, message);
    }
  }).finally(() => {
    finishImageJobExecution(job.id, executionController);
  });
  return { retrySessionId, runningJob, branchMetadata };
}

function finalizeInterruptedImageJobIfComplete(job: StoredImageJobRow) {
  if (!job.session_id) return false;
  const requestPayload = safeJson<Record<string, unknown>>(job.request_json, {});
  if (Object.keys(requestPayload).length === 0) return false;
  const images = storedImageJobImages(job);
  const requestedImageCount = numberFromPayload(requestPayload.n, 1);
  if (storedImageCompletionState(images, requestedImageCount).remainingRequestedSlotCount > 0) return false;

  const recoveryCount = Math.max(0, Math.trunc(Number(job.recovery_count ?? 0)) || 0);
  const claim = run(
    appDb,
    "update image_jobs set error = null, updated_at = ? where id = ? and status = ? and coalesce(recovery_count, 0) = ?",
    now(),
    job.id,
    "running",
    recoveryCount
  );
  if (Number(claim.changes ?? 0) === 0) return true;

  const retrySessionId = job.session_id;
  const messageMetadata = jobUserMessageMetadata(job.user_id, retrySessionId, job.id);
  const revisionMetadata = requestRevisionMetadata(messageMetadata);
  const branchMetadata = requestBranchMetadata(messageMetadata);
  const maxAutoRetries = Math.max(0, Math.trunc(Number(job.max_auto_retries ?? 0)) || 0);
  const previousAutoRetryCount = Math.max(0, Math.trunc(Number(job.auto_retry_count ?? 0)) || 0);
  const nextManualRetryCount = Math.max(0, Math.trunc(Number(job.manual_retry_count ?? 0)) || 0);
  void finalizeStoredImageJobFromExisting({
    job,
    requestPayload,
    images,
    retrySessionId,
    revisionMetadata,
    branchMetadata,
    maxAutoRetries,
    previousAutoRetryCount,
    nextManualRetryCount,
    expectedRecoveryCount: recoveryCount
  }).catch((error) => {
    const latestJob = getOne<StoredImageJobRow>(appDb, "select * from image_jobs where id = ?", job.id);
    if (latestJob && imageJobExecutionIsActive(job.id, nextManualRetryCount, recoveryCount)) {
      markInterruptedImageJobFailed(latestJob, errorMessage(error, "任务结果恢复失败，请重新生成"));
    }
  });
  return true;
}

export function startInterruptedImageJobRecovery() {
  const interruptedJobs = getAll<StoredImageJobRow>(
    appDb,
    "select * from image_jobs where status = ? order by created_at asc, rowid asc",
    "running"
  );
  if (interruptedJobs.length === 0) return;

  const recoveryCutoff = localTimestamp(new Date(Date.now() - IMAGE_JOB_RUNNING_TIMEOUT_MS));
  let resumed = 0;
  let failed = 0;
  for (const job of interruptedJobs) {
    if (finalizeInterruptedImageJobIfComplete(job)) {
      resumed += 1;
      continue;
    }
    if (job.updated_at < recoveryCutoff) {
      markInterruptedImageJobFailed(job, IMAGE_JOB_TIMEOUT_ERROR);
      failed += 1;
      continue;
    }
    const recoveryCount = Math.max(0, Math.trunc(Number(job.recovery_count ?? 0)) || 0);
    if (recoveryCount >= MAX_STARTUP_IMAGE_JOB_RECOVERIES) {
      markInterruptedImageJobFailed(job, "任务自动恢复未完成，请重新生成");
      failed += 1;
      continue;
    }
    try {
      startStoredImageJob(job, "startup");
      resumed += 1;
    } catch (error) {
      if (error instanceof ImageJobClaimError) continue;
      markInterruptedImageJobFailed(job, errorMessage(error, "任务自动恢复失败，请重新生成"));
      failed += 1;
    }
  }
  console.info(`图片任务启动恢复完成：接管 ${resumed} 个，失败 ${failed} 个`);
}

export function registerImageRoutes(api: Hono) {
api.get("/images", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const pagination = boundedPaginationFromQuery(c);
  const keyword = String(c.req.query("keyword") ?? "").trim().toLowerCase();
  const sort = String(c.req.query("sort") ?? "desc").trim() === "asc" ? "asc" : "desc";
  const favoriteOnly = c.req.query("favoriteOnly") === "true" || c.req.query("favoriteOnly") === "1";
  const sessionId = String(c.req.query("sessionId") ?? "").trim();
  const where = ["user_id = ?"];
  const params: Array<string | number> = [user.id];
  if (sessionId) {
    where.push("session_id = ?");
    params.push(sessionId);
  }
  if (keyword) {
    const like = `%${keyword}%`;
    const kindClauses: string[] = [];
    const dateClauses: string[] = [];
    const dateParams: string[] = [];
    if ("生成".includes(keyword) || keyword.includes("生成")) kindClauses.push("kind = 'generation'");
    if ("编辑".includes(keyword) || keyword.includes("编辑")) kindClauses.push("kind = 'edit'");
    const dateSearch = imageDateSearchConditions(keyword, "created_at");
    dateClauses.push(...dateSearch.clauses);
    dateParams.push(...dateSearch.params);
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

api.get("/images/:imageId", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const image = getOne<ImageRow>(
    appDb,
    "select * from images where id = ? and user_id = ?",
    c.req.param("imageId"),
    user.id
  );
  if (!image) return c.json({ error: "图片不存在" }, 404);
  const favorite = getOne<{ favorite_count: number; current_user_favorited: number }>(
    appDb,
    `select count(*) as favorite_count,
            max(case when user_id = ? then 1 else 0 end) as current_user_favorited
     from image_favorites
     where image_id = ?`,
    user.id,
    image.id
  );
  const referenceMap = imageReferencesByImageIds([image.id]);
  const publicImage = publicImagesWithReferences([image], referenceMap)[0];
  return c.json({
    image: publicImage
      ? {
          ...publicImage,
          favoriteCount: Number(favorite?.favorite_count ?? 0),
          favorited: Boolean(favorite?.current_user_favorited)
        }
      : null
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
    promptHistory,
    c.req.query("language") || preferences.language
  );
  return c.json(result);
});

api.put("/images/batch/favorite", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const parsed = parseImageBatchIds(body.imageIds, 200);
  if (parsed.error) return c.json({ error: parsed.error }, 400);
  const favorited = Boolean(body.favorited);
  const placeholders = parsed.imageIds.map(() => "?").join(", ");
  const existingRows = getAll<{ id: string }>(
    appDb,
    `select id from images where user_id = ? and id in (${placeholders})`,
    user.id,
    ...parsed.imageIds
  );
  const existingIds = new Set(existingRows.map((row) => row.id));
  const updateFavorites = appDb.transaction(() => {
    for (const imageId of parsed.imageIds) {
      if (!existingIds.has(imageId)) continue;
      if (favorited) {
        run(
          appDb,
          "insert or ignore into image_favorites (id, user_id, image_id, created_at) values (?, ?, ?, ?)",
          makeId("imgfav"),
          user.id,
          imageId,
          now()
        );
      } else {
        run(appDb, "delete from image_favorites where user_id = ? and image_id = ?", user.id, imageId);
      }
    }
  });
  updateFavorites();
  return c.json({
    ...imageBatchResult(
      parsed.imageIds.map((imageId) =>
        existingIds.has(imageId)
          ? { imageId, status: "updated" as const }
          : { imageId, status: "not_found" as const, reason: "图片不存在" }
      )
    ),
    favorited
  });
});

api.post("/images/batch/delete-preview", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const parsed = parseImageBatchIds(body.imageIds, 200);
  if (parsed.error) return c.json({ error: parsed.error }, 400);
  const impact = imageDeleteImpact(user.id, parsed.imageIds);
  return c.json({ requested: parsed.imageIds.length, impact });
});

api.post("/images/batch/delete", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const parsed = parseImageBatchIds(body.imageIds, 200);
  if (parsed.error) return c.json({ error: parsed.error }, 400);
  const impact = imageDeleteImpact(user.id, parsed.imageIds);
  if (impact.hasAssociated && body.confirmAssociated !== true) {
    return c.json({ error: "这些图片包含关联内容，请确认后再删除", impact }, 409);
  }
  const deleted = await deleteImageRecordsBatch(user.id, parsed.imageIds);
  if (deleted.deletedImageIds.length > 0) invalidateLibraryFacetCache();
  return c.json({
    ...imageBatchResult([
      ...deleted.deletedImageIds.map((imageId) => ({ imageId, status: "deleted" as const })),
      ...deleted.notFoundIds.map((imageId) => ({ imageId, status: "not_found" as const, reason: "图片不存在" }))
    ]),
    impact: deleted.impact,
    cleanupWarnings: deleted.cleanupWarnings
  });
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
  invalidateLibraryFacetCache();
  return c.json({ ok: true });
});

api.post("/images/generate", async (c) => {
  const user = await requireImageRouteUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const clientRequestId = requestClientRequestId(body);
  cleanupExpiredImageJobCancelIntents();
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
  if (imageJobCancelRequested(user.id, clientRequestId)) {
    return c.json({ cancelled: true, clientRequestId }, 409);
  }
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
  const quality = requestImageQuality(body.quality, provider.default_quality);
  const imageCount = resolvePromptImageCount(prompt, body.n ?? body.imageCount);
  const imageOptions = normalizedImageRequestOptions(body);
  if (imageOptions.error) return c.json({ error: imageOptions.error }, 400);
  const sessionId = await ensureChatSession(user.id, String(body.sessionId ?? "") || null, prompt, clientRequestId);
  if (imageJobCancelRequested(user.id, clientRequestId)) {
    deleteRequestEmptySessionRecord(user.id, sessionId, clientRequestId);
    return c.json({ cancelled: true, clientRequestId, sessionId }, 409);
  }
  const webConversationContext = branchForkMessageId
    ? providerConversationContextFromMessage(user.id, sessionId, branchForkMessageId, "branch") ?? { placement: "branch" }
    : latestProviderConversationContextForBranch(user.id, sessionId, branchId);
  const timestamp = now();
  const jobId = makeId("job");
  const generationSettings = imageGenerationSettings();
  const requestPayload = {
    prompt: providerPrompt(prompt, imageCount),
    size,
    quality,
    n: imageCount,
    [IMAGE_COMPLETION_CONCURRENCY_REQUEST_KEY]: generationSettings.multiImageConcurrency,
    ...imageOptions.payload,
    ...(webConversationContext ? { webConversationContext } : {})
  };
  const maxAutoRetries = resolveImageResultRetryCount(generationSettings.resultRetryCount);

  insertMessage(user.id, sessionId, "user", prompt, null, {
    mode: "generation",
    jobId,
    clientRequestId,
    size,
    quality,
    ...imageRequestMessageMetadata(imageOptions.payload),
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
      provider_id, request_json, client_request_id, max_auto_retries, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    jobId,
    user.id,
    sessionId,
    "generation",
    "running",
    prompt,
    "[]",
    selectedProviderId,
    JSON.stringify(requestPayload),
    clientRequestId || null,
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

  const executionController = beginImageJobExecution(jobId);
  const runGenerationJob = async () => {
    const savedImageIds: string[] = [];
    try {
      const promptPlan = await ensureStoredImagePromptPlan({
        jobId,
        userId: user.id,
        prompt,
        taskType: "generation",
        requestPayload,
        existingImageCount: 0,
        manualRetryCount: 0,
        recoveryCount: 0,
        signal: executionController.signal
      });
      const preparedEditSuggestions = promptPlan.mode === "grouped"
        ? null
        : prepareImageEditSuggestionsForJob({
            userId: user.id,
            prompt,
            kind: "generation",
            promptHistory: [prompt],
            language: body.language
          });
      const completion = await runProviderImageCompletion({
        providers,
        mode: "generation",
        requestPayload,
        promptPlan,
        originalPrompt: prompt,
        existingImageCount: 0,
        existingImageIndexes: [],
        concurrency: requestImageCompletionConcurrency(requestPayload),
        userId: user.id,
        sessionId,
        jobId,
        retryCount: maxAutoRetries,
        buildPrompt: providerPrompt,
        onBatch: async ({ prompt: imagePrompt, imageIndexStart, imageIndexes, items, result }) => {
          await assertImageJobExecutionIsActiveAfterSave(jobId, 0, 0, items);
          const generatedByRetry = result.attemptNo > 1 ? 1 : 0;
          for (const [batchIndex, saved] of items.entries()) {
            assertImageJobExecutionIsActive(jobId, 0, 0);
            const imageIndex = imageIndexes[batchIndex] ?? imageIndexStart + batchIndex;
            const createdAt = now();
            run(
              appDb,
              `insert into images (
                id, user_id, session_id, job_id, job_image_index, path, prompt, kind, size, quality,
                provider_id, mime_type, parent_image_id,
                provider_file_id, provider_gen_id, provider_conversation_id, provider_parent_message_id, provider_source_account_id,
                image_width, image_height, image_file_size, generated_attempt_no, generated_by_retry, created_at
              ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              saved.id,
              user.id,
              sessionId,
              jobId,
              imageIndex,
              saved.file.path,
              imagePrompt,
              "generation",
              size,
              quality,
              result.provider.id,
              saved.file.mimeType,
              null,
              ...providerImageContextValues(saved.providerContext),
              saved.file.width,
              saved.file.height,
              saved.file.fileSize,
              result.attemptNo,
              generatedByRetry,
              createdAt
            );
            savedImageIds.push(saved.id);
            insertMessage(user.id, sessionId, "assistant", "已生成图片", saved.id, {
              mode: "generation",
              jobId,
              ...imageRequestMessageMetadata(imageOptions.payload),
              n: imageCount,
              imageIndex,
              imageTotal: imageCount,
              promptPlanMode: promptPlan.mode,
              ...revisionMetadata,
              ...branchMetadata
            });
            run(
              appDb,
              `update image_jobs set result_image_id = coalesce(result_image_id, ?), updated_at = ?
               where id = ? and status = ? and coalesce(manual_retry_count, 0) = 0 and coalesce(recovery_count, 0) = 0`,
              saved.id,
              now(),
              jobId,
              "running"
            );
            emitImageJobProgress(user.id, sessionId, jobId, "generation", imageCount);
          }
          if (items.length > 0) invalidateLibraryFacetCache("images");
        },
        signal: executionController.signal
      });
      await applyImageFieldSuggestions(savedImageIds);
      await ensureImageEditSuggestionsForImages(user.id, savedImageIds, preparedEditSuggestions);
      const succeededOnRetry = completion.autoRetryCount > 0 ? 1 : 0;
      const completed = run(
        appDb,
        `update image_jobs
         set status = ?, result_image_id = ?, response_json = ?, auto_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = ?, updated_at = ?
         where id = ? and status = ? and coalesce(manual_retry_count, 0) = 0 and coalesce(recovery_count, 0) = 0`,
        "succeeded",
        savedImageIds[0] ?? null,
        providerResponseSnapshot(completion.responseJson),
        completion.autoRetryCount,
        completion.retryCount,
        succeededOnRetry,
        now(),
        jobId,
        "running"
      );
      if (Number(completed.changes ?? 0) > 0) {
        emitJobStatus(user.id, sessionId, jobId, "succeeded", "generation", { resultImageId: savedImageIds[0] ?? null });
      }
      return savedImageIds;
    } catch (error) {
      if (error instanceof ImageJobExecutionSupersededError || providerRequestWasCancelled(error, executionController.signal)) return [];
      const detail = error instanceof Error ? error.message : "生成失败";
      const message = incompleteImageCountMessage(imageCount, storedImageJobImagesById(jobId, user.id), detail);
      const failedAutoRetryCount = autoRetryCountFromError(error, maxAutoRetries);
      const failed = run(
        appDb,
        `update image_jobs
         set status = ?, error = ?, auto_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = 0, updated_at = ?
         where id = ? and status = ? and coalesce(manual_retry_count, 0) = 0 and coalesce(recovery_count, 0) = 0`,
        "failed",
        message,
        failedAutoRetryCount,
        maxAutoRetries,
        now(),
        jobId,
        "running"
      );
      if (Number(failed.changes ?? 0) > 0) {
        emitJobStatus(user.id, sessionId, jobId, "failed", "generation", { error: message });
      }
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
  }).finally(() => {
    finishImageJobExecution(jobId, executionController);
    clearImageJobCancelIntent(user.id, clientRequestId);
  });
  return c.json({ sessionId, job: job ? serializeJob(job) : null, image: null, images: [] }, 202);
});

api.post("/images/edit", async (c) => {
  const user = await requireImageRouteUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const clientRequestId = requestClientRequestId(body);
  cleanupExpiredImageJobCancelIntents();
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
  const revisionRootId = String(body.revisionRootId ?? "").trim();
  const editedMessageId = String(body.editedMessageId ?? "").trim();
  const canRestoreRemovalMask = body.editIntent === "remove" && Boolean(editedMessageId);
  const normalizedEditRequest = normalizeImageEditRequest(body, {
    hasMask: Boolean(rawMaskDataUrl),
    canRestoreMask: canRestoreRemovalMask
  });
  if ("error" in normalizedEditRequest) return c.json({ error: normalizedEditRequest.error }, 400);
  const { editIntent, extraPrompt, imageAnnotations, prompt } = normalizedEditRequest;
  const hideReference = body.hideReference === true;
  const revisionMetadata = revisionRootId ? { revisionRootId, ...(editedMessageId ? { editedMessageId } : {}) } : {};
  const branchId = String(body.branchId ?? "").trim();
  const branchForkMessageId = String(body.branchForkMessageId ?? "").trim();
  const branchMetadata = requestBranchMetadata(body);
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
  if (imageJobCancelRequested(user.id, clientRequestId)) {
    return c.json({ cancelled: true, clientRequestId }, 409);
  }
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
  const quality = requestImageQuality(body.quality, provider.default_quality);
  const imageCount = editIntent === "annotation"
    ? resolvePromptImageCount(extraPrompt, resolveSelectedImageCount(body.n ?? body.imageCount))
    : resolvePromptImageCount(prompt, body.n ?? body.imageCount);
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
  if (rawMaskDataUrl) {
    try {
      maskDataUrl = await normalizeImageEditMaskDataUrl(rawMaskDataUrl, imageUrls[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "遮罩图片处理失败";
      return c.json({ error: message }, 400);
    }
  }
  if (imageJobCancelRequested(user.id, clientRequestId)) {
    return c.json({ cancelled: true, clientRequestId }, 409);
  }
  const primarySourceImage = validSourceImages[0] ?? null;
  const sessionId = await ensureChatSession(
    user.id,
    String(body.sessionId ?? primarySourceImage?.session_id ?? "") || null,
    prompt,
    clientRequestId
  );
  if (imageJobCancelRequested(user.id, clientRequestId)) {
    deleteRequestEmptySessionRecord(user.id, sessionId, clientRequestId);
    return c.json({ cancelled: true, clientRequestId, sessionId }, 409);
  }
  if (!maskDataUrl && editedMessageId) {
    maskDataUrl = await messageMaskSnapshotDataUrl(user.id, sessionId, editedMessageId);
    if (maskDataUrl) {
      try {
        maskDataUrl = await normalizeImageEditMaskDataUrl(maskDataUrl, imageUrls[0]);
      } catch (error) {
        deleteRequestEmptySessionRecord(user.id, sessionId, clientRequestId);
        const message = error instanceof Error ? error.message : "遮罩图片处理失败";
        return c.json({ error: message }, 400);
      }
    }
  }
  if (editIntent === "remove" && !maskDataUrl) {
    deleteRequestEmptySessionRecord(user.id, sessionId, clientRequestId);
    return c.json({ error: "请先涂抹需要移除的区域" }, 400);
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
  let maskSnapshot = null;
  if (maskDataUrl) {
    try {
      maskSnapshot = await requireImageEditMaskSnapshot(jobId, maskDataUrl);
    } catch (error) {
      console.warn("图片编辑遮罩快照保存失败", error);
      deleteRequestEmptySessionRecord(user.id, sessionId, clientRequestId);
      return c.json({ error: errorMessage(error, "图片编辑遮罩保存失败，请重试") }, 500);
    }
  }
  const timestamp = now();
  const requestPrompt = providerEditPrompt(prompt, imageCount, Boolean(maskDataUrl), editIntent);
  const generationSettings = imageGenerationSettings();
  const requestPayload = {
    prompt: requestPrompt,
    size,
    quality,
    n: imageCount,
    editIntent,
    [IMAGE_COMPLETION_CONCURRENCY_REQUEST_KEY]: generationSettings.multiImageConcurrency,
    images: imageUrls.map((image_url) => ({ image_url })),
    ...imageOptions.payload,
    ...(maskDataUrl ? { mask: maskDataUrl } : {}),
    ...(sourceReference ? { sourceReference } : {}),
    ...(webConversationContext ? { webConversationContext } : {})
  };
  const maxAutoRetries = resolveImageResultRetryCount(generationSettings.resultRetryCount);
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

  if (imageJobCancelRequested(user.id, clientRequestId)) {
    await deleteImageJobArtifacts(user.id, jobId, clientRequestId);
    if (maskSnapshot?.path) await deleteStoredFilesIfUnreferenced([maskSnapshot.path]);
    deleteRequestEmptySessionRecord(user.id, sessionId, clientRequestId);
    return c.json({ cancelled: true, clientRequestId, sessionId }, 409);
  }

  const userMessageId = insertMessage(
    user.id,
    sessionId,
    "user",
    prompt,
    hideReference || (!primarySourceImage && (sourceCaseReferences.length > 0 || existingSourceReferences.length > 0)) ? null : primarySourceImage?.id ?? null,
    {
      mode: "edit",
      jobId,
      clientRequestId,
      sourceImageIds,
      sourceAssetIds,
      sourceCaseItemIds,
      sourceReferenceIds,
      ...(sourceCaseReferences.length > 0 ? { sourceCaseReferences } : {}),
      ...(existingSourceReferences.length > 0 ? { sourceReferenceImages: existingSourceReferences } : {}),
      ...(referenceAssetId ? { referenceAssetId } : {}),
      hasMask: Boolean(maskDataUrl),
      editIntent,
      ...(imageAnnotations.length > 0 ? { imageAnnotations } : {}),
      ...(maskSnapshot ? { maskPath: maskSnapshot.path, maskMimeType: maskSnapshot.mimeType } : {}),
      hideReference,
      size,
      quality,
      ...imageRequestMessageMetadata(imageOptions.payload),
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
  if (imageJobCancelRequested(user.id, clientRequestId)) {
    await deleteImageJobArtifacts(user.id, jobId, clientRequestId);
    deleteRequestEmptySessionRecord(user.id, sessionId, clientRequestId);
    return c.json({ cancelled: true, clientRequestId, sessionId }, 409);
  }
  const messageSourceReferences = [...existingSourceReferences, ...snapshotReferences];
  if (messageSourceReferences.length > 0) {
    const metadata = {
      mode: "edit",
      jobId,
      clientRequestId,
      sourceImageIds,
      sourceAssetIds,
      sourceCaseItemIds,
      sourceReferenceIds: messageSourceReferences.map((item) => item.sourceReferenceId).filter(Boolean),
      sourceReferenceImages: messageSourceReferences,
      ...(sourceCaseReferences.length > 0 ? { sourceCaseReferences } : {}),
      ...(referenceAssetId ? { referenceAssetId } : {}),
      hasMask: Boolean(maskDataUrl),
      editIntent,
      ...(imageAnnotations.length > 0 ? { imageAnnotations } : {}),
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
      provider_id, request_json, client_request_id, max_auto_retries, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    clientRequestId || null,
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

  const executionController = beginImageJobExecution(jobId);
  const runEditJob = async () => {
    let responseJson: unknown = null;
    const savedImageIds: string[] = [];
    try {
      const promptPlan = await ensureStoredImagePromptPlan({
        jobId,
        userId: user.id,
        prompt,
        taskType: "edit",
        requestPayload,
        existingImageCount: 0,
        manualRetryCount: 0,
        recoveryCount: 0,
        signal: executionController.signal
      });
      const preparedEditSuggestions = promptPlan.mode === "grouped"
        ? null
        : prepareImageEditSuggestionsForJob({
            userId: user.id,
            prompt,
            kind: "edit",
            promptHistory: editPromptHistoryForSourceImage(primarySourceImage, prompt),
            language: body.language
          });
      const completion = await runProviderImageCompletion({
        providers,
        mode: "edit",
        requestPayload,
        promptPlan,
        originalPrompt: prompt,
        existingImageCount: 0,
        existingImageIndexes: [],
        concurrency: requestImageCompletionConcurrency(requestPayload),
        userId: user.id,
        sessionId,
        jobId,
        retryCount: maxAutoRetries,
        buildPrompt: (batchPrompt, count) => providerEditPrompt(batchPrompt, count, Boolean(maskDataUrl), editIntent),
        onResponseJson: (value) => {
          responseJson = value;
        },
        onBatch: async ({ prompt: imagePrompt, imageIndexStart, imageIndexes, items, result }) => {
          await assertImageJobExecutionIsActiveAfterSave(jobId, 0, 0, items);
          const generatedByRetry = result.attemptNo > 1 ? 1 : 0;
          for (const [batchIndex, saved] of items.entries()) {
            assertImageJobExecutionIsActive(jobId, 0, 0);
            const imageIndex = imageIndexes[batchIndex] ?? imageIndexStart + batchIndex;
            const createdAt = now();
            run(
              appDb,
              `insert into images (
                id, user_id, session_id, job_id, job_image_index, path, prompt, kind, size, quality,
                provider_id, mime_type, parent_image_id,
                provider_file_id, provider_gen_id, provider_conversation_id, provider_parent_message_id, provider_source_account_id,
                image_width, image_height, image_file_size, generated_attempt_no, generated_by_retry, created_at
              ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              saved.id,
              user.id,
              sessionId,
              jobId,
              imageIndex,
              saved.file.path,
              imagePrompt,
              "edit",
              size,
              quality,
              result.provider.id,
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
            assertImageJobExecutionIsActive(jobId, 0, 0);
            savedImageIds.push(saved.id);
            insertMessage(user.id, sessionId, "assistant", "已完成图片编辑", saved.id, {
              mode: "edit",
              jobId,
              parentImageId: primarySourceImage?.id ?? null,
              sourceAssetIds,
              sourceReferenceIds,
              hasMask: Boolean(maskDataUrl),
              ...imageRequestMessageMetadata(imageOptions.payload),
              n: imageCount,
              imageIndex,
              imageTotal: imageCount,
              promptPlanMode: promptPlan.mode,
              ...revisionMetadata,
              ...branchMetadata
            });
            run(
              appDb,
              `update image_jobs set result_image_id = coalesce(result_image_id, ?), updated_at = ?
               where id = ? and status = ? and coalesce(manual_retry_count, 0) = 0 and coalesce(recovery_count, 0) = 0`,
              saved.id,
              now(),
              jobId,
              "running"
            );
            emitImageJobProgress(user.id, sessionId, jobId, "edit", imageCount);
          }
          if (items.length > 0) invalidateLibraryFacetCache("images");
        },
        signal: executionController.signal
      });
      responseJson = completion.responseJson;
      await applyImageFieldSuggestions(savedImageIds);
      await ensureImageEditSuggestionsForImages(user.id, savedImageIds, preparedEditSuggestions);
      const resultImageId = savedImageIds[0] ?? null;
      const succeededOnRetry = completion.autoRetryCount > 0 ? 1 : 0;
      const completed = run(
        appDb,
        `update image_jobs
         set status = ?, result_image_id = ?, response_json = ?, auto_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = ?, updated_at = ?
         where id = ? and status = ? and coalesce(manual_retry_count, 0) = 0 and coalesce(recovery_count, 0) = 0`,
        "succeeded",
        resultImageId,
        providerResponseSnapshot(responseJson),
        completion.autoRetryCount,
        completion.retryCount,
        succeededOnRetry,
        now(),
        jobId,
        "running"
      );
      if (Number(completed.changes ?? 0) > 0) {
        emitJobStatus(user.id, sessionId, jobId, "succeeded", "edit", { resultImageId });
      }
      return;
    } catch (error) {
      if (error instanceof ImageJobExecutionSupersededError || providerRequestWasCancelled(error, executionController.signal)) return;
      const detail = error instanceof Error ? error.message : "编辑失败";
      const message = incompleteImageCountMessage(imageCount, storedImageJobImagesById(jobId, user.id), detail);
      const responseJsonText = responseJson === null ? null : providerResponseSnapshot(responseJson);
      const failedAutoRetryCount = autoRetryCountFromError(error, maxAutoRetries);
      const failed = run(
        appDb,
        `update image_jobs
         set status = ?, error = ?, response_json = coalesce(?, response_json), auto_retry_count = ?, max_auto_retries = ?, succeeded_on_retry = 0, updated_at = ?
         where id = ? and status = ? and coalesce(manual_retry_count, 0) = 0 and coalesce(recovery_count, 0) = 0`,
        "failed",
        message,
        responseJsonText,
        failedAutoRetryCount,
        maxAutoRetries,
        now(),
        jobId,
        "running"
      );
      if (Number(failed.changes ?? 0) > 0) {
        emitJobStatus(user.id, sessionId, jobId, "failed", "edit", { error: message });
      }
      return;
    }
  };

  void runEditJob().catch((error) => {
    console.warn("图片编辑后台任务失败", error);
  }).finally(() => {
    finishImageJobExecution(jobId, executionController);
    clearImageJobCancelIntent(user.id, clientRequestId);
  });
  return c.json({ sessionId, job: runningJob ? serializeJob(runningJob) : null, image: null, images: [] }, 202);
});

api.post("/image-jobs/cancel", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const clientRequestId = requestClientRequestId(body);
  const requestedJobId = String(body.jobId ?? "").trim();
  if (!clientRequestId) return c.json({ error: "缺少请求标识" }, 400);
  cleanupExpiredImageJobCancelIntents();
  rememberImageJobCancelIntent(user.id, clientRequestId);

  const requestedJob = requestedJobId
    ? getOne<StoredImageJobRow & { client_request_id: string | null }>(
        appDb,
        "select * from image_jobs where id = ? and user_id = ? limit 1",
        requestedJobId,
        user.id
      )
    : null;
  if (requestedJob?.client_request_id && requestedJob.client_request_id !== clientRequestId) {
    clearImageJobCancelIntent(user.id, clientRequestId);
    return c.json({ error: "任务与请求标识不匹配，请刷新后重试" }, 409);
  }
  const job = requestedJob ?? getOne<StoredImageJobRow & { client_request_id: string | null }>(
    appDb,
    "select * from image_jobs where user_id = ? and client_request_id = ? order by created_at desc limit 1",
    user.id,
    clientRequestId
  );
  if (!job) {
    const pendingSession = getOne<{ id: string }>(
      appDb,
      "select id from sessions where user_id = ? and client_request_id = ? and deleted_at is null order by created_at desc limit 1",
      user.id,
      clientRequestId
    );
    await deleteImageJobArtifacts(user.id, "", clientRequestId);
    const sessionDeleted = pendingSession
      ? deleteRequestEmptySessionRecord(user.id, pendingSession.id, clientRequestId)
      : false;
    return c.json({
      cancelled: true,
      clientRequestId,
      jobId: requestedJobId || null,
      sessionId: pendingSession?.id ?? null,
      sessionDeleted,
      status: "cancelled"
    });
  }
  if (job.status === "succeeded" || job.status === "failed") {
    clearImageJobCancelIntent(user.id, clientRequestId);
    return c.json({ error: "任务已结束，无法取消", job: serializeJob(job) }, 409);
  }
  if (job.status === "cancelled") {
    await deleteImageJobArtifacts(user.id, job.id, clientRequestId);
    const sessionDeleted = job.session_id
      ? deleteCancelledEmptySessionRecord(user.id, job.session_id, clientRequestId)
      : false;
    clearImageJobCancelIntent(user.id, clientRequestId);
    return c.json({ cancelled: true, clientRequestId, jobId: job.id, sessionId: job.session_id, sessionDeleted, status: "cancelled" });
  }

  const cancelled = run(
    appDb,
    "update image_jobs set status = ?, error = null, result_image_id = null, updated_at = ? where id = ? and user_id = ? and status = ?",
    "cancelled",
    now(),
    job.id,
    user.id,
    "running"
  );
  if (Number(cancelled.changes ?? 0) === 0) {
    return c.json({ error: "任务状态已变化，请刷新后重试" }, 409);
  }
  abortImageJobExecution(job.id);
  await deleteImageJobArtifacts(user.id, job.id, clientRequestId);
  const sessionDeleted = job.session_id
    ? deleteCancelledEmptySessionRecord(user.id, job.session_id, clientRequestId)
    : false;
  clearImageJobCancelIntent(user.id, clientRequestId);
  emitJobStatus(user.id, job.session_id, job.id, "cancelled", job.type);
  return c.json({ cancelled: true, clientRequestId, jobId: job.id, sessionId: job.session_id, sessionDeleted, status: "cancelled" });
});

api.post("/image-jobs/:id/retry", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const job = getOne<StoredImageJobRow>(
    appDb,
    "select * from image_jobs where id = ? and user_id = ?",
    c.req.param("id"),
    user.id
  );
  if (!job) return c.json({ error: "任务不存在" }, 404);
  if (!job.session_id) return c.json({ error: "任务缺少对话信息，无法重试" }, 400);
  if (job.status === "running") return c.json({ error: "任务正在处理中" }, 409);
  if (job.status !== "failed") return c.json({ error: "只有失败的任务可以重试" }, 400);

  try {
    const { retrySessionId, runningJob, branchMetadata } = startStoredImageJob(job, "manual");
    return c.json({
      sessionId: retrySessionId,
      job: runningJob ? serializeJob({ ...runningJob, ...branchMetadata }) : null,
      image: null,
      images: []
    }, 202);
  } catch (error) {
    if (error instanceof ImageJobClaimError) {
      return c.json({ error: "任务正在处理中" }, 409);
    }
    return c.json({ error: errorMessage(error, "任务重试失败") }, 400);
  }
});

api.get("/image-jobs/:id", async (c) => {
  const user = await requireImageRouteUser(c);
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
