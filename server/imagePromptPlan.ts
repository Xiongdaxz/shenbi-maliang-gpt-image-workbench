import { logModelRequest } from "./auditLog";
import { resolveLanguageModelProvider } from "./languageModelAssignments";
import {
  fetchPromptOptimizerWithRetry,
  normalizePromptOptimizerRetryCount,
  promptOptimizerApiKey,
  promptOptimizerHeaders,
  type PromptOptimizerProviderRow
} from "./promptOptimizerRoutes";
import { normalizePath, safeJson } from "./utils";

const IMAGE_PROMPT_PLAN_VERSION = 1 as const;
const IMAGE_PROMPT_PLAN_TIMEOUT_MS = 45_000;
const MAX_PROMPT_PLAN_REASON_LENGTH = 500;

export type ImagePromptPlanMode = "shared" | "grouped" | "fallback_shared";

export type ImagePromptPlan = {
  version: typeof IMAGE_PROMPT_PLAN_VERSION;
  mode: ImagePromptPlanMode;
  requestedCount: number;
  detectedGroupCount: number;
  prompts: string[];
  fallbackReason?: string;
};

type PromptModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ImagePromptPlanRequest = {
  prompt: string;
  imageCount: number;
  taskType: "generation" | "edit";
  userId: string;
  jobId: string;
  signal?: AbortSignal;
};

type ImagePromptPlanModelRequest = (messages: PromptModelMessage[]) => Promise<string>;

function compactReason(value: unknown) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return Array.from(text.replace(/\s+/g, " ").trim()).slice(0, MAX_PROMPT_PLAN_REASON_LENGTH).join("");
}

export function fallbackImagePromptPlan(imageCount: number, reason: unknown = ""): ImagePromptPlan {
  return {
    version: IMAGE_PROMPT_PLAN_VERSION,
    mode: "fallback_shared",
    requestedCount: imageCount,
    detectedGroupCount: 0,
    prompts: [],
    ...(compactReason(reason) ? { fallbackReason: compactReason(reason) } : {})
  };
}

function stripJsonFence(value: string) {
  return value.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonObject(value: string) {
  const text = stripJsonFence(value);
  const direct = safeJson<unknown>(text, null);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct as Record<string, unknown>;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const clipped = safeJson<unknown>(text.slice(start, end + 1), null);
    if (clipped && typeof clipped === "object" && !Array.isArray(clipped)) return clipped as Record<string, unknown>;
  }
  throw new Error("多图提示词规划模型没有返回有效 JSON");
}

function promptValue(item: unknown) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  return String((item as Record<string, unknown>).prompt ?? "").trim();
}

function promptIndex(item: unknown, fallback: number) {
  if (!item || typeof item !== "object") return fallback;
  const value = Number((item as Record<string, unknown>).index);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export function parseImagePromptPlan(value: string, imageCount: number): ImagePromptPlan {
  const record = parseJsonObject(value);
  const mode = String(record.mode ?? "").trim().toLowerCase();
  const detectedGroupCountValue = Number(record.detectedGroupCount);
  const detectedGroupCount = Number.isFinite(detectedGroupCountValue)
    ? Math.max(0, Math.trunc(detectedGroupCountValue))
    : 0;

  if (mode === "shared") {
    return {
      version: IMAGE_PROMPT_PLAN_VERSION,
      mode: "shared",
      requestedCount: imageCount,
      detectedGroupCount,
      prompts: []
    };
  }
  if (mode !== "grouped") throw new Error("多图提示词规划模式必须是 shared 或 grouped");

  const rawPrompts = Array.isArray(record.prompts) ? record.prompts : [];
  if (rawPrompts.length !== imageCount) {
    throw new Error(`分组提示词数量不正确：期望 ${imageCount} 组，实际 ${rawPrompts.length} 组`);
  }
  const prompts = rawPrompts.map(promptValue);
  if (prompts.some((prompt) => !prompt)) throw new Error("分组提示词中存在空内容");
  const indexes = rawPrompts.map((item, index) => promptIndex(item, index + 1));
  if (indexes.some((value, index) => value !== index + 1)) throw new Error("分组提示词索引必须从 1 连续排列");
  const uniquePrompts = new Set(prompts.map((prompt) => prompt.replace(/\s+/g, " ").trim().toLocaleLowerCase()));
  if (uniquePrompts.size !== prompts.length) throw new Error("分组提示词不能重复");

  return {
    version: IMAGE_PROMPT_PLAN_VERSION,
    mode: "grouped",
    requestedCount: imageCount,
    detectedGroupCount,
    prompts
  };
}

function plannerSystemPrompt(imageCount: number, taskType: "generation" | "edit") {
  return [
    "你是多图生图任务的提示词规划器，只负责判断和拆分，不负责普通润色。",
    `当前任务类型是${taskType === "edit" ? "改图" : "文生图"}，接口参数要求最终生成 ${imageCount} 张图片。`,
    "判断用户是否已经针对不同图片分别给出了不同内容，例如图1/图2、图片一/图片二、按编号列出的不同画面。",
    "如果用户只是要求同一主题生成多张变体，没有逐图分配不同内容，返回 mode=shared、prompts=[]。",
    "如果用户已经逐图分配内容，返回 mode=grouped，并把提示词整理成恰好与接口参数一致的独立提示词。",
    `无论用户原文写了多少组，接口参数 ${imageCount} 都是最终数量。原始组数少时补充不同构图、角度或场景；原始组数多时合并相关意图，必须保留全部用户意图。`,
    "每个独立提示词都要包含适用的全局主体、风格、品牌、文字、比例和共同约束，但不能包含“生成多张”“分别生成”“图1”等调度包装。",
    "每组只描述一张独立完整图片，禁止拼图、分屏、四宫格，也不能在单组内再次要求输出多张图片。",
    "不得新增用户没有表达的品牌、人物身份、文字内容或硬性要求。",
    "只返回 JSON，不要 Markdown，不要解释。",
    `JSON 结构固定为 {"mode":"shared|grouped","detectedGroupCount":0,"prompts":[{"index":1,"prompt":"..."}]}；grouped 的 prompts 必须正好 ${imageCount} 项、索引从 1 连续排列且内容互不重复。`
  ].join("\n");
}

function initialPlannerMessages(input: ImagePromptPlanRequest): PromptModelMessage[] {
  return [
    { role: "system", content: plannerSystemPrompt(input.imageCount, input.taskType) },
    {
      role: "user",
      content: JSON.stringify({
        requestedImageCount: input.imageCount,
        taskType: input.taskType,
        originalPrompt: input.prompt
      }, null, 2)
    }
  ];
}

function repairPlannerMessages(input: ImagePromptPlanRequest, invalidOutput: string, validationError: unknown): PromptModelMessage[] {
  return [
    ...initialPlannerMessages(input),
    { role: "assistant", content: invalidOutput },
    {
      role: "user",
      content: `上一版输出校验失败：${compactReason(validationError)}。请严格按规定 JSON 结构修复，grouped 必须恰好输出 ${input.imageCount} 个非空且互不重复的提示词。`
    }
  ];
}

function shouldSendDeepSeekThinkingMode(provider: PromptOptimizerProviderRow) {
  return [provider.name, provider.base_url, provider.endpoint_path, provider.model]
    .some((value) => String(value ?? "").toLowerCase().includes("deepseek"));
}

function chatCompletionContent(data: unknown, fallbackText = "") {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    const choiceRecord = choice && typeof choice === "object" ? choice as Record<string, unknown> : {};
    const message = choiceRecord.message && typeof choiceRecord.message === "object" ? choiceRecord.message as Record<string, unknown> : {};
    const content = message.content ?? choiceRecord.text;
    if (typeof content === "string" && content.trim()) return content.trim();
  }
  return String(fallbackText ?? "").trim();
}

function streamFrameContent(frame: string) {
  let content = "";
  for (const rawLine of frame.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    const data = safeJson<unknown>(payload, null);
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const choices = Array.isArray(record.choices) ? record.choices : [];
    for (const choice of choices) {
      const choiceRecord = choice && typeof choice === "object" ? choice as Record<string, unknown> : {};
      const delta = choiceRecord.delta && typeof choiceRecord.delta === "object" ? choiceRecord.delta as Record<string, unknown> : {};
      const message = choiceRecord.message && typeof choiceRecord.message === "object" ? choiceRecord.message as Record<string, unknown> : {};
      const text = delta.content ?? message.content ?? choiceRecord.text;
      if (typeof text === "string") content += text;
    }
  }
  return content;
}

async function readStreamingChatCompletion(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        content += streamFrameContent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (done) break;
  }
  if (buffer.trim()) content += streamFrameContent(buffer);
  return content.trim();
}

function combinedTimeoutSignal(signal?: AbortSignal) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeoutId = setTimeout(() => controller.abort(new Error("多图提示词规划超时")), IMAGE_PROMPT_PLAN_TIMEOUT_MS);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  };
}

async function requestImagePromptPlanModel(
  provider: PromptOptimizerProviderRow,
  messages: PromptModelMessage[],
  input: Pick<ImagePromptPlanRequest, "userId" | "jobId" | "signal">
) {
  const endpoint = normalizePath(provider.base_url, provider.endpoint_path || "/chat/completions");
  const streamEnabled = Boolean(provider.stream_enabled);
  const maxTokens = Math.trunc(Number(provider.max_tokens ?? 0));
  const requestBody: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature: 0,
    ...(streamEnabled ? { stream: true } : {})
  };
  if (shouldSendDeepSeekThinkingMode(provider)) {
    requestBody.thinking = { type: (provider.thinking_enabled ?? 1) === 0 ? "disabled" : "enabled" };
  }
  if (maxTokens > 0) requestBody.max_tokens = maxTokens;

  const requestSignal = combinedTimeoutSignal(input.signal);
  const startedAt = Date.now();
  let attemptCount = 0;
  let statusCode: number | null = null;
  try {
    if (!promptOptimizerApiKey(provider)) throw new Error(`多图提示词规划模型「${provider.name}」缺少 API Key`);
    const response = await fetchPromptOptimizerWithRetry(provider, endpoint, {
      method: "POST",
      signal: requestSignal.signal,
      headers: {
        ...promptOptimizerHeaders(provider, streamEnabled ? "text/event-stream" : "application/json"),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    }, {
      onAttempt: (attemptNo) => {
        attemptCount = attemptNo;
      }
    });
    statusCode = response.status;
    if (!response.ok) {
      const text = await response.text();
      const data = safeJson<Record<string, unknown>>(text, {});
      const nestedError = data.error && typeof data.error === "object" ? data.error as Record<string, unknown> : null;
      throw new Error(String(nestedError?.message ?? data.message ?? text ?? response.statusText).trim() || "多图提示词规划模型请求失败");
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const content = streamEnabled && contentType.includes("text/event-stream")
      ? await readStreamingChatCompletion(response)
      : await response.text().then((text) => chatCompletionContent(safeJson<unknown>(text, null), text));
    if (!content.trim()) throw new Error("多图提示词规划模型没有返回内容");
    logModelRequest({
      purpose: "image.prompt_plan",
      providerId: provider.id,
      providerName: provider.name,
      model: provider.model,
      endpoint,
      method: "POST",
      streamEnabled,
      retryCount: normalizePromptOptimizerRetryCount(provider.retry_count),
      attemptCount,
      statusCode,
      durationMs: Date.now() - startedAt,
      success: true,
      userId: input.userId,
      jobId: input.jobId,
      source: "image.prompt_plan"
    });
    return content.trim();
  } catch (error) {
    logModelRequest({
      purpose: "image.prompt_plan",
      providerId: provider.id,
      providerName: provider.name,
      model: provider.model,
      endpoint,
      method: "POST",
      streamEnabled,
      retryCount: normalizePromptOptimizerRetryCount(provider.retry_count),
      attemptCount,
      statusCode,
      durationMs: Date.now() - startedAt,
      success: false,
      error,
      userId: input.userId,
      jobId: input.jobId,
      source: "image.prompt_plan"
    });
    throw error;
  } finally {
    requestSignal.dispose();
  }
}

export async function resolveImagePromptPlan(
  input: ImagePromptPlanRequest,
  requestModel?: ImagePromptPlanModelRequest
): Promise<ImagePromptPlan> {
  if (input.imageCount <= 1) {
    return {
      version: IMAGE_PROMPT_PLAN_VERSION,
      mode: "shared",
      requestedCount: input.imageCount,
      detectedGroupCount: 0,
      prompts: []
    };
  }
  const provider = requestModel ? null : resolveLanguageModelProvider("image.prompt_plan");
  if (!requestModel && !provider) return fallbackImagePromptPlan(input.imageCount, "没有可用的多图提示词规划模型");
  const execute = requestModel ?? ((messages: PromptModelMessage[]) => requestImagePromptPlanModel(provider!, messages, input));

  let firstOutput = "";
  try {
    firstOutput = await execute(initialPlannerMessages(input));
    return parseImagePromptPlan(firstOutput, input.imageCount);
  } catch (firstError) {
    if (input.signal?.aborted) throw firstError;
    if (!firstOutput) return fallbackImagePromptPlan(input.imageCount, firstError);
    try {
      const repairedOutput = await execute(repairPlannerMessages(input, firstOutput, firstError));
      return parseImagePromptPlan(repairedOutput, input.imageCount);
    } catch (repairError) {
      if (input.signal?.aborted) throw repairError;
      return fallbackImagePromptPlan(input.imageCount, repairError);
    }
  }
}

export function storedImagePromptPlan(value: unknown, imageCount: number) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (Number(record.version) !== IMAGE_PROMPT_PLAN_VERSION) return null;
  const mode = String(record.mode ?? "");
  if (mode === "shared" || mode === "fallback_shared") {
    return {
      version: IMAGE_PROMPT_PLAN_VERSION,
      mode,
      requestedCount: imageCount,
      detectedGroupCount: Math.max(0, Math.trunc(Number(record.detectedGroupCount) || 0)),
      prompts: [],
      ...(String(record.fallbackReason ?? "").trim() ? { fallbackReason: compactReason(record.fallbackReason) } : {})
    } satisfies ImagePromptPlan;
  }
  if (mode !== "grouped") return null;
  try {
    return parseImagePromptPlan(JSON.stringify(record), imageCount);
  } catch {
    return null;
  }
}
