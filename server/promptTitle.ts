import { configDb, getOne } from "./db";
import {
  fetchPromptOptimizerWithRetry,
  normalizePromptOptimizerRetryCount,
  promptOptimizerApiKey,
  promptOptimizerHeaders,
  type PromptOptimizerProviderRow
} from "./promptOptimizerRoutes";
import { logModelRequest } from "./auditLog";
import type { EditSuggestionTone } from "./userPreferences";
import { normalizePath, safeJson } from "./utils";

type PromptModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ModelRequestLogContext = {
  purpose: "title.generate";
  userId?: string;
  jobId?: string;
  source?: string;
};

type PromptSummaryTitleOptions = {
  fallbackTitle: string;
  logLabel: string;
  logSource?: string;
  maxLength?: number | null;
  systemPrompt: string;
  temperature?: number;
  userLabel?: string;
};

type PromptCategorySelectionOptions = {
  systemPrompt: string;
  userHeading: string;
  logLabel: string;
  maxCount?: number;
};

export type PromptEditSuggestion = {
  label: string;
  prompt: string;
};

export type PromptCategoryOption = {
  id: string;
  name: string;
  slug?: string | null;
};

const PROMPT_TITLE_TIMEOUT_MS = 60 * 1000;
const USERNAME_GENERATION_TIMEOUT_MS = 8 * 1000;
const PROMPT_CATEGORY_SELECTION_TIMEOUT_MS = 20 * 1000;
const PROMPT_EDIT_SUGGESTION_TIMEOUT_MS = 20 * 1000;
const MAX_CASE_STYLE_SELECTION_COUNT = 2;
const EDIT_SUGGESTION_COUNT = 3;
export const FALLBACK_PROMPT_EDIT_SUGGESTIONS: PromptEditSuggestion[] = [
  {
    label: "强化视觉焦点",
    prompt: "保留当前主体，选出画面最重要的一个信息或物件，通过位置、光影和留白调整让它更醒目。"
  },
  {
    label: "补真实场景",
    prompt: "保留当前风格，把主体放进更具体的使用场景，加入 1-2 个能说明用途的道具或环境细节。"
  },
  {
    label: "精修关键细节",
    prompt: "保留整体构图，针对最容易出错的文字、边缘、材质或表情做局部精修，让画面更干净可信。"
  }
];
const FALLBACK_CHINESE_USERNAMES = [
  "星柚",
  "云栗",
  "晚橙",
  "青瓷",
  "雾蓝",
  "晴川",
  "月白",
  "风禾",
  "夏盐",
  "松糖",
  "梨光",
  "柠川",
  "星沫",
  "墨柚",
  "荔光",
  "蓝屿",
  "糖霜",
  "橘灯",
  "银笺",
  "晴盐",
  "云朵",
  "海盐",
  "青柠",
  "薄荷",
  "小满",
  "山月",
  "松间",
  "溪午",
  "花火",
  "南枝",
  "初雪",
  "白桃",
  "乌龙",
  "浅岛",
  "日和",
  "森野",
  "鹿鸣",
  "棠梨",
  "秋栗",
  "雪芽",
  "晴野",
  "云雀",
  "月桂",
  "星桥",
  "雨巷",
  "青团",
  "冬青",
  "风铃",
  "眠月",
  "春笺",
  "月汽水",
  "云片糖",
  "星河盐",
  "柚子茶",
  "薄荷糖",
  "橘子灯",
  "海盐光",
  "松子糖",
  "晴天盐",
  "葡萄雾",
  "梨花白",
  "青柠序",
  "晚风信",
  "月光笺",
  "蓝莓光",
  "雪松糖",
  "雾里灯",
  "小春盐",
  "半糖月",
  "浅草光"
];

function timeoutSignal(ms = PROMPT_TITLE_TIMEOUT_MS) {
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
    const data = safeJson<unknown>(payload, null);
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const choices = Array.isArray(record.choices) ? record.choices : [];
    for (const choiceValue of choices) {
      const choice = choiceValue && typeof choiceValue === "object" ? choiceValue as Record<string, unknown> : {};
      const delta = choice.delta && typeof choice.delta === "object" ? choice.delta as Record<string, unknown> : {};
      content += chatContentText(delta.content ?? choice.text);
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
      content += streamFrameContent(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
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

function activePromptProvider() {
  return getOne<PromptOptimizerProviderRow>(
    configDb,
    "select * from prompt_optimizer_providers where enabled = 1 order by sort_order asc, created_at asc limit 1"
  );
}

async function requestPromptModelText(
  provider: PromptOptimizerProviderRow,
  messages: PromptModelMessage[],
  temperature: number,
  timeoutMs = PROMPT_TITLE_TIMEOUT_MS,
  logContext?: ModelRequestLogContext
) {
  const endpoint = normalizePath(provider.base_url, provider.endpoint_path || "/chat/completions");
  const streamEnabled = Boolean(provider.stream_enabled);
  const maxTokens = Math.trunc(Number(provider.max_tokens ?? 0));
  const requestBody: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature,
    ...(streamEnabled ? { stream: true } : {})
  };
  if (shouldSendDeepSeekThinkingMode(provider)) {
    requestBody.thinking = { type: (provider.thinking_enabled ?? 1) === 0 ? "disabled" : "enabled" };
  }
  if (maxTokens > 0) requestBody.max_tokens = maxTokens;

  const { controller, timeoutId } = timeoutSignal(timeoutMs);
  const startedAt = Date.now();
  let attemptCount = 0;
  let statusCode: number | null = null;
  try {
    if (!promptOptimizerApiKey(provider)) throw new Error(`提示词优化模型「${provider.name}」缺少 API Key`);
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
      throw new Error(String(nestedError?.message ?? data.message ?? text ?? response.statusText).trim() || "标题生成失败");
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    let content = "";
    if (streamEnabled && contentType.includes("text/event-stream")) {
      content = await readStreamingChatCompletion(response);
    } else {
      const text = await response.text();
      content = chatCompletionContent(safeJson<unknown>(text, null), text);
    }
    if (logContext) {
      logModelRequest({
        ...logContext,
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
        success: true
      });
    }
    return content;
  } catch (error) {
    if (logContext) {
      logModelRequest({
        ...logContext,
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
        error
      });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function stripLeadingModelListMarker(value: string) {
  return value
    .replace(/^["'“”‘’`*#\-•\s]+/, "")
    .replace(/^(?:[（(]\s*)?(?:\d{1,2}|[一二三四五六七八九十]{1,3})(?:\s*[.、)）]|\s+[.、)）])\s*/, "")
    .replace(/^["'“”‘’`*#\-•\s]+/, "");
}

function cleanGeneratedTitle(value: string) {
  return stripLeadingModelListMarker(
    value.trim()
      .replace(/^```(?:json|text)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .replace(/^(?:标题|灵感标题|对话标题|提示词|提示内容)\s*[:：]\s*/i, "")
  )
    .replace(/["'“”‘’`]+$/g, "")
    .trim();
}

function cleanGeneratedEditSuggestionText(value: unknown) {
  return stripLeadingModelListMarker(
    String(value ?? "")
      .replace(/^```(?:json|text)?\s*/i, "")
      .replace(/\s*```$/i, "")
  )
    .replace(/["'“”‘’`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAsciiWordChar(value: string) {
  return /^[A-Za-z0-9]$/.test(value);
}

function truncateTitle(value: string, maxLength: number | null) {
  if (!maxLength || maxLength <= 0) return value;
  const chars = Array.from(value);
  if (chars.length <= maxLength) return value;
  const clipped = chars.slice(0, maxLength).join("").trimEnd();
  const previousChar = chars[maxLength - 1] ?? "";
  const nextChar = chars[maxLength] ?? "";
  if (isAsciiWordChar(previousChar) && isAsciiWordChar(nextChar)) {
    let wordStart = maxLength - 1;
    while (wordStart > 0 && isAsciiWordChar(chars[wordStart - 1])) wordStart -= 1;
    let wordEnd = maxLength;
    while (wordEnd < chars.length && isAsciiWordChar(chars[wordEnd])) wordEnd += 1;
    const wordLength = wordEnd - wordStart;
    if (wordLength <= maxLength) return chars.slice(0, wordEnd).join("").trimEnd();
    const beforeWord = chars.slice(0, wordStart).join("").replace(/[，,、：:\s]+$/g, "").trim();
    if (beforeWord) return beforeWord;
  }
  return clipped;
}

export function fallbackTitleFromPrompt(value: string, fallbackTitle: string, maxLength: number | null = 18) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallbackTitle;
  const firstSentence = normalized.match(/^(.+?)([。！？!?；;.]|$)/)?.[1]?.trim() || normalized;
  const title = firstSentence.replace(/[，,、：:]\s*$/, "").trim();
  return truncateTitle(title, maxLength);
}

function normalizeGeneratedTitle(value: string, fallbackPrompt: string, fallbackTitle: string, maxLength: number | null) {
  const line = cleanGeneratedTitle(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean)[0] ?? "";
  const withoutPunctuation = line.replace(/[。！？!?；;，,、：:]+$/g, "").trim();
  return fallbackTitleFromPrompt(withoutPunctuation || fallbackPrompt, fallbackTitle, maxLength);
}

function cleanJsonLikeModelOutput(value: string) {
  const clean = value.trim()
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const objectMatch = clean.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  const arrayMatch = clean.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];
  return clean;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(collectStringValues);
  return [];
}

function normalizeGeneratedCategoryIds(value: string, options: PromptCategoryOption[], maxCount = MAX_CASE_STYLE_SELECTION_COUNT) {
  const byKey = new Map<string, string>();
  const normalizeKey = (item: string) => item.trim().toLowerCase();
  for (const option of options) {
    byKey.set(normalizeKey(option.id), option.id);
    byKey.set(normalizeKey(option.name), option.id);
    if (option.slug) byKey.set(normalizeKey(option.slug), option.id);
  }

  const selected: string[] = [];
  const addCandidate = (raw: string) => {
    const id = byKey.get(normalizeKey(raw));
    if (id && !selected.includes(id)) selected.push(id);
  };

  const parsed = safeJson<unknown>(cleanJsonLikeModelOutput(value), null);
  collectStringValues(parsed).forEach(addCandidate);

  const loweredOutput = value.toLowerCase();
  for (const option of options) {
    if (selected.includes(option.id)) continue;
    if (
      loweredOutput.includes(option.id.toLowerCase()) ||
      loweredOutput.includes(option.name.toLowerCase()) ||
      (option.slug && loweredOutput.includes(option.slug.toLowerCase()))
    ) {
      selected.push(option.id);
    }
  }

  return selected.slice(0, maxCount);
}

function normalizeEditSuggestionLabel(label: unknown, prompt: string) {
  const cleaned = cleanGeneratedEditSuggestionText(label).replace(/[。！？!?；;，,、：:]+$/g, "").trim();
  return truncateTitle(cleaned || fallbackTitleFromPrompt(prompt, "继续优化", 14), 14) || "继续优化";
}

function normalizeEditSuggestionPrompt(value: unknown) {
  return cleanGeneratedEditSuggestionText(value)
    .replace(/^(?:编辑指令|修改建议|建议|prompt)\s*[:：]\s*/i, "")
    .trim();
}

function isGenericEditSuggestion(label: string, prompt: string) {
  const text = `${label} ${prompt}`;
  const hasGenericPhrase = /优化构图|提升质感|增强氛围|优化背景|增强光影|商业质感|继续优化|更高级|更好看/.test(text);
  if (!hasGenericPhrase) return false;
  const hasConcreteDetail =
    /主标题|副标题|日期|地点|编号|箭头|图标|卡片|模块|按钮|留白|贴纸|标注|道具|前景|手部|名片|包装|门头|价格|邮戳|左上|右下|顶部|底部|上方|下方|文字|路线|节点/.test(text);
  return !hasConcreteDetail;
}

function normalizeGeneratedEditSuggestions(value: string) {
  const parsed = safeJson<unknown>(cleanJsonLikeModelOutput(value), null);
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record.suggestions)
      ? record.suggestions
      : Array.isArray(record.items)
        ? record.items
        : collectStringValues(parsed).slice(0, EDIT_SUGGESTION_COUNT);
  const suggestions: PromptEditSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of rawItems) {
    const itemRecord = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const prompt = normalizeEditSuggestionPrompt(
      typeof item === "string" ? item : itemRecord.prompt ?? itemRecord.instruction ?? itemRecord.text ?? itemRecord.content
    );
    if (!prompt) continue;
    const label = normalizeEditSuggestionLabel(itemRecord.label ?? itemRecord.title ?? itemRecord.name, prompt);
    if (isGenericEditSuggestion(label, prompt)) continue;
    const key = `${label}\u0000${prompt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ label, prompt });
    if (suggestions.length >= EDIT_SUGGESTION_COUNT) break;
  }
  for (const fallback of FALLBACK_PROMPT_EDIT_SUGGESTIONS) {
    if (suggestions.length >= EDIT_SUGGESTION_COUNT) break;
    const key = `${fallback.label}\u0000${fallback.prompt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(fallback);
  }
  return suggestions.slice(0, EDIT_SUGGESTION_COUNT);
}

function promptIncludes(prompt: string, keywords: string[]) {
  return keywords.some((keyword) => prompt.includes(keyword.toLowerCase()));
}

function promptSubject(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.includes("老虎") && normalized.includes("小老虎")) return "老虎和小老虎";
  const subjectRules: Array<[string[], string]> = [
    [["老虎"], "老虎"],
    [["狮子"], "狮子"],
    [["熊猫"], "熊猫"],
    [["小猪", "猪"], "小猪"],
    [["猫"], "猫"],
    [["狗"], "狗"],
    [["狐狸"], "狐狸"],
    [["logo", "标志", "商标", "品牌"], "品牌标志"],
    [["人物", "人像", "肖像", "模特", "女孩", "男孩", "女性", "男性", "角色"], "人物主体"],
    [["产品", "商品", "包装", "瓶", "杯", "鞋", "包", "香水", "首饰", "手机"], "产品主体"],
    [["海报", "攻略", "流程图", "信息图", "教程", "路线", "地图", "版式", "封面", "banner"], "版式内容"],
    [["菜", "食物", "餐", "咖啡", "饮品", "甜品", "蛋糕", "水果"], "食物主体"],
    [["风景", "旅行", "城市", "海边", "山", "草原", "森林", "岛", "长城", "建筑"], "景观主体"]
  ];
  const matched = subjectRules.find(([keywords]) => keywords.some((keyword) => normalized.includes(keyword)));
  if (matched) return matched[1];
  return fallbackTitleFromPrompt(prompt, "当前主题", 12).replace(/[「」]/g, "").trim() || "当前主题";
}

function fallbackPromptEditSuggestionsForPrompt(prompt: string): PromptEditSuggestion[] {
  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim().toLowerCase();
  const subject = promptSubject(normalizedPrompt);
  const suggestions: PromptEditSuggestion[] = [];
  const seen = new Set<string>();
  const add = (label: string, editPrompt: string) => {
    const normalizedLabel = normalizeEditSuggestionLabel(label, editPrompt);
    const normalizedEditPrompt = normalizeEditSuggestionPrompt(editPrompt);
    if (!normalizedLabel || !normalizedEditPrompt) return;
    const key = `${normalizedLabel}\u0000${normalizedEditPrompt}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({ label: normalizedLabel, prompt: normalizedEditPrompt });
  };

  if (promptIncludes(normalizedPrompt, ["老虎", "狮子", "猫", "狗", "小猪", "猪", "动物", "鸟", "马", "熊猫", "狐狸"])) {
    add("加入互动动作", `保留「${subject}」的主体识别，加入一个明确互动动作，例如靠近、回头、奔跑或陪伴，并让动作成为画面焦点。`);
    add("加前景环境层", `保留「${subject}」和当前风格，在前景加入草叶、岩石、雾气或水面反光，形成前中后景层次。`);
    add("做竖版电影海报", `保留「${subject}」主体，改成竖版电影海报构图，上方留片名位置，下方加入小号演职员式文字和戏剧化背景。`);
  }

  if (promptIncludes(normalizedPrompt, ["logo", "图标", "标志", "商标", "品牌", "字体设计"])) {
    add("补品牌应用物料", `保留「${subject}」标志核心识别，加入名片、纸袋、招牌或包装盒 2-3 个应用物料，统一品牌色。`);
    add("优化小尺寸识别", `保留「${subject}」标志概念，拉开图形和文字间距，减少过细线条，让 64px 小尺寸下轮廓仍清楚。`);
    add("做门头样机展示", `保留「${subject}」标志主体，把它放到店铺门头或墙面发光字样机上，加入真实阴影和材质反射。`);
  }

  if (promptIncludes(normalizedPrompt, ["人物", "人像", "肖像", "模特", "女孩", "男孩", "女性", "男性", "角色"])) {
    add("改成杂志封面", `保留「${subject}」人物造型，改成杂志封面构图，人物压住部分刊名，侧边加入 3 条短封面标题。`);
    add("细化手部表情", `保留「${subject}」身份和服装，微调眼神、嘴角和手部动作，让情绪更明确，避免手指变形。`);
    add("加入角色道具", `保留「${subject}」人物主体，加入一个能解释角色身份的道具，例如相机、花束、工具或票据，并放在手边或前景。`);
  }

  if (promptIncludes(normalizedPrompt, ["产品", "商品", "电商", "包装", "瓶", "杯", "鞋", "包", "香水", "首饰", "手机"])) {
    add("加三处卖点标注", `保留「${subject}」产品主体，在产品周围加入 3 个细线标注点，分别指向材质、结构和使用亮点。`);
    add("做真实使用场景", `保留「${subject}」外观，把背景改成真实使用场景，并加入手部、桌面或空间参照来体现尺寸感。`);
    add("改电商白底主图", `保留「${subject}」产品角度，改成白底电商主图，主体占画面 75%，右侧预留 2-3 条卖点文字。`);
  }

  if (promptIncludes(normalizedPrompt, ["菜", "食物", "餐", "咖啡", "饮品", "甜品", "蛋糕", "水果"])) {
    add("加菜名价格区", `保留「${subject}」食物主体，在左上或右下加入菜名、价格和一句短卖点，文字不要遮挡食物。`);
    add("补餐桌道具", `保留「${subject}」摆盘，在周围加入餐具、桌布、饮品或手部动作，形成真实用餐场景。`);
    add("突出食欲局部", `保留整体构图，放大「${subject}」最诱人的局部，例如切面、汁水、热气或酥脆边缘。`);
  }

  if (promptIncludes(normalizedPrompt, ["海报", "攻略", "流程图", "信息图", "教程", "路线", "地图", "版式", "封面", "banner"])) {
    add("强化第一眼重点", `保留「${subject}」主题，先突出最想让用户看到的一句话或一个视觉焦点，用留白、大小对比或色块拉开层级。`);
    add("删减拥挤信息", `保留「${subject}」核心内容，弱化重复说明，把次要文字压缩成更短的提示，让主要信息更容易扫读。`);
    add("换成使用场景", `保留「${subject}」原有信息，把画面包装成更明确的使用场景，例如收藏截图、活动预告、社媒封面或店内展示。`);
  }

  if (promptIncludes(normalizedPrompt, ["风景", "旅行", "城市", "海边", "山", "草原", "森林", "岛", "长城", "建筑"])) {
    add("加旅行标题贴纸", `保留「${subject}」景观主体，在天空或留白处加入目的地标题贴纸、日期和一句短标语。`);
    add("补人物尺度参照", `保留「${subject}」主要景观，在前景加入一个小人物或小队伍作为尺度参照，不要抢走景观主体。`);
    add("做明信片边框", `保留「${subject}」景点识别，加入明信片式白边、邮戳、手写地名和局部小插画。`);
  }

  for (const fallback of FALLBACK_PROMPT_EDIT_SUGGESTIONS) {
    if (suggestions.length >= EDIT_SUGGESTION_COUNT) break;
    add(fallback.label, fallback.prompt);
  }

  return suggestions.slice(0, EDIT_SUGGESTION_COUNT);
}

function seededIndex(value: string) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function fallbackChineseUsername(seed = "", offset = 0) {
  return FALLBACK_CHINESE_USERNAMES[(seededIndex(seed) + offset) % FALLBACK_CHINESE_USERNAMES.length];
}

export function fallbackChineseUsernameCount() {
  return FALLBACK_CHINESE_USERNAMES.length;
}

function cleanGeneratedUsername(value: string) {
  return value.trim()
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^(?:昵称|用户名|用户昵称|中文昵称|名字|推荐)\s*[:：]\s*/i, "")
    .replace(/^["'“”‘’`*#\-•\d.、)）\s]+/, "")
    .replace(/["'“”‘’`。！？!?；;，,、：:\s]+$/g, "")
    .trim();
}

function isModernChineseUsername(value: string) {
  if (!/^[\u4e00-\u9fff]{2,3}$/.test(value)) return false;
  return !/^(用户|昵称|名字|小明|小红|张三|李四|老王|测试)$/.test(value);
}

function normalizeGeneratedUsername(value: string, fallback: string) {
  const firstLine = cleanGeneratedUsername(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean)[0] ?? "";
  const compact = firstLine.replace(/[^\u4e00-\u9fff]/g, "");
  if (isModernChineseUsername(compact)) return compact;
  const candidates = compact.match(/[\u4e00-\u9fff]{2,3}/g) ?? [];
  return candidates.find((item) => item.length === 2 && isModernChineseUsername(item)) ?? candidates.find(isModernChineseUsername) ?? fallback;
}

function uniqueModernChineseUsernames(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const compact = cleanGeneratedUsername(value).replace(/[^\u4e00-\u9fff]/g, "");
    const candidates = isModernChineseUsername(compact) ? [compact] : compact.match(/[\u4e00-\u9fff]{2,3}/g) ?? [];
    for (const candidate of candidates) {
      if (!isModernChineseUsername(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);
      result.push(candidate);
    }
  }
  return result;
}

function parseGeneratedUsernameCandidates(value: string) {
  return uniqueModernChineseUsernames(value.split(/[\r\n,，、;；|/]+/));
}

function fallbackChineseUsernameCandidates(seed: string, count: number) {
  return Array.from({ length: count }, (_, index) => fallbackChineseUsername(seed, index));
}

export async function generateChineseUsername(seed = "") {
  const fallback = fallbackChineseUsername(seed);
  const provider = activePromptProvider();
  if (!provider) return fallback;
  try {
    const content = await requestPromptModelText(
      provider,
      [
        {
          role: "system",
          content: "你是一个中文产品昵称生成器。只返回一个中文用户名，不要解释、不要标点、不要英文或数字。优先生成2个汉字，只有特别好听时才允许3个汉字。风格要有趣、轻巧、有画面感，像年轻产品里的昵称；避免老土、普通、俗气、网红腔或过度幼稚。"
        },
        { role: "user", content: `为新注册用户生成一个中文用户名。尽量给我2个汉字。参考种子：${seed || "new-user"}` }
      ],
      0.85,
      USERNAME_GENERATION_TIMEOUT_MS
    );
    return normalizeGeneratedUsername(content, fallback);
  } catch (error) {
    console.warn("AI username generation failed", error);
    return fallback;
  }
}

export async function generateChineseUsernameCandidates(seed = "", count = 6) {
  const candidateCount = Math.max(1, Math.min(12, Math.floor(count)));
  const fallback = fallbackChineseUsernameCandidates(seed, candidateCount);
  const provider = activePromptProvider();
  if (!provider) return fallback;
  try {
    const content = await requestPromptModelText(
      provider,
      [
        {
          role: "system",
          content: `你是一个中文产品昵称生成器。一次返回${candidateCount}个中文用户名，每行一个，不要解释、不要标点、不要英文或数字。优先生成2个汉字，只有特别好听时才允许3个汉字。风格要有趣、轻巧、有画面感，像年轻产品里的昵称；避免老土、普通、俗气、网红腔或过度幼稚。`
        },
        { role: "user", content: `为用户生成${candidateCount}个可选择的中文用户名。尽量给我2个汉字。参考种子：${seed || "new-user"}` }
      ],
      0.9,
      USERNAME_GENERATION_TIMEOUT_MS
    );
    return uniqueModernChineseUsernames([...parseGeneratedUsernameCandidates(content), ...fallback]).slice(0, candidateCount);
  } catch (error) {
    console.warn("AI username generation failed", error);
    return fallback;
  }
}

export async function generatePromptSummaryTitle(prompt: string, options: PromptSummaryTitleOptions) {
  const maxLength = options.maxLength === null ? null : options.maxLength ?? 18;
  const fallback = fallbackTitleFromPrompt(prompt, options.fallbackTitle, maxLength);
  const provider = activePromptProvider();
  if (!provider) return fallback;
  try {
    const content = await requestPromptModelText(
      provider,
      [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: `${options.userLabel ?? "提示词"}：${prompt}` }
      ],
      options.temperature ?? 0.35,
      PROMPT_TITLE_TIMEOUT_MS,
      { purpose: "title.generate", source: options.logSource || "prompt-title" }
    );
    return normalizeGeneratedTitle(content, prompt, options.fallbackTitle, maxLength) || fallback;
  } catch (error) {
    console.warn(options.logLabel, error);
    return fallback;
  }
}

async function generatePromptCategoryIds(prompt: string, options: PromptCategoryOption[], selectionOptions: PromptCategorySelectionOptions) {
  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
  if (!normalizedPrompt || options.length === 0) return [];
  const provider = activePromptProvider();
  if (!provider) return [];
  const optionLines = options
    .map((option) => `- ${option.id} | ${option.name}${option.slug ? ` | ${option.slug}` : ""}`)
    .join("\n");
  const promptExcerpt = Array.from(normalizedPrompt).slice(0, 2400).join("");
  try {
    const content = await requestPromptModelText(
      provider,
      [
        {
          role: "system",
          content: selectionOptions.systemPrompt
        },
        {
          role: "user",
          content: `${selectionOptions.userHeading}：\n${optionLines}\n\n提示内容：${promptExcerpt}`
        }
      ],
      0.1,
      PROMPT_CATEGORY_SELECTION_TIMEOUT_MS
    );
    return normalizeGeneratedCategoryIds(content, options, selectionOptions.maxCount);
  } catch (error) {
    console.warn(selectionOptions.logLabel, error);
    return [];
  }
}

export async function generatePromptCaseStyleIds(prompt: string, options: PromptCategoryOption[]) {
  return generatePromptCategoryIds(prompt, options, {
    systemPrompt:
      "你是灵感空间风格分类助手。只能从候选风格中选择最匹配的 1 到 2 个 id；不要创造新风格。用户没有明确主题或无法判断时返回空数组。只输出 JSON，格式为 {\"ids\":[\"候选风格id\"]}，不要解释。",
    userHeading: "候选风格",
    logLabel: "灵感风格自动判断失败",
    maxCount: MAX_CASE_STYLE_SELECTION_COUNT
  });
}

export async function generatePromptAssetCategoryIds(prompt: string, options: PromptCategoryOption[]) {
  return generatePromptCategoryIds(prompt, options, {
    systemPrompt:
      "你是素材库标签分类助手。候选项是素材标签，不是灵感空间风格。只能从候选素材标签中选择最匹配的 0 到 3 个 id；不要创造新标签，也不要为了凑数强行选择。优先根据图片主体、可复用素材类型、商业用途或明确出现的对象判断，例如 Logo、商标、公司名、人物、模特、箱包、表情包、宣传片。只有候选标签能明确描述这张图时才选择；没有明确匹配时返回空数组。只输出 JSON，格式为 {\"ids\":[\"候选标签id\"]}，不要解释。",
    userHeading: "候选素材标签",
    logLabel: "素材标签自动判断失败",
    maxCount: 3
  });
}

export async function generatePromptEditSuggestions({
  prompt,
  originPrompt = "",
  promptHistory = [],
  kind = "",
  tone = "default"
}: {
  prompt: string;
  originPrompt?: string;
  promptHistory?: string[];
  kind?: string;
  tone?: EditSuggestionTone;
}) {
  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
  const normalizedOriginPrompt = originPrompt.replace(/\s+/g, " ").trim();
  const normalizedPromptHistory = promptHistory
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const initialPrompt = normalizedPromptHistory[0] ?? (normalizedOriginPrompt || normalizedPrompt);
  const editHistory = normalizedPromptHistory.slice(1, -1);
  const currentPrompt = normalizedPromptHistory.at(-1) ?? (normalizedPrompt || normalizedOriginPrompt);
  const historyLines = editHistory
    .slice(-6)
    .map((item, index) => `${index + 1}. ${Array.from(item).slice(0, 240).join("")}`);
  const fallback = fallbackPromptEditSuggestionsForPrompt(
    [initialPrompt, ...editHistory, currentPrompt].filter(Boolean).join("\n")
  );
  const provider = activePromptProvider();
  if (!provider) return fallback;
  try {
    const content = await requestPromptModelText(
      provider,
      [
        {
          role: "system",
          content:
            [
              "你是 AI 图片续改建议策划。用户刚得到一张图片，你要基于当前图片提示词给 3 条可以直接执行的下一步编辑建议。不要输出抽象方向，不要只写“优化构图、提升质感、增强氛围、做成海报”这类空泛话。每条建议都必须落到真实可编辑细节：具体加什么元素、放在画面哪里、文字/版式怎么排、保留什么主体、改动什么局部。三条建议必须是不同设计路线，例如信息层级、视觉元素、场景氛围、版式结构、用途转化、局部细节、风格包装里选三种。遇到海报/攻略/信息图/封面/banner 等版式型图片时，先判断它最需要强化的是信息表达、视觉焦点、阅读顺序、使用场景还是情绪包装，再自由给出具体改法，不要为了套版式元素而固定使用主副标题、编号、卡片等模板。label 为 6 到 14 个中文字符，具体但简短；prompt 为一句中文编辑指令，30 到 70 字，必须包含 2 个以上可执行细节。不要写成重新生成新图，不要要求上传图片，不要解释。只输出 JSON，格式为 {\"suggestions\":[{\"label\":\"补标题与报名区\",\"prompt\":\"保留旅游海报主视觉，在顶部加入更醒目的目的地标题，底部补日期、地点和一个轻量报名按钮。\"}]}。",
              editSuggestionToneInstruction(tone)
            ].filter(Boolean).join("\n")
        },
        {
          role: "user",
          content: [
            `图片类型：${kind === "edit" ? "编辑图" : "生成图"}`,
            `建议倾向：${editSuggestionToneLabel(tone)}`,
            `最初生成提示词：${Array.from(initialPrompt).slice(0, 1200).join("")}`,
            historyLines.length > 0 ? `中间编辑提示词：\n${historyLines.join("\n")}` : "",
            `当前图片提示词：${Array.from(currentPrompt).slice(0, 1200).join("")}`,
            "请先判断这张图最可能的用途，再给 3 条不同设计路线的具体续改建议。每条 prompt 都要引用提示词里的主体或用途，并给出具体元素、位置或版式动作；不要用抽象词凑数。"
          ].filter(Boolean).join("\n")
        }
      ],
      0.72,
      PROMPT_EDIT_SUGGESTION_TIMEOUT_MS
    );
    return normalizeGeneratedEditSuggestions(content);
  } catch (error) {
    console.warn("图片续改建议自动生成失败", error);
    return fallback;
  }
}

function editSuggestionToneLabel(tone: EditSuggestionTone) {
  if (tone === "practical") return "实用优化";
  if (tone === "creative") return "创意扩展";
  if (tone === "detail") return "细节修复";
  return "默认 / 均衡";
}

function editSuggestionToneInstruction(tone: EditSuggestionTone) {
  if (tone === "practical") {
    return "本次建议倾向：实用优化。优先围绕排版清晰、阅读顺序、信息层级、商业可用性、使用场景落地给建议；仍然要保留具体可执行细节。";
  }
  if (tone === "creative") {
    return "本次建议倾向：创意扩展。优先围绕新场景、新风格包装、视觉记忆点、叙事变化、用途转化给建议；避免只做基础修补。";
  }
  if (tone === "detail") {
    return "本次建议倾向：细节修复。优先围绕局部主体、文字可读性、边缘、材质、光影、背景瑕疵、手部表情等可精修细节给建议；避免大幅重做整张图。";
  }
  return "";
}
