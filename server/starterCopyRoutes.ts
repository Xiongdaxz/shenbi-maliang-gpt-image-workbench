import type { Hono } from "hono";
import { audit, logModelRequest } from "./auditLog";
import { requireConfig, requireUser } from "./auth";
import { appDb, configDb, getAll, getOne, run } from "./db";
import { globalSwitchEnabled, saveGlobalSwitch } from "./globalSwitches";
import {
  fetchPromptOptimizerWithRetry,
  normalizePromptOptimizerRetryCount,
  promptOptimizerApiKey,
  promptOptimizerHeaders,
  type PromptOptimizerProviderRow
} from "./promptOptimizerRoutes";
import { normalizePath, now, safeJson } from "./utils";

type StarterCopySettingsRow = {
  id: string;
  enabled: number;
  copy_count: number;
  updated_at: string;
};

type StarterDailyCopyRow = {
  date: string;
  copies_json: string;
  copies_en_json: string;
  source: string;
  provider_name: string;
  model: string;
  status: string;
  error: string;
  generated_at: string;
  created_at: string;
  updated_at: string;
};

type PromptModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const SETTINGS_ID = "default";
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STARTER_COPY_RUN_MINUTE = 5;
const DEFAULT_STARTER_COPY_COUNT = 50;
const MIN_STARTER_COPY_COUNT = 0;
const MAX_STARTER_COPY_COUNT = 100;
const MAX_STARTER_COPY_GENERATION_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 60 * 1000;
const COPY_RELEVANCE_KEYWORDS = [
  "图",
  "海报",
  "商品",
  "产品",
  "头像",
  "插画",
  "画面",
  "镜头",
  "构图",
  "光影",
  "风格",
  "视觉",
  "素材",
  "人像",
  "壁纸",
  "封面",
  "设计",
  "UI",
  "ui",
  "界面",
  "办公",
  "职场",
  "销售",
  "人事",
  "招聘",
  "业务",
  "客户",
  "汇报",
  "简报",
  "PPT",
  "ppt",
  "流程",
  "方案",
  "名片",
  "展业",
  "日常",
  "生活",
  "社交",
  "朋友圈",
  "小红书",
  "生日",
  "聚会",
  "邀请",
  "旅行",
  "旅游",
  "宠物",
  "家庭",
  "亲子",
  "节日",
  "祝福",
  "菜谱",
  "美食",
  "穿搭",
  "家居",
  "婚礼",
  "请柬",
  "社群",
  "表情包",
  "Logo",
  "logo",
  "照片",
  "摄影"
];
const COPY_END_PUNCTUATION_RE = /[。！？!…]$/;
const ENGLISH_COPY_END_PUNCTUATION_RE = /[.!?…]$/;

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let generationPromise: Promise<StarterDailyCopyRow | null> | null = null;

function starterCopySettingsRow() {
  return getOne<StarterCopySettingsRow>(configDb, "select id, enabled, copy_count, updated_at from starter_copy_settings where id = ?", SETTINGS_ID);
}

function normalizeCopyCount(value: unknown) {
  const count = Number(value);
  if (!Number.isFinite(count)) return DEFAULT_STARTER_COPY_COUNT;
  return Math.max(MIN_STARTER_COPY_COUNT, Math.min(MAX_STARTER_COPY_COUNT, Math.trunc(count)));
}

function publicStarterCopySettings(row: StarterCopySettingsRow) {
  return {
    enabled: globalSwitchEnabled("starter_copy_generation"),
    copyCount: normalizeCopyCount(row.copy_count),
    updatedAt: row.updated_at
  };
}

function starterCopyLocale(value: unknown): "zh" | "en" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "zh";
  return normalized.startsWith("zh") ? "zh" : "en";
}

function starterCopyList(value: string) {
  return safeJson<string[]>(value, [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function starterChineseCopies(row: StarterDailyCopyRow) {
  return starterCopyList(row.copies_json);
}

function starterEnglishCopies(row: StarterDailyCopyRow) {
  return starterCopyList(row.copies_en_json);
}

function publicStarterDailyCopy(row: StarterDailyCopyRow | null, locale: "zh" | "en" = "zh") {
  if (!row || row.status !== "success") return null;
  const copiesZh = starterChineseCopies(row);
  const copiesEn = starterEnglishCopies(row);
  return {
    date: row.date,
    copies: locale === "en" ? copiesEn : copiesZh,
    copiesZh,
    copiesEn,
    locale,
    source: row.source,
    generatedAt: row.generated_at,
    providerName: row.provider_name,
    model: row.model
  };
}

function publicStarterDailyCopyStatus(row: StarterDailyCopyRow | null) {
  if (!row) return null;
  const base = publicStarterDailyCopy(row) ?? {
    date: row.date,
    copies: [],
    copiesZh: starterCopyList(row.copies_json),
    copiesEn: starterCopyList(row.copies_en_json),
    locale: "zh" as const,
    source: row.source,
    generatedAt: row.generated_at,
    providerName: row.provider_name,
    model: row.model
  };
  return {
    ...base,
    status: row.status,
    error: row.error,
    updatedAt: row.updated_at
  };
}

function shanghaiParts(date = new Date()) {
  const shanghaiDate = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shanghaiDate.getUTCFullYear(),
    month: shanghaiDate.getUTCMonth() + 1,
    day: shanghaiDate.getUTCDate()
  };
}

function shanghaiDateString(date = new Date()) {
  const parts = shanghaiParts(date);
  return [
    String(parts.year),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
}

function nextShanghaiRunDelay(date = new Date()) {
  const parts = shanghaiParts(date);
  const dayStartUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day) - SHANGHAI_OFFSET_MS;
  let targetUtcMs = dayStartUtcMs + STARTER_COPY_RUN_MINUTE * 60 * 1000;
  if (targetUtcMs <= date.getTime() + 1000) targetUtcMs += DAY_MS;
  return Math.max(1000, targetUtcMs - date.getTime());
}

function timeoutSignal(ms = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return { controller, timeoutId };
}

function chatContentText(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return item;
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return String(record.text ?? record.content ?? "").trim();
    }).join("");
  }
  return "";
}

function chatCompletionContent(data: unknown, fallbackText = "") {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === "object" ? first.message as Record<string, unknown> : {};
  return chatContentText(message.content ?? first.text).trim() || fallbackText.trim();
}

function streamFrameContent(frame: string) {
  let content = "";
  const payloads = frame
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  for (const payload of payloads) {
    try {
      const data = JSON.parse(payload);
      const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
      const choices = Array.isArray(record.choices) ? record.choices : [];
      for (const choiceValue of choices) {
        const choice = choiceValue && typeof choiceValue === "object" ? choiceValue as Record<string, unknown> : {};
        const delta = choice.delta && typeof choice.delta === "object" ? choice.delta as Record<string, unknown> : {};
        content += chatContentText(delta.content ?? choice.text);
      }
    } catch {
      // Keep-alive and partial stream frames are ignored until complete JSON arrives.
    }
  }
  return content;
}

async function readStreamingChatCompletion(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      content += streamFrameContent(frame);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) content += streamFrameContent(buffer);
  return content.trim();
}

function shouldSendDeepSeekThinkingMode(provider: PromptOptimizerProviderRow) {
  return [provider.name, provider.base_url, provider.endpoint_path, provider.model]
    .some((value) => String(value ?? "").toLowerCase().includes("deepseek"));
}

async function requestPromptModelText(provider: PromptOptimizerProviderRow, messages: PromptModelMessage[]) {
  const envKey = String(provider.api_key_env ?? "").trim();
  const endpoint = normalizePath(provider.base_url, provider.endpoint_path || "/chat/completions");
  const streamEnabled = Boolean(provider.stream_enabled);
  const maxTokens = Math.trunc(Number(provider.max_tokens ?? 0));
  const requestBody: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature: provider.temperature == null ? 0.86 : Number(provider.temperature),
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
    if (!promptOptimizerApiKey(provider)) {
      throw new Error(`提示词优化模型「${provider.name}」缺少 API Key，请在配置页填写密钥或环境变量 ${envKey || "API_KEY"}`);
    }
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
      throw new Error(String(nestedError?.message ?? data.message ?? text ?? response.statusText).trim() || "每日文案模型请求失败");
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (streamEnabled && contentType.includes("text/event-stream")) {
      const content = await readStreamingChatCompletion(response);
      logModelRequest({
        purpose: "starter.copy",
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
        source: "starter-copy"
      });
      return content;
    }
    const text = await response.text();
    const content = chatCompletionContent(safeJson<unknown>(text, null), text);
    logModelRequest({
      purpose: "starter.copy",
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
      source: "starter-copy"
    });
    return content;
  } catch (error) {
    logModelRequest({
      purpose: "starter.copy",
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
      source: "starter-copy"
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function stripJsonFence(value: string) {
  return value.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeCopy(value: unknown) {
  return String(value ?? "")
    .replace(/^[\s"'“”‘’`*#\-•\d.、)）]+/, "")
    .replace(/["'“”‘’`]+$/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeEnglishCopy(value: unknown) {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    value = record.en ?? record.english ?? record.text ?? record.copy ?? record.translation ?? "";
  }
  return String(value ?? "")
    .replace(/^[\s"'“”‘’`*#\-•\d.、)）]+/, "")
    .replace(/["'“”‘’`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function copyWithEndingPunctuation(value: string) {
  return COPY_END_PUNCTUATION_RE.test(value) ? value : `${value}。`;
}

function englishCopyWithEndingPunctuation(value: string) {
  return ENGLISH_COPY_END_PUNCTUATION_RE.test(value) ? value : `${value}.`;
}

function collectValidCopies(candidates: unknown[], copyCount: number, existingCopies: string[] = []) {
  const seen = new Set(
    existingCopies
      .map((item) => copyWithEndingPunctuation(normalizeCopy(item)))
      .filter(Boolean)
  );
  const copies: string[] = [];
  for (const candidate of candidates) {
    const copy = copyWithEndingPunctuation(normalizeCopy(candidate));
    if (copy.length < 4 || copy.length > 42) continue;
    if (/https?:\/\//i.test(copy) || /根据|新闻|报道|文章|链接|趋势|热点/.test(copy)) continue;
    if (!COPY_RELEVANCE_KEYWORDS.some((keyword) => copy.includes(keyword))) continue;
    if (seen.has(copy)) continue;
    seen.add(copy);
    copies.push(copy);
    if (copies.length >= copyCount) break;
  }
  return copies;
}

function collectEnglishCopies(candidates: unknown[], copyCount: number) {
  const seen = new Set<string>();
  const copies: string[] = [];
  for (const candidate of candidates) {
    const copy = englishCopyWithEndingPunctuation(normalizeEnglishCopy(candidate));
    if (copy.length < 6 || copy.length > 120) continue;
    if (/[\u3400-\u9fff]/.test(copy)) continue;
    if (seen.has(copy.toLowerCase())) continue;
    seen.add(copy.toLowerCase());
    copies.push(copy);
    if (copies.length >= copyCount) break;
  }
  return copies;
}

function collectStoredCopies(candidates: unknown[], copyCount: number, existingCopies: string[] = []) {
  const seen = new Set(
    existingCopies
      .map((item) => copyWithEndingPunctuation(normalizeCopy(item)))
      .filter(Boolean)
  );
  const copies: string[] = [];
  for (const candidate of candidates) {
    const copy = copyWithEndingPunctuation(normalizeCopy(candidate));
    if (copy.length < 4) continue;
    if (seen.has(copy)) continue;
    seen.add(copy);
    copies.push(copy);
    if (copies.length >= copyCount) break;
  }
  return copies;
}

function starterCopyHistory(date: string) {
  const rows = getAll<{ copies_json: string }>(
    appDb,
    `select copies_json
     from starter_daily_copies
     where status = ? and date <= ?
     order by date desc, generated_at desc
     limit 8`,
    "success",
    date
  );
  return collectStoredCopies(rows.flatMap((row) => safeJson<unknown[]>(row.copies_json, [])), MAX_STARTER_COPY_COUNT);
}

function parseGeneratedCopies(content: string, copyCount: number, existingCopies: string[] = []) {
  const stripped = stripJsonFence(content);
  const candidates: unknown[] = [];
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) candidates.push(...parsed);
    else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).copies)) {
      candidates.push(...((parsed as Record<string, unknown>).copies as unknown[]));
    }
  } catch {
    const jsonMatch = stripped.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) candidates.push(...parsed);
        else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).copies)) {
          candidates.push(...((parsed as Record<string, unknown>).copies as unknown[]));
        }
      } catch {
        // Fall through to line parsing.
      }
    }
  }
  if (candidates.length === 0) candidates.push(...stripped.split(/\r?\n/));
  return collectValidCopies(candidates, copyCount, existingCopies);
}

function parseTranslatedCopies(content: string, copyCount: number) {
  const stripped = stripJsonFence(content);
  const candidates: unknown[] = [];
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) candidates.push(...parsed);
    else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).copies)) {
      candidates.push(...((parsed as Record<string, unknown>).copies as unknown[]));
    }
  } catch {
    const jsonMatch = stripped.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) candidates.push(...parsed);
        else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).copies)) {
          candidates.push(...((parsed as Record<string, unknown>).copies as unknown[]));
        }
      } catch {
        // Fall through to line parsing.
      }
    }
  }
  if (candidates.length === 0) candidates.push(...stripped.split(/\r?\n/));
  const copies = collectEnglishCopies(candidates, copyCount);
  if (copies.length < copyCount) {
    throw new Error(`英文每日文案翻译失败：需要 ${copyCount} 条，实际 ${copies.length} 条`);
  }
  return copies;
}

async function generateCopyBatchWithProvider(provider: PromptOptimizerProviderRow, copyCount: number, existingCopies: string[] = []) {
  const content = await requestPromptModelText(provider, [
    {
      role: "system",
      content: [
        "你是 GPT 图像工作台的空白页文案编辑。",
        `请生成 ${copyCount} 条中文互动文案，用在 AI 生图工作台的新对话空白页。`,
        "每条都要能直接启发用户开始生成图片，方向可以覆盖海报、商品图、头像、人像、插画、封面、壁纸、Logo、摄影、图像编辑、素材组合、构图、镜头、光影和风格。",
        "请增加更专业、更适合办公和职场的生图场景，例如 UI 设计、产品界面、销售物料、客户拜访图、人事招聘、培训海报、业务员展业、会议汇报、PPT 封面、流程说明、方案配图、企业宣传和团队文化视觉。",
        "也要覆盖轻松的日常使用和社交分享场景，例如朋友圈配图、小红书封面、生日祝福、聚会邀请、旅行攻略、宠物写真、家庭纪念、亲子活动、美食菜单、穿搭家居、婚礼请柬、节日问候、表情包和社群活动视觉。",
        "整体场景要多样均衡，不要全部偏办公和职场；要让用户看到不同生活、工作、社交和个人兴趣里的生图可能。",
        "文案要短、自然、有邀请感；不要追新闻，不要提热点，不要讲趋势，不要营销腔。",
        "每条要贴近真实创作场景，能洞察用户可能要做图的需求，真实有趣、生动具体，并激发想法、创意和生图兴趣。",
        "办公类文案要像真实工作需求，日常类文案要像真实生活灵感，都不要写成空泛口号；可以具体到部门、岗位、客户沟通、汇报展示、社交分享、家庭记录或兴趣创作。",
        "每条 12 到 28 个中文字符左右，不要写成固定问句或反问句模板。",
        "每条结尾必须带一个自然的标点符号，优先使用「。」或「！」，不要统一使用问号。",
        `必须返回刚好 ${copyCount} 条有效文案，copies 数组长度必须等于 ${copyCount}；不要少写、不要合并、不要省略。`,
        existingCopies.length > 0 ? "不要重复已生成文案，也不要只替换标点制造重复。" : "",
        "只输出 JSON，格式为 {\"copies\":[\"...\"]}，不要 Markdown，不要解释。"
      ].filter(Boolean).join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        date: shanghaiDateString(),
        copyCount,
        existingCopies,
        product: "AI 图片生成工作台",
        outputRules: {
          imageGenerationRelated: true,
          concise: true,
          noNews: true,
          noTrendTalk: true,
          realScene: true,
          interesting: true,
          vivid: true,
          professionalWorkScenes: true,
          dailySocialScenes: true,
          diverseSceneMix: true,
          endingPunctuation: true
        }
      })
    }
  ]);
  return parseGeneratedCopies(content, copyCount, existingCopies);
}

async function translateCopiesWithProvider(provider: PromptOptimizerProviderRow, copies: string[]) {
  if (copies.length === 0) return [];
  const content = await requestPromptModelText(provider, [
    {
      role: "system",
      content: [
        "你是 GPT 图像工作台的双语产品文案编辑。",
        `请把 ${copies.length} 条中文空白页互动文案翻译成英文，用在非中文界面的 AI 生图工作台空白页。`,
        "必须先忠实保留原意，再把表达调整成自然、简洁、有邀请感的英文 UI 文案。",
        "必须保持与输入完全相同的顺序和数量，一条中文对应一条英文。",
        "不要添加编号、引号之外的说明、Markdown 或额外字段。",
        "每条 5 到 14 个英文单词左右；不要出现中文字符；结尾使用自然英文标点。",
        `必须返回刚好 ${copies.length} 条有效文案，copies 数组长度必须等于 ${copies.length}。`,
        "只输出 JSON，格式为 {\"copies\":[\"...\"]}，不要解释。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        sourceLanguage: "zh-CN",
        targetLanguage: "en-US",
        copies
      })
    }
  ]);
  return parseTranslatedCopies(content, copies.length);
}

async function generateCopiesWithProvider(provider: PromptOptimizerProviderRow, copyCount: number, fallbackCopies: string[] = []) {
  let copies: string[] = [];
  for (let attempt = 0; attempt < MAX_STARTER_COPY_GENERATION_ATTEMPTS && copies.length < copyCount; attempt += 1) {
    const remainingCount = copyCount - copies.length;
    const requestCount = Math.min(MAX_STARTER_COPY_COUNT, Math.max(remainingCount, Math.min(4, copyCount)));
    const generatedCopies = await generateCopyBatchWithProvider(provider, requestCount, copies);
    if (generatedCopies.length === 0) continue;
    copies = [...copies, ...generatedCopies].slice(0, copyCount);
  }
  if (copies.length < copyCount) {
    const historicalCopies = collectStoredCopies(fallbackCopies, copyCount - copies.length, copies);
    copies = [...copies, ...historicalCopies].slice(0, copyCount);
  }
  if (copies.length < copyCount) {
    throw new Error(`每日文案补齐失败：需要 ${copyCount} 条，实际 ${copies.length} 条，历史文案不足`);
  }
  return copies;
}

function upsertStarterCopyRecord({
  date,
  copies,
  copiesEn = [],
  providerName,
  model,
  status,
  error
}: {
  date: string;
  copies: string[];
  copiesEn?: string[];
  providerName: string;
  model: string;
  status: "success" | "failed";
  error: string;
}) {
  const timestamp = now();
  run(
    appDb,
    `insert into starter_daily_copies (
      date, copies_json, copies_en_json, source, provider_name, model, status, error, generated_at, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(date) do update set
      copies_json = excluded.copies_json,
      copies_en_json = excluded.copies_en_json,
      source = excluded.source,
      provider_name = excluded.provider_name,
      model = excluded.model,
      status = excluded.status,
      error = excluded.error,
      generated_at = excluded.generated_at,
      updated_at = excluded.updated_at`,
    date,
    JSON.stringify(copies),
    JSON.stringify(copiesEn),
    "ai",
    providerName,
    model,
    status,
    error,
    timestamp,
    timestamp,
    timestamp
  );
  return getOne<StarterDailyCopyRow>(appDb, "select * from starter_daily_copies where date = ?", date);
}

function recordStarterCopyFailure(date: string, message: string, existing: StarterDailyCopyRow | null | undefined) {
  if (existing?.status === "success") {
    run(
      appDb,
      "update starter_daily_copies set error = ?, updated_at = ? where date = ?",
      message,
      now(),
      date
    );
    return getOne<StarterDailyCopyRow>(appDb, "select * from starter_daily_copies where date = ?", date);
  }
  return upsertStarterCopyRecord({
    date,
    copies: [],
    providerName: "",
    model: "",
    status: "failed",
    error: message
  });
}

function starterCopyNeedsEnglish(row: StarterDailyCopyRow | null | undefined) {
  if (!row || row.status !== "success") return false;
  const copies = starterChineseCopies(row);
  if (copies.length === 0) return false;
  return starterEnglishCopies(row).length < copies.length;
}

async function ensureStarterCopyEnglish(row: StarterDailyCopyRow | null | undefined, provider?: PromptOptimizerProviderRow | null) {
  if (!starterCopyNeedsEnglish(row)) return row ?? null;
  const sourceRow = row as StarterDailyCopyRow;
  const resolvedProvider =
    provider ??
    getOne<PromptOptimizerProviderRow>(
      configDb,
      "select * from prompt_optimizer_providers where enabled = 1 order by sort_order asc, created_at asc limit 1"
    );
  if (!resolvedProvider) return sourceRow;
  try {
    const copiesEn = await translateCopiesWithProvider(resolvedProvider, starterChineseCopies(sourceRow));
    run(
      appDb,
      "update starter_daily_copies set copies_en_json = ?, error = ?, updated_at = ? where date = ?",
      JSON.stringify(copiesEn),
      "",
      now(),
      sourceRow.date
    );
    return getOne<StarterDailyCopyRow>(appDb, "select * from starter_daily_copies where date = ?", sourceRow.date) ?? sourceRow;
  } catch (error) {
    const message = error instanceof Error ? error.message : "英文每日文案翻译失败";
    run(
      appDb,
      "update starter_daily_copies set error = ?, updated_at = ? where date = ?",
      message,
      now(),
      sourceRow.date
    );
    console.warn("每日空白页英文文案翻译失败", message);
    return getOne<StarterDailyCopyRow>(appDb, "select * from starter_daily_copies where date = ?", sourceRow.date) ?? sourceRow;
  }
}

export async function generateStarterCopies({ force = false }: { force?: boolean } = {}) {
  if (generationPromise) return generationPromise;
  generationPromise = (async () => {
    const date = shanghaiDateString();
    const existing = getOne<StarterDailyCopyRow>(appDb, "select * from starter_daily_copies where date = ?", date);
    if (!force && existing?.status === "success") return ensureStarterCopyEnglish(existing);

    const settings = starterCopySettingsRow();
    if (!settings || !globalSwitchEnabled("starter_copy_generation")) {
      if (force) throw new Error("请先启用空白页每日文案");
      return null;
    }
    const copyCount = normalizeCopyCount(settings.copy_count);

    try {
      if (copyCount === 0) {
        return upsertStarterCopyRecord({
          date,
          copies: [],
          providerName: "",
          model: "",
          status: "success",
          error: ""
        });
      }
      const provider = getOne<PromptOptimizerProviderRow>(
        configDb,
        "select * from prompt_optimizer_providers where enabled = 1 order by sort_order asc, created_at asc limit 1"
      );
      if (!provider) throw new Error("请先在配置页启用提示词优化模型");

      const copies = await generateCopiesWithProvider(provider, copyCount, starterCopyHistory(date));
      const copiesEn = await translateCopiesWithProvider(provider, copies);
      return upsertStarterCopyRecord({
        date,
        copies,
        copiesEn,
        providerName: provider.name,
        model: provider.model,
        status: "success",
        error: ""
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "每日文案生成失败";
      const failed = recordStarterCopyFailure(date, message, existing);
      if (force) throw error;
      console.warn("每日空白页文案生成失败", message);
      return failed;
    }
  })();
  try {
    return await generationPromise;
  } finally {
    generationPromise = null;
  }
}

async function ensureStarterCopiesForToday() {
  const existing = getOne<StarterDailyCopyRow>(
    appDb,
    "select * from starter_daily_copies where date = ? and status = ?",
    shanghaiDateString(),
    "success"
  );
  if (existing) {
    await ensureStarterCopyEnglish(existing);
    return;
  }
  await generateStarterCopies().catch(() => undefined);
}

export function startStarterCopyScheduler() {
  void ensureStarterCopiesForToday();
  const schedule = () => {
    if (schedulerTimer) clearTimeout(schedulerTimer);
    schedulerTimer = setTimeout(async () => {
      await generateStarterCopies().catch((error) => {
        console.warn("定时每日空白页文案生成失败", error instanceof Error ? error.message : error);
      });
      schedule();
    }, nextShanghaiRunDelay());
  };
  schedule();
}

export function registerStarterCopyRoutes(api: Hono) {
  api.get("/starter-copies/today", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const locale = starterCopyLocale(c.req.query("language"));
    const settings = starterCopySettingsRow();
    if (!settings || !globalSwitchEnabled("starter_copy_generation")) {
      return c.json({
        date: shanghaiDateString(),
        copies: [],
        copiesZh: [],
        copiesEn: [],
        locale,
        source: "fallback",
        generatedAt: ""
      });
    }
    const row = getOne<StarterDailyCopyRow>(
      appDb,
      "select * from starter_daily_copies where date = ? and status = ?",
      shanghaiDateString(),
      "success"
    );
    const resolvedRow = locale === "en" ? await ensureStarterCopyEnglish(row) : row;
    return c.json(publicStarterDailyCopy(resolvedRow, locale) ?? {
      date: shanghaiDateString(),
      copies: [],
      copiesZh: row ? starterChineseCopies(row) : [],
      copiesEn: row ? starterEnglishCopies(row) : [],
      locale,
      source: "fallback",
      generatedAt: ""
    });
  });

  api.get("/config/starter-copy-settings", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const settings = starterCopySettingsRow();
    const today = getOne<StarterDailyCopyRow>(appDb, "select * from starter_daily_copies where date = ?", shanghaiDateString());
    const resolvedToday = await ensureStarterCopyEnglish(today);
    return c.json({
      settings: settings ? publicStarterCopySettings(settings) : null,
      today: publicStarterDailyCopyStatus(resolvedToday)
    });
  });

  api.put("/config/starter-copy-settings", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const enabled = Boolean(body.enabled) ? 1 : 0;
    const copyCount = normalizeCopyCount(body.copyCount);
    const timestamp = now();
    run(
      configDb,
      `insert into starter_copy_settings (id, enabled, copy_count, updated_at)
       values (?, ?, ?, ?)
       on conflict(id) do update set
        enabled = excluded.enabled,
        copy_count = excluded.copy_count,
        updated_at = excluded.updated_at`,
      SETTINGS_ID,
      enabled,
      copyCount,
      timestamp
    );
    saveGlobalSwitch("starter_copy_generation", Boolean(enabled));
    audit("starter_copy_settings.save", { enabled: Boolean(enabled), copyCount });
    if (enabled) void ensureStarterCopiesForToday();
    const row = starterCopySettingsRow();
    return c.json({ settings: row ? publicStarterCopySettings(row) : null });
  });

  api.post("/config/starter-copy-settings/regenerate", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    try {
      const row = await generateStarterCopies({ force: true });
      audit("starter_copy_settings.regenerate", { date: shanghaiDateString() });
      return c.json({ today: publicStarterDailyCopyStatus(row) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "每日文案生成失败";
      const today = getOne<StarterDailyCopyRow>(appDb, "select * from starter_daily_copies where date = ?", shanghaiDateString());
      return c.json({ error: message, today: publicStarterDailyCopyStatus(today) }, 400);
    }
  });
}
