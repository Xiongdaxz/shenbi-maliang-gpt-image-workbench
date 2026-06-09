import type { Hono } from "hono";
import { audit, logModelRequest } from "./auditLog";
import { requireConfig } from "./auth";
import { appDb, configDb, getAll, getOne, run } from "./db";
import { globalSwitchEnabled, saveGlobalSwitch } from "./globalSwitches";
import {
  fetchPromptOptimizerWithRetry,
  normalizePromptOptimizerRetryCount,
  promptOptimizerApiKey,
  promptOptimizerHeaders,
  type PromptOptimizerProviderRow
} from "./promptOptimizerRoutes";
import { makeId, normalizePath, now, safeJson } from "./utils";

type SafetyReviewDecision = "allow" | "review" | "block";
type SafetyReviewFailurePolicy = "allow" | "block";
type SafetyReviewScene = "image_generation" | "image_edit";

type SafetyReviewSettingsRow = {
  id: string;
  enabled: number;
  failure_policy: string;
  block_message: string;
  updated_at: string;
};

type SafetyReviewLogRow = {
  id: string;
  user_id: string;
  session_id: string;
  job_id: string;
  scene: string;
  prompt_excerpt: string;
  decision: string;
  risk_level: string;
  categories_json: string;
  confidence: number | null;
  reason: string;
  matched_text_json: string;
  suggested_action: string;
  action: string;
  provider_id: string;
  provider_name: string;
  duration_ms: number;
  error: string | null;
  created_at: string;
  username?: string | null;
  account?: string | null;
};

type PromptModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ModelRequestLogContext = {
  userId?: string;
  jobId?: string;
  source?: string;
};

type SafetyReviewResult = {
  decision: SafetyReviewDecision;
  riskLevel: "none" | "low" | "medium" | "high";
  categories: string[];
  confidence: number;
  reason: string;
  matchedText: string[];
  suggestedAction: "continue" | "manual_review" | "reject";
};

const DEFAULT_BLOCK_MESSAGE = "当前提示词可能存在安全风险，请调整后再试。";
const SAFETY_REVIEW_TIMEOUT_MS = 45 * 1000;
const SAFETY_REVIEW_LOG_LIMIT = 100;
const SAFETY_REVIEW_CATEGORIES = new Set([
  "safe",
  "sexual",
  "violence",
  "self_harm",
  "hate",
  "illegal",
  "privacy",
  "copyright_public_figure",
  "political_sensitive",
  "medical_financial_legal"
]);

const SAFETY_REVIEW_SYSTEM_PROMPT = `你是图片生成平台的文本安全合规审核器。你的任务是审核用户提交的图片生成提示词是否适合继续用于图片生成或图片编辑。

你必须只输出 JSON，不要输出 Markdown，不要解释规则，不要给用户建议，不要改写输入文本。

审核原则：
1. 区分创作、教育、新闻、历史、讽刺、虚构场景和真实违法/伤害请求。
2. 对未成年人性内容、明确违法教程、真实个人隐私泄露、严重暴力血腥、自残诱导、仇恨煽动应判定 block。
3. 对可能涉及版权角色、在世公众人物、商标品牌复刻、敏感政治传播、医疗金融法律误导、轻度成人暗示或不确定风险，应判定 review。
4. 对普通审美、风格、构图、商业海报、产品图、人像、头像、插画、壁纸等正常图片生成请求，应判定 allow。
5. 如果输入为空、只有无意义字符或无法判断，判定 review。
6. 不要因为出现“美女、人像、泳装、战争、医生、律师、股票”等词就直接拦截；必须结合具体意图和风险程度判断。

输出 JSON 格式：
{
  "decision": "allow" | "review" | "block",
  "riskLevel": "none" | "low" | "medium" | "high",
  "categories": ["safe" | "sexual" | "violence" | "self_harm" | "hate" | "illegal" | "privacy" | "copyright_public_figure" | "political_sensitive" | "medical_financial_legal"],
  "confidence": 0.0,
  "reason": "不超过60字的中文原因",
  "matchedText": ["命中的关键短语，最多5条"],
  "suggestedAction": "continue" | "manual_review" | "reject"
}`;

function normalizeFailurePolicy(value: unknown): SafetyReviewFailurePolicy {
  return String(value ?? "").trim() === "block" ? "block" : "allow";
}

function normalizeSettings(row: SafetyReviewSettingsRow | null) {
  return {
    enabled: globalSwitchEnabled("prompt_safety_review"),
    failurePolicy: normalizeFailurePolicy(row?.failure_policy),
    blockMessage: String(row?.block_message ?? "").trim() || DEFAULT_BLOCK_MESSAGE,
    updatedAt: row?.updated_at ?? ""
  };
}

export function safetyReviewSettings() {
  const row = getOne<SafetyReviewSettingsRow>(configDb, "select * from safety_review_settings where id = ?", "default");
  return normalizeSettings(row);
}

export function saveSafetyReviewSettings(input: Record<string, unknown>) {
  const timestamp = now();
  const settings = {
    enabled: Boolean(input.enabled),
    failurePolicy: normalizeFailurePolicy(input.failurePolicy),
    blockMessage: String(input.blockMessage ?? "").trim() || DEFAULT_BLOCK_MESSAGE
  };
  run(
    configDb,
    `insert into safety_review_settings (id, enabled, failure_policy, block_message, updated_at)
     values (?, ?, ?, ?, ?)
     on conflict(id) do update set
       enabled = excluded.enabled,
       failure_policy = excluded.failure_policy,
       block_message = excluded.block_message,
       updated_at = excluded.updated_at`,
    "default",
    settings.enabled ? 1 : 0,
    settings.failurePolicy,
    settings.blockMessage,
    timestamp
  );
  saveGlobalSwitch("prompt_safety_review", settings.enabled);
  return { ...settings, updatedAt: timestamp };
}

function truncateText(value: string, maxLength: number) {
  const chars = Array.from(value);
  return chars.length <= maxLength ? value : `${chars.slice(0, maxLength).join("")}...`;
}

function stripJsonFence(value: string) {
  return value.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonObjectText(value: string) {
  const text = stripJsonFence(value);
  const direct = safeJson<unknown>(text, null);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct as Record<string, unknown>;
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const clipped = text.slice(firstBrace, lastBrace + 1);
    const parsed = safeJson<unknown>(clipped, null);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  }
  throw new Error("审核模型没有返回有效 JSON");
}

function normalizeDecision(value: unknown): SafetyReviewDecision {
  const normalized = String(value ?? "").trim();
  if (normalized === "review" || normalized === "block") return normalized;
  return "allow";
}

function normalizeRiskLevel(value: unknown, decision: SafetyReviewDecision): SafetyReviewResult["riskLevel"] {
  const normalized = String(value ?? "").trim();
  if (normalized === "low" || normalized === "medium" || normalized === "high") return normalized;
  return decision === "block" ? "high" : decision === "review" ? "medium" : "none";
}

function normalizeCategories(value: unknown, decision: SafetyReviewDecision) {
  const categories = Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter((item) => SAFETY_REVIEW_CATEGORIES.has(item))
    : [];
  if (categories.length > 0) return Array.from(new Set(categories));
  return decision === "allow" ? ["safe"] : [];
}

function normalizeStringList(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeSuggestedAction(value: unknown, decision: SafetyReviewDecision): SafetyReviewResult["suggestedAction"] {
  const normalized = String(value ?? "").trim();
  if (normalized === "manual_review" || normalized === "reject" || normalized === "continue") return normalized;
  if (decision === "block") return "reject";
  if (decision === "review") return "manual_review";
  return "continue";
}

function parseSafetyReviewResult(content: string): SafetyReviewResult {
  const record = parseJsonObjectText(content);
  const decision = normalizeDecision(record.decision);
  const confidence = Number(record.confidence);
  return {
    decision,
    riskLevel: normalizeRiskLevel(record.riskLevel, decision),
    categories: normalizeCategories(record.categories, decision),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    reason: truncateText(String(record.reason ?? "").trim(), 60),
    matchedText: normalizeStringList(record.matchedText, 5).map((item) => truncateText(item, 80)),
    suggestedAction: normalizeSuggestedAction(record.suggestedAction, decision)
  };
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
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        content += streamFrameContent(frame);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (done) break;
  }
  if (buffer.trim()) content += streamFrameContent(buffer);
  return content.trim();
}

function timeoutSignal(ms = SAFETY_REVIEW_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return { controller, timeoutId };
}

async function requestSafetyReviewModel(provider: PromptOptimizerProviderRow, messages: PromptModelMessage[], logContext: ModelRequestLogContext) {
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

  const { controller, timeoutId } = timeoutSignal();
  const startedAt = Date.now();
  let attemptCount = 0;
  let statusCode: number | null = null;
  try {
    if (!promptOptimizerApiKey(provider)) throw new Error(`审核模型「${provider.name}」缺少 API Key`);
    const response = await fetchPromptOptimizerWithRetry(provider, endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...promptOptimizerHeaders(provider, streamEnabled ? "text/event-stream" : "application/json"),
        "Content-Type": "application/json",
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
      throw new Error(String(nestedError?.message ?? data.message ?? text ?? response.statusText).trim() || "审核模型请求失败");
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    let content = "";
    if (streamEnabled && contentType.includes("text/event-stream")) {
      content = await readStreamingChatCompletion(response);
    } else {
      const text = await response.text();
      content = chatCompletionContent(safeJson<unknown>(text, null), text);
    }
    logModelRequest({
      purpose: "safety.review",
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
      ...logContext
    });
    return content;
  } catch (error) {
    logModelRequest({
      purpose: "safety.review",
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
      ...logContext
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function activeSafetyReviewProvider() {
  return getOne<PromptOptimizerProviderRow>(
    configDb,
    "select * from prompt_optimizer_providers where enabled = 1 order by sort_order asc, created_at asc limit 1"
  );
}

function safetyReviewUserMessage(scene: SafetyReviewScene, prompt: string) {
  return [
    `审核场景：${scene}`,
    "用户提示词：",
    prompt
  ].join("\n");
}

function insertSafetyReviewLog(input: {
  userId: string;
  sessionId?: string;
  jobId?: string;
  scene: SafetyReviewScene;
  prompt: string;
  result?: SafetyReviewResult;
  action: string;
  provider?: PromptOptimizerProviderRow | null;
  durationMs: number;
  error?: string;
}) {
  const result = input.result;
  const logId = makeId("safety");
  run(
    configDb,
    `insert into safety_review_logs (
      id, user_id, session_id, job_id, scene, prompt_excerpt,
      decision, risk_level, categories_json, confidence, reason, matched_text_json,
      suggested_action, action, provider_id, provider_name, duration_ms, error, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    logId,
    input.userId,
    input.sessionId ?? "",
    input.jobId ?? "",
    input.scene,
    truncateText(input.prompt, 120),
    result?.decision ?? "",
    result?.riskLevel ?? "",
    JSON.stringify(result?.categories ?? []),
    result?.confidence ?? null,
    result?.reason ?? "",
    JSON.stringify(result?.matchedText ?? []),
    result?.suggestedAction ?? "",
    input.action,
    input.provider?.id ?? "",
    input.provider?.name ?? "",
    Math.max(0, Math.round(input.durationMs)),
    input.error ?? null,
    now()
  );
  return logId;
}

export async function reviewConversationPrompt(input: {
  userId: string;
  sessionId?: string;
  jobId?: string;
  scene: SafetyReviewScene;
  prompt: string;
}) {
  const settings = safetyReviewSettings();
  if (!settings.enabled) return { enabled: false, blocked: false };
  const startedAt = Date.now();
  let provider: PromptOptimizerProviderRow | null = null;
  try {
    provider = activeSafetyReviewProvider();
    if (!provider) throw new Error("请先在配置页启用模型配置");
    const content = await requestSafetyReviewModel(provider, [
      { role: "system", content: SAFETY_REVIEW_SYSTEM_PROMPT },
      { role: "user", content: safetyReviewUserMessage(input.scene, input.prompt) }
    ], { userId: input.userId, jobId: input.jobId, source: input.scene });
    const result = parseSafetyReviewResult(content);
    const action = result.decision === "block" ? "block" : result.decision === "review" ? "record" : "allow";
    const logId = insertSafetyReviewLog({
      ...input,
      result,
      action,
      provider,
      durationMs: Date.now() - startedAt
    });
    return {
      enabled: true,
      blocked: result.decision === "block",
      message: result.decision === "block" ? settings.blockMessage : "",
      result,
      logId
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "提示词审核失败";
    const blocked = settings.failurePolicy === "block";
    const logId = insertSafetyReviewLog({
      ...input,
      action: blocked ? "failure_block" : "failure_allow",
      provider,
      durationMs: Date.now() - startedAt,
      error: message
    });
    return {
      enabled: true,
      blocked,
      message: blocked ? settings.blockMessage : "",
      error: message,
      logId
    };
  }
}

function publicSafetyReviewLog(row: SafetyReviewLogRow) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username ?? "",
    account: row.account ?? "",
    sessionId: row.session_id,
    jobId: row.job_id,
    scene: row.scene,
    promptExcerpt: row.prompt_excerpt,
    decision: row.decision,
    riskLevel: row.risk_level,
    categories: safeJson<string[]>(row.categories_json, []),
    confidence: row.confidence == null ? null : Number(row.confidence),
    reason: row.reason,
    matchedText: safeJson<string[]>(row.matched_text_json, []),
    suggestedAction: row.suggested_action,
    action: row.action,
    providerId: row.provider_id,
    providerName: row.provider_name,
    durationMs: Number(row.duration_ms ?? 0),
    error: row.error ?? "",
    createdAt: row.created_at
  };
}

function recentSafetyReviewLogs() {
  const rows = getAll<SafetyReviewLogRow>(
    configDb,
    `select *
     from safety_review_logs
     order by created_at desc, rowid desc
     limit ?`,
    SAFETY_REVIEW_LOG_LIMIT
  );
  const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)));
  const users = userIds.length > 0
    ? getAll<{ id: string; username: string; account: string }>(
        appDb,
        `select id, username, account from users where id in (${userIds.map(() => "?").join(", ")})`,
        ...userIds
      )
    : [];
  const userById = new Map(users.map((user) => [user.id, user]));
  return rows.map((row) => publicSafetyReviewLog({ ...row, ...userById.get(row.user_id) }));
}

export function registerSafetyReviewRoutes(api: Hono) {
  api.get("/config/safety-review", (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    return c.json({
      settings: safetyReviewSettings(),
      logs: recentSafetyReviewLogs()
    });
  });

  api.put("/config/safety-review", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const body = await c.req.json().catch(() => ({}));
    const settings = saveSafetyReviewSettings(body as Record<string, unknown>);
    audit("safety_review.save", { enabled: settings.enabled, failurePolicy: settings.failurePolicy });
    return c.json({
      settings,
      logs: recentSafetyReviewLogs()
    });
  });
}
