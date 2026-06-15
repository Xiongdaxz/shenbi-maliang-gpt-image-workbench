import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { logModelRequest } from "./auditLog";
import { appDb, configDb, getAll, getOne, run } from "./db";
import { requireUser } from "./auth";
import {
  orderedPromptTemplatePresets as promptTemplatePresets,
  type PromptTemplatePreset
} from "./promptTemplatePresets";
import { normalizePath, makeId, now, safeJson, visibleAssetSql } from "./utils";
import {
  fetchPromptOptimizerWithRetry,
  normalizePromptOptimizerRetryCount,
  promptOptimizerApiKey,
  promptOptimizerHeaders,
  type PromptOptimizerProviderRow
} from "./promptOptimizerRoutes";
import type { AssetRow } from "./types";
import { readStoredFile } from "./secureFiles";
import { mimeTypeFromPath } from "./imageFiles";
import { userPreferences } from "./userPreferences";
import {
  promptOptimizeStyleGroupsToOptions,
  promptOptimizeStyleOption as preferencePromptOptimizeStyleOption,
  type PromptOptimizeStyleGroup
} from "../src/lib/promptOptimizeStyles";

type PromptTemplateVisibility = "private" | "shared";
type ModelRequestLogContext = {
  purpose: "prompt.optimize" | "prompt.translate" | "template.optimize" | "template.translate";
  userId?: string;
  jobId?: string;
  source?: string;
};
type ModelRequestLogBaseContext = Omit<ModelRequestLogContext, "purpose">;

type PromptTemplateRow = {
  id: string;
  user_id: string | null;
  owner_name?: string | null;
  visibility: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  optimize_style?: string | null;
  components_json: string;
  rules_json: string;
  output_json: string;
  created_at: string;
  updated_at: string;
};

type PromptTemplateResultRow = {
  id: string;
  template_id: string | null;
  user_id: string;
  template_snapshot_json: string;
  form_snapshot_json: string;
  language: string;
  base_prompt: string;
  base_prompt_en?: string | null;
  optimized_prompt: string;
  optimized_prompt_en?: string | null;
  sections_json: string;
  negative_prompt: string;
  negative_prompt_en?: string | null;
  provider_name: string;
  model: string;
  created_at: string;
};

type PromptTemplateCountRow = {
  all_count: number;
  mine_count: number;
  shared_count: number;
};

type PromptTemplateBaseTranslationRow = {
  template_id: string;
  user_id: string;
  signature: string;
  base_prompt: string;
  base_prompt_en: string;
  negative_prompt: string;
  negative_prompt_en: string;
  provider_name: string;
  model: string;
  updated_at: string;
};

type PromptTemplateFormDraftRow = {
  template_id: string;
  user_id: string;
  form_values_json: string;
  created_at: string;
  updated_at: string;
};

const DEFAULT_CONTENT_SEED_VERSION = "default-content-v4";
const PROMPT_TEMPLATE_HISTORY_PAGE_SIZE = 20;
type PromptOptimizeStyle = string;

const promptOptimizeMainStyles = [
  "standard",
  "realistic",
  "cinematic",
  "anime",
  "artistic",
  "commercial",
  "series",
  "composition",
  "detailed",
  "creative"
] as const;

const promptOptimizeSubStyleParents: Record<string, typeof promptOptimizeMainStyles[number]> = {
  "realistic:portrait-photography": "realistic",
  "realistic:commercial-product": "realistic",
  "realistic:documentary-street": "realistic",
  "realistic:landscape-blockbuster": "realistic",
  "realistic:macro-closeup": "realistic",
  "realistic:fashion-editorial": "realistic",
  "cinematic:hollywood-blockbuster": "cinematic",
  "cinematic:cyberpunk": "cinematic",
  "cinematic:film-noir": "cinematic",
  "cinematic:european-art-house": "cinematic",
  "cinematic:horror-thriller": "cinematic",
  "cinematic:historical-epic": "cinematic",
  "cinematic:sci-fi-space": "cinematic",
  "anime:ghibli": "anime",
  "anime:shonen-action": "anime",
  "anime:shinkai": "anime",
  "anime:cel-animation": "anime",
  "anime:mecha-battle": "anime",
  "anime:shojo-dreamy": "anime",
  "anime:dark-gothic": "anime",
  "artistic:classical-oil": "artistic",
  "artistic:watercolor-illustration": "artistic",
  "artistic:concept-art": "artistic",
  "artistic:pop-art": "artistic",
  "artistic:minimalism": "artistic",
  "artistic:surrealism": "artistic",
  "artistic:pixel-art": "artistic",
  "commercial:ecommerce-product": "commercial",
  "commercial:brand-advertising": "commercial",
  "commercial:social-media": "commercial",
  "commercial:corporate-promo": "commercial",
  "series:marketing-campaign": "series",
  "series:ecommerce-detail": "series",
  "series:social-content": "series",
  "series:brand-visual": "series",
  "series:storyboard": "series",
  "series:logo-design": "series",
  "composition:rule-of-thirds": "composition",
  "composition:center-symmetry": "composition",
  "composition:leading-lines": "composition",
  "composition:frame-within-frame": "composition",
  "composition:diagonal-dynamic": "composition",
  "composition:negative-space": "composition",
  "composition:foreground-depth": "composition",
  "composition:golden-spiral": "composition",
  "composition:close-crop": "composition",
  "composition:flat-lay": "composition",
  "detailed:material-texture": "detailed",
  "detailed:lighting-enhancement": "detailed",
  "detailed:environment-atmosphere": "detailed",
  "creative:surreal-collage": "creative",
  "creative:double-exposure": "creative",
  "creative:glitch-art": "creative",
  "creative:fantasy-world": "creative"
};

const promptOptimizeStyleValues = new Set([
  ...promptOptimizeMainStyles,
  ...Object.keys(promptOptimizeSubStyleParents)
]);

function promptTemplatePresetOrderSql(alias = "prompt_templates") {
  const cases = promptTemplatePresets
    .map(() => `when ${alias}.name = ? and ${alias}.category = ? then ?`)
    .join(" ");
  return `case ${cases} else 999 end`;
}

function promptTemplatePresetOrderParams() {
  return promptTemplatePresets.flatMap((template, index) => [
    template.name,
    template.category,
    index + 1
  ]);
}

function visibilityOf(value: unknown): PromptTemplateVisibility {
  const text = String(value ?? "").trim();
  if (text === "shared") return text;
  return "private";
}

function asJsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asJsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizePromptOptimizeStyle(value: unknown, styleGroups?: PromptOptimizeStyleGroup[]): PromptOptimizeStyle {
  const text = String(value ?? "").trim();
  if (promptOptimizeStyleValues.has(text)) return text;
  if (styleGroups && promptOptimizeStyleGroupsToOptions(styleGroups, true).some((option) => option.value === text)) return text;
  return "standard";
}

function normalizePromptOptimizeImageCount(value: unknown) {
  const count = Number(value);
  if (!Number.isFinite(count)) return undefined;
  const integer = Math.floor(count);
  if (integer <= 0) return undefined;
  return Math.min(integer, 10);
}

function normalizePromptOptimizeCustomInstruction(value: unknown) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return "";
  return Array.from(text).slice(0, 500).join("");
}

function parentPromptOptimizeStyle(optimizeStyle: PromptOptimizeStyle, styleGroups?: PromptOptimizeStyleGroup[]) {
  const normalizedStyle = normalizePromptOptimizeStyle(optimizeStyle, styleGroups);
  const preferenceOption = styleGroups ? preferencePromptOptimizeStyleOption(normalizedStyle, styleGroups, true) : null;
  return promptOptimizeSubStyleParents[normalizedStyle] ?? preferenceOption?.parentValue ?? normalizedStyle;
}

function seriesPromptImageCountContext(optimizeStyle: PromptOptimizeStyle, imageCount?: number, styleGroups?: PromptOptimizeStyleGroup[]) {
  if (parentPromptOptimizeStyle(optimizeStyle, styleGroups) !== "series") return null;
  const normalizedCount = normalizePromptOptimizeImageCount(imageCount);
  const requestedImageCount = normalizedCount && normalizedCount > 1 ? normalizedCount : null;
  const planCount = requestedImageCount ?? 4;
  return {
    requestedImageCount,
    planCount,
    mode: requestedImageCount ? "numbered-series" : "default-series-plan"
  };
}

function seriesPromptImageCountInstructions(optimizeStyle: PromptOptimizeStyle, imageCount?: number, styleGroups?: PromptOptimizeStyleGroup[]) {
  const context = seriesPromptImageCountContext(optimizeStyle, imageCount, styleGroups);
  if (!context) return [];
  if (context.requestedImageCount) {
    return [
      `当前生成数量为 ${context.requestedImageCount} 张；优化结果应按 1-${context.requestedImageCount} 编号规划 ${context.requestedImageCount} 张不同用途的单张图片。`
    ];
  }
  return [
    "当前生成数量未提供或为 1 张；组图优化仍应输出完整系列方案，默认按 4 张核心套图规划，并清楚标出每张图的不同用途。",
    "不要只输出第一张，不要写“系列第一张”“非当前生成”“后续可延展方向”等会让用户以为只有第一张可用的表达。"
  ];
}

type PromptLanguageKey = "zh" | "en";

function countChineseCharacters(value: string) {
  return value.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
}

function countLatinLetters(value: string) {
  return value.match(/[A-Za-z]/g)?.length ?? 0;
}

function promptLanguageFromText(value: string): PromptLanguageKey {
  return countChineseCharacters(value) > 0 ? "zh" : "en";
}

function plainPromptViolatesLanguageLock(value: string, language: PromptLanguageKey) {
  const text = value.trim();
  if (!text || language !== "zh") return false;
  const chineseCount = countChineseCharacters(text);
  const latinCount = countLatinLetters(text);
  if (chineseCount === 0) return true;
  return latinCount >= 24 && latinCount > chineseCount * 4;
}

function localizedTextRecord(value: unknown) {
  const record = asJsonObject(value);
  const result: Partial<Record<PromptLanguageKey, string>> = {};
  const zh = String(record.zh ?? record.cn ?? record.chinese ?? "").trim();
  const en = String(record.en ?? record.english ?? "").trim();
  if (zh) result.zh = zh;
  if (en) result.en = en;
  return result;
}

function publicPromptTemplate(row: PromptTemplateRow, currentUserId: string, styleGroups?: PromptOptimizeStyleGroup[]) {
  const visibility = visibilityOf(row.visibility);
  const isOwner = Boolean(row.user_id && row.user_id === currentUserId);
  return {
    id: row.id,
    userId: row.user_id ?? "",
    ownerName: row.owner_name ?? "",
    visibility,
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon || "Sparkles",
    optimizeStyle: normalizePromptOptimizeStyle(row.optimize_style, styleGroups),
    components: asJsonArray(safeJson(row.components_json, [])),
    rules: asJsonObject(safeJson(row.rules_json, {})),
    output: asJsonObject(safeJson(row.output_json, {})),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canEdit: isOwner,
    canDelete: isOwner,
    canShare: isOwner,
    canCopy: !isOwner
  };
}

function resultBasePromptEn(row: PromptTemplateResultRow) {
  const direct = String(row.base_prompt_en ?? "").trim();
  if (direct) return direct;
  if (!row.template_id) return "";
  const translation = getOne<{ base_prompt_en: string }>(
    appDb,
    `select base_prompt_en
     from prompt_template_base_translations
     where template_id = ? and user_id = ? and base_prompt = ?
     order by updated_at desc
     limit 1`,
    row.template_id,
    row.user_id,
    row.base_prompt
  );
  return String(translation?.base_prompt_en ?? "").trim();
}

function publicPromptTemplateResult(row: PromptTemplateResultRow) {
  const metadata = asJsonObject(safeJson(row.sections_json, {}));
  const optimizedPrompts = localizedTextRecord(metadata.promptVersions ?? metadata.optimizedPrompts);
  const negativePrompts = localizedTextRecord(metadata.negativePromptVersions ?? metadata.negativePrompts);
  const basePromptEn = resultBasePromptEn(row);
  if (row.optimized_prompt) optimizedPrompts.zh = row.optimized_prompt;
  if (row.optimized_prompt_en) optimizedPrompts.en = row.optimized_prompt_en;
  if (!optimizedPrompts.zh && !optimizedPrompts.en) optimizedPrompts.zh = row.optimized_prompt;
  if (row.negative_prompt) negativePrompts.zh = row.negative_prompt;
  if (row.negative_prompt_en) negativePrompts.en = row.negative_prompt_en;
  return {
    id: row.id,
    templateId: row.template_id ?? "",
    language: row.language,
    basePrompt: row.base_prompt,
    basePromptEn,
    optimizedPrompt: row.optimized_prompt,
    optimizedPrompts,
    negativePrompt: row.negative_prompt,
    negativePrompts,
    providerName: row.provider_name,
    model: row.model,
    templateSnapshot: asJsonObject(safeJson(row.template_snapshot_json, {})),
    formSnapshot: asJsonObject(safeJson(row.form_snapshot_json, {})),
    createdAt: row.created_at
  };
}

function publicPromptTemplateBaseTranslation(row: PromptTemplateBaseTranslationRow | null) {
  if (!row) return null;
  return {
    templateId: row.template_id,
    signature: row.signature,
    basePrompt: row.base_prompt,
    basePromptEn: row.base_prompt_en,
    negativePrompt: row.negative_prompt,
    negativePromptEn: row.negative_prompt_en,
    providerName: row.provider_name,
    model: row.model,
    updatedAt: row.updated_at
  };
}

function publicPromptTemplateFormDraft(row: PromptTemplateFormDraftRow | null) {
  if (!row) return null;
  return {
    templateId: row.template_id,
    formValues: asJsonObject(safeJson(row.form_values_json, {})),
    updatedAt: row.updated_at
  };
}

function visibleTemplate(id: string, userId: string) {
  return getOne<PromptTemplateRow>(
    appDb,
    `select prompt_templates.*, users.username as owner_name
     from prompt_templates
     left join users on users.id = prompt_templates.user_id
     where prompt_templates.id = ?
       and (
        prompt_templates.visibility = 'shared'
        or prompt_templates.user_id = ?
       )`,
    id,
    userId
  );
}

function ownedEditableTemplate(id: string, userId: string) {
  const row = getOne<PromptTemplateRow>(
    appDb,
    "select * from prompt_templates where id = ?",
    id
  );
  if (!row) return { row: null, error: "表单不存在", status: 404 };
  if (row.user_id !== userId) return { row: null, error: "只能编辑自己创建的表单", status: 403 };
  return { row, error: "", status: 200 };
}

function visiblePromptTemplateForUser(id: string, userId: string) {
  const row = visibleTemplate(id, userId);
  if (!row) return { row: null, error: "表单不存在", status: 404 };
  return { row, error: "", status: 200 };
}

function snapshotFromRow(row: PromptTemplateRow, userId: string) {
  return publicPromptTemplate(row, userId, userPreferences(userId).promptOptimizeStyleGroups);
}

function normalizeTemplatePayload(body: Record<string, unknown>, fallback?: PromptTemplateRow, styleGroups?: PromptOptimizeStyleGroup[]) {
  const name = String(body.name ?? fallback?.name ?? "").trim();
  const description = String(body.description ?? fallback?.description ?? "").trim();
  const category = String(body.category ?? fallback?.category ?? "").trim();
  const icon = String(body.icon ?? fallback?.icon ?? "Sparkles").trim() || "Sparkles";
  const optimizeStyle = normalizePromptOptimizeStyle(body.optimizeStyle ?? fallback?.optimize_style, styleGroups);
  const components = asJsonArray(body.components ?? safeJson(fallback?.components_json, []));
  const rules = asJsonObject(body.rules ?? safeJson(fallback?.rules_json, {}));
  const output = asJsonObject(body.output ?? safeJson(fallback?.output_json, {}));
  const manualNegativePrompt = String(rules.negativePrompt ?? "").trim();
  return {
    name,
    description,
    category,
    icon,
    optimizeStyle,
    componentsJson: JSON.stringify(components),
    rulesJson: JSON.stringify(rules),
    outputJson: JSON.stringify({
      ...output,
      negativeEnabled: manualNegativePrompt ? false : Boolean(output.negativeEnabled)
    })
  };
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function looksLikeJsonPayload(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("{") || trimmed.startsWith("```json")) return true;
  return /"(promptZh|promptEn|items|negativePromptZh|negativePromptEn)"\s*:/.test(trimmed);
}

function formatPromptImageSize(bytes: unknown) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 100 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function promptImageFileText(file: Record<string, unknown>) {
  const name = String(file.fileName ?? "").trim();
  if (!name) return "";
  const dimensions = Number(file.width) > 0 && Number(file.height) > 0 ? `${file.width}x${file.height}` : "";
  const size = formatPromptImageSize(file.size);
  const meta = [dimensions, size].filter(Boolean).join("，");
  return meta ? `${name}（${meta}）` : name;
}

function promptTemplateValueText(component: Record<string, unknown>, value: unknown) {
  if (component.type === "image") {
    if (typeof value === "string") return value.trim() || String(component.defaultValue ?? "").trim();
    const imageValue = asJsonObject(value);
    const files = asJsonArray(imageValue.files).map((file) => asJsonObject(file));
    const fileTexts = files.map(promptImageFileText).filter(Boolean);
    const fileName = String(imageValue.fileName ?? "").trim();
    const note = String(imageValue.note ?? "").trim();
    if (fileTexts.length > 0) {
      return [
        `已上传 ${fileTexts.length} 个素材：${fileTexts.join("；")}`,
        note ? `备注：${note}` : ""
      ].filter(Boolean).join("；");
    }
    if (!fileName && !note) return String(component.defaultValue ?? "").trim();
    if (!fileName) return `素材备注：${note}`;
    return [
      `已上传 ${fileName}`,
      note ? `备注：${note}` : ""
    ].filter(Boolean).join("；");
  }
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join("、");
  return String(value ?? component.defaultValue ?? "").trim();
}

function sortedTemplateComponents(template: ReturnType<typeof publicPromptTemplate>) {
  return asJsonArray(template.components)
    .map((component) => asJsonObject(component))
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
}

type PromptStructureItem = {
  id: string;
  slot: string;
  label: string;
  type: string;
  original: string;
};

function promptStructureItems(template: ReturnType<typeof publicPromptTemplate>, formValues: unknown) {
  const rules = asJsonObject(template.rules);
  const labels = asJsonObject(rules.labels);
  const values = asJsonObject(formValues);
  const items: PromptStructureItem[] = [];
  for (const component of sortedTemplateComponents(template)) {
    const type = String(component.type ?? "");
    if (type === "section") continue;
    const id = String(component.id ?? "").trim();
    if (!id) continue;
    const slot = String(component.slot ?? "").trim();
    const original = promptTemplateValueText(component, values[id]).trim();
    if (!original) continue;
    const label = String(component.label ?? (slot ? labels[slot] : "") ?? id).trim() || id;
    items.push({ id, slot, label, type, original });
  }
  return items;
}

function normalizeAiValue(value: unknown) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join("、");
  if (typeof value === "object") {
    const record = asJsonObject(value);
    return String(record.value ?? record.optimizedValue ?? record.optimized_value ?? record.text ?? record.content ?? "").trim();
  }
  return String(value).trim();
}

function stripRepeatedItemLabel(value: string, item: PromptStructureItem) {
  let next = value.trim();
  for (const key of [item.label, item.slot, item.id]) {
    const label = String(key ?? "").trim();
    if (!label) continue;
    if (next.startsWith(`${label}：`)) next = next.slice(label.length + 1).trim();
    if (next.startsWith(`${label}:`)) next = next.slice(label.length + 1).trim();
  }
  return next;
}

function itemKeyMap(items: PromptStructureItem[]) {
  const map = new Map<string, string>();
  for (const item of items) {
    for (const key of [item.id, item.slot, item.label]) {
      const text = String(key ?? "").trim();
      if (!text) continue;
      map.set(text, item.id);
      map.set(text.toLowerCase(), item.id);
    }
  }
  return map;
}

function collectItemValuesFromObject(value: unknown, items: PromptStructureItem[]) {
  const values: Record<string, string> = {};
  const keys = itemKeyMap(items);
  const record = asJsonObject(value);
  for (const [key, rawValue] of Object.entries(record)) {
    const id = keys.get(key.trim()) ?? keys.get(key.trim().toLowerCase());
    if (!id) continue;
    const text = normalizeAiValue(rawValue);
    if (text) values[id] = text;
  }
  return values;
}

function collectItemValuesFromArray(value: unknown, items: PromptStructureItem[]) {
  const values: Record<string, string> = {};
  const keys = itemKeyMap(items);
  for (const rawItem of asJsonArray(value)) {
    const item = asJsonObject(rawItem);
    const key = String(item.id ?? item.slot ?? item.label ?? item.name ?? item.key ?? "").trim();
    const id = keys.get(key) ?? keys.get(key.toLowerCase());
    if (!id) continue;
    const text = normalizeAiValue(item.value ?? item.optimizedValue ?? item.optimized_value ?? item.text ?? item.content);
    if (text) values[id] = text;
  }
  return values;
}

function parseItemValuesFromPrompt(prompt: string, items: PromptStructureItem[]) {
  const values: Record<string, string> = {};
  const lines = prompt.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const item of items) {
    const labels = [item.label, item.slot, item.id].map((label) => String(label ?? "").trim()).filter(Boolean);
    for (const line of lines) {
      const matched = labels.find((label) => line.startsWith(`${label}：`) || line.startsWith(`${label}:`));
      if (!matched) continue;
      const text = line.slice(matched.length + 1).trim();
      if (text) values[item.id] = text;
      break;
    }
  }
  return values;
}

function outputLanguageLine(language: string, promptLanguage?: PromptLanguageKey) {
  if (promptLanguage === "en" || language === "en") return "Output language: English";
  if (promptLanguage === "zh" || language === "zh") return "输出语言：中文";
  return `输出语言：${languageLabel(language)}`;
}

function templateManualNegativePrompt(template: ReturnType<typeof publicPromptTemplate>) {
  const rules = asJsonObject(template.rules);
  return String(rules.negativePrompt ?? "").trim();
}

function buildLockedPrompt({
  template,
  items,
  values,
  language,
  labelOverrides,
  promptLanguage
}: {
  template: ReturnType<typeof publicPromptTemplate>;
  items: PromptStructureItem[];
  values: Record<string, string>;
  language: string;
  labelOverrides?: Record<string, string>;
  promptLanguage?: PromptLanguageKey;
}) {
  const rules = asJsonObject(template.rules);
  const parts: string[] = [];
  const prefix = String(rules.prefix ?? "").trim();
  const suffix = String(rules.suffix ?? "").trim();
  if (prefix) parts.push(prefix);
  for (const item of items) {
    const text = stripRepeatedItemLabel(String(values[item.id] ?? item.original).trim(), item);
    if (!text) continue;
    const label = String(labelOverrides?.[item.id] ?? item.label).trim() || item.label;
    parts.push(`${label}${promptLanguage === "en" ? ": " : "："}${text}`);
  }
  parts.push(outputLanguageLine(language, promptLanguage));
  if (suffix) parts.push(suffix);
  const joiner = String(rules.joiner ?? "\n") || "\n";
  return parts.join(joiner);
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return "";
}

function pickNestedString(value: unknown, keys: string[]) {
  const record = asJsonObject(value);
  return pickString(record, keys);
}

function promptTextFromPossiblyJson(value: string, language: PromptLanguageKey): string {
  const text = value.trim();
  if (!looksLikeJsonPayload(text)) return text;
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  return promptVersionFromRecord(parsed as Record<string, unknown>, language);
}

function promptVersionFromRecord(record: Record<string, unknown>, language: PromptLanguageKey): string {
  const directKeys = language === "zh"
    ? ["promptZh", "prompt_zh", "zhPrompt", "chinesePrompt", "optimizedPromptZh", "optimized_prompt_zh", "finalPromptZh"]
    : ["promptEn", "prompt_en", "enPrompt", "englishPrompt", "optimizedPromptEn", "optimized_prompt_en", "finalPromptEn"];
  const nestedKeys = language === "zh" ? ["zh", "cn", "chinese"] : ["en", "english"];
  const text = (
    pickString(record, directKeys)
    || pickNestedString(record.prompts, nestedKeys)
    || pickNestedString(record.promptVersions, nestedKeys)
    || pickNestedString(record.optimizedPrompts, nestedKeys)
  );
  return promptTextFromPossiblyJson(text, language);
}

function negativePromptVersionFromRecord(record: Record<string, unknown>, language: PromptLanguageKey) {
  const directKeys = language === "zh"
    ? ["negativePromptZh", "negative_prompt_zh", "zhNegativePrompt", "negativeZh", "negative_zh"]
    : ["negativePromptEn", "negative_prompt_en", "enNegativePrompt", "negativeEn", "negative_en"];
  const nestedKeys = language === "zh" ? ["zh", "cn", "chinese"] : ["en", "english"];
  const nestedNegativePrompt = typeof record.negativePrompt === "object" ? record.negativePrompt : null;
  return (
    pickString(record, directKeys)
    || pickNestedString(record.negativePrompts, nestedKeys)
    || pickNestedString(record.negativePromptVersions, nestedKeys)
    || pickNestedString(nestedNegativePrompt, nestedKeys)
  );
}

function collectLocalizedItemValuesFromArray(value: unknown, items: PromptStructureItem[]) {
  const keys = itemKeyMap(items);
  const zh: Record<string, string> = {};
  const en: Record<string, string> = {};
  const labelEn: Record<string, string> = {};
  for (const rawItem of asJsonArray(value)) {
    const item = asJsonObject(rawItem);
    const key = String(item.id ?? item.slot ?? item.label ?? item.name ?? item.key ?? "").trim();
    const id = keys.get(key) ?? keys.get(key.toLowerCase());
    if (!id) continue;
    const zhText = normalizeAiValue(item.valueZh ?? item.value_zh ?? item.zh ?? item.chineseValue ?? item.chinese);
    const enText = normalizeAiValue(item.valueEn ?? item.value_en ?? item.en ?? item.englishValue ?? item.english);
    const enLabel = String(item.labelEn ?? item.label_en ?? item.englishLabel ?? item.nameEn ?? item.name_en ?? "").trim();
    if (zhText) zh[id] = zhText;
    if (enText) en[id] = enText;
    if (enLabel) labelEn[id] = enLabel;
  }
  return { zh, en, labelEn };
}

function hasRecordValues(record: Record<string, string>) {
  return Object.values(record).some((value) => String(value ?? "").trim());
}

function parseAiContent(
  content: string,
  context: {
    template: ReturnType<typeof publicPromptTemplate>;
    formValues: unknown;
    language: string;
    basePrompt: string;
  }
) {
  const items = promptStructureItems(context.template, context.formValues);
  const sections = items.map((item) => ({ id: item.id, label: item.label, original: item.original, optimized: item.original }));
  let values: Record<string, string> = {};
  let zhValues: Record<string, string> = {};
  let enValues: Record<string, string> = {};
  let enLabels: Record<string, string> = {};
  let promptZh = "";
  let promptEn = "";
  let genericPrompt = "";
  let negativePromptZh = "";
  let negativePromptEn = "";
  let genericNegativePrompt = "";
  const parsed = extractJsonObject(content);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    promptZh = promptVersionFromRecord(record, "zh");
    promptEn = promptVersionFromRecord(record, "en");
    genericPrompt = promptTextFromPossiblyJson(pickString(record, ["prompt", "optimizedPrompt", "optimized_prompt", "finalPrompt", "final_prompt"]), context.language === "en" ? "en" : "zh");
    negativePromptZh = negativePromptVersionFromRecord(record, "zh");
    negativePromptEn = negativePromptVersionFromRecord(record, "en");
    genericNegativePrompt = typeof record.negativePrompt === "string"
      ? record.negativePrompt.trim()
      : pickString(record, ["negative_prompt", "negative", "negativePrompt"]);
    const localizedItems = collectLocalizedItemValuesFromArray(record.items ?? record.optimizedItems ?? record.components, items);
    values = {
      ...values,
      ...collectItemValuesFromObject(record.fieldValues ?? record.fields ?? record.values, items),
      ...collectItemValuesFromObject(record.items ?? record.optimizedItems ?? record.components, items),
      ...collectItemValuesFromArray(record.items ?? record.optimizedItems ?? record.components, items)
    };
    zhValues = {
      ...collectItemValuesFromObject(record.fieldValuesZh ?? record.fieldsZh ?? record.valuesZh ?? record.field_values_zh, items),
      ...localizedItems.zh
    };
    enValues = {
      ...collectItemValuesFromObject(record.fieldValuesEn ?? record.fieldsEn ?? record.valuesEn ?? record.field_values_en, items),
      ...localizedItems.en
    };
    enLabels = localizedItems.labelEn;
    const promptValues = genericPrompt ? parseItemValuesFromPrompt(genericPrompt, items) : {};
    for (const item of items) {
      const fromPrompt = String(promptValues[item.id] ?? "").trim();
      if (!fromPrompt) continue;
      const current = String(values[item.id] ?? "").trim();
      if (!current || current === item.original) values[item.id] = fromPrompt;
    }
    if (genericPrompt && Object.keys(values).length === 0) {
      values = parseItemValuesFromPrompt(genericPrompt, items);
    }
  } else {
    values = parseItemValuesFromPrompt(content, items);
    genericPrompt = looksLikeJsonPayload(content) ? "" : content.trim();
  }
  const fallbackZh = buildLockedPrompt({
    template: context.template,
    items,
    values: { ...values, ...zhValues },
    language: "zh",
    promptLanguage: "zh"
  });
  const fallbackEn = buildLockedPrompt({
    template: context.template,
    items,
    values: { ...values, ...enValues },
    language: "en",
    labelOverrides: enLabels,
    promptLanguage: "en"
  });
  const hasGenericFieldValues = hasRecordValues(values);
  const hasZhFieldValues = hasRecordValues(zhValues);
  const hasEnFieldValues = hasRecordValues(enValues);
  const canFormatZh = context.language !== "en" && (hasGenericFieldValues || hasZhFieldValues);
  const canFormatEn = context.language === "en"
    ? (hasGenericFieldValues || hasEnFieldValues)
    : hasEnFieldValues;
  const finalPromptZh = canFormatZh ? fallbackZh : (promptZh || genericPrompt || fallbackZh);
  const finalPromptEn = canFormatEn ? fallbackEn : (promptEn || (context.language === "en" ? genericPrompt || fallbackEn : ""));
  const optimizedPrompt = context.language === "en" ? finalPromptEn : finalPromptZh;
  if (!negativePromptZh && context.language !== "en") negativePromptZh = genericNegativePrompt;
  if (!negativePromptEn && context.language === "en") negativePromptEn = genericNegativePrompt;
  const negativePrompt = context.language === "en" ? negativePromptEn : negativePromptZh;
  const promptVersions: Partial<Record<PromptLanguageKey, string>> = {};
  const negativePromptVersions: Partial<Record<PromptLanguageKey, string>> = {};
  if (context.language !== "en" && finalPromptZh) promptVersions.zh = finalPromptZh;
  if (context.language !== "zh" && finalPromptEn) promptVersions.en = finalPromptEn;
  if (negativePromptZh) negativePromptVersions.zh = negativePromptZh;
  if (negativePromptEn) negativePromptVersions.en = negativePromptEn;
  const sectionValues = context.language === "en" ? { ...values, ...enValues } : { ...values, ...zhValues };
  const optimizedSections = items.map((item) => ({
    id: item.id,
    label: item.label,
    original: item.original,
    optimized: stripRepeatedItemLabel(String(sectionValues[item.id] ?? item.original).trim(), item)
  }));
  return {
    optimizedPrompt: optimizedPrompt || context.basePrompt,
    negativePrompt,
    promptVersions,
    negativePromptVersions,
    sections: optimizedSections.length > 0 ? optimizedSections : sections
  };
}

function chatContentText(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return item;
      const record = asJsonObject(item);
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

function shouldSendDeepSeekThinkingMode(provider: PromptOptimizerProviderRow) {
  return [provider.name, provider.base_url, provider.endpoint_path, provider.model]
    .some((value) => String(value ?? "").toLowerCase().includes("deepseek"));
}

function streamFrameContent(frame: string) {
  let content = "";
  const payloads = frame
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  const candidates = payloads.length > 0 ? payloads : [frame.trim()].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const data = JSON.parse(candidate);
      const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
      const choices = Array.isArray(record.choices) ? record.choices : [];
      for (const choiceValue of choices) {
        const choice = choiceValue && typeof choiceValue === "object" ? choiceValue as Record<string, unknown> : {};
        const delta = choice.delta && typeof choice.delta === "object" ? choice.delta as Record<string, unknown> : {};
        const message = choice.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : {};
        content += chatContentText(delta.content ?? message.content ?? choice.text);
      }
    } catch {
      // Ignore comments, keep-alives, and partial frames until a complete JSON payload arrives.
    }
  }
  return content;
}

async function readStreamingChatCompletion(response: Response, onContent?: (delta: string, content: string) => void) {
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
      const delta = streamFrameContent(frame);
      if (delta) {
        content += delta;
        onContent?.(delta, content);
      }
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const delta = streamFrameContent(buffer);
    if (delta) {
      content += delta;
      onContent?.(delta, content);
    }
  }
  return content.trim();
}

function decodeJsonStringPrefix(content: string, start: number) {
  let value = "";
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (char === "\"") break;
    if (char !== "\\") {
      value += char;
      continue;
    }
    index += 1;
    if (index >= content.length) break;
    const escaped = content[index];
    if (escaped === "n") value += "\n";
    else if (escaped === "r") value += "\r";
    else if (escaped === "t") value += "\t";
    else if (escaped === "b") value += "\b";
    else if (escaped === "f") value += "\f";
    else if (escaped === "u") {
      const hex = content.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
    } else {
      value += escaped;
    }
  }
  return value;
}

function streamingJsonFieldValue(content: string, keys: string[]) {
  for (const key of keys) {
    const marker = `"${key}"`;
    let keyIndex = content.indexOf(marker);
    while (keyIndex >= 0) {
      let index = keyIndex + marker.length;
      while (/\s/.test(content[index] ?? "")) index += 1;
      if (content[index] !== ":") {
        keyIndex = content.indexOf(marker, keyIndex + marker.length);
        continue;
      }
      index += 1;
      while (/\s/.test(content[index] ?? "")) index += 1;
      if (content[index] !== "\"") return "";
      return decodeJsonStringPrefix(content, index + 1);
    }
  }
  return "";
}

function streamingPromptPreview(content: string, language: string) {
  const primaryKeys = language === "en"
    ? ["promptEn", "prompt_en", "englishPrompt", "optimizedPromptEn"]
    : ["promptZh", "prompt_zh", "chinesePrompt", "optimizedPromptZh"];
  return streamingJsonFieldValue(content, primaryKeys)
    || streamingJsonFieldValue(content, ["optimizedPrompt", "optimized_prompt", "finalPrompt", "final_prompt", "prompt"]);
}

type PromptModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type PromptStreamDelta = {
  language: PromptLanguageKey;
  delta: string;
  reset?: boolean;
  phase: "optimize" | "translate";
};

function emitPromptStreamDelta(
  onPreview: ((delta: PromptStreamDelta) => void) | undefined,
  state: { text: string },
  language: PromptLanguageKey,
  phase: PromptStreamDelta["phase"],
  nextText: string
) {
  const text = nextText.trim();
  if (!text || text === state.text) return;
  if (text.startsWith(state.text)) {
    const delta = text.slice(state.text.length);
    if (delta) onPreview?.({ language, delta, phase, ...(state.text ? {} : { reset: true }) });
  } else {
    onPreview?.({ language, delta: text, phase, reset: true });
  }
  state.text = text;
}

type ParsedPlainPrompt = {
  prompt: string;
  negativePrompt: string;
};

const NEGATIVE_PROMPT_SEPARATOR = "---NEGATIVE PROMPT---";

type PromptOptimizeStyleConfig = {
  label: string;
  temperature?: number;
  instructions: string[];
  rules: Record<string, unknown>;
};

const promptOptimizeStyleConfigs: Record<string, PromptOptimizeStyleConfig> = {
  standard: {
    label: "标准风格",
    instructions: [
      "使用标准优化风格：在准确保留用户意图的基础上，让提示词更完整、更清晰、更适合直接生图。"
    ],
    rules: {
      balance: "clarity, usability, visual completeness"
    }
  },
  realistic: {
    label: "写实风格",
    temperature: 0.62,
    instructions: [
      "使用写实风格：强化真实摄影感，补充专业摄影词汇，如镜头焦段、景深、光线方向、曝光、质感和真实材质。",
      "画面应像真实拍摄或高质量商业摄影，不要加入卡通化、插画化或不符合现实物理的效果。"
    ],
    rules: {
      balance: "photorealism, lens, lighting, material realism",
      avoid: "cartoon, illustration, physically implausible effects"
    }
  },
  cinematic: {
    label: "电影风格",
    temperature: 0.78,
    instructions: [
      "使用电影风格：强化叙事感、镜头语言、构图层次、色调、光影反差、情绪氛围和场景张力。",
      "可以加入电影摄影常用表达，如 cinematic lighting、wide shot、close-up、depth of field、film grain、color grading，但必须服务用户主题。"
    ],
    rules: {
      balance: "storytelling, camera language, mood, color grading",
      avoid: "unrelated plot changes or excessive drama"
    }
  },
  anime: {
    label: "动漫风格",
    temperature: 0.72,
    instructions: [
      "使用动漫风格：面向二次元、动画、角色插画和日系/国风插画表达，补充线稿、赛璐璐上色、角色神态、画面层次和背景氛围。",
      "如果用户原始需求不是动漫或插画，也要保持主题和用途不变，只把视觉语言转向动漫插画。"
    ],
    rules: {
      balance: "anime illustration, character expression, line art, cel shading",
      avoid: "breaking the requested subject or intended use"
    }
  },
  artistic: {
    label: "艺术风格",
    temperature: 0.82,
    instructions: [
      "使用艺术风格：往绘画和艺术创作方向改写，加入媒介、艺术流派、笔触、肌理、色彩关系和画家风格参考。",
      "艺术化描述要与主题匹配，避免堆砌互相冲突的流派或画家风格。"
    ],
    rules: {
      balance: "art movement, painterly texture, brushwork, color harmony",
      avoid: "conflicting art styles"
    }
  },
  commercial: {
    label: "商业质感",
    temperature: 0.55,
    instructions: [
      "使用商业质感风格：突出品牌感、产品价值、视觉高级感、干净构图和可转化的商业表达。",
      "避免过度艺术化，优先让画面适合广告、海报、电商、运营或品牌展示。"
    ],
    rules: {
      balance: "brand value, premium look, conversion-oriented clarity",
      avoid: "overly abstract art direction"
    }
  },
  series: {
    label: "组图",
    temperature: 0.62,
    instructions: [
      "使用组图风格：把用户需求优化成适合连续生成多张图的一组提示词，核心是统一视觉系统、明确分图用途和稳定主体一致性。",
      "必须保留同一主体、品牌名、产品特征、角色设定、配色、光线、构图语言和视觉调性；每张图承担不同功能，不要只是重复同一张图。",
      "输出应是一个可直接复制使用的系列提示词，包含统一视觉约束和按编号排列的分图规划；不要生成拼图、九宫格或把多张图挤在同一画面里。"
    ],
    rules: {
      balance: "series consistency, shared visual system, distinct image roles",
      outputMode: "one reusable prompt with numbered image plan",
      avoid: "collage, grid layout, unrelated variations, changing subject identity"
    }
  },
  composition: {
    label: "构图",
    temperature: 0.64,
    instructions: [
      "使用构图优化：不改变用户指定画风和主题，重点根据提示词类型自动选择合适的构图手法。",
      "先判断原始提示词适合三分法、中心对称、引导线、框中框、对角线动势、留白构图、前景层次、黄金螺旋、近景裁切、平铺俯拍或其他主流构图，再补充匹配的主体位置、画幅倾向、镜头距离、视线动线、留白、前中后景和视觉层级。",
      "如果用户已明确指定构图、比例、机位或排版，必须优先保留；不要强行套用不匹配的构图手法。"
    ],
    rules: {
      balance: "composition selection, visual hierarchy, subject placement, framing",
      autoSelect: "rule of thirds, center symmetry, leading lines, frame within frame, diagonal dynamic, negative space, foreground depth, golden spiral, close crop, flat lay",
      avoid: "changing art style or forcing an unrelated composition technique"
    }
  },
  detailed: {
    label: "细节丰富",
    temperature: 0.75,
    instructions: [
      "使用细节丰富风格：重点补充主体细节、材质、光线、镜头、构图、背景层次、色彩和质感。",
      "细节要服务画面可执行性，不要堆砌互相冲突的形容词。"
    ],
    rules: {
      balance: "materials, lighting, lens, composition, scene depth",
      avoid: "conflicting adjectives"
    }
  },
  creative: {
    label: "创意强化",
    temperature: 0.9,
    instructions: [
      "使用创意强化风格：可以加入更有想象力的画面概念、氛围、叙事感和视觉张力。",
      "创意补充必须围绕用户原意展开，不要改变主题、用途、品牌、数量、比例和硬性约束。"
    ],
    rules: {
      balance: "imagination, atmosphere, visual tension",
      avoid: "changing required constraints"
    }
  }
};

const promptOptimizeSubStyleConfigs: Record<string, PromptOptimizeStyleConfig> = {
  "realistic:portrait-photography": {
    label: "人像摄影",
    temperature: 0.6,
    instructions: [
      "子风格方向：人像摄影。强化浅景深、自然肤质、眼神情绪、面部光影、背景虚化和真实摄影质感。",
      "如果包含人物，优先补充镜头焦段、光源位置、肤色质感、服装细节和情绪表达。"
    ],
    rules: { subStyle: "portrait photography", balance: "skin texture, shallow depth of field, emotional lighting" }
  },
  "realistic:commercial-product": {
    label: "商业产品",
    temperature: 0.54,
    instructions: [
      "子风格方向：商业产品摄影。强化干净背景、精准布光、产品材质、边缘高光、阴影控制和卖点呈现。",
      "画面应适合电商详情页、广告主图或品牌展示，不要让背景抢走主体。"
    ],
    rules: { subStyle: "commercial product photography", balance: "clean background, controlled lighting, material highlights" }
  },
  "realistic:documentary-street": {
    label: "纪实街拍",
    temperature: 0.66,
    instructions: [
      "子风格方向：纪实街拍。强化自然光、抓拍瞬间、生活现场感、轻微颗粒和真实环境细节。",
      "避免过度摆拍和棚拍感，让画面像真实街头或日常场景中捕捉到的瞬间。"
    ],
    rules: { subStyle: "documentary street photography", balance: "available light, candid moment, film grain" }
  },
  "realistic:landscape-blockbuster": {
    label: "风光大片",
    temperature: 0.66,
    instructions: [
      "子风格方向：风光大片。强化黄金时段、广角视野、壮阔层次、云影、地貌尺度和空气透视。",
      "画面应有强空间感和自然景观震撼力，同时保留用户指定地点或主体。"
    ],
    rules: { subStyle: "epic landscape photography", balance: "golden hour, wide angle, scale, atmospheric perspective" }
  },
  "realistic:macro-closeup": {
    label: "微距特写",
    temperature: 0.58,
    instructions: [
      "子风格方向：微距特写。强化极近距离、细小纹理、焦外虚化、微小高光和局部细节。",
      "主体应清晰可识别，背景可高度虚化，但不要丢失用户指定的关键元素。"
    ],
    rules: { subStyle: "macro close-up", balance: "extreme detail, bokeh, tiny textures" }
  },
  "realistic:fashion-editorial": {
    label: "时尚大片",
    temperature: 0.68,
    instructions: [
      "子风格方向：时尚大片。强化杂志质感、高级造型、姿态、服装材质、大片布光和精致构图。",
      "优先呈现高级、克制、利落的视觉表达，不要堆砌廉价装饰。"
    ],
    rules: { subStyle: "fashion editorial", balance: "premium styling, magazine lighting, pose, wardrobe texture" }
  },
  "cinematic:hollywood-blockbuster": {
    label: "好莱坞大片",
    temperature: 0.8,
    instructions: [
      "子风格方向：好莱坞大片。强化史诗规模、强对比、英雄式构图、动作张力、大场面光影和视觉冲击。",
      "可以补充 dramatic backlight、epic wide shot、high contrast、large-scale set pieces 等表达，但不要改变主体设定。"
    ],
    rules: { subStyle: "hollywood blockbuster", balance: "epic scale, high contrast, visual impact" }
  },
  "cinematic:cyberpunk": {
    label: "赛博朋克",
    temperature: 0.84,
    instructions: [
      "子风格方向：赛博朋克。强化霓虹灯、雨夜反光、未来都市、电子屏、金属材质、潮湿街道和冷暖色冲突。",
      "保持用户主题不变，将视觉语言转向高科技与低生活感并存的未来城市氛围。"
    ],
    rules: { subStyle: "cyberpunk", balance: "neon, rainy night, futuristic city, reflective surfaces" }
  },
  "cinematic:film-noir": {
    label: "黑色电影",
    temperature: 0.72,
    instructions: [
      "子风格方向：黑色电影。强化高反差黑白、硬光阴影、百叶窗光、悬疑感、烟雾和低调构图。",
      "画面应克制、紧张、带有经典悬疑电影的阴影叙事。"
    ],
    rules: { subStyle: "film noir", balance: "black and white, hard shadows, suspense, low-key lighting" }
  },
  "cinematic:european-art-house": {
    label: "欧洲文艺",
    temperature: 0.7,
    instructions: [
      "子风格方向：欧洲文艺。强化自然光、慢节奏、真实克制的表演感、生活化场景和留白构图。",
      "避免夸张戏剧化，画面应更安静、细腻、带有人文气质。"
    ],
    rules: { subStyle: "european art-house cinema", balance: "natural light, restraint, quiet composition" }
  },
  "cinematic:horror-thriller": {
    label: "恐怖惊悚",
    temperature: 0.82,
    instructions: [
      "子风格方向：恐怖惊悚。强化低照度、压抑空间、冷色阴影、未知威胁、诡异细节和紧张氛围。",
      "保持主题边界，不要加入血腥暴力或与用户需求无关的恐怖元素。"
    ],
    rules: { subStyle: "horror thriller", balance: "low light, oppressive mood, uncanny details" }
  },
  "cinematic:historical-epic": {
    label: "古装史诗",
    temperature: 0.78,
    instructions: [
      "子风格方向：古装史诗。强化历史质感、宫廷或战场规模、服饰纹样、年代材质、宏大构图和庄重光影。",
      "补充时代氛围时要服务用户主题，不要编造冲突的年代、阵营或文化元素。"
    ],
    rules: { subStyle: "historical epic", balance: "period texture, grand scale, costume detail, solemn lighting" }
  },
  "cinematic:sci-fi-space": {
    label: "科幻太空",
    temperature: 0.8,
    instructions: [
      "子风格方向：科幻太空。强化宇宙尺度、飞船结构、未来科技界面、冷色金属、星云和太空光影。",
      "科技设定要清晰可信，避免让装饰性元素破坏主体可读性。"
    ],
    rules: { subStyle: "sci-fi space", balance: "spaceships, cosmic scale, futuristic technology, metallic surfaces" }
  },
  "anime:ghibli": {
    label: "吉卜力",
    temperature: 0.72,
    instructions: [
      "子风格方向：自然温暖的手绘动画感。强化柔和自然、田园场景、手绘水彩质感、温暖光线和童话般生活气息。",
      "不要使用受版权保护的角色或标志，只提炼自然、温暖、细腻的动画视觉语言。"
    ],
    rules: { subStyle: "warm hand-drawn animation", balance: "nature, watercolor softness, gentle atmosphere" }
  },
  "anime:shonen-action": {
    label: "少年热血",
    temperature: 0.78,
    instructions: [
      "子风格方向：少年热血。强化高速动作、夸张姿态、速度线、爆炸特效、能量冲击和强烈表情。",
      "动作要清晰有力，避免让特效遮住主体。"
    ],
    rules: { subStyle: "shonen action", balance: "dynamic pose, impact effects, speed lines, expressive face" }
  },
  "anime:shinkai": {
    label: "新海诚",
    temperature: 0.72,
    instructions: [
      "子风格方向：唯美现实动画感。强化光晕、逆光、细腻天空、城市背景、玻璃反光、空气感和清透色彩。",
      "不要直接模仿在世创作者的个人画风，只保留光影、背景精细度和唯美现实氛围。"
    ],
    rules: { subStyle: "lyrical realistic anime", balance: "glow, detailed background, sky, reflective light" }
  },
  "anime:cel-animation": {
    label: "赛璐璐",
    temperature: 0.68,
    instructions: [
      "子风格方向：赛璐璐。强化复古动画平涂、干净线稿、明确色块、少量阴影和胶片时代动画质感。",
      "色彩和边线要清晰稳定，避免过度真实渲染。"
    ],
    rules: { subStyle: "cel animation", balance: "flat color, clean line art, limited shadows, retro anime" }
  },
  "anime:mecha-battle": {
    label: "机甲战斗",
    temperature: 0.78,
    instructions: [
      "子风格方向：机甲战斗。强化硬核机械结构、装甲分件、关节细节、能量武器、战斗姿态和工业尺度。",
      "不要使用具体受版权保护的机体名称或标志，重点描述原创机械设计语言。"
    ],
    rules: { subStyle: "mecha battle", balance: "armor plates, mechanical joints, weapons, industrial scale" }
  },
  "anime:shojo-dreamy": {
    label: "少女唯美",
    temperature: 0.74,
    instructions: [
      "子风格方向：少女唯美。强化柔和粉色、花卉、闪光、轻盈服饰、梦幻背景和温柔表情。",
      "保持画面清爽甜美，不要过度堆叠装饰。"
    ],
    rules: { subStyle: "dreamy shojo", balance: "pastel color, flowers, sparkle, gentle expression" }
  },
  "anime:dark-gothic": {
    label: "暗黑哥特",
    temperature: 0.8,
    instructions: [
      "子风格方向：暗黑哥特。强化地下城、哥特建筑、冷暗配色、神秘符号、暗影层次和奇诡氛围。",
      "可以加入黑暗幻想感，但不要偏离用户指定主体。"
    ],
    rules: { subStyle: "dark gothic anime", balance: "gothic architecture, dark fantasy, shadow layers" }
  },
  "artistic:classical-oil": {
    label: "油画古典",
    temperature: 0.78,
    instructions: [
      "子风格方向：油画古典。强化古典油画媒介、厚重明暗、伦勃朗式光影、文艺复兴构图和细腻肌理。",
      "艺术参考要统一，不要混入冲突的现代数字特效。"
    ],
    rules: { subStyle: "classical oil painting", balance: "chiaroscuro, renaissance composition, oil texture" }
  },
  "artistic:watercolor-illustration": {
    label: "水彩插画",
    temperature: 0.76,
    instructions: [
      "子风格方向：水彩插画。强化透明颜料、湿润晕染、轻盈边缘、纸张纹理和柔和留白。",
      "保持画面清透，不要加入厚重油画或高反差金属质感。"
    ],
    rules: { subStyle: "watercolor illustration", balance: "transparent wash, bloom, paper texture, lightness" }
  },
  "artistic:concept-art": {
    label: "概念艺术",
    temperature: 0.84,
    instructions: [
      "子风格方向：概念艺术。强化游戏/影视概念设计、清晰剪影、世界观信息、设计逻辑、场景尺度和视觉探索。",
      "补充设定时要让主体更可执行，不要只堆形容词。"
    ],
    rules: { subStyle: "concept art", balance: "design logic, silhouette, worldbuilding, production art" }
  },
  "artistic:pop-art": {
    label: "波普艺术",
    temperature: 0.82,
    instructions: [
      "子风格方向：波普艺术。强化高饱和色块、重复图案、网点印刷、强图形感和广告文化视觉。",
      "保持主体轮廓醒目，避免复杂纹样影响识别。"
    ],
    rules: { subStyle: "pop art", balance: "high saturation, repeated pattern, halftone, graphic contrast" }
  },
  "artistic:minimalism": {
    label: "极简主义",
    temperature: 0.62,
    instructions: [
      "子风格方向：极简主义。强化几何构成、大面积留白、纯色块、少量关键元素和清晰秩序。",
      "尽量减少无关细节，让用户指定主体以最少元素被准确表达。"
    ],
    rules: { subStyle: "minimalism", balance: "geometry, negative space, simple color blocks" }
  },
  "artistic:surrealism": {
    label: "超现实主义",
    temperature: 0.9,
    instructions: [
      "子风格方向：超现实主义。强化梦境逻辑、尺度错位、象征元素、意外组合和奇异空间关系。",
      "创意变化必须围绕用户原始主题，不能替换主体或关键约束。"
    ],
    rules: { subStyle: "surrealism", balance: "dream logic, symbolic objects, unexpected scale" }
  },
  "artistic:pixel-art": {
    label: "像素艺术",
    temperature: 0.7,
    instructions: [
      "子风格方向：像素艺术。强化 8-bit/16-bit 复古游戏感、有限色板、清晰像素块、等距或横版构图。",
      "确保主体在低分辨率视觉语言下仍然可读。"
    ],
    rules: { subStyle: "pixel art", balance: "limited palette, visible pixels, retro game readability" }
  },
  "commercial:ecommerce-product": {
    label: "电商产品",
    temperature: 0.52,
    instructions: [
      "子风格方向：电商产品。强化简洁背景、清晰卖点、主体居中、材质展示、可购买感和信息直达。",
      "画面应服务商品转化，不要加入分散注意力的复杂剧情。"
    ],
    rules: { subStyle: "ecommerce product", balance: "clean background, selling points, product clarity" }
  },
  "commercial:brand-advertising": {
    label: "品牌广告",
    temperature: 0.58,
    instructions: [
      "子风格方向：品牌广告。强化高端调性、视觉统一、品牌价值、情绪场景、版式留白和广告大片感。",
      "如果有品牌名或文字内容，必须保留并服务统一调性。"
    ],
    rules: { subStyle: "brand advertising", balance: "premium tone, brand consistency, campaign visual" }
  },
  "commercial:social-media": {
    label: "社交媒体",
    temperature: 0.72,
    instructions: [
      "子风格方向：社交媒体。强化高饱和抓眼、活泼构图、明确焦点、短平快传播感和移动端可读性。",
      "画面要第一眼吸引注意，但不要牺牲主体识别。"
    ],
    rules: { subStyle: "social media visual", balance: "eye-catching color, mobile readability, energetic composition" }
  },
  "commercial:corporate-promo": {
    label: "企业宣传",
    temperature: 0.54,
    instructions: [
      "子风格方向：企业宣传。强化专业、可信、大气、整洁办公或行业场景、稳重配色和清晰信息层级。",
      "避免过度娱乐化，让画面适合官网、展会或企业介绍。"
    ],
    rules: { subStyle: "corporate promotion", balance: "professional, trustworthy, clean hierarchy" }
  },
  "series:marketing-campaign": {
    label: "营销套图",
    temperature: 0.58,
    instructions: [
      "子风格方向：营销套图。将需求拆成主视觉、核心卖点、使用场景、活动氛围、封面或收尾图等不同用途。",
      "每张图要共享品牌调性、配色、主体和光影，但构图与信息重点要有差异，适合一次生成多张用于同一活动。"
    ],
    rules: { subStyle: "marketing campaign series", balance: "hero visual, selling points, scenes, campaign consistency" }
  },
  "series:ecommerce-detail": {
    label: "电商详情",
    temperature: 0.54,
    instructions: [
      "子风格方向：电商详情。将产品需求拆成主图、材质细节、使用场景、卖点说明、规格对比或包装展示。",
      "强调商品可购买感、主体清晰、背景干净和细节可信；不要让每张图都变成同一角度的重复产品照。"
    ],
    rules: { subStyle: "ecommerce detail series", balance: "main image, detail close-up, usage scene, selling point breakdown" }
  },
  "series:social-content": {
    label: "社媒内容",
    temperature: 0.68,
    instructions: [
      "子风格方向：社媒内容。将需求拆成封面、正文配图、步骤图、对比图、情绪图或结尾引导图。",
      "画面要适合移动端浏览，重点清晰、节奏有变化，保持同一套颜色、字体氛围和视觉记忆点。"
    ],
    rules: { subStyle: "social content series", balance: "cover, feed image, step visual, comparison, mobile readability" }
  },
  "series:brand-visual": {
    label: "品牌延展",
    temperature: 0.56,
    instructions: [
      "子风格方向：品牌延展。将需求拆成品牌主视觉、海报、Banner、包装或空间应用等延展画面。",
      "品牌名称、视觉符号、色彩系统和高级感要稳定统一，所有分图应像同一品牌项目下的系列物料。"
    ],
    rules: { subStyle: "brand visual extension", balance: "key visual, poster, banner, packaging, brand applications" }
  },
  "series:storyboard": {
    label: "故事分镜",
    temperature: 0.7,
    instructions: [
      "子风格方向：故事分镜。将同一角色、产品或场景拆成连续镜头，明确起承转合、镜头距离和场景变化。",
      "必须保持角色外观、产品形态、服装、道具和世界观一致；每张图推进一个动作或情绪节点。"
    ],
    rules: { subStyle: "storyboard series", balance: "same subject, sequential shots, scene progression, camera distance" }
  },
  "series:logo-design": {
    label: "Logo设计",
    temperature: 0.5,
    instructions: [
      "子风格方向：Logo设计。生成一组 logo 方案或品牌延展图，而不是单张拼图；保持品牌名称、行业、调性和核心符号一致。",
      "分图应覆盖主标志、图形符号、字标组合、黑白版或反白版、名片/包装/门头等应用场景；适合多张连续生成后挑选和延展。",
      "明确避免复杂小字、难识别细节、仿冒知名品牌或受版权保护的商标；如果用户给了品牌名，必须原样保留品牌名。"
    ],
    rules: {
      subStyle: "logo design series",
      balance: "logo concepts, symbol mark, wordmark, monochrome, brand applications",
      avoid: "tiny unreadable text, trademark imitation, over-detailed marks"
    }
  },
  "composition:rule-of-thirds": {
    label: "三分法",
    temperature: 0.62,
    instructions: [
      "子风格方向：三分法构图。将主体或关键视觉焦点放在三分线交点附近，平衡主体、环境和留白。",
      "画面要稳定、自然、有呼吸感，不要让主体贴边或落在无意义的位置。"
    ],
    rules: { subStyle: "rule of thirds composition", balance: "thirds grid, balanced subject placement, natural negative space" }
  },
  "composition:center-symmetry": {
    label: "中心对称",
    temperature: 0.56,
    instructions: [
      "子风格方向：中心对称构图。强化居中主体、轴线对称、左右平衡、稳定秩序和仪式感。",
      "适合需要正式、庄重、产品级或建筑秩序的画面；避免无意义的倾斜和杂乱背景。"
    ],
    rules: { subStyle: "centered symmetry composition", balance: "center focus, symmetry axis, visual order" }
  },
  "composition:leading-lines": {
    label: "引导线",
    temperature: 0.64,
    instructions: [
      "子风格方向：引导线构图。使用道路、栏杆、建筑线条、光束、河流或视线方向把观看者目光导向主体。",
      "线条必须服务主体和空间深度，不要为了线条而破坏主题。"
    ],
    rules: { subStyle: "leading lines composition", balance: "visual path, directional lines, depth, subject guidance" }
  },
  "composition:frame-within-frame": {
    label: "框中框",
    temperature: 0.66,
    instructions: [
      "子风格方向：框中框构图。使用门窗、拱门、树枝、前景物、屏幕或建筑结构形成天然画框，集中注意力。",
      "框架元素应增强层次和叙事，不要遮挡主体关键信息。"
    ],
    rules: { subStyle: "frame within frame composition", balance: "foreground frame, subject focus, depth layering" }
  },
  "composition:diagonal-dynamic": {
    label: "对角线动势",
    temperature: 0.72,
    instructions: [
      "子风格方向：对角线动势构图。用斜向主体、倾斜线条、动作轨迹或光影方向制造速度感、冲突感和画面张力。",
      "动势要清晰可读，避免让主体失衡或关键元素被切碎。"
    ],
    rules: { subStyle: "diagonal dynamic composition", balance: "diagonal movement, tension, action direction" }
  },
  "composition:negative-space": {
    label: "留白构图",
    temperature: 0.58,
    instructions: [
      "子风格方向：留白构图。使用大面积干净背景、空白区域或低信息区突出主体、情绪和文字空间。",
      "留白应有设计感和呼吸感，不要变成主体太小或信息不足。"
    ],
    rules: { subStyle: "negative space composition", balance: "minimal background, breathing room, clear focus" }
  },
  "composition:foreground-depth": {
    label: "前景层次",
    temperature: 0.66,
    instructions: [
      "子风格方向：前景层次构图。安排前景遮挡、中景主体和远景背景，强化空间纵深、透视和沉浸感。",
      "前景只能辅助层次，不要喧宾夺主或挡住核心主体。"
    ],
    rules: { subStyle: "foreground depth composition", balance: "foreground, midground, background, perspective depth" }
  },
  "composition:golden-spiral": {
    label: "黄金螺旋",
    temperature: 0.66,
    instructions: [
      "子风格方向：黄金螺旋构图。用弧线、旋转动线或元素尺度递进组织画面，让视觉自然汇聚到主体。",
      "螺旋关系要自然融入画面，不要显得机械或刻意。"
    ],
    rules: { subStyle: "golden spiral composition", balance: "spiral flow, visual rhythm, focal convergence" }
  },
  "composition:close-crop": {
    label: "近景裁切",
    temperature: 0.62,
    instructions: [
      "子风格方向：近景裁切构图。通过大胆近景、局部裁切、边缘切入和大主体比例强化细节、表情、质感或冲击力。",
      "裁切要有设计目的，不能切掉用户明确要求完整展示的关键信息。"
    ],
    rules: { subStyle: "close crop composition", balance: "tight framing, detail impact, intentional crop" }
  },
  "composition:flat-lay": {
    label: "平铺俯拍",
    temperature: 0.6,
    instructions: [
      "子风格方向：平铺俯拍构图。采用俯视视角、平面排列、网格秩序、间距控制和图案化关系组织主体。",
      "元素摆放要清晰、有节奏，避免堆叠混乱。"
    ],
    rules: { subStyle: "flat lay composition", balance: "top-down view, grid order, spacing rhythm, pattern layout" }
  },
  "detailed:material-texture": {
    label: "材质纹理",
    temperature: 0.7,
    instructions: [
      "子风格方向：材质纹理。重点强化布料、金属、玻璃、皮肤、木材、石材等真实表面质感和触感细节。",
      "材质描述要和主体匹配，不要给不相关元素强行添加纹理。"
    ],
    rules: { subStyle: "material texture", balance: "surface detail, tactile quality, realistic material" }
  },
  "detailed:lighting-enhancement": {
    label: "光影强化",
    temperature: 0.7,
    instructions: [
      "子风格方向：光影强化。重点补充主光、辅光、轮廓光、阴影层次、反射、高光和明暗节奏。",
      "光源方向要清晰一致，避免互相冲突的光影描述。"
    ],
    rules: { subStyle: "lighting enhancement", balance: "key light, rim light, shadow hierarchy, highlights" }
  },
  "detailed:environment-atmosphere": {
    label: "环境氛围",
    temperature: 0.76,
    instructions: [
      "子风格方向：环境氛围。重点强化烟雾、粒子、体积光、空气湿度、背景层次和场景包裹感。",
      "氛围要服务主题，不要让环境特效遮挡主体。"
    ],
    rules: { subStyle: "environment atmosphere", balance: "fog, particles, volumetric light, scene depth" }
  },
  "creative:surreal-collage": {
    label: "超现实拼贴",
    temperature: 0.92,
    instructions: [
      "子风格方向：超现实拼贴。强化打破常规的元素组合、拼贴层次、异质材质并置和奇异叙事感。",
      "拼贴元素必须围绕用户原意展开，不能变成无关概念集合。"
    ],
    rules: { subStyle: "surreal collage", balance: "unexpected combination, layered collage, concept coherence" }
  },
  "creative:double-exposure": {
    label: "双重曝光",
    temperature: 0.84,
    instructions: [
      "子风格方向：双重曝光。强化两个影像层的叠加融合、轮廓承载画面、透明过渡和诗意关联。",
      "两层影像要有清晰关系，避免主体变得不可辨认。"
    ],
    rules: { subStyle: "double exposure", balance: "image blending, silhouette, translucent layers" }
  },
  "creative:glitch-art": {
    label: "故障艺术",
    temperature: 0.86,
    instructions: [
      "子风格方向：故障艺术。强化数字噪点、扫描线、色彩错位、数据破碎、屏幕失真和科技不稳定感。",
      "故障效果要增强风格，不要破坏关键信息和主体轮廓。"
    ],
    rules: { subStyle: "glitch art", balance: "digital noise, chromatic offset, scanlines, distortion" }
  },
  "creative:fantasy-world": {
    label: "奇幻世界观",
    temperature: 0.92,
    instructions: [
      "子风格方向：奇幻世界观。强化架空世界、异世界规则、独特建筑、生物、符号系统和沉浸式场景设定。",
      "世界观补充要围绕用户主题，保留数量、比例、用途和硬性约束。"
    ],
    rules: { subStyle: "fantasy worldbuilding", balance: "fictional world, architecture, symbols, immersive setting" }
  }
};

function resolvedPromptOptimizeStyleConfig(optimizeStyle: PromptOptimizeStyle, styleGroups?: PromptOptimizeStyleGroup[]) {
  const normalizedStyle = normalizePromptOptimizeStyle(optimizeStyle, styleGroups);
  const parentStyle = parentPromptOptimizeStyle(normalizedStyle, styleGroups);
  const parentConfig = promptOptimizeStyleConfigs[parentStyle] ?? promptOptimizeStyleConfigs.standard;
  const subConfig = promptOptimizeSubStyleConfigs[normalizedStyle];
  const baseConfig = !subConfig ? parentConfig : {
    label: `${parentConfig.label} / ${subConfig.label}`,
    temperature: subConfig.temperature ?? parentConfig.temperature,
    instructions: [
      ...parentConfig.instructions,
      ...subConfig.instructions
    ],
    rules: {
      ...parentConfig.rules,
      ...subConfig.rules,
      parentStyle,
      subStyleLabel: subConfig.label
    }
  };
  const preferenceOption = styleGroups ? preferencePromptOptimizeStyleOption(normalizedStyle, styleGroups, true) : null;
  const preferenceParent = preferenceOption?.parentValue && styleGroups
    ? preferencePromptOptimizeStyleOption(preferenceOption.parentValue, styleGroups, true)
    : null;
  const preferenceInstructions = [
    preferenceParent?.prompt?.trim() ? `用户自定义主风格方向：${preferenceParent.prompt.trim()}` : "",
    preferenceOption?.prompt?.trim() ? `用户自定义优化方向：${preferenceOption.prompt.trim()}` : ""
  ].filter(Boolean);
  if (!preferenceOption && preferenceInstructions.length === 0) return baseConfig;
  if (preferenceInstructions.length === 0 && promptOptimizeStyleValues.has(normalizedStyle)) return baseConfig;
  const label = preferenceOption
    ? (preferenceOption.parentLabel ? `${preferenceOption.parentLabel} / ${preferenceOption.label}` : preferenceOption.label)
    : baseConfig.label;
  const description = preferenceOption?.description?.trim() ?? "";
  return {
    ...baseConfig,
    label,
    instructions: [
      ...baseConfig.instructions,
      description ? `用户风格说明：${description}` : "",
      ...preferenceInstructions
    ].filter(Boolean),
    rules: {
      ...baseConfig.rules,
      userCustomStyle: true,
      userCustomStyleValue: normalizedStyle,
      userCustomStyleDescription: description
    }
  };
}

function stripPromptHeading(value: string) {
  let text = value.trim();
  const headingPatterns = [
    /^(?:正向提示词|AI提示词|优化提示词|提示词|Prompt|Positive prompt|Optimized prompt)\s*[:：]\s*/i,
    /^#+\s*(?:正向提示词|AI提示词|优化提示词|提示词|Prompt|Positive prompt|Optimized prompt)\s*\n+/i
  ];
  for (const pattern of headingPatterns) text = text.replace(pattern, "").trim();
  return text;
}

function cleanPromptPart(value: string, stripHeadings: boolean) {
  const text = value.replace(/\r\n/g, "\n").trim();
  return stripHeadings ? stripPromptHeading(text) : text;
}

function splitPlainPrompt(content: string, options: { stripHeadings?: boolean } = {}): ParsedPlainPrompt {
  const text = content.replace(/\r\n/g, "\n").trim();
  if (!text) return { prompt: "", negativePrompt: "" };
  const stripHeadings = options.stripHeadings !== false;
  const separatorIndex = text.toUpperCase().indexOf(NEGATIVE_PROMPT_SEPARATOR);
  if (separatorIndex >= 0) {
    return {
      prompt: cleanPromptPart(text.slice(0, separatorIndex), stripHeadings),
      negativePrompt: cleanPromptPart(text.slice(separatorIndex + NEGATIVE_PROMPT_SEPARATOR.length), stripHeadings)
    };
  }
  const lines = text.split("\n");
  const labelIndex = lines.findIndex((line) => /^(?:反向提示词|Negative prompt)\s*[:：]?\s*$/i.test(line.trim()));
  if (labelIndex >= 0) {
    return {
      prompt: cleanPromptPart(lines.slice(0, labelIndex).join("\n"), stripHeadings),
      negativePrompt: cleanPromptPart(lines.slice(labelIndex + 1).join("\n"), stripHeadings)
    };
  }
  const inlineIndex = lines.findIndex((line) => /^(?:反向提示词|Negative prompt)\s*[:：]/i.test(line.trim()));
  if (inlineIndex >= 0) {
    const line = lines[inlineIndex].replace(/^(?:反向提示词|Negative prompt)\s*[:：]\s*/i, "");
    return {
      prompt: cleanPromptPart(lines.slice(0, inlineIndex).join("\n"), stripHeadings),
      negativePrompt: cleanPromptPart([line, ...lines.slice(inlineIndex + 1)].join("\n"), stripHeadings)
    };
  }
  return { prompt: cleanPromptPart(text, stripHeadings), negativePrompt: "" };
}

async function requestPromptModelText({
  provider,
  messages,
  onContent,
  temperature,
  logContext
}: {
  provider: PromptOptimizerProviderRow;
  messages: PromptModelMessage[];
  onContent?: (delta: string, content: string) => void;
  temperature?: number;
  logContext: ModelRequestLogContext;
}) {
  const envKey = String(provider.api_key_env ?? "").trim();
  const endpoint = normalizePath(provider.base_url, provider.endpoint_path || "/chat/completions");
  const streamEnabled = Boolean(provider.stream_enabled);
  const maxTokens = Math.trunc(Number(provider.max_tokens ?? 0));
  const requestBody: Record<string, unknown> = {
    model: provider.model,
    messages,
    ...(streamEnabled ? { stream: true } : {})
  };
  const temperatureOverride = Number(temperature);
  const providerTemperature = provider.temperature == null ? null : Number(provider.temperature);
  const resolvedTemperature = Number.isFinite(temperatureOverride) ? temperatureOverride : providerTemperature;
  if (resolvedTemperature !== null && Number.isFinite(resolvedTemperature)) {
    requestBody.temperature = resolvedTemperature;
  }
  if (shouldSendDeepSeekThinkingMode(provider)) {
    requestBody.thinking = { type: (provider.thinking_enabled ?? 1) === 0 ? "disabled" : "enabled" };
  }
  if (maxTokens > 0) requestBody.max_tokens = maxTokens;
  const startedAt = Date.now();
  let attemptCount = 0;
  let statusCode: number | null = null;
  try {
    if (!promptOptimizerApiKey(provider)) {
      throw new Error(`提示词优化模型「${provider.name}」缺少 API Key，请在配置页填写密钥或环境变量 ${envKey || "API_KEY"}`);
    }
    const response = await fetchPromptOptimizerWithRetry(provider, endpoint, {
      method: "POST",
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
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
      const nestedError = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
      const message = String(nestedError?.message ?? record.message ?? text ?? response.statusText).trim();
      throw new Error(message || "提示词模型请求失败");
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    let content = "";
    if (streamEnabled && contentType.includes("text/event-stream")) {
      content = await readStreamingChatCompletion(response, (delta, nextContent) => onContent?.(delta, nextContent));
    } else {
      const text = await response.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      content = chatCompletionContent(data, text);
      if (content) onContent?.(content, content);
    }
    if (!content.trim()) throw new Error("提示词模型没有返回内容");
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
    return content.trim();
  } catch (error) {
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
    throw error;
  }
}

async function translatePromptTextWithProvider({
  provider,
  prompt,
  negativePrompt = "",
  onPreview,
  logContext
}: {
  provider: PromptOptimizerProviderRow;
  prompt: string;
  negativePrompt?: string;
  onPreview?: (delta: PromptStreamDelta) => void;
  logContext: ModelRequestLogContext;
}) {
  const content = [
    prompt.trim(),
    negativePrompt.trim() ? `${NEGATIVE_PROMPT_SEPARATOR}\n${negativePrompt.trim()}` : ""
  ].filter(Boolean).join("\n");
  const previewState = { text: "" };
  const translated = await requestPromptModelText({
    provider,
    messages: [
      {
        role: "system",
        content: [
          "你是严格的 AI 生图提示词中译英翻译器。",
          "把用户提供的中文提示词翻译成英文，必须以中文原文为唯一依据。",
          "这是纯翻译任务：不要优化、改写、概括、补充、删除、重排或合并任何内容。",
          "必须逐行翻译，并保留原来的行数、空行、段落、字段顺序、标点位置、分隔线和整体结构。",
          "第一行即使是任务说明或前置拼接文案，也必须完整翻译，不能省略。",
          "中文字段名翻译成对应英文字段名；字段内容只做等义翻译。",
          "文件名、尺寸、比例、品牌名、英文、数字、路径和不可翻译专有名词保持原样。",
          `如果输入里有 ${NEGATIVE_PROMPT_SEPARATOR}，输出中也必须在相同位置保留这条分隔线，分隔线前是英文正向提示词，分隔线后是英文 negative prompt。`,
          "只输出英文翻译文本，不要添加标题，不要 JSON，不要 Markdown，不要解释。"
        ].join("\n")
      },
      { role: "user", content }
    ],
    onContent: (_delta, nextContent) => {
      const preview = splitPlainPrompt(nextContent, { stripHeadings: false }).prompt || nextContent.trim();
      emitPromptStreamDelta(onPreview, previewState, "en", "translate", preview);
    },
    logContext
  });
  const parsed = splitPlainPrompt(translated, { stripHeadings: false });
  return { prompt: parsed.prompt, negativePrompt: negativePrompt.trim() ? parsed.negativePrompt : "" };
}

async function optimizePlainPromptWithProvider({
  provider,
  prompt,
  optimizeStyle = "standard",
  styleGroups,
  customInstruction = "",
  imageCount,
  onPreview,
  logContext
}: {
  provider: PromptOptimizerProviderRow;
  prompt: string;
  optimizeStyle?: PromptOptimizeStyle;
  styleGroups?: PromptOptimizeStyleGroup[];
  customInstruction?: string;
  imageCount?: number;
  onPreview?: (delta: PromptStreamDelta) => void;
  logContext: ModelRequestLogContext;
}) {
  const styleConfig = resolvedPromptOptimizeStyleConfig(optimizeStyle, styleGroups);
  const seriesImageContext = seriesPromptImageCountContext(optimizeStyle, imageCount, styleGroups);
  const temporaryInstruction = normalizePromptOptimizeCustomInstruction(customInstruction);
  const promptLanguage = promptLanguageFromText(prompt);
  const previewState = { text: "" };
  const outputLanguage = promptLanguage === "zh" ? "中文" : "English";
  const languageInstructions = (retryLanguageLock = false) => promptLanguage === "zh"
    ? [
        "输出语言锁定为中文。只要 originalPrompt 中包含中文，优化结果的主体描述必须使用中文。",
        "可以保留用户原文中的英文品牌名、文件名、UI 文字、模型关键词或不可翻译专有名词，但不能把整段提示词翻译成英文。",
        "如果需要补充英文生图关键词，也必须以中文描述为主，英文关键词只能作为少量辅助。",
        retryLanguageLock ? "上一轮输出疑似没有遵守中文要求；这次必须用中文重写，不允许返回英文段落。" : ""
      ].filter(Boolean)
    : [
        "输出语言锁定为英文。除用户明确要求保留的中文文字外，主体描述使用英文。",
        "保留必要的中文文字内容、品牌名、文件名和不可翻译专有名词。"
      ];
  const buildOptimizeMessages = (retryLanguageLock = false): PromptModelMessage[] => [
      {
        role: "system",
        content: [
          "你是专业的图像生成提示词优化器。",
          "用户会给你一段输入框里的自由提示词，不一定来自表单。",
          "请把它优化成更适合 AI 生图模型直接使用的提示词。",
          "必须保留用户的核心意图、主体、品牌名、文字内容、数量、比例、尺寸、风格和硬性约束。",
          "可以补充画面主体特征、构图、场景、材质、光线、镜头、氛围、细节层次和视觉执行信息。",
          "如果原文已经有多行结构，请尽量保留原来的段落和关键顺序；不要压成难读的一整段。",
          ...languageInstructions(retryLanguageLock),
          "不要输出 JSON，不要 Markdown，不要解释，不要添加标题，只输出优化后的提示词正文。",
          "优化后的提示词不能和原文一模一样；不要原样返回。",
          `当前优化风格：${styleConfig.label}。`,
          ...styleConfig.instructions,
          temporaryInstruction ? `用户自定义优化方向：${temporaryInstruction}` : "",
          temporaryInstruction ? "自定义优化方向优先级高于所选风格，但仍必须保留用户原始主体、用途和硬性约束。" : "",
          ...seriesPromptImageCountInstructions(optimizeStyle, imageCount, styleGroups)
        ].filter(Boolean).join("\n")
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            originalPrompt: prompt,
            optimizeStyle: {
              value: optimizeStyle,
              label: styleConfig.label,
              rules: styleConfig.rules
            },
            imageSeriesContext: seriesImageContext,
            customInstruction: temporaryInstruction,
            outputRules: {
              plainTextOnly: true,
              preserveUserIntent: true,
              improveForImageGeneration: true,
              keepImportantConstraints: true,
              outputLanguage,
              languageLock: promptLanguage === "zh"
                ? "主体描述必须使用中文；英文只能作为少量专有词或原文文字保留。"
                : "Main description must be English unless the user explicitly supplied Chinese text to preserve."
            }
          },
          null,
          2
        )
      }
    ];
  const requestOptimization = (retryLanguageLock = false) => requestPromptModelText({
    provider,
    temperature: styleConfig.temperature,
    messages: buildOptimizeMessages(retryLanguageLock),
    onContent: (_delta, nextContent) => {
      const preview = splitPlainPrompt(nextContent).prompt;
      emitPromptStreamDelta(onPreview, previewState, promptLanguage, "optimize", preview);
    },
    logContext
  });
  const optimizedContent = await requestOptimization();
  let parsed = splitPlainPrompt(optimizedContent);
  if (plainPromptViolatesLanguageLock(parsed.prompt, promptLanguage)) {
    try {
      const retryContent = await requestOptimization(true);
      const retryParsed = splitPlainPrompt(retryContent);
      parsed = plainPromptViolatesLanguageLock(retryParsed.prompt, promptLanguage)
        ? { prompt, negativePrompt: "" }
        : retryParsed;
    } catch {
      parsed = { prompt, negativePrompt: "" };
    }
  }
  return {
    prompt: parsed.prompt || prompt,
    negativePrompt: parsed.negativePrompt,
    providerName: provider.name,
    model: provider.model
  };
}

function languageLabel(value: unknown) {
  const text = String(value ?? "zh").trim();
  if (text === "en") return "English";
  if (text === "bilingual") return "中文和 English 双语";
  return "中文";
}

function defaultContentSeedKey(templateId: string) {
  return `${templateId}:${DEFAULT_CONTENT_SEED_VERSION}`;
}

function componentMigrationSignature(components: unknown) {
  return asJsonArray(components).map((component) => {
    const record = asJsonObject(component);
    return {
      id: String(record.id ?? ""),
      type: String(record.type ?? ""),
      label: String(record.label ?? ""),
      placeholder: String(record.placeholder ?? ""),
      defaultValue: String(record.defaultValue ?? ""),
      helpText: String(record.helpText ?? ""),
      slot: String(record.slot ?? ""),
      sortOrder: Number(record.sortOrder ?? 0),
      required: Boolean(record.required),
      multiple: Boolean(record.multiple),
      options: Array.isArray(record.options) ? record.options.map((option) => String(option ?? "")) : []
    };
  });
}

function componentsMatchLegacy(existingComponents: unknown, legacyComponents: unknown) {
  const legacySignature = componentMigrationSignature(legacyComponents);
  if (legacySignature.length === 0) return false;
  return JSON.stringify(componentMigrationSignature(existingComponents)) === JSON.stringify(legacySignature);
}

function clonePresetComponents(presetComponents: PromptTemplatePreset["components"]) {
  return presetComponents.map((component) => ({ ...asJsonObject(component) }));
}

function componentsWithPresetDefaults(
  existingComponents: unknown,
  presetComponents: PromptTemplatePreset["components"],
  legacyComponents: PromptTemplatePreset["legacyComponents"] = []
) {
  const components = asJsonArray(existingComponents).map((component) => asJsonObject(component));
  if (componentsMatchLegacy(components, legacyComponents)) {
    return { changed: true, replace: true, components: clonePresetComponents(presetComponents) };
  }
  const presetById = new Map(presetComponents.map((component) => [String(component.id ?? ""), component]));
  let changed = false;
  const next = components.map((component) => {
    const preset = presetById.get(String(component.id ?? ""));
    const presetDefault = String(preset?.defaultValue ?? "").trim();
    let nextComponent = component;
    if (String(component.type ?? "") === "image") {
      for (const field of ["label", "placeholder", "helpText", "defaultValue"]) {
        const currentValue = String(nextComponent[field] ?? "");
        if (currentValue.includes("参考图")) {
          changed = true;
          nextComponent = { ...nextComponent, [field]: currentValue.replaceAll("参考图", "素材") };
        }
      }
    }
    if (!presetDefault) return nextComponent;
    const currentDefault = String(component.defaultValue ?? "").trim();
    if (currentDefault) return nextComponent;
    changed = true;
    return { ...nextComponent, defaultValue: presetDefault };
  });
  return { changed, replace: false, components: next };
}

function ensureDefaultTemplateContentForUser(userId: string, template: PromptTemplatePreset) {
  const seedKey = defaultContentSeedKey(template.id);
  const seeded = getOne<{ seed_key: string }>(
    appDb,
    "select seed_key from prompt_template_default_seeds where user_id = ? and seed_key = ? limit 1",
    userId,
    seedKey
  );
  if (seeded) return;

  const timestamp = now();
  const row = getOne<PromptTemplateRow>(
    appDb,
    "select * from prompt_templates where user_id = ? and name = ? and category = ? order by created_at asc limit 1",
    userId,
    template.name,
    template.category
  );
  if (row) {
    const next = componentsWithPresetDefaults(safeJson(row.components_json, []), template.components, template.legacyComponents);
    if (next.changed) {
      if (next.replace) {
        const currentDescription = String(row.description ?? "").trim();
        const legacyDescriptions = new Set(template.legacyDescriptions ?? []);
        const nextDescription = currentDescription && !legacyDescriptions.has(currentDescription) ? row.description : template.description;
        run(
          appDb,
          "update prompt_templates set description = ?, components_json = ?, rules_json = ?, output_json = ?, updated_at = ? where id = ? and user_id = ?",
          nextDescription,
          JSON.stringify(next.components),
          JSON.stringify(template.rules),
          JSON.stringify(template.output),
          timestamp,
          row.id,
          userId
        );
      } else {
        run(
          appDb,
          "update prompt_templates set components_json = ?, updated_at = ? where id = ? and user_id = ?",
          JSON.stringify(next.components),
          timestamp,
          row.id,
          userId
        );
      }
    }
  }
  run(
    appDb,
    "insert or ignore into prompt_template_default_seeds (user_id, seed_key, created_at) values (?, ?, ?)",
    userId,
    seedKey,
    timestamp
  );
}

function insertPromptTemplatePresetForUser(userId: string, template: PromptTemplatePreset, timestamp: string) {
  const existing = getOne<{ id: string }>(
    appDb,
    "select id from prompt_templates where user_id = ? and name = ? and category = ? limit 1",
    userId,
    template.name,
    template.category
  );
  if (existing) return "";
  const id = makeId("prompttpl");
  run(
    appDb,
    `insert into prompt_templates (
      id, user_id, visibility, name, description, category, icon,
      optimize_style, components_json, rules_json, output_json, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    "private",
    template.name,
    template.description,
    template.category,
    template.icon,
    "standard",
    JSON.stringify(template.components),
    JSON.stringify(template.rules),
    JSON.stringify(template.output),
    timestamp,
    timestamp
  );
  return id;
}

function syncDefaultPromptTemplateIconForUser(userId: string, template: PromptTemplatePreset) {
  const row = getOne<{ id: string; icon: string | null }>(
    appDb,
    "select id, icon from prompt_templates where user_id = ? and name = ? and category = ? limit 1",
    userId,
    template.name,
    template.category
  );
  if (!row) return;
  const currentIcon = String(row.icon ?? "").trim();
  if (currentIcon === template.icon) return;
  if (currentIcon && !(template.legacyIcons ?? []).includes(currentIcon)) return;
  run(
    appDb,
    "update prompt_templates set icon = ?, updated_at = ? where id = ? and user_id = ?",
    template.icon,
    now(),
    row.id,
    userId
  );
}

function syncDefaultPromptTemplateRulesForUser(userId: string, template: PromptTemplatePreset) {
  const row = getOne<{ id: string; rules_json: string | null }>(
    appDb,
    "select id, rules_json from prompt_templates where user_id = ? and name = ? and category = ? limit 1",
    userId,
    template.name,
    template.category
  );
  if (!row) return;
  const rules = asJsonObject(safeJson(row.rules_json, {}));
  const currentPrefix = String(rules.prefix ?? "").trim();
  const nextPrefix = String((template.rules as Record<string, unknown>).prefix ?? "").trim();
  const legacyPrefixes = [
    "请生成一段可直接用于 AI 生图的专业提示词。",
    `请生成一段可直接用于 AI 生图的专业提示词。表单类型：${template.name}。`
  ];
  if (!nextPrefix || currentPrefix === nextPrefix || !legacyPrefixes.includes(currentPrefix)) return;
  run(
    appDb,
    "update prompt_templates set rules_json = ?, updated_at = ? where id = ? and user_id = ?",
    JSON.stringify({ ...rules, prefix: nextPrefix }),
    now(),
    row.id,
    userId
  );
}

function restoreDefaultPromptTemplatesForUser(userId: string) {
  const timestamp = now();
  const createdIds: string[] = [];
  for (const template of promptTemplatePresets) {
    const id = insertPromptTemplatePresetForUser(userId, template, timestamp);
    if (id) createdIds.push(id);
    run(
      appDb,
      "insert or ignore into prompt_template_default_seeds (user_id, seed_key, created_at) values (?, ?, ?)",
      userId,
      template.id,
      timestamp
    );
    ensureDefaultTemplateContentForUser(userId, template);
    syncDefaultPromptTemplateIconForUser(userId, template);
    syncDefaultPromptTemplateRulesForUser(userId, template);
  }
  return createdIds;
}

function ensureDefaultPromptTemplatesForUser(userId: string) {
  for (const template of promptTemplatePresets) {
    const seeded = getOne<{ seed_key: string }>(
      appDb,
      "select seed_key from prompt_template_default_seeds where user_id = ? and seed_key = ? limit 1",
      userId,
      template.id
    );
    const timestamp = now();
    if (!seeded) {
      const existing = getOne<{ id: string }>(
        appDb,
        "select id from prompt_templates where user_id = ? and name = ? and category = ? limit 1",
        userId,
        template.name,
        template.category
      );
      if (!existing) {
        insertPromptTemplatePresetForUser(userId, template, timestamp);
      }
      run(
        appDb,
        "insert or ignore into prompt_template_default_seeds (user_id, seed_key, created_at) values (?, ?, ?)",
        userId,
        template.id,
        timestamp
      );
    }
    ensureDefaultTemplateContentForUser(userId, template);
    syncDefaultPromptTemplateIconForUser(userId, template);
    syncDefaultPromptTemplateRulesForUser(userId, template);
  }
}

async function optimizePromptWithProvider({
  provider,
  template,
  formValues,
  basePrompt,
  negativeEnabled,
  optimizeStyle = "standard",
  styleGroups,
  customInstruction = "",
  manualNegativePrompt = "",
  onPreview,
  logContext
}: {
  provider: PromptOptimizerProviderRow;
  template: ReturnType<typeof publicPromptTemplate>;
  formValues: unknown;
  basePrompt: string;
  negativeEnabled: boolean;
  optimizeStyle?: PromptOptimizeStyle;
  styleGroups?: PromptOptimizeStyleGroup[];
  customInstruction?: string;
  manualNegativePrompt?: string;
  onPreview?: (delta: PromptStreamDelta) => void;
  logContext: ModelRequestLogBaseContext;
}) {
  const fixedNegativePrompt = manualNegativePrompt.trim();
  const aiNegativeEnabled = negativeEnabled && !fixedNegativePrompt;
  const styleConfig = resolvedPromptOptimizeStyleConfig(optimizeStyle, styleGroups);
  const seriesImageContext = seriesPromptImageCountContext(optimizeStyle, undefined, styleGroups);
  const temporaryInstruction = normalizePromptOptimizeCustomInstruction(customInstruction);
  const optimizePreviewState = { text: "" };
  const optimizedContent = await requestPromptModelText({
    provider,
    temperature: styleConfig.temperature,
    messages: [
      {
        role: "system",
        content: [
          "你是专业的图像生成提示词优化器。",
          "用户会给你一段已经按表单拼好的中文基础提示词。",
          "请直接输出优化后的中文完整提示词，不要 JSON，不要 Markdown，不要解释。",
          "必须保留原来的多行结构、字段顺序、输出语言行和结尾要求；不要压成一个自然段。",
          "字段名可以保持中文，字段内容要比原文更适合生图模型。",
          "优化后的提示词不能和基础提示词一模一样；不要原样返回整段基础提示词。",
          "对可扩写字段，要保留用户原意并补充专业画面信息，例如主体特征、构图、场景、材质、光线、镜头、氛围、细节层次、UI 规范等。",
          "短字段可以扩写成一句更具体的描述；长字段要重写得更清晰、更专业、更适合生图，但不要改变用户想表达的方向。",
          "画幅、平台、数量、尺寸这类约束字段应保留原约束，可只做轻微补充，不要编造不存在的选项。",
          "如果字段是素材或文件上传，只能优化备注描述；不要改写、翻译、编造文件名、图片尺寸和文件大小。",
          `当前优化风格：${styleConfig.label}。`,
          ...styleConfig.instructions,
          temporaryInstruction ? `用户自定义优化方向：${temporaryInstruction}` : "",
          temporaryInstruction ? "自定义优化方向优先级高于所选风格，但仍必须保留表单原始主体、用途、字段结构和硬性约束。" : "",
          ...seriesPromptImageCountInstructions(optimizeStyle, undefined, styleGroups),
          aiNegativeEnabled
            ? `如果需要反向提示词，在中文正向提示词后另起一行输出 ${NEGATIVE_PROMPT_SEPARATOR}，再输出中文反向提示词。`
            : "不要输出反向提示词，不要输出分隔线。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            templateName: template.name,
            templateCategory: template.category,
            requiredOutputLanguage: "zh",
            negativePromptEnabled: aiNegativeEnabled,
            manualNegativePrompt: fixedNegativePrompt,
            optimizeStyle: {
              value: optimizeStyle,
              label: styleConfig.label,
              rules: styleConfig.rules
            },
            imageSeriesContext: seriesImageContext,
            customInstruction: temporaryInstruction,
            basePrompt,
            formValues,
            lockedStructure: {
              prefix: String((template.rules as Record<string, unknown>)?.prefix ?? ""),
              fields: promptStructureItems(template, formValues).map((item) => ({
                id: item.id,
                label: item.label,
                type: item.type,
                originalValue: item.original
              })),
              outputLanguageLine: "输出语言：中文",
              suffix: String((template.rules as Record<string, unknown>)?.suffix ?? ""),
              joiner: String((template.rules as Record<string, unknown>)?.joiner ?? "\n")
            },
            optimizationRules: {
              keepStructure: true,
              outputPlainTextOnly: true,
              preserveLineBreaks: true,
              expandUsefulFields: true,
              avoidSameAsOriginal: true,
              preserveUserIntent: true,
              style: optimizeStyle,
              styleLabel: styleConfig.label
            }
          },
          null,
          2
        )
      }
    ],
    onContent: (_delta, nextContent) => {
      const prompt = splitPlainPrompt(nextContent).prompt;
      emitPromptStreamDelta(onPreview, optimizePreviewState, "zh", "optimize", prompt);
    },
    logContext: { ...logContext, purpose: "template.optimize" }
  });
  const parsedOptimized = splitPlainPrompt(optimizedContent);
  const optimizedPrompt = parsedOptimized.prompt || basePrompt;
  const negativePrompt = fixedNegativePrompt || (aiNegativeEnabled ? parsedOptimized.negativePrompt : "");
  const translated = await translatePromptTextWithProvider({
    provider,
    prompt: optimizedPrompt,
    negativePrompt,
    onPreview,
    logContext: { ...logContext, purpose: "template.translate" }
  });
  const translatedBasePrompt = await translatePromptTextWithProvider({
    provider,
    prompt: basePrompt,
    logContext: { ...logContext, purpose: "template.translate" }
  });
  return {
    basePromptEn: translatedBasePrompt.prompt,
    optimizedPrompt,
    optimizedPromptEn: translated.prompt,
    negativePrompt,
    negativePromptEn: translated.negativePrompt,
    sections: []
  };
}

type ParsedAiPromptContent = {
  optimizedPrompt: string;
  optimizedPromptEn?: string;
  negativePrompt: string;
  negativePromptEn?: string;
  basePromptEn?: string;
  sections?: Array<{ id: string; label: string; original: string; optimized: string }>;
};

function savePromptTemplateOptimizeResult({
  row,
  userId,
  language,
  basePrompt,
  formValues,
  optimized,
  negativeEnabled,
  provider
}: {
  row: PromptTemplateRow;
  userId: string;
  language: string;
  basePrompt: string;
  formValues: unknown;
  optimized: ParsedAiPromptContent;
  negativeEnabled: boolean;
  provider: PromptOptimizerProviderRow;
}) {
  const resultId = makeId("promptres");
  const timestamp = now();
  const templateSnapshot = snapshotFromRow(row, userId);
  run(
    appDb,
    `insert into prompt_template_results (
      id, template_id, user_id, template_snapshot_json, form_snapshot_json,
      language, base_prompt, base_prompt_en, optimized_prompt, optimized_prompt_en,
      sections_json, negative_prompt, negative_prompt_en, provider_name, model, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    resultId,
    row.id,
    userId,
    JSON.stringify(templateSnapshot),
    JSON.stringify(formValues ?? {}),
    language,
    basePrompt,
    optimized.basePromptEn ?? "",
    optimized.optimizedPrompt,
    optimized.optimizedPromptEn ?? "",
    JSON.stringify({ sections: optimized.sections ?? [] }),
    negativeEnabled ? optimized.negativePrompt : "",
    negativeEnabled ? optimized.negativePromptEn ?? "" : "",
    provider.name,
    provider.model,
    timestamp
  );
  const result = getOne<PromptTemplateResultRow>(appDb, "select * from prompt_template_results where id = ?", resultId);
  return result ? publicPromptTemplateResult(result) : null;
}

function streamPromptTemplateOptimizeResponse({
  row,
  userId,
  provider,
  template,
  formValues,
  language,
  basePrompt,
  negativeEnabled,
  optimizeStyle,
  styleGroups,
  customInstruction = "",
  manualNegativePrompt = "",
  source = "prompt-template"
}: {
  row: PromptTemplateRow;
  userId: string;
  provider: PromptOptimizerProviderRow;
  template: ReturnType<typeof publicPromptTemplate>;
  formValues: unknown;
  language: string;
  basePrompt: string;
  negativeEnabled: boolean;
  optimizeStyle: PromptOptimizeStyle;
  styleGroups?: PromptOptimizeStyleGroup[];
  customInstruction?: string;
  manualNegativePrompt?: string;
  source?: string;
}) {
  const encoder = new TextEncoder();
  let canceled = false;
  const sendFrame = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) => {
    if (canceled) return;
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const optimized = await optimizePromptWithProvider({
          provider,
          template,
          formValues,
          basePrompt,
          negativeEnabled,
          optimizeStyle,
          styleGroups,
          customInstruction,
          manualNegativePrompt,
          onPreview: (delta) => sendFrame(controller, "delta", delta),
          logContext: { userId, jobId: row.id, source }
        });
        const result = savePromptTemplateOptimizeResult({
          row,
          userId,
          language,
          basePrompt,
          formValues,
          optimized,
          negativeEnabled: Boolean(optimized.negativePrompt.trim()),
          provider
        });
        sendFrame(controller, "done", { result });
      } catch (error) {
        sendFrame(controller, "error", { error: error instanceof Error ? error.message : "提示词优化失败" });
      } finally {
        if (!canceled) controller.close();
      }
    },
    cancel() {
      canceled = true;
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

function streamPlainPromptOptimizeResponse({
  provider,
  prompt,
  optimizeStyle,
  styleGroups,
  customInstruction = "",
  imageCount,
  userId = "",
  source = "prompt-optimizer"
}: {
  provider: PromptOptimizerProviderRow;
  prompt: string;
  optimizeStyle: PromptOptimizeStyle;
  styleGroups?: PromptOptimizeStyleGroup[];
  customInstruction?: string;
  imageCount?: number;
  userId?: string;
  source?: string;
}) {
  const encoder = new TextEncoder();
  let canceled = false;
  const sendFrame = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) => {
    if (canceled) return;
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const optimized = await optimizePlainPromptWithProvider({
          provider,
          prompt,
          optimizeStyle,
          styleGroups,
          customInstruction,
          imageCount,
          onPreview: (delta) => sendFrame(controller, "delta", delta),
          logContext: { purpose: "prompt.optimize", userId, source }
        });
        sendFrame(controller, "done", optimized);
      } catch (error) {
        sendFrame(controller, "error", { error: error instanceof Error ? error.message : "提示词优化失败" });
      } finally {
        if (!canceled) controller.close();
      }
    },
    cancel() {
      canceled = true;
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

function streamPromptTemplateTranslationResponse({
  provider,
  templateId,
  userId,
  prompt,
  negativePrompt = "",
  signature = "",
  source = "prompt-template"
}: {
  provider: PromptOptimizerProviderRow;
  templateId?: string;
  userId?: string;
  prompt: string;
  negativePrompt?: string;
  signature?: string;
  source?: string;
}) {
  const encoder = new TextEncoder();
  let canceled = false;
  const sendFrame = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) => {
    if (canceled) return;
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const translated = await translatePromptTextWithProvider({
          provider,
          prompt,
          negativePrompt,
          onPreview: (delta) => sendFrame(controller, "delta", delta),
          logContext: { purpose: "template.translate", userId, jobId: templateId, source }
        });
        let translation: ReturnType<typeof publicPromptTemplateBaseTranslation> = null;
        if (templateId && userId && signature && translated.prompt.trim()) {
          const timestamp = now();
          run(
            appDb,
            `insert into prompt_template_base_translations (
              template_id, user_id, signature, base_prompt, base_prompt_en,
              negative_prompt, negative_prompt_en, provider_name, model, updated_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(template_id, user_id) do update set
              signature = excluded.signature,
              base_prompt = excluded.base_prompt,
              base_prompt_en = excluded.base_prompt_en,
              negative_prompt = excluded.negative_prompt,
              negative_prompt_en = excluded.negative_prompt_en,
              provider_name = excluded.provider_name,
              model = excluded.model,
              updated_at = excluded.updated_at`,
            templateId,
            userId,
            signature,
            prompt,
            translated.prompt,
            negativePrompt ?? "",
            translated.negativePrompt,
            provider.name,
            provider.model,
            timestamp
          );
          const row = getOne<PromptTemplateBaseTranslationRow>(
            appDb,
            "select * from prompt_template_base_translations where template_id = ? and user_id = ?",
            templateId,
            userId
          );
          translation = publicPromptTemplateBaseTranslation(row ?? null);
        }
        sendFrame(controller, "done", {
          text: translated.prompt,
          negativeText: translated.negativePrompt,
          translation
        });
      } catch (error) {
        sendFrame(controller, "error", { error: error instanceof Error ? error.message : "提示词翻译失败" });
      } finally {
        if (!canceled) controller.close();
      }
    },
    cancel() {
      canceled = true;
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeScriptJson(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

const PROMPT_TEMPLATE_EXPORT_TOKEN_SCOPE = "prompt-template-optimize";
const PROMPT_TEMPLATE_EXPORT_TOKEN_DAY_MS = 24 * 60 * 60 * 1000;
const PROMPT_TEMPLATE_EXPORT_SECRET_ID = "prompt-template-export";
const PROMPT_TEMPLATE_EXPORT_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400"
};

type PromptTemplateExportTokenPayload = {
  v: 1;
  scope: typeof PROMPT_TEMPLATE_EXPORT_TOKEN_SCOPE;
  templateId: string;
  userId: string;
  downloadId?: string;
  issuedAt?: number;
  expiresAt: number | null;
  nonce: string;
};

type PromptTemplateExportDownloadRow = {
  id: string;
  template_id: string;
  user_id: string;
  variant: string;
  status: string;
  issued_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  last_used_at: number | null;
  use_count: number;
  created_at: string;
  updated_at: string;
};

function promptTemplateExportSecret() {
  configDb.run(`
    create table if not exists prompt_template_export_secrets (
      id text primary key,
      secret text not null,
      created_at text not null,
      updated_at text not null
    )
  `);
  const row = getOne<{ secret: string }>(
    configDb,
    "select secret from prompt_template_export_secrets where id = ?",
    PROMPT_TEMPLATE_EXPORT_SECRET_ID
  );
  if (row?.secret) return row.secret;
  const timestamp = now();
  const secret = randomBytes(32).toString("base64");
  run(
    configDb,
    "insert into prompt_template_export_secrets (id, secret, created_at, updated_at) values (?, ?, ?, ?)",
    PROMPT_TEMPLATE_EXPORT_SECRET_ID,
    secret,
    timestamp,
    timestamp
  );
  return secret;
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + (4 - (normalized.length % 4 || 4)), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function signPromptTemplateExportPayload(payloadText: string) {
  return base64UrlEncode(createHmac("sha256", promptTemplateExportSecret()).update(payloadText).digest());
}

function safeEqualText(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function normalizePromptTemplateExportExpiresDays(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text === "0" || text.toLowerCase() === "permanent") return null;
  const days = Math.trunc(Number(text));
  if (!Number.isFinite(days) || days <= 0) return null;
  return Math.min(days, 36500);
}

function createPromptTemplateExportDownload(templateId: string, userId: string, variant: "ai" | "basic", expiresAt: number | null) {
  const id = makeId("promptexport");
  const timestamp = now();
  const issuedAt = Date.now();
  run(
    appDb,
    `insert into prompt_template_export_downloads (
      id, template_id, user_id, variant, status, issued_at, expires_at,
      revoked_at, last_used_at, use_count, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, null, null, 0, ?, ?)`,
    id,
    templateId,
    userId,
    variant,
    variant === "ai" ? "active" : "downloaded",
    issuedAt,
    expiresAt,
    timestamp,
    timestamp
  );
  return { id, issuedAt, expiresAt };
}

function promptTemplateExportRevokedAfter(templateId: string, userId: string) {
  const row = getOne<{ revoked_after: number }>(
    appDb,
    "select revoked_after from prompt_template_export_revocations where template_id = ? and user_id = ?",
    templateId,
    userId
  );
  return Number(row?.revoked_after ?? 0) || 0;
}

function promptTemplateExportDownloadStatus(row: PromptTemplateExportDownloadRow) {
  if (row.variant !== "ai") return "downloaded";
  if (row.status === "revoked" || Number(row.revoked_at ?? 0) > 0) return "revoked";
  const expiresAt = Number(row.expires_at ?? 0);
  if (expiresAt > 0 && expiresAt < Date.now()) return "expired";
  return "active";
}

function publicPromptTemplateExportDownload(row: PromptTemplateExportDownloadRow) {
  return {
    id: row.id,
    variant: row.variant === "ai" ? "ai" : "basic",
    status: promptTemplateExportDownloadStatus(row),
    issuedAt: Number(row.issued_at ?? 0) || 0,
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    useCount: Number(row.use_count ?? 0) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createPromptTemplateExportAccess(templateId: string, userId: string, expiresDays: number | null) {
  const expiresAt = expiresDays ? Date.now() + expiresDays * PROMPT_TEMPLATE_EXPORT_TOKEN_DAY_MS : null;
  const download = createPromptTemplateExportDownload(templateId, userId, "ai", expiresAt);
  const payload: PromptTemplateExportTokenPayload = {
    v: 1,
    scope: PROMPT_TEMPLATE_EXPORT_TOKEN_SCOPE,
    templateId,
    userId,
    downloadId: download.id,
    issuedAt: download.issuedAt,
    expiresAt,
    nonce: base64UrlEncode(randomBytes(12))
  };
  const payloadText = base64UrlEncode(JSON.stringify(payload));
  return {
    token: `${payloadText}.${signPromptTemplateExportPayload(payloadText)}`,
    expiresAt: payload.expiresAt,
    downloadId: download.id
  };
}

function verifyPromptTemplateExportToken(token: string, templateId: string) {
  const [payloadText, signature, extra] = token.split(".");
  if (!payloadText || !signature || extra) return null;
  if (!safeEqualText(signature, signPromptTemplateExportPayload(payloadText))) return null;
  let payload: PromptTemplateExportTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadText));
  } catch {
    return null;
  }
  if (payload.v !== 1 || payload.scope !== PROMPT_TEMPLATE_EXPORT_TOKEN_SCOPE) return null;
  if (payload.templateId !== templateId || !payload.userId) return null;
  if (payload.expiresAt !== null && (!Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now())) return null;
  const issuedAt = Number(payload.issuedAt ?? 0) || 0;
  const revokedAfter = promptTemplateExportRevokedAfter(templateId, payload.userId);
  if (revokedAfter > 0 && issuedAt <= revokedAfter) return null;
  if (payload.downloadId) {
    const download = getOne<PromptTemplateExportDownloadRow>(
      appDb,
      "select * from prompt_template_export_downloads where id = ? and template_id = ? and user_id = ? and variant = 'ai'",
      payload.downloadId,
      templateId,
      payload.userId
    );
    if (!download || promptTemplateExportDownloadStatus(download) !== "active") return null;
    run(
      appDb,
      "update prompt_template_export_downloads set last_used_at = ?, use_count = use_count + 1, updated_at = ? where id = ?",
      Date.now(),
      now(),
      download.id
    );
  }
  return payload;
}

function exportJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...PROMPT_TEMPLATE_EXPORT_CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function withExportCors(response: Response) {
  for (const [key, value] of Object.entries(PROMPT_TEMPLATE_EXPORT_CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

function lucideStaticIconName(name: string) {
  return String(name || "Sparkles")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d)/g, "$1-$2")
    .toLowerCase();
}

function lucideStaticIconUrl(name: string) {
  return `https://cdn.jsdelivr.net/npm/lucide-static@0.562.0/icons/${lucideStaticIconName(name)}.svg`;
}

function exportFaviconHref(iconName: string, iconSvg?: string) {
  if (!iconSvg) return lucideStaticIconUrl(iconName);
  const paths = iconSvg
    .replace(/^<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="4" y="4" width="40" height="40" rx="10" fill="#111827"/><g transform="translate(12 12)" color="#fff" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function exportIconMarkup(iconName: string) {
  const inlineIcon = exportIconSvg[iconName];
  if (inlineIcon) return inlineIcon;
  const iconUrl = lucideStaticIconUrl(iconName);
  return `<span class="icon-mask" style="-webkit-mask-image:url('${escapeHtml(iconUrl)}');mask-image:url('${escapeHtml(iconUrl)}')"></span>`;
}

const exportIconSvg: Record<string, string> = {
  Sparkles: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2z"/><path d="M19 14l.8 2.5 2.2.8-2.2.7-.8 2.5-.8-2.5-2.2-.7 2.2-.8L19 14z"/></svg>',
  Megaphone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l8 4V6l-8 4H4z"/><path d="M8 14l1.5 6h3L11 14"/></svg>',
  Image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15l3-3 3 3 2-2 3 4"/><circle cx="8" cy="9" r="1.4"/></svg>',
  Film: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4"/></svg>',
  PanelsTopLeft: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 9v11"/></svg>',
  Palette: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0 0 18h1.3a2 2 0 0 0 1.4-3.4 1 1 0 0 1 .7-1.7H17a4 4 0 0 0 0-8h-1a1 1 0 0 1-1-1 4 4 0 0 0-3-3.9z"/><circle cx="8" cy="10" r="1"/><circle cx="11" cy="7" r="1"/><circle cx="14" cy="10" r="1"/></svg>',
  Box: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
  Camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 7.5L8 5h8l1.5 2.5H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.5z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
  Building2: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/><path d="M4 22h16M9 6h1M14 6h1M9 10h1M14 10h1M9 14h1M14 14h1M10 22v-4h4v4"/></svg>',
  Utensils: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v19M15 3v19M15 3c2.8 1.5 4 3.4 4 6.4V11h-4"/></svg>',
  Gamepad2: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M7 6h10a5 5 0 0 1 4.8 6.5l-1.2 4A3 3 0 0 1 15.4 18l-1.9-2h-3l-1.9 2a3 3 0 0 1-5.2-1.5l-1.2-4A5 5 0 0 1 7 6z"/></svg>'
};

function visibleExportAsset(assetId: string, userId: string) {
  if (!assetId) return null;
  return getOne<AssetRow>(
    appDb,
    `select *
     from assets
     where id = ?
       and (
         ${visibleAssetSql("assets")}
         or exists (select 1 from case_items where case_items.asset_id = assets.id)
         or exists (select 1 from case_group_images where case_group_images.asset_id = assets.id)
       )`,
    assetId,
    userId
  );
}

function bufferDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType || "application/octet-stream"};base64,${buffer.toString("base64")}`;
}

function cleanExportDataUrl(value: unknown) {
  const text = String(value ?? "").trim();
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(text) ? text : "";
}

async function exportImageFileSnapshot(file: unknown, userId: string) {
  const record = asJsonObject(file);
  const assetRecord = asJsonObject(record.asset);
  const assetId = String(record.assetId ?? assetRecord.id ?? "").trim();
  let fileName = String(record.fileName ?? assetRecord.name ?? "").trim();
  let size = Number(record.size ?? 0) || 0;
  let width = Number(record.width ?? 0) || 0;
  let height = Number(record.height ?? 0) || 0;
  let mimeType = String(record.mimeType ?? assetRecord.mimeType ?? assetRecord.mime_type ?? "").trim();
  let dataUrl = cleanExportDataUrl(record.dataUrl) || cleanExportDataUrl(record.downloadUrl) || cleanExportDataUrl(record.previewUrl);
  const asset = !dataUrl ? visibleExportAsset(assetId, userId) : null;
  if (asset) {
    try {
      const buffer = await readStoredFile(asset.path);
      mimeType = asset.mime_type || mimeType || mimeTypeFromPath(asset.path);
      dataUrl = bufferDataUrl(buffer, mimeType);
      fileName = fileName || asset.name;
      size = asset.size || buffer.length || size;
      width = asset.image_width || width;
      height = asset.image_height || height;
    } catch (error) {
      console.warn("导出表单素材读取失败", asset.id, error);
    }
  }
  if (!fileName) return null;
  const previewUrl = dataUrl || cleanExportDataUrl(record.previewUrl) || String(record.previewUrl ?? "").trim();
  return {
    id: String(record.id ?? assetId ?? `${fileName}_${size}`).trim(),
    fileName,
    size,
    width,
    height,
    mimeType,
    assetId,
    previewUrl,
    dataUrl,
    downloadUrl: dataUrl || String(record.downloadUrl ?? record.originalUrl ?? "").trim(),
    uploaded: true
  };
}

async function exportFormSnapshot(template: ReturnType<typeof publicPromptTemplate>, value: unknown, userId: string) {
  if (!value || typeof value !== "object") return null;
  const source = asJsonObject(value);
  const snapshot: Record<string, unknown> = {};
  for (const component of asJsonArray(template.components).map((item) => asJsonObject(item))) {
    const id = String(component.id ?? "").trim();
    if (!id || !(id in source) || String(component.type ?? "") === "section") continue;
    const current = source[id];
    if (String(component.type ?? "") !== "image") {
      snapshot[id] = current;
      continue;
    }
    const imageValue = asJsonObject(current);
    const files = (
      await Promise.all(asJsonArray(imageValue.files).map((file) => exportImageFileSnapshot(file, userId)))
    ).filter(Boolean);
    snapshot[id] = {
      fileName: String(imageValue.fileName ?? (files[0] as Record<string, unknown> | undefined)?.fileName ?? "").trim(),
      note: String(imageValue.note ?? "").trim(),
      uploaded: files.length > 0 || Boolean(imageValue.uploaded),
      previewUrl: String((files[0] as Record<string, unknown> | undefined)?.previewUrl ?? cleanExportDataUrl(imageValue.previewUrl) ?? "").trim(),
      files
    };
  }
  return snapshot;
}

function exportHtml(
  template: ReturnType<typeof publicPromptTemplate>,
  latestResult: ReturnType<typeof publicPromptTemplateResult> | null = null,
  exportAccess: { optimizeEndpoint: string; translateEndpoint: string; token: string; expiresAt: number | null } | null = null,
  initialFormSnapshot: Record<string, unknown> | null = null
) {
  const title = `${template.name} - 提示词表单`;
  const icon = exportIconMarkup(template.icon);
  const faviconHref = exportFaviconHref(template.icon, exportIconSvg[template.icon]);
  const aiOptimizeEnabled = Boolean(exportAccess);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="${escapeHtml(faviconHref)}" />
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#111827;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{min-height:100vh;display:grid;grid-template-columns:minmax(360px,1fr) minmax(360px,560px);gap:14px;padding:14px}.panel{min-width:0;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px;box-shadow:0 14px 32px rgba(17,24,39,.06)}header{display:flex;align-items:center;gap:12px;margin-bottom:14px}.icon{width:42px;height:42px;border-radius:8px;background:#111827;color:#fff;display:grid;place-items:center;flex:0 0 auto}.icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.icon-mask{width:22px;height:22px;background:currentColor;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain}h1{font-size:22px;line-height:1.2;margin:0}.meta{margin:4px 0 0;color:#6b7280;line-height:1.55}.form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.field{display:grid;gap:7px}.field.full,.section-title.full{grid-column:1/-1}.field span{font-weight:700;font-size:14px}input,textarea,select{width:100%;border:1px solid #d1d5db;border-radius:8px;background:#fff;padding:9px 11px;font:inherit;color:#111827;outline:none}input:focus,textarea:focus,select:focus{border-color:#111827;box-shadow:0 0 0 3px rgba(17,24,39,.08)}textarea{min-height:92px;resize:vertical}.section-title{font-size:13px;font-weight:700;color:#6b7280;border-top:1px solid #eef0f3;padding-top:12px}.upload{display:grid;gap:9px;border:1px dashed #cbd5e1;border-radius:8px;padding:12px;background:#fafafa}.upload-input{position:absolute;width:1px;height:1px;overflow:hidden;border:0;padding:0;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}.upload-pick{min-height:68px;display:flex;align-items:center;gap:11px;border:1px dashed #cbd5e1;border-radius:8px;background:#fff;color:#111827;padding:12px;text-align:left;cursor:pointer;transition:border-color .16s ease,background .16s ease,transform .16s ease}.upload-pick:hover{border-color:#111827;background:#f9fafb;transform:translateY(-1px)}.upload-pick-icon{width:38px;height:38px;flex:0 0 38px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:#111827;color:#fff;line-height:0}.upload-pick-icon svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.upload-pick-copy{min-width:0;display:grid;gap:3px}.upload-pick-copy strong,.upload-pick-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.upload-pick-copy small{color:#6b7280;font-size:12px;font-weight:600}.upload-list{display:grid;gap:8px}.upload-item{display:grid;grid-template-columns:54px minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #e5e7eb;border-radius:8px;background:#fff;padding:7px}.upload-thumb{width:54px;height:54px;border-radius:8px;background:#f3f4f6;display:grid;place-items:center;color:#9ca3af;font-size:12px;overflow:hidden}.upload-thumb img{width:100%;height:100%;object-fit:cover}.upload-item strong,.upload-item span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.upload-item span{color:#6b7280;font-size:12px}.upload-download{min-height:28px;border:1px solid #d1d5db;border-radius:999px;background:#fff;color:#111827;padding:6px 10px;text-decoration:none;font-size:12px;font-weight:800;white-space:nowrap}.upload-download:hover{background:#f9fafb}.upload-download.disabled{pointer-events:none;opacity:.45}.result-panel{display:grid;grid-template-rows:auto minmax(0,1fr) 12px minmax(0,1fr);gap:0;min-height:calc(100vh - 28px)}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}.language-tabs{display:inline-flex;align-items:center;gap:2px;border:1px solid #e5e7eb;border-radius:999px;background:#f9fafb;padding:2px}.language-tabs button{min-height:26px;border:0;border-radius:999px;background:transparent;color:#6b7280;padding:0 10px;font-size:13px;cursor:pointer}.language-tabs button.active{background:#111827;color:#fff}.result-card{min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);border:1px solid #e5e7eb;border-radius:8px;background:#fff;padding:12px}.result-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}.result-head svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.result-head strong{white-space:nowrap}.result-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.btn{min-height:34px;border:1px solid #d1d5db;border-radius:999px;background:#fff;color:#111827;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}.btn.primary{background:#111827;border-color:#111827;color:#fff}.btn:disabled{cursor:not-allowed;opacity:.55}.diff-switch{min-height:34px;border:1px solid #e5e7eb;border-radius:999px;background:#fff;color:#4b5563;padding:0 10px 0 6px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px}.diff-switch span{width:20px;height:12px;border-radius:999px;background:#d1d5db;position:relative;transition:background .16s ease}.diff-switch span:after{content:"";position:absolute;top:2px;left:2px;width:8px;height:8px;border-radius:999px;background:#fff;transition:transform .16s ease}.diff-switch.active{background:#f9fafb;color:#111827}.diff-switch.active span{background:#111827}.diff-switch.active span:after{transform:translateX(8px)}.style-select{width:auto;min-width:112px;min-height:34px;border-radius:999px;padding:7px 30px 7px 12px;font-size:13px}.prompt-box{min-height:0;overflow:auto;background:#f9fafb;border:1px solid #eef0f3;border-radius:8px;padding:12px}.prompt-box pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:inherit;line-height:1.68}.prompt-box mark{border-radius:4px;background:#dcfce7;color:inherit;padding:0;box-decoration-break:clone;-webkit-box-decoration-break:clone}.negative{display:none;margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb}.negative.visible{display:grid;gap:6px}.negative span{color:#6b7280;font-size:12px;font-weight:700}.status{font-size:13px;color:#6b7280}.status.error{color:#b91c1c}.status.success{color:#047857}.spinner{width:13px;height:13px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:980px){.wrap{grid-template-columns:1fr}.result-panel{min-height:680px}}@media(max-width:640px){.wrap,.form{grid-template-columns:1fr}.wrap{padding:10px}.result-panel{min-height:760px}.toolbar{align-items:flex-start}.result-actions{width:100%;justify-content:flex-start}.upload-item{grid-template-columns:44px minmax(0,1fr) auto}.upload-thumb{width:44px;height:44px}}
.wrap{--result-width:2fr;--base-width:1fr;--export-panel-min:260px;height:100vh;min-height:720px;grid-template-columns:minmax(var(--export-panel-min),1fr) 12px minmax(532px,var(--result-width));gap:0}.form-panel{height:calc(100vh - 28px);min-height:0;margin:0;overflow:auto}.result-panel{height:calc(100vh - 28px);max-height:calc(100vh - 28px);min-height:0;align-self:start;overflow:hidden;position:sticky;top:14px;margin:0;display:grid;grid-template-rows:minmax(0,1fr)}.result-grid{min-height:0;display:grid;grid-template-columns:minmax(var(--export-panel-min),var(--base-width)) 12px minmax(var(--export-panel-min),1fr);gap:0}.result-grid>.result-card{min-width:0}.result-card{overflow:hidden}.resize-handle{align-self:stretch;width:12px;height:calc(100vh - 28px);position:sticky;top:14px;border:0;background:transparent;cursor:col-resize;display:grid;place-items:center;padding:0;touch-action:none}.result-resize-handle{height:auto;position:static;top:auto}.resize-handle span{display:block;width:3px;height:56px;border-radius:999px;background:#d1d5db;transition:background .16s ease,height .16s ease}.resize-handle:hover span,.resize-handle:focus-visible span,body.resizing-columns .resize-handle span{height:74px;background:#111827}body.resizing-columns,body.resizing-columns *{cursor:col-resize!important;user-select:none!important}.result-actions{min-width:0}.btn{white-space:nowrap}.optimize-control{height:36px;display:inline-flex;align-items:center;position:relative;border:1px solid #d1d5db;border-radius:999px;background:#fff;box-shadow:0 1px 2px rgba(17,24,39,.06)}.optimize-submit{width:32px;min-width:32px;height:34px;min-height:34px;border:0;border-radius:999px 0 0 999px;background:transparent;color:#111827;padding:0;font:inherit;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.optimize-submit #optimize-icon{width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;line-height:0}.optimize-submit svg{display:block;width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.optimize-submit:hover:not(:disabled){background:#f3f4f6}.optimize-submit:disabled,.optimize-style-trigger:disabled{cursor:not-allowed;opacity:.55}.optimize-style-select{height:34px;position:relative;flex:0 0 auto}.optimize-style-trigger{height:34px;min-width:86px;border:0;border-radius:0 999px 999px 0;background:transparent;color:#111827;padding:0 9px 0 5px;font:inherit;font-size:13px;font-weight:800;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:space-between;gap:5px}.optimize-style-label,#optimize-style-label{display:inline-flex;align-items:center;height:16px;line-height:16px}.optimize-style-trigger:hover:not(:disabled),.optimize-style-trigger[aria-expanded="true"]{background:#f9fafb}.optimize-style-caret{width:16px;height:16px;position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 16px}.optimize-style-caret:before{content:"";width:7px;height:7px;margin-top:-3px;border-right:1.7px solid #6b7280;border-bottom:1.7px solid #6b7280;transform:rotate(45deg)}.optimize-style-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:70;width:240px;display:none;gap:4px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 18px 42px rgba(17,24,39,.18);padding:6px;max-height:260px;overflow:auto}.optimize-style-select.open .optimize-style-menu{display:grid}.optimize-style-option{width:100%;border:0;border-radius:6px;background:transparent;color:#111827;padding:8px 9px;text-align:left;font:inherit;cursor:pointer;display:grid;gap:3px}.optimize-style-option:hover,.optimize-style-option.active{background:#f3f4f6}.optimize-style-option strong{font-size:13px}.optimize-style-option small{color:#6b7280;font-size:12px;line-height:1.4}.stale-badge{display:none;align-items:center;border-radius:999px;background:#fff7ed;color:#c2410c;padding:3px 7px;font-size:11px;font-weight:800;line-height:1;white-space:nowrap}.stale-badge.visible{display:inline-flex}.prompt-box{position:relative}.prompt-box.loading{overflow:hidden}.prompt-box.loading pre,.prompt-box.loading .negative{visibility:hidden}.prompt-box.loading:before{content:"";position:absolute;inset:12px;border-radius:8px;background-image:linear-gradient(90deg,transparent,rgba(255,255,255,.78),transparent),linear-gradient(#e5e7eb,#e5e7eb),linear-gradient(#e5e7eb,#e5e7eb),linear-gradient(#e5e7eb,#e5e7eb),linear-gradient(#e5e7eb,#e5e7eb),linear-gradient(#e5e7eb,#e5e7eb);background-size:120px 100%,82% 14px,94% 14px,76% 14px,88% 14px,66% 14px;background-position:-140px 0,0 4px,0 40px,0 76px,0 112px,0 148px;background-repeat:no-repeat;animation:skeleton 1.15s ease-in-out infinite}@keyframes skeleton{to{background-position:calc(100% + 140px) 0,0 4px,0 40px,0 76px,0 112px,0 148px}}.toast{position:fixed;left:50%;top:18px;z-index:80;max-width:min(520px,calc(100vw - 32px));transform:translate(-50%,-10px);opacity:0;pointer-events:none;border:1px solid #e5e7eb;border-radius:8px;background:#111827;color:#fff;box-shadow:0 18px 42px rgba(17,24,39,.18);padding:10px 14px;font-size:14px;font-weight:700;line-height:1.45;text-align:center;transition:opacity .18s ease,transform .18s ease}.toast.visible{opacity:1;transform:translate(-50%,0)}.toast.success{background:#047857;border-color:#047857}.toast.error{background:#b91c1c;border-color:#b91c1c}.ai-disabled-note{min-height:34px;display:inline-flex;align-items:center;border:1px solid #e5e7eb;border-radius:999px;background:#f9fafb;color:#6b7280;padding:7px 11px;font-size:13px;font-weight:700}@media(max-width:1120px){.wrap{--export-panel-min:240px;grid-template-columns:minmax(var(--export-panel-min),1fr) 12px minmax(492px,var(--result-width))}}@media(max-width:980px){.wrap{height:auto;min-height:100vh;grid-template-columns:1fr;gap:14px}.form-panel,.result-panel{height:auto;max-height:none;margin:0}.resize-handle{display:none}.result-panel{min-height:680px;position:static;top:auto}.result-grid{grid-template-columns:1fr;gap:12px}.result-grid>.result-card{min-height:320px}}@media(max-width:640px){.wrap,.form{grid-template-columns:1fr}.wrap{padding:10px}.result-panel{min-height:760px}.result-grid>.result-card{min-height:360px}.result-actions{width:100%;justify-content:flex-start}.optimize-control{width:100%}.optimize-submit{flex:0 0 38px}.optimize-style-select{flex:1}.optimize-style-trigger{width:100%;min-width:0}}
.optimize-style-menu{max-height:none!important;overflow:visible!important}.optimize-style-row{position:relative}.optimize-style-row:hover>.optimize-style-submenu,.optimize-style-row:focus-within>.optimize-style-submenu{display:grid}.optimize-style-submenu{position:absolute;right:calc(100% + 6px);top:0;z-index:72;width:250px;display:none;gap:4px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 18px 42px rgba(17,24,39,.18);padding:6px}.optimize-style-option{grid-template-columns:minmax(0,1fr) auto!important;align-items:center;gap:8px!important}.optimize-style-option strong{display:block}.optimize-style-option small{display:block}.optimize-style-row-action,.optimize-style-child-check{display:inline-flex;align-items:center;color:#6b7280}.optimize-style-option.active .optimize-style-child-check:before{content:"✓";font-size:13px}.optimize-style-sub-caret{font-size:18px;line-height:1}
.custom-select,.template-multi-select{position:relative;width:100%}.custom-select-trigger{width:100%;min-height:42px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#111827;padding:9px 10px 9px 11px;font:inherit;display:grid;grid-template-columns:minmax(0,1fr) 18px;align-items:center;gap:8px;text-align:left;cursor:pointer;transition:border-color .16s ease,background .16s ease,box-shadow .16s ease}.custom-select-trigger:hover{border-color:#cbd5e1;background:#f9fafb}.custom-select.open .custom-select-trigger,.template-multi-select.open .custom-select-trigger{border-color:#111827;box-shadow:0 0 0 3px rgba(17,24,39,.08)}.custom-select-value{min-width:0;display:inline-flex;align-items:center;gap:8px}.custom-select-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.custom-select-label.placeholder{color:#9ca3af}.custom-select-caret{width:18px;height:18px;position:relative;display:inline-flex;align-items:center;justify-content:center;transition:transform .16s ease}.custom-select-caret:before{content:"";width:7px;height:7px;margin-top:-3px;border-right:1.7px solid #6b7280;border-bottom:1.7px solid #6b7280;transform:rotate(45deg)}.custom-select.open .custom-select-caret,.template-multi-select.open .custom-select-caret{transform:rotate(180deg)}.custom-select-menu,.template-multi-select-menu{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:90;display:none;gap:4px;max-height:260px;overflow:auto;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 18px 42px rgba(17,24,39,.18);padding:6px}.custom-select.open .custom-select-menu,.template-multi-select.open .template-multi-select-menu{display:grid}.custom-select-menu button,.template-multi-select-menu button{width:100%;min-height:34px;border:0;border-radius:6px;background:transparent;color:#111827;padding:8px 9px;font:inherit;text-align:left;cursor:pointer;display:grid;grid-template-columns:minmax(0,1fr) 18px;align-items:center;gap:8px}.custom-select-menu button:hover,.template-multi-select-menu button:hover,.custom-select-menu button.active,.template-multi-select-menu button.active{background:#f3f4f6}.custom-select-menu strong,.template-multi-select-menu strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:700}.custom-select-check{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;color:#111827;opacity:0}.active .custom-select-check{opacity:1}.custom-select-empty{padding:10px;color:#6b7280;font-size:13px}
.translate-action-icon{width:16px;height:16px;display:inline-grid;place-items:center;flex:0 0 16px;line-height:0}.translate-action-icon:empty:before{content:"";width:15px;height:15px;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m5 8 6 6' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='m4 14 6-6 2-3' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='M2 5h12' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='M7 2h1' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='m22 22-5-10-5 10' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='M14 18h6' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m5 8 6 6' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='m4 14 6-6 2-3' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='M2 5h12' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='M7 2h1' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='m22 22-5-10-5 10' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='M14 18h6' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E") center/contain no-repeat}.translate-action-icon .spinner{display:block;width:15px;height:15px;border:0;border-radius:0;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M21 12a9 9 0 1 1-2.64-6.36L21 8' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='M21 3v5h-5' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M21 12a9 9 0 1 1-2.64-6.36L21 8' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='M21 3v5h-5' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E") center/contain no-repeat;animation:spin .8s linear infinite}
</style>
</head>
<body>
<main class="wrap">
  <section class="panel form-panel">
    <header><div class="icon">${icon}</div><div><h1>${escapeHtml(template.name)}</h1><p class="meta">${escapeHtml(template.description || "离线提示词表单")}</p></div></header>
    <div id="form" class="form"></div>
  </section>
  <button class="resize-handle" type="button" id="resize-form-results" aria-label="拖动调整表单和提示词区域宽度" title="拖动调整表单和提示词区域宽度"><span></span></button>
  <aside class="result-panel">
    <div class="result-grid">
    <section class="result-card base-card">
      <div class="result-head">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>
        <strong>基础提示词</strong>
        <div class="language-tabs" data-language-tabs role="tablist" aria-label="基础提示词语言"></div>
        <div class="result-actions">
          <button class="btn" type="button" id="copy-base">复制</button>
          ${aiOptimizeEnabled ? '<button class="btn" type="button" id="translate-base"><span id="translate-base-icon" class="translate-action-icon"></span><span id="translate-base-text">翻译英文</span></button>' : ""}
        </div>
      </div>
      <div class="prompt-box" id="base-prompt-box">
        <pre id="base-prompt"></pre>
        <div class="negative" id="base-negative-wrap">
          <span id="base-negative-label">反向提示词</span>
          <pre id="base-negative"></pre>
        </div>
      </div>
    </section>
    <button class="resize-handle result-resize-handle" type="button" id="resize-base-ai" aria-label="拖动调整基础提示词和AI提示词宽度" title="拖动调整基础提示词和AI提示词宽度"><span></span></button>
    <section class="result-card ai-card">
      <div class="result-head">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2z"/><path d="M19 14l.8 2.5 2.2.8-2.2.7-.8 2.5-.8-2.5-2.2-.7 2.2-.8L19 14z"/></svg>
        <strong>AI优化结果</strong>
        <div class="language-tabs" data-language-tabs role="tablist" aria-label="AI优化结果语言"></div>
        <strong class="stale-badge" id="ai-stale-badge">需要重新优化</strong>
        <div class="result-actions">
          <button class="btn" type="button" id="copy-ai">复制</button>
          ${aiOptimizeEnabled ? '<button class="diff-switch active" type="button" id="diff-toggle" aria-pressed="true" title="隐藏差异"><span aria-hidden="true"></span>显示差异</button>' : ""}
          ${aiOptimizeEnabled ? `
          <div class="optimize-control" id="optimize-control">
            <button class="optimize-submit" type="button" id="optimize" aria-label="AI优化" title="AI优化"><span id="optimize-icon"></span></button>
            <div class="optimize-style-select" id="optimize-style-select">
              <button class="optimize-style-trigger" type="button" id="optimize-style-trigger" aria-haspopup="listbox" aria-expanded="false">
                <span id="optimize-style-label">标准</span>
                <span class="optimize-style-caret" aria-hidden="true"></span>
              </button>
              <div class="optimize-style-menu" id="optimize-style-menu" role="listbox" aria-label="优化风格"></div>
            </div>
          </div>
          ` : '<span class="ai-disabled-note">无 AI 优化版</span>'}
        </div>
      </div>
      <div class="prompt-box" id="ai-prompt-box">
        <pre id="ai-prompt"></pre>
        <div class="negative" id="ai-negative-wrap">
          <span id="ai-negative-label">反向提示词</span>
          <pre id="ai-negative"></pre>
        </div>
      </div>
    </section>
    </div>
  </aside>
</main>
<div class="toast" id="status" role="status" aria-live="polite"></div>
<script type="application/json" id="template-json">${safeScriptJson(template)}</script>
<script type="application/json" id="latest-result-json">${safeScriptJson(latestResult)}</script>
<script type="application/json" id="export-access-json">${safeScriptJson(exportAccess)}</script>
<script type="application/json" id="export-form-json">${safeScriptJson(initialFormSnapshot)}</script>
<script>
const template=JSON.parse(document.getElementById("template-json").textContent);
const latestResult=JSON.parse(document.getElementById("latest-result-json").textContent);
const exportAccess=JSON.parse(document.getElementById("export-access-json").textContent);
const exportFormSnapshot=JSON.parse(document.getElementById("export-form-json").textContent);
const aiOptimizeEnabled=Boolean(exportAccess&&exportAccess.token&&exportAccess.optimizeEndpoint);
const labels={zh:"中文",en:"English"};
const styleOptions=[
 {value:"standard",label:"标准",description:"均衡优化，适合大多数表单"},
 {value:"realistic",label:"写实",description:"强化摄影感、镜头、光线和材质",children:[
  {value:"realistic:portrait-photography",label:"人像摄影",description:"浅景深、肤质、情绪光"},
  {value:"realistic:commercial-product",label:"商业产品",description:"白底、精准打光、质感呈现"},
  {value:"realistic:documentary-street",label:"纪实街拍",description:"自然光、抓拍感、颗粒感"},
  {value:"realistic:landscape-blockbuster",label:"风光大片",description:"黄金时段、广角、壮阔"},
  {value:"realistic:macro-closeup",label:"微距特写",description:"极致细节、焦外虚化"},
  {value:"realistic:fashion-editorial",label:"时尚大片",description:"高级感、杂志质感"}
 ]},
 {value:"cinematic",label:"电影",description:"强化叙事感、色调、镜头语言和情绪氛围",children:[
  {value:"cinematic:hollywood-blockbuster",label:"好莱坞大片",description:"史诗感、强对比、视觉冲击"},
  {value:"cinematic:cyberpunk",label:"赛博朋克",description:"霓虹、雨夜、未来都市"},
  {value:"cinematic:film-noir",label:"黑色电影",description:"高反差黑白、阴影、悬疑感"},
  {value:"cinematic:european-art-house",label:"欧洲文艺",description:"自然光、慢节奏、写实克制"},
  {value:"cinematic:horror-thriller",label:"恐怖惊悚",description:"阴暗、压抑、诡异氛围"},
  {value:"cinematic:historical-epic",label:"古装史诗",description:"宏大战争、宫廷、历史质感"},
  {value:"cinematic:sci-fi-space",label:"科幻太空",description:"宇宙、飞船、未来科技感"}
 ]},
 {value:"anime",label:"动漫",description:"面向二次元、角色插画和动画画风优化",children:[
  {value:"anime:ghibli",label:"吉卜力",description:"自然、温暖、手绘水彩感"},
  {value:"anime:shonen-action",label:"少年热血",description:"动感、夸张动作、爆炸特效"},
  {value:"anime:shinkai",label:"新海诚",description:"光晕、细腻背景、唯美现实"},
  {value:"anime:cel-animation",label:"赛璐璐",description:"复古动画平涂风格"},
  {value:"anime:mecha-battle",label:"机甲战斗",description:"硬核机械、装甲、战斗姿态"},
  {value:"anime:shojo-dreamy",label:"少女唯美",description:"粉嫩、花卉、梦幻"},
  {value:"anime:dark-gothic",label:"暗黑哥特",description:"地下城、克苏鲁、恶魔风"}
 ]},
 {value:"artistic",label:"艺术",description:"往绘画方向改写，加入流派、画家风格和笔触描述",children:[
  {value:"artistic:classical-oil",label:"油画古典",description:"伦勃朗、文艺复兴光影"},
  {value:"artistic:watercolor-illustration",label:"水彩插画",description:"透明感、晕染、轻盈"},
  {value:"artistic:concept-art",label:"概念艺术",description:"游戏/影视概念设计风"},
  {value:"artistic:pop-art",label:"波普艺术",description:"高饱和、重复图案、安迪沃霍尔"},
  {value:"artistic:minimalism",label:"极简主义",description:"几何、留白、纯色块"},
  {value:"artistic:surrealism",label:"超现实主义",description:"达利风、梦境逻辑"},
  {value:"artistic:pixel-art",label:"像素艺术",description:"8-bit/16-bit 复古游戏感"}
 ]},
 {value:"commercial",label:"商业",description:"偏品牌、产品和转化表达",children:[
  {value:"commercial:ecommerce-product",label:"电商产品",description:"简洁背景、突出卖点"},
  {value:"commercial:brand-advertising",label:"品牌广告",description:"高端调性、视觉统一"},
  {value:"commercial:social-media",label:"社交媒体",description:"活泼构图、高饱和抓眼"},
  {value:"commercial:corporate-promo",label:"企业宣传",description:"专业、可信、大气"}
 ]},
 {value:"series",label:"组图",description:"拆成风格统一、用途明确的一组图片",children:[
  {value:"series:marketing-campaign",label:"营销套图",description:"主视觉、卖点、场景、活动、封面"},
  {value:"series:ecommerce-detail",label:"电商详情",description:"主图、细节、场景、规格卖点"},
  {value:"series:social-content",label:"社媒内容",description:"封面、正文配图、步骤对比、结尾图"},
  {value:"series:brand-visual",label:"品牌延展",description:"KV、海报、Banner、应用场景"},
  {value:"series:storyboard",label:"故事分镜",description:"连续镜头和场景变化"},
  {value:"series:logo-design",label:"Logo设计",description:"标志方向、图形标、字标、黑白版、应用场景"}
 ]},
 {value:"composition",label:"构图",description:"根据提示词类型自动选择构图手法",children:[
  {value:"composition:rule-of-thirds",label:"三分法",description:"主体落在三分交点，画面均衡"},
  {value:"composition:center-symmetry",label:"中心对称",description:"主体居中，轴线稳定，秩序感强"},
  {value:"composition:leading-lines",label:"引导线",description:"线条、道路或光影将视线带向主体"},
  {value:"composition:frame-within-frame",label:"框中框",description:"门窗、前景或结构形成天然画框"},
  {value:"composition:diagonal-dynamic",label:"对角线动势",description:"斜线切入，增强速度感和张力"},
  {value:"composition:negative-space",label:"留白构图",description:"大面积留白，突出主体和情绪"},
  {value:"composition:foreground-depth",label:"前景层次",description:"前景、中景、背景形成空间纵深"},
  {value:"composition:golden-spiral",label:"黄金螺旋",description:"螺旋动线组织视觉焦点"},
  {value:"composition:close-crop",label:"近景裁切",description:"大胆裁切，强化局部细节和冲击"},
  {value:"composition:flat-lay",label:"平铺俯拍",description:"俯视排列，突出秩序和图案感"}
 ]},
 {value:"detailed",label:"细节",description:"补足材质、光线、镜头细节",children:[
  {value:"detailed:material-texture",label:"材质纹理",description:"强化布料、金属、皮肤等质感"},
  {value:"detailed:lighting-enhancement",label:"光影强化",description:"精细光源方向和阴影层次"},
  {value:"detailed:environment-atmosphere",label:"环境氛围",description:"烟雾、粒子、体积光细节"}
 ]},
 {value:"creative",label:"创意",description:"更大胆的画面想象和氛围",children:[
  {value:"creative:surreal-collage",label:"超现实拼贴",description:"打破常规的元素组合"},
  {value:"creative:double-exposure",label:"双重曝光",description:"影像叠加融合"},
  {value:"creative:glitch-art",label:"故障艺术",description:"Glitch、数字噪点美学"},
  {value:"creative:fantasy-world",label:"奇幻世界观",description:"架空世界、异世界构建"}
 ]}
];
const optimizeWandIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>';
let language="zh";
let showPromptDiff=true;
let activeResult=latestResult||null;
let optimizeStyle=String(template.optimizeStyle||"standard");
let optimizing=false;
let translatingBase=false;
let streamingPrompt="";
let streamingBaseTranslation="";
let translatedBasePromptEn="";
let translatedBaseNegativePromptEn="";
let statusTimer=0;
let baseAutoTranslateTimer=0;
const formValues=initialFormValues();
const resultWidthStorageKey="prompt-template-export-result-group-width-v1";
const baseWidthStorageKey="prompt-template-export-base-width-v1";
function setupOuterColumnResize(){const wrap=document.querySelector(".wrap");const panel=document.querySelector(".result-panel");const handle=document.getElementById("resize-form-results");if(!wrap||!panel||!handle)return;const minFormWidth=260;const minResultWidth=532;try{const saved=Number(localStorage.getItem(resultWidthStorageKey)||"");if(Number.isFinite(saved)&&saved>=minResultWidth)wrap.style.setProperty("--result-width",Math.round(saved)+"px");}catch{}handle.addEventListener("pointerdown",(event)=>{event.preventDefault();const startX=event.clientX;const startWidth=panel.getBoundingClientRect().width;const wrapWidth=wrap.getBoundingClientRect().width;const maxWidth=Math.max(minResultWidth,wrapWidth-minFormWidth-12);document.body.classList.add("resizing-columns");const move=(moveEvent)=>{const next=Math.min(maxWidth,Math.max(minResultWidth,startWidth+startX-moveEvent.clientX));wrap.style.setProperty("--result-width",Math.round(next)+"px");};const finish=()=>{document.body.classList.remove("resizing-columns");try{const width=Math.round(panel.getBoundingClientRect().width);localStorage.setItem(resultWidthStorageKey,String(width));}catch{}window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",finish);window.removeEventListener("pointercancel",finish);};window.addEventListener("pointermove",move);window.addEventListener("pointerup",finish);window.addEventListener("pointercancel",finish);});}
function setupResultColumnResize(){const grid=document.querySelector(".result-grid");const panel=document.querySelector(".base-card");const handle=document.getElementById("resize-base-ai");if(!grid||!panel||!handle)return;const minWidth=260;try{const saved=Number(localStorage.getItem(baseWidthStorageKey)||"");if(Number.isFinite(saved)&&saved>=minWidth)grid.style.setProperty("--base-width",Math.round(saved)+"px");}catch{}handle.addEventListener("pointerdown",(event)=>{event.preventDefault();const startX=event.clientX;const startWidth=panel.getBoundingClientRect().width;const gridWidth=grid.getBoundingClientRect().width;const maxWidth=Math.max(minWidth,gridWidth-minWidth-12);document.body.classList.add("resizing-columns");const move=(moveEvent)=>{const next=Math.min(maxWidth,Math.max(minWidth,startWidth+moveEvent.clientX-startX));grid.style.setProperty("--base-width",Math.round(next)+"px");};const finish=()=>{document.body.classList.remove("resizing-columns");try{const width=Math.round(panel.getBoundingClientRect().width);localStorage.setItem(baseWidthStorageKey,String(width));}catch{}window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",finish);window.removeEventListener("pointercancel",finish);};window.addEventListener("pointermove",move);window.addEventListener("pointerup",finish);window.addEventListener("pointercancel",finish);});}
function sortedComponents(){return [...template.components].sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0));}
function componentWidth(component){if(component.type==="section")return"full";if(component.width==="half"||component.width==="full")return component.width;return component.type==="text"||component.type==="select"?"half":"full";}
function defaultValues(value,options){const values=String(value||"").split(/[\\n,，、]+/).map((item)=>item.trim()).filter(Boolean);const set=new Set(options||[]);return set.size?values.filter((item)=>set.has(item)):values;}
function initialValue(component){if(component.type==="image")return{fileName:"",note:String(component.defaultValue||""),files:[]};if(component.type==="select"&&component.multiple)return defaultValues(component.defaultValue,component.options);return String(component.defaultValue||"");}
function initialFormValues(){const values={};for(const component of sortedComponents()){if(component.type!=="section")values[component.id]=initialValue(component);}const resultSnapshot=activeResult&&activeResult.formSnapshot&&typeof activeResult.formSnapshot==="object"?activeResult.formSnapshot:null;const snapshot=exportFormSnapshot&&typeof exportFormSnapshot==="object"?exportFormSnapshot:resultSnapshot;return snapshot?{...values,...snapshot}:values;}
function fileSize(bytes){const value=Number(bytes||0);if(!value)return"";if(value<1024)return Math.round(value)+" B";if(value<1024*1024)return(value/1024).toFixed(value<100*1024?1:0)+" KB";return(value/1024/1024).toFixed(1)+" MB";}
function fileText(file){const name=String(file&&file.fileName||"").trim();if(!name)return"";const dimensions=Number(file.width)>0&&Number(file.height)>0?file.width+"x"+file.height:"";const size=fileSize(file.size);const meta=[dimensions,size].filter(Boolean).join("，");return meta?name+"（"+meta+"）":name;}
function valueText(component,value){if(component.type==="image"){const note=value&&value.note?String(value.note).trim():String(component.defaultValue||"").trim();const files=Array.isArray(value&&value.files)?value.files:[];const fileTexts=files.map(fileText).filter(Boolean);if(fileTexts.length)return"已上传 "+fileTexts.length+" 个素材："+fileTexts.join("；")+(note?"；备注："+note:"");if(value&&value.fileName)return "已上传 "+value.fileName+(note?"；备注："+note:"");return note?"素材备注："+note:"";}if(Array.isArray(value))return value.map((item)=>String(item).trim()).filter(Boolean).join("、");return String(value??component.defaultValue??"").trim();}
function buildPrompt(targetLanguage){
 const rules=template.rules||{}; const parts=[];
 if(rules.prefix) parts.push(String(rules.prefix));
 for(const c of sortedComponents()){if(!c||c.type==="section") continue; const text=valueText(c,formValues[c.id]); if(!text) continue; const label=c.label||(c.slot&&rules.labels&&rules.labels[c.slot])||c.id; parts.push(label+"："+text);}
 parts.push("输出语言："+(labels[targetLanguage]||labels.zh));
 if(rules.suffix) parts.push(String(rules.suffix));
 return parts.join(String(rules.joiner||"\\n"));
}
function manualNegativePrompt(){return String(template&&template.rules&&template.rules.negativePrompt||"").trim();}
function negativeLabel(){return language==="en"?"Negative prompt":"反向提示词";}
function promptWithNegative(prompt,negative){const positive=String(prompt||"").trim();const negativeText=String(negative||"").trim();if(!positive)return"";if(!negativeText)return positive;return positive+"\\n\\n"+negativeLabel()+"：\\n"+negativeText;}
function resultPrompt(result){if(!result)return"";if(language==="en"){return String(result.optimizedPrompts&&result.optimizedPrompts.en||result.optimizedPromptEn||"").trim();}return String(result.optimizedPrompts&&result.optimizedPrompts.zh||result.optimizedPrompt||"").trim();}
function resultNegative(result){if(!result)return"";if(language==="en"){return String(result.negativePrompts&&result.negativePrompts.en||result.negativePromptEn||"").trim();}return String(result.negativePrompts&&result.negativePrompts.zh||result.negativePrompt||"").trim();}
function resultBasePrompt(result){if(!result)return"";if(language==="en")return String(result.basePromptEn||"").trim();return String(result.basePrompt||"").trim();}
function nonEmptyPromptLineCount(value){return String(value||"").replace(/\\r\\n/g,"\\n").split("\\n").filter((line)=>line.trim()).length;}
function translatedPromptCoversSource(source,translated){const sourceLineCount=nonEmptyPromptLineCount(source);const translatedLineCount=nonEmptyPromptLineCount(translated);return Boolean(String(translated||"").trim())&&(!sourceLineCount||translatedLineCount>=sourceLineCount);}
function activeResultMatchesBase(){const resultBase=String(activeResult&&activeResult.basePrompt||"").trim();const currentBase=buildPrompt("zh").trim();return Boolean(activeResult&&resultBase&&currentBase&&resultBase===currentBase);}
function aiResultStale(){const resultBase=String(activeResult&&activeResult.basePrompt||"").trim();const currentBase=buildPrompt("zh").trim();return Boolean(activeResult&&resultBase&&currentBase&&resultBase!==currentBase);}
function currentBasePromptEn(){const currentBase=buildPrompt("zh").trim();const resultBaseEn=activeResultMatchesBase()?String(activeResult&&activeResult.basePromptEn||"").trim():"";return streamingBaseTranslation||translatedBasePromptEn||(translatedPromptCoversSource(currentBase,resultBaseEn)?resultBaseEn:"");}
function shouldAutoTranslateBase(){if(!aiOptimizeEnabled||language!=="en"||translatingBase||optimizing)return false;if(!buildPrompt("zh").trim())return false;const needsNegative=Boolean(manualNegativePrompt()&&!translatedBaseNegativePromptEn.trim());return !currentBasePromptEn().trim()||needsNegative;}
function maybeAutoTranslateBase(delay){window.clearTimeout(baseAutoTranslateTimer);if(!shouldAutoTranslateBase())return;baseAutoTranslateTimer=window.setTimeout(()=>{if(shouldAutoTranslateBase())translateBasePrompt();},Number(delay)||0);}
function setPromptLanguage(next){language=next;renderLanguageTabs();update();if(next==="en")maybeAutoTranslateBase();}
function setStatus(message,type){const status=document.getElementById("status");if(!status)return;window.clearTimeout(statusTimer);const text=String(message||"").trim();status.textContent=text;status.className="toast"+(type?" "+type:"")+(text?" visible":"");if(text){statusTimer=window.setTimeout(()=>{status.className="toast"+(type?" "+type:"");},type==="error"?4200:2400);}}
function setPromptLoading(prefix,loading){const box=document.getElementById(prefix+"-prompt-box");if(box)box.classList.toggle("loading",Boolean(loading));}
function setNegative(prefix,value){const wrap=document.getElementById(prefix+"-negative-wrap");document.getElementById(prefix+"-negative-label").textContent=negativeLabel();document.getElementById(prefix+"-negative").textContent=value||"";wrap.className=value?"negative visible":"negative";}
function copyText(text){if(navigator.clipboard&&window.isSecureContext){return navigator.clipboard.writeText(text);}const area=document.createElement("textarea");area.value=text;area.style.position="fixed";area.style.opacity="0";document.body.appendChild(area);area.select();document.execCommand("copy");area.remove();return Promise.resolve();}
function currentBasePrompt(){if(language==="en")return currentBasePromptEn();return buildPrompt("zh");}
function currentBaseNegative(){return language==="zh"?manualNegativePrompt():translatedBaseNegativePromptEn;}
function currentAiPrompt(){return streamingPrompt||resultPrompt(activeResult);}
function currentAiNegative(){return optimizing&&streamingPrompt?"":(resultNegative(activeResult)||(language==="zh"?manualNegativePrompt():""));}
function flatStyleOptions(){return styleOptions.flatMap((item)=>[item,...(Array.isArray(item.children)?item.children.map((child)=>({...child,parentValue:item.value,parentLabel:item.label})):[])]);}
function normalizeStyle(value){const text=String(value||"standard");return flatStyleOptions().some((item)=>item.value===text)?text:"standard";}
function currentStyle(){optimizeStyle=normalizeStyle(optimizeStyle);return optimizeStyle;}
function currentStyleOption(){const value=currentStyle();return flatStyleOptions().find((item)=>item.value===value)||styleOptions[0];}
const promptDiffMaxCells=160000;
function tokenizePromptDiffText(text){const parts=String(text||"").match(/[\u3400-\u9fff\uf900-\ufaff]|[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*|\\s+|[^\\s]/g)||[];return parts.map((part,index)=>({text:part,normalized:/^\\s+$/.test(part)?"":part.toLowerCase(),sourceIndex:index}));}
function matchedPromptDiffTokenIndexes(baseText,targetText){const baseTokens=tokenizePromptDiffText(baseText).filter((token)=>token.normalized);const targetTokens=tokenizePromptDiffText(targetText).filter((token)=>token.normalized);const matched=new Set();if(baseTokens.length===0||targetTokens.length===0)return matched;if(baseTokens.length*targetTokens.length>promptDiffMaxCells){const baseValues=new Set(baseTokens.map((token)=>token.normalized));targetTokens.forEach((token)=>{if(baseValues.has(token.normalized))matched.add(token.sourceIndex);});return matched;}const rows=baseTokens.length+1;const cols=targetTokens.length+1;const lcs=Array.from({length:rows},()=>new Uint16Array(cols));for(let baseIndex=baseTokens.length-1;baseIndex>=0;baseIndex-=1){for(let targetIndex=targetTokens.length-1;targetIndex>=0;targetIndex-=1){if(baseTokens[baseIndex].normalized===targetTokens[targetIndex].normalized){lcs[baseIndex][targetIndex]=lcs[baseIndex+1][targetIndex+1]+1;}else{lcs[baseIndex][targetIndex]=Math.max(lcs[baseIndex+1][targetIndex],lcs[baseIndex][targetIndex+1]);}}}let baseIndex=0;let targetIndex=0;while(baseIndex<baseTokens.length&&targetIndex<targetTokens.length){if(baseTokens[baseIndex].normalized===targetTokens[targetIndex].normalized){matched.add(targetTokens[targetIndex].sourceIndex);baseIndex+=1;targetIndex+=1;}else if(lcs[baseIndex+1][targetIndex]>=lcs[baseIndex][targetIndex+1]){baseIndex+=1;}else{targetIndex+=1;}}return matched;}
function renderPromptDiffText(elementId,content,baseText){const element=document.getElementById(elementId);if(!element)return;const text=String(content||"");element.replaceChildren();if(!showPromptDiff||!text.trim()||!String(baseText||"").trim()){element.textContent=text;return;}const tokens=tokenizePromptDiffText(text);const matched=matchedPromptDiffTokenIndexes(baseText,text);const segments=[];tokens.forEach((token)=>{const changed=Boolean(token.normalized&&!matched.has(token.sourceIndex));const last=segments[segments.length-1];if(last&&last.changed===changed){last.text+=token.text;}else{segments.push({text:token.text,changed});}});for(const segment of segments){if(segment.changed){const mark=document.createElement("mark");mark.textContent=segment.text;element.appendChild(mark);}else{element.appendChild(document.createTextNode(segment.text));}}}
function syncDiffToggle(){const toggle=document.getElementById("diff-toggle");if(!toggle)return;toggle.className="diff-switch"+(showPromptDiff?" active":"");toggle.setAttribute("aria-pressed",String(showPromptDiff));toggle.title=showPromptDiff?"隐藏差异":"显示差异";}
function syncAiStaleBadge(){const badge=document.getElementById("ai-stale-badge");if(!badge)return;badge.className="stale-badge"+(aiResultStale()?" visible":"");}
function closeStyleMenu(){const wrapper=document.getElementById("optimize-style-select");const trigger=document.getElementById("optimize-style-trigger");if(wrapper)wrapper.classList.remove("open");if(trigger)trigger.setAttribute("aria-expanded","false");}
function openStyleMenu(){const wrapper=document.getElementById("optimize-style-select");const trigger=document.getElementById("optimize-style-trigger");if(!wrapper||!trigger||trigger.disabled)return;wrapper.classList.add("open");trigger.setAttribute("aria-expanded","true");}
function syncOptimizeStyleControl(){const option=currentStyleOption();const label=document.getElementById("optimize-style-label");if(label)label.textContent=option.label;const trigger=document.getElementById("optimize-style-trigger");const disabled=optimizing||translatingBase;if(trigger){trigger.disabled=disabled;if(disabled)closeStyleMenu();else trigger.setAttribute("aria-expanded",String(Boolean(document.getElementById("optimize-style-select")&&document.getElementById("optimize-style-select").classList.contains("open"))));}const button=document.getElementById("optimize");const action=optimizing?"优化中":(activeResult?"重新优化":"AI优化");if(button){button.setAttribute("aria-label",action+"，"+option.label+"风格");button.title=action+"，"+option.label+"风格";}document.querySelectorAll(".optimize-style-option").forEach((item)=>{const active=item.getAttribute("data-value")===option.value;item.className="optimize-style-option"+(active?" active":"");item.setAttribute("aria-selected",String(active));});}
function renderStyleOptions(){const menu=document.getElementById("optimize-style-menu");if(!menu)return;menu.innerHTML="";optimizeStyle=normalizeStyle(optimizeStyle);for(const option of styleOptions){const row=document.createElement("div");row.className="optimize-style-row";const children=Array.isArray(option.children)?option.children:[];const item=document.createElement("button");item.type="button";item.className="optimize-style-option";item.setAttribute("role","option");item.setAttribute("data-value",option.value);const text=document.createElement("span");const title=document.createElement("strong");title.textContent=option.label;const desc=document.createElement("small");desc.textContent=option.description||"";text.append(title,desc);const action=document.createElement("span");action.className="optimize-style-row-action";if(children.length){const arrow=document.createElement("span");arrow.className="optimize-style-sub-caret";arrow.textContent="›";action.appendChild(arrow);}item.append(text,action);item.onclick=(event)=>{event.stopPropagation();optimizeStyle=option.value;closeStyleMenu();syncOptimizeStyleControl();};row.appendChild(item);if(children.length){const submenu=document.createElement("div");submenu.className="optimize-style-submenu";for(const child of children){const childItem=document.createElement("button");childItem.type="button";childItem.className="optimize-style-option";childItem.setAttribute("role","option");childItem.setAttribute("data-value",child.value);const childText=document.createElement("span");const childTitle=document.createElement("strong");childTitle.textContent=child.label;const childDesc=document.createElement("small");childDesc.textContent=child.description||"";childText.append(childTitle,childDesc);const childCheck=document.createElement("span");childCheck.className="optimize-style-child-check";childItem.append(childText,childCheck);childItem.onclick=(event)=>{event.stopPropagation();optimizeStyle=child.value;closeStyleMenu();syncOptimizeStyleControl();};submenu.appendChild(childItem);}row.appendChild(submenu);}menu.appendChild(row);}syncOptimizeStyleControl();}
function renderLanguageTabs(){document.querySelectorAll("[data-language-tabs]").forEach((tabs)=>{tabs.innerHTML="";for(const key of Object.keys(labels)){const b=document.createElement("button");b.type="button";b.className=language===key?"active":"";b.textContent=key==="zh"?"中":"EN";b.onclick=()=>setPromptLanguage(key);tabs.appendChild(b);}});}
function renderFiles(list,value){const files=Array.isArray(value&&value.files)?value.files:[];list.innerHTML="";for(const item of files){const row=document.createElement("div");row.className="upload-item";const thumb=document.createElement("div");thumb.className="upload-thumb";const preview=item.previewUrl||item.dataUrl||"";if(preview){const img=document.createElement("img");img.src=preview;thumb.appendChild(img);}else{thumb.textContent="素材";}const info=document.createElement("div");const name=document.createElement("strong");name.textContent=item.fileName||"";const meta=document.createElement("span");meta.textContent=(item.width&&item.height?item.width+" x "+item.height:"尺寸未知")+(fileSize(item.size)?" · "+fileSize(item.size):"");info.append(name,meta);const downloadSource=item.downloadUrl||item.dataUrl||item.originalUrl||item.previewUrl||"";const download=document.createElement("a");download.className=downloadSource?"upload-download":"upload-download disabled";download.textContent="下载";download.href=downloadSource||"#";download.download=item.fileName||"素材图片";download.onclick=(event)=>event.stopPropagation();row.append(thumb,info,download);list.appendChild(row);}}
function readFileDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(reader.error||new Error("文件读取失败"));reader.readAsDataURL(file);});}
function imageDimensions(src){return new Promise((resolve)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth||0,height:img.naturalHeight||0});img.onerror=()=>resolve({width:0,height:0});img.src=src;});}
function requestFormValues(){const next={};for(const [key,value] of Object.entries(formValues)){if(!value||typeof value!=="object"||Array.isArray(value)){next[key]=value;continue;}const imageValue=value;next[key]={...imageValue,previewUrl:"",files:Array.isArray(imageValue.files)?imageValue.files.map((file)=>({...file,previewUrl:"",dataUrl:"",downloadUrl:""})):[]};}return next;}
function closeFormSelectMenus(except){document.querySelectorAll(".custom-select.open,.template-multi-select.open").forEach((wrapper)=>{if(wrapper===except)return;wrapper.classList.remove("open");const trigger=wrapper.querySelector(".custom-select-trigger");if(trigger)trigger.setAttribute("aria-expanded","false");});}
function touchPromptForm(){streamingPrompt="";markResultStale();update();}
function selectOptions(component){return Array.isArray(component.options)?component.options.map((option)=>String(option)):[];}
function createSelectTrigger(labelText,placeholder,multiple){const trigger=document.createElement("button");trigger.type="button";trigger.className="custom-select-trigger";trigger.setAttribute("aria-haspopup","listbox");trigger.setAttribute("aria-expanded","false");const value=document.createElement("span");value.className="custom-select-value";const label=document.createElement("span");label.className=labelText?"custom-select-label":"custom-select-label placeholder";label.textContent=labelText||placeholder||"请选择";value.appendChild(label);const caret=document.createElement("span");caret.className="custom-select-caret";caret.setAttribute("aria-hidden","true");trigger.append(value,caret);trigger._valueLabel=label;trigger._multiple=multiple;return trigger;}
function createCustomSelect(component){const options=selectOptions(component);const placeholder=component.placeholder||"请选择";let current=String(formValues[component.id]??component.defaultValue??"");formValues[component.id]=current;const wrapper=document.createElement("div");wrapper.className="custom-select";const trigger=createSelectTrigger(current,placeholder,false);const menu=document.createElement("div");menu.className="custom-select-menu";menu.setAttribute("role","listbox");function sync(){current=String(formValues[component.id]??"");const label=trigger._valueLabel;label.textContent=current||placeholder;label.className=current?"custom-select-label":"custom-select-label placeholder";menu.querySelectorAll("button").forEach((button)=>{const active=button.getAttribute("data-value")===current;button.className=active?"active":"";button.setAttribute("aria-selected",String(active));});}trigger.onclick=(event)=>{event.preventDefault();event.stopPropagation();const open=!wrapper.classList.contains("open");closeFormSelectMenus(wrapper);wrapper.classList.toggle("open",open);trigger.setAttribute("aria-expanded",String(open));};for(const option of options){const item=document.createElement("button");item.type="button";item.setAttribute("role","option");item.setAttribute("data-value",option);const text=document.createElement("strong");text.textContent=option;const check=document.createElement("span");check.className="custom-select-check";check.textContent="✓";item.append(text,check);item.onclick=(event)=>{event.preventDefault();event.stopPropagation();formValues[component.id]=option;sync();closeFormSelectMenus();touchPromptForm();};menu.appendChild(item);}if(options.length===0){const empty=document.createElement("div");empty.className="custom-select-empty";empty.textContent="暂无选项";menu.appendChild(empty);}wrapper.append(trigger,menu);sync();return wrapper;}
function createCustomMultiSelect(component){const options=selectOptions(component);const placeholder=component.placeholder||"请选择";let values=Array.isArray(formValues[component.id])?formValues[component.id].map((item)=>String(item)):defaultValues(component.defaultValue,component.options);formValues[component.id]=values;const wrapper=document.createElement("div");wrapper.className="template-multi-select";const trigger=createSelectTrigger("",placeholder,true);const menu=document.createElement("div");menu.className="template-multi-select-menu";menu.setAttribute("role","listbox");menu.setAttribute("aria-multiselectable","true");function sync(){values=Array.isArray(formValues[component.id])?formValues[component.id].map((item)=>String(item)):[];const selectedSet=new Set(values);const selectedLabels=options.filter((option)=>selectedSet.has(option));const label=trigger._valueLabel;label.textContent=selectedLabels.length?selectedLabels.join("、"):placeholder;label.className=selectedLabels.length?"custom-select-label":"custom-select-label placeholder";menu.querySelectorAll("button").forEach((button)=>{const active=selectedSet.has(String(button.getAttribute("data-value")||""));button.className=active?"active":"";button.setAttribute("aria-selected",String(active));});}trigger.onclick=(event)=>{event.preventDefault();event.stopPropagation();const open=!wrapper.classList.contains("open");closeFormSelectMenus(wrapper);wrapper.classList.toggle("open",open);trigger.setAttribute("aria-expanded",String(open));};for(const option of options){const item=document.createElement("button");item.type="button";item.setAttribute("role","option");item.setAttribute("data-value",option);const text=document.createElement("strong");text.textContent=option;const check=document.createElement("span");check.className="custom-select-check";check.textContent="✓";item.append(text,check);item.onclick=(event)=>{event.preventDefault();event.stopPropagation();const next=new Set(Array.isArray(formValues[component.id])?formValues[component.id].map((value)=>String(value)):[]);if(next.has(option))next.delete(option);else next.add(option);formValues[component.id]=Array.from(next);sync();touchPromptForm();};menu.appendChild(item);}if(options.length===0){const empty=document.createElement("div");empty.className="custom-select-empty";empty.textContent="暂无选项";menu.appendChild(empty);}wrapper.append(trigger,menu);sync();return wrapper;}
function markResultStale(){streamingBaseTranslation="";translatedBasePromptEn="";translatedBaseNegativePromptEn="";if(activeResult){setStatus("表单内容已变化，可重新AI优化","");}if(language==="en")maybeAutoTranslateBase(650);}
function render(){
 const root=document.getElementById("form"); root.innerHTML="";
 for(const component of sortedComponents()){
  const widthClass=componentWidth(component)==="half"?"half":"full";
  const field=document.createElement("label"); field.className="field "+widthClass;
  if(component.type==="section"){const div=document.createElement("div");div.className="section-title "+widthClass;div.textContent=component.label||"分组";root.appendChild(div);continue;}
  const title=document.createElement("span"); title.textContent=component.label||component.id; field.appendChild(title);
  if(component.type==="textarea"){const input=document.createElement("textarea"); input.placeholder=component.placeholder||""; input.value=formValues[component.id]??component.defaultValue??""; input.oninput=()=>{formValues[component.id]=input.value;streamingPrompt="";markResultStale();update();}; field.appendChild(input);}
  else if(component.type==="select"){field.appendChild(component.multiple?createCustomMultiSelect(component):createCustomSelect(component));}
  else if(component.type==="image"){const box=document.createElement("div");box.className="upload";const pick=document.createElement("label");pick.className="upload-pick";const file=document.createElement("input");file.className="upload-input";file.type="file";file.accept="image/*";file.multiple=true;const pickIcon=document.createElement("span");pickIcon.className="upload-pick-icon";pickIcon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8 12 3 7 8"/><path d="M12 3v12"/></svg>';const pickCopy=document.createElement("span");pickCopy.className="upload-pick-copy";const pickTitle=document.createElement("strong");pickTitle.textContent="选择素材";const pickDesc=document.createElement("small");pickDesc.textContent="支持多张图片，可继续追加";pickCopy.append(pickTitle,pickDesc);pick.append(file,pickIcon,pickCopy);const note=document.createElement("input");note.placeholder="素材备注";const current=formValues[component.id]&&typeof formValues[component.id]==="object"?formValues[component.id]:initialValue(component);formValues[component.id]=current;note.value=current.note||component.defaultValue||"";const list=document.createElement("div");list.className="upload-list";renderFiles(list,current);file.onchange=async()=>{const selected=Array.from(file.files||[]);const old=formValues[component.id]||{};const oldFiles=Array.isArray(old.files)?old.files:[];const nextFiles=[];for(const selectedFile of selected){const dataUrl=await readFileDataUrl(selectedFile);const dimensions=await imageDimensions(dataUrl);nextFiles.push({fileName:selectedFile.name,size:selectedFile.size,width:dimensions.width,height:dimensions.height,previewUrl:dataUrl,dataUrl,downloadUrl:dataUrl,mimeType:selectedFile.type});}const files=[...oldFiles,...nextFiles];formValues[component.id]={...old,files,fileName:files[0]&&files[0].fileName||"",note:note.value,previewUrl:files[0]&&(files[0].previewUrl||files[0].dataUrl)||""};file.value="";renderFiles(list,formValues[component.id]);streamingPrompt="";markResultStale();update();};note.oninput=()=>{const old=formValues[component.id]||{};formValues[component.id]={...old,note:note.value};streamingPrompt="";markResultStale();update();};box.append(pick,note,list);field.appendChild(box);}
  else {const input=document.createElement("input"); input.placeholder=component.placeholder||""; input.value=formValues[component.id]??component.defaultValue??""; input.oninput=()=>{formValues[component.id]=input.value;streamingPrompt="";markResultStale();update();}; field.appendChild(input);}
  root.appendChild(field);
 }
}
function parseFrame(frame){let event="message";const data=[];for(const line of frame.split("\\n")){if(line.startsWith("event:"))event=line.slice(6).trim();else if(line.startsWith("data:"))data.push(line.slice(5).trimStart());}const text=data.join("\\n").trim();let parsed={};if(text){try{parsed=JSON.parse(text);}catch{parsed={error:text};}}return{event,data:parsed};}
async function readOptimizeStream(response){if(!response.body)throw new Error("浏览器不支持流式响应");const reader=response.body.getReader();const decoder=new TextDecoder();let buffer="";let doneResult=null;for(;;){const next=await reader.read();if(next.value)buffer+=decoder.decode(next.value,{stream:!next.done}).replace(/\\r\\n/g,"\\n");let boundary=buffer.indexOf("\\n\\n");while(boundary>=0){const frame=parseFrame(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);if(frame.event==="delta"){if(frame.data&&frame.data.language==="en"){setPromptLanguage("en");}const delta=String(frame.data&&frame.data.delta||"");streamingPrompt=frame.data&&frame.data.reset?delta:streamingPrompt+delta;update();}else if(frame.event==="done"){doneResult=frame.data&&frame.data.result||null;}else if(frame.event==="error"){throw new Error(String(frame.data&&frame.data.error||"AI优化失败"));}boundary=buffer.indexOf("\\n\\n");}if(next.done)break;}if(buffer.trim()){const frame=parseFrame(buffer);if(frame.event==="done")doneResult=frame.data&&frame.data.result||null;}return doneResult;}
async function readTranslateStream(response){if(!response.body)throw new Error("浏览器不支持流式响应");const reader=response.body.getReader();const decoder=new TextDecoder();let buffer="";let doneResult=null;for(;;){const next=await reader.read();if(next.value)buffer+=decoder.decode(next.value,{stream:!next.done}).replace(/\\r\\n/g,"\\n");let boundary=buffer.indexOf("\\n\\n");while(boundary>=0){const frame=parseFrame(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);if(frame.event==="delta"){const delta=String(frame.data&&frame.data.delta||"");streamingBaseTranslation=frame.data&&frame.data.reset?delta:streamingBaseTranslation+delta;update();}else if(frame.event==="done"){doneResult=frame.data||null;}else if(frame.event==="error"){throw new Error(String(frame.data&&frame.data.error||"基础提示词翻译失败"));}boundary=buffer.indexOf("\\n\\n");}if(next.done)break;}if(buffer.trim()){const frame=parseFrame(buffer);if(frame.event==="done")doneResult=frame.data||null;}return doneResult;}
async function translateBasePrompt(){const basePrompt=buildPrompt("zh").trim();if(!basePrompt){setStatus("请先填写表单内容","error");return;}if(!exportAccess||!exportAccess.token||!exportAccess.translateEndpoint){setStatus("当前网页未启用翻译功能，请重新下载 AI 优化版","error");return;}if(Number(exportAccess.expiresAt)>0&&Date.now()>Number(exportAccess.expiresAt)){setStatus("AI 功能有效期已到，请重新下载网页","error");return;}language="en";translatingBase=true;streamingBaseTranslation="";translatedBasePromptEn="";translatedBaseNegativePromptEn="";setStatus("基础提示词翻译中","");renderLanguageTabs();update();try{const response=await fetch(String(exportAccess.translateEndpoint),{method:"POST",mode:"cors",credentials:"omit",headers:{"Accept":"text/event-stream, application/json","Content-Type":"application/json"},body:JSON.stringify({prompt:basePrompt,negativePrompt:manualNegativePrompt(),signature:basePrompt,exportToken:exportAccess.token})});if(!response.ok){let message=response.statusText||"基础提示词翻译失败";try{const data=await response.json();message=String(data.error||data.message||message);}catch{}throw new Error(message);}const contentType=String(response.headers.get("content-type")||"").toLowerCase();let result=null;if(contentType.includes("text/event-stream")){result=await readTranslateStream(response);}else{result=await response.json();}translatedBasePromptEn=String(result&&result.text||result&&result.translation&&result.translation.basePromptEn||"").trim();translatedBaseNegativePromptEn=String(result&&result.negativeText||result&&result.translation&&result.translation.negativePromptEn||"").trim();streamingBaseTranslation="";setStatus(translatedBasePromptEn?"基础提示词已翻译":"翻译已结束，但没有返回结果",translatedBasePromptEn?"success":"");}catch(error){setStatus(error&&error.message?error.message:"基础提示词翻译失败，请确认原应用服务正在运行","error");}finally{translatingBase=false;update();}}
async function optimizePrompt(){const basePrompt=buildPrompt("zh").trim();if(!basePrompt){setStatus("请先填写表单内容","error");return;}if(!exportAccess||!exportAccess.token||!exportAccess.optimizeEndpoint){setStatus("当前网页未启用 AI 优化，请重新下载 AI 优化版","error");return;}if(Number(exportAccess.expiresAt)>0&&Date.now()>Number(exportAccess.expiresAt)){setStatus("AI 优化有效期已到，请重新下载网页","error");return;}optimizing=true;streamingPrompt="";setStatus("AI优化中","");update();try{const response=await fetch(String(exportAccess.optimizeEndpoint),{method:"POST",mode:"cors",credentials:"omit",headers:{"Accept":"text/event-stream, application/json","Content-Type":"application/json"},body:JSON.stringify({language:"zh",formValues:requestFormValues(),basePrompt,optimizeStyle:currentStyle(),exportToken:exportAccess.token})});if(!response.ok){let message=response.statusText||"AI优化失败";try{const data=await response.json();message=String(data.error||data.message||message);}catch{}throw new Error(message);}const contentType=String(response.headers.get("content-type")||"").toLowerCase();let result=null;if(contentType.includes("text/event-stream")){result=await readOptimizeStream(response);}else{const data=await response.json();result=data&&data.result||null;}activeResult=result;streamingPrompt="";if(result&&String(result.optimizedPrompts&&result.optimizedPrompts.en||result.optimizedPromptEn||"").trim()){setPromptLanguage("en");}setStatus(result?"AI优化完成":"AI优化已结束，但没有返回结果",result?"success":"");}catch(error){setStatus(error&&error.message?error.message:"AI优化失败，请确认原应用服务正在运行","error");}finally{optimizing=false;update();if(language==="en")maybeAutoTranslateBase();}}
function update(){const zhBasePrompt=buildPrompt("zh").trim();const basePrompt=currentBasePrompt();const baseNegative=currentBaseNegative();const aiPrompt=aiOptimizeEnabled?currentAiPrompt():"";const aiNegative=aiOptimizeEnabled?currentAiNegative():"";const baseLoading=translatingBase&&!streamingBaseTranslation;const aiLoading=optimizing&&!streamingPrompt;const aiEmptyText=activeResult?(language==="en"?"英文版本需要重新优化后显示。":"中文版本需要重新优化后显示。"):"AI优化后显示结果";const aiDisplayText=aiPrompt||(aiOptimizeEnabled?aiEmptyText:"无 AI 优化版未启用优化功能，可直接复制基础提示词。");const baseEmptyText=language==="en"?(aiOptimizeEnabled?(baseLoading||translatingBase?"基础提示词翻译中":"英文基础提示词需要重新翻译"):"当前网页未启用翻译功能。"):"填写表单后自动生成基础提示词";document.getElementById("base-prompt").textContent=basePrompt||baseEmptyText;setNegative("base",baseNegative);renderPromptDiffText("ai-prompt",aiDisplayText,aiPrompt?basePrompt:"");setNegative("ai",aiNegative&&aiPrompt?aiNegative:"");setPromptLoading("base",baseLoading);setPromptLoading("ai",aiLoading);document.getElementById("copy-base").disabled=baseLoading||!promptWithNegative(basePrompt,baseNegative).trim();document.getElementById("copy-ai").disabled=aiLoading||!aiOptimizeEnabled||!promptWithNegative(aiPrompt,aiNegative).trim();const translateButton=document.getElementById("translate-base");if(translateButton)translateButton.disabled=translatingBase||optimizing||!zhBasePrompt;const translateText=document.getElementById("translate-base-text");if(translateText)translateText.textContent=translatingBase?"翻译中":(currentBasePromptEn()?"重新翻译":"翻译英文");const translateIcon=document.getElementById("translate-base-icon");if(translateIcon)translateIcon.innerHTML=translatingBase?'<span class="spinner"></span>':"";const optimizeButton=document.getElementById("optimize");if(optimizeButton)optimizeButton.disabled=optimizing||translatingBase||!zhBasePrompt;const optimizeText=document.getElementById("optimize-text");if(optimizeText)optimizeText.textContent=optimizing?"优化中":(activeResult?"重新优化":"AI优化");const optimizeIcon=document.getElementById("optimize-icon");if(optimizeIcon)optimizeIcon.innerHTML=optimizing?'<span class="spinner"></span>':optimizeWandIcon;syncOptimizeStyleControl();syncDiffToggle();syncAiStaleBadge();}
document.getElementById("copy-base").onclick=()=>copyText(promptWithNegative(currentBasePrompt(),currentBaseNegative())).then(()=>setStatus("基础提示词已复制","success"));
document.getElementById("copy-ai").onclick=()=>copyText(promptWithNegative(currentAiPrompt(),currentAiNegative())).then(()=>setStatus("AI优化结果已复制","success"));
const translateButton=document.getElementById("translate-base");if(translateButton)translateButton.onclick=translateBasePrompt;
const diffToggle=document.getElementById("diff-toggle");if(diffToggle)diffToggle.onclick=()=>{showPromptDiff=!showPromptDiff;update();};
const optimizeButton=document.getElementById("optimize");if(optimizeButton)optimizeButton.onclick=optimizePrompt;
const optimizeStyleTrigger=document.getElementById("optimize-style-trigger");if(optimizeStyleTrigger)optimizeStyleTrigger.onclick=(event)=>{event.stopPropagation();const wrapper=document.getElementById("optimize-style-select");if(!wrapper||optimizeStyleTrigger.disabled)return;if(wrapper.classList.contains("open"))closeStyleMenu();else openStyleMenu();};
document.addEventListener("click",(event)=>{const control=document.getElementById("optimize-control");if(control&&!control.contains(event.target))closeStyleMenu();closeFormSelectMenus();});
document.addEventListener("keydown",(event)=>{if(event.key==="Escape"){closeStyleMenu();closeFormSelectMenus();}});
renderStyleOptions();render();renderLanguageTabs();setupOuterColumnResize();setupResultColumnResize();if(activeResult)setStatus("已加载最近一次AI优化结果","success");update();
</script>
</body>
</html>`;
}

type PromptTemplateExportOptions = {
  aiOptimizeEnabled?: unknown;
  expiresDays?: unknown;
  formValues?: unknown;
  resultId?: unknown;
};

function exportHtmlResponse(html: string, filename: string) {
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    }
  });
}

function exportAiEnabled(value: unknown, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (value === false) return false;
  const text = String(value).trim().toLowerCase();
  return text !== "0" && text !== "false" && text !== "off";
}

async function promptTemplateExportHtmlResponse(c: Context, options: PromptTemplateExportOptions = {}) {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const row = visibleTemplate(String(c.req.param("id") ?? ""), user.id);
  if (!row) return c.json({ error: "表单不存在" }, 404);
  const styleGroups = userPreferences(user.id).promptOptimizeStyleGroups;
  const aiOptimizeEnabled = exportAiEnabled(options.aiOptimizeEnabled, c.req.query("ai") !== "0");
  const exportExpiresDays = normalizePromptTemplateExportExpiresDays(options.expiresDays ?? c.req.query("expiresDays"));
  const template = publicPromptTemplate(row, user.id, styleGroups);
  const requestedResultId = String(options.resultId ?? "").trim();
  const latestResultRow = requestedResultId
    ? getOne<PromptTemplateResultRow>(
        appDb,
        "select * from prompt_template_results where id = ? and template_id = ? and user_id = ?",
        requestedResultId,
        row.id,
        user.id
      )
    : getOne<PromptTemplateResultRow>(
        appDb,
        "select * from prompt_template_results where template_id = ? and user_id = ? order by created_at desc, id desc limit 1",
        row.id,
        user.id
      );
  const latestResult = aiOptimizeEnabled && latestResultRow ? publicPromptTemplateResult(latestResultRow) : null;
  const snapshotSource = options.formValues ?? latestResult?.formSnapshot ?? null;
  const initialFormSnapshot = await exportFormSnapshot(template, snapshotSource, user.id);
  const access = aiOptimizeEnabled ? createPromptTemplateExportAccess(row.id, user.id, exportExpiresDays) : null;
  if (!aiOptimizeEnabled) createPromptTemplateExportDownload(row.id, user.id, "basic", null);
  const optimizeEndpoint = aiOptimizeEnabled ? new URL(`/api/prompt-templates/${encodeURIComponent(row.id)}/export-optimize`, c.req.url).toString() : "";
  const translateEndpoint = aiOptimizeEnabled ? new URL(`/api/prompt-templates/${encodeURIComponent(row.id)}/export-translate`, c.req.url).toString() : "";
  const html = exportHtml(
    template,
    latestResult,
    access ? {
      optimizeEndpoint,
      translateEndpoint,
      token: access.token,
      expiresAt: access.expiresAt
    } : null,
    initialFormSnapshot
  );
  return exportHtmlResponse(html, `${template.name || "prompt-template"}.html`);
}

export function registerPromptTemplateRoutes(api: Hono) {
  api.get("/prompt-templates", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    ensureDefaultPromptTemplatesForUser(user.id);
    const scope = String(c.req.query("scope") ?? "all").trim();
    const keyword = String(c.req.query("keyword") ?? "").trim().toLowerCase();
    const countClauses = [
      "(visibility = 'shared' or user_id = ?)"
    ];
    const countParams: Array<string | number> = [user.id];
    const clauses = [
      "(prompt_templates.visibility = 'shared' or prompt_templates.user_id = ?)"
    ];
    const params: Array<string | number> = [user.id];
    if (scope === "mine") {
      clauses.push("prompt_templates.user_id = ?");
      params.push(user.id);
    }
    if (scope === "shared") clauses.push("prompt_templates.visibility = 'shared'");
    if (keyword) {
      countClauses.push("(lower(name) like ? or lower(description) like ? or lower(category) like ?)");
      countParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      clauses.push("(lower(prompt_templates.name) like ? or lower(prompt_templates.description) like ? or lower(prompt_templates.category) like ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const countsRow = getOne<PromptTemplateCountRow>(
      appDb,
      `select
        count(*) as all_count,
        sum(case when user_id = ? then 1 else 0 end) as mine_count,
        sum(case when visibility = 'shared' then 1 else 0 end) as shared_count
       from prompt_templates
       where ${countClauses.join(" and ")}`,
      user.id,
      ...countParams
    );
    const presetOrderSql = promptTemplatePresetOrderSql();
    const presetOrderParams = promptTemplatePresetOrderParams();
    const rows = getAll<PromptTemplateRow>(
      appDb,
      `select prompt_templates.*, users.username as owner_name
       from prompt_templates
       left join users on users.id = prompt_templates.user_id
       where ${clauses.join(" and ")}
       order by
        case when prompt_templates.user_id = ? then 0 else 1 end,
        case prompt_templates.visibility when 'private' then 0 else 1 end,
        ${presetOrderSql},
        prompt_templates.updated_at desc,
        prompt_templates.rowid desc`,
      ...params,
      user.id,
      ...presetOrderParams
    );
    const styleGroups = userPreferences(user.id).promptOptimizeStyleGroups;
    return c.json({
      templates: rows.map((row) => publicPromptTemplate(row, user.id, styleGroups)),
      counts: {
        all: Number(countsRow?.all_count ?? 0),
        mine: Number(countsRow?.mine_count ?? 0),
        shared: Number(countsRow?.shared_count ?? 0)
      }
    });
  });

  api.post("/prompt-templates", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const styleGroups = userPreferences(user.id).promptOptimizeStyleGroups;
    const payload = normalizeTemplatePayload(body as Record<string, unknown>, undefined, styleGroups);
    if (!payload.name) return c.json({ error: "请填写表单名称" }, 400);
    const id = makeId("prompttpl");
    const timestamp = now();
    run(
      appDb,
      `insert into prompt_templates (
        id, user_id, visibility, name, description, category, icon,
        optimize_style, components_json, rules_json, output_json, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      user.id,
      "private",
      payload.name,
      payload.description,
      payload.category,
      payload.icon,
      payload.optimizeStyle,
      payload.componentsJson,
      payload.rulesJson,
      payload.outputJson,
      timestamp,
      timestamp
    );
    const row = visibleTemplate(id, user.id);
    return c.json({ template: row ? publicPromptTemplate(row, user.id, styleGroups) : null });
  });

  api.post("/prompt-templates/defaults/restore", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const createdIds = restoreDefaultPromptTemplatesForUser(user.id);
    const styleGroups = userPreferences(user.id).promptOptimizeStyleGroups;
    const presetOrderSql = promptTemplatePresetOrderSql();
    const presetOrderParams = promptTemplatePresetOrderParams();
    const rows = createdIds.length > 0
      ? getAll<PromptTemplateRow>(
        appDb,
        `select prompt_templates.*, users.username as owner_name
         from prompt_templates
         left join users on users.id = prompt_templates.user_id
         where prompt_templates.user_id = ?
           and prompt_templates.id in (${createdIds.map(() => "?").join(",")})
         order by ${presetOrderSql}, prompt_templates.updated_at desc, prompt_templates.rowid desc`,
        user.id,
        ...createdIds,
        ...presetOrderParams
      )
      : [];
    return c.json({
      templates: rows.map((row) => publicPromptTemplate(row, user.id, styleGroups)),
      created: createdIds.length
    });
  });

  api.post("/prompt-optimizer/optimize", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const record = body as Record<string, unknown>;
    const prompt = String(record.prompt ?? record.text ?? "").trim();
    if (!prompt) return c.json({ error: "输入内容为空，请先输入提示词" }, 400);
    const provider = getOne<PromptOptimizerProviderRow>(
      configDb,
      "select * from prompt_optimizer_providers where enabled = 1 order by sort_order asc, created_at asc limit 1"
    );
    if (!provider) return c.json({ error: "请先在配置页启用提示词优化模型" }, 400);
    const styleGroups = userPreferences(user.id).promptOptimizeStyleGroups;
    const optimizeStyle = normalizePromptOptimizeStyle(record.optimizeStyle, styleGroups);
    const customInstruction = normalizePromptOptimizeCustomInstruction(record.customInstruction ?? record.optimizeDirection);
    const imageCount = normalizePromptOptimizeImageCount(record.imageCount ?? record.n);
    if (provider.stream_enabled) {
      return streamPlainPromptOptimizeResponse({ provider, prompt, optimizeStyle, styleGroups, customInstruction, imageCount, userId: user.id });
    }
    try {
      const optimized = await optimizePlainPromptWithProvider({
        provider,
        prompt,
        optimizeStyle,
        styleGroups,
        customInstruction,
        imageCount,
        logContext: { purpose: "prompt.optimize", userId: user.id, source: "prompt-optimizer" }
      });
      return c.json(optimized);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "提示词优化失败" }, 502);
    }
  });

  api.patch("/prompt-templates/:id", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const checked = ownedEditableTemplate(c.req.param("id"), user.id);
    if (!checked.row) return c.json({ error: checked.error }, checked.status as 403 | 404);
    const body = await c.req.json().catch(() => ({}));
    const styleGroups = userPreferences(user.id).promptOptimizeStyleGroups;
    const payload = normalizeTemplatePayload(body as Record<string, unknown>, checked.row, styleGroups);
    if (!payload.name) return c.json({ error: "请填写表单名称" }, 400);
    run(
      appDb,
      `update prompt_templates set
        name = ?, description = ?, category = ?, icon = ?, optimize_style = ?,
        components_json = ?, rules_json = ?, output_json = ?, updated_at = ?
       where id = ? and user_id = ?`,
      payload.name,
      payload.description,
      payload.category,
      payload.icon,
      payload.optimizeStyle,
      payload.componentsJson,
      payload.rulesJson,
      payload.outputJson,
      now(),
      checked.row.id,
      user.id
    );
    const row = visibleTemplate(checked.row.id, user.id);
    return c.json({ template: row ? publicPromptTemplate(row, user.id, styleGroups) : null });
  });

  api.delete("/prompt-templates/:id", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const checked = ownedEditableTemplate(c.req.param("id"), user.id);
    if (!checked.row) return c.json({ error: checked.error }, checked.status as 403 | 404);
    run(appDb, "delete from prompt_template_form_drafts where template_id = ?", checked.row.id);
    run(appDb, "delete from prompt_template_results where template_id = ? and user_id = ?", checked.row.id, user.id);
    run(appDb, "delete from prompt_template_export_downloads where template_id = ? and user_id = ?", checked.row.id, user.id);
    run(appDb, "delete from prompt_template_export_revocations where template_id = ? and user_id = ?", checked.row.id, user.id);
    run(appDb, "delete from prompt_templates where id = ? and user_id = ?", checked.row.id, user.id);
    return c.json({ ok: true });
  });

  api.post("/prompt-templates/:id/copy", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const source = visibleTemplate(c.req.param("id"), user.id);
    if (!source) return c.json({ error: "表单不存在" }, 404);
    const styleGroups = userPreferences(user.id).promptOptimizeStyleGroups;
    const id = makeId("prompttpl");
    const timestamp = now();
    run(
      appDb,
      `insert into prompt_templates (
        id, user_id, visibility, name, description, category, icon,
        optimize_style, components_json, rules_json, output_json, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      user.id,
      "private",
      `${source.name} 副本`,
      source.description,
      source.category,
      source.icon,
      normalizePromptOptimizeStyle(source.optimize_style, styleGroups),
      source.components_json,
      source.rules_json,
      source.output_json,
      timestamp,
      timestamp
    );
    const row = visibleTemplate(id, user.id);
    return c.json({ template: row ? publicPromptTemplate(row, user.id, styleGroups) : null });
  });

  api.put("/prompt-templates/:id/share", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const checked = ownedEditableTemplate(c.req.param("id"), user.id);
    if (!checked.row) return c.json({ error: checked.error }, checked.status as 403 | 404);
    const body = await c.req.json().catch(() => ({}));
    const shared = Boolean((body as Record<string, unknown>).shared);
    run(
      appDb,
      "update prompt_templates set visibility = ?, updated_at = ? where id = ? and user_id = ?",
      shared ? "shared" : "private",
      now(),
      checked.row.id,
      user.id
    );
    const row = visibleTemplate(checked.row.id, user.id);
    return c.json({ template: row ? publicPromptTemplate(row, user.id, userPreferences(user.id).promptOptimizeStyleGroups) : null });
  });

  api.put("/prompt-templates/:id/optimize-style", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const checked = ownedEditableTemplate(c.req.param("id"), user.id);
    if (!checked.row) return c.json({ error: checked.error }, checked.status as 403 | 404);
    const body = await c.req.json().catch(() => ({}));
    const styleGroups = userPreferences(user.id).promptOptimizeStyleGroups;
    const optimizeStyle = normalizePromptOptimizeStyle((body as Record<string, unknown>).optimizeStyle, styleGroups);
    run(
      appDb,
      "update prompt_templates set optimize_style = ?, updated_at = ? where id = ? and user_id = ?",
      optimizeStyle,
      now(),
      checked.row.id,
      user.id
    );
    const row = visibleTemplate(checked.row.id, user.id);
    return c.json({ template: row ? publicPromptTemplate(row, user.id, styleGroups) : null });
  });

  api.get("/prompt-templates/:id/form-draft", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const checked = visiblePromptTemplateForUser(c.req.param("id"), user.id);
    if (!checked.row) return c.json({ error: checked.error }, checked.status as 404);
    const draft = getOne<PromptTemplateFormDraftRow>(
      appDb,
      "select * from prompt_template_form_drafts where template_id = ? and user_id = ?",
      checked.row.id,
      user.id
    );
    return c.json({ draft: publicPromptTemplateFormDraft(draft ?? null) });
  });

  api.put("/prompt-templates/:id/form-draft", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const checked = visiblePromptTemplateForUser(c.req.param("id"), user.id);
    if (!checked.row) return c.json({ error: checked.error }, checked.status as 404);
    const body = await c.req.json().catch(() => ({}));
    const formValues = asJsonObject((body as Record<string, unknown>).formValues);
    const timestamp = now();
    run(
      appDb,
      `insert into prompt_template_form_drafts (
        template_id, user_id, form_values_json, created_at, updated_at
      ) values (?, ?, ?, ?, ?)
      on conflict(template_id, user_id) do update set
        form_values_json = excluded.form_values_json,
        updated_at = excluded.updated_at`,
      checked.row.id,
      user.id,
      JSON.stringify(formValues),
      timestamp,
      timestamp
    );
    const draft = getOne<PromptTemplateFormDraftRow>(
      appDb,
      "select * from prompt_template_form_drafts where template_id = ? and user_id = ?",
      checked.row.id,
      user.id
    );
    return c.json({ draft: publicPromptTemplateFormDraft(draft ?? null) });
  });

  api.get("/prompt-templates/:id/export-downloads", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const row = visibleTemplate(c.req.param("id"), user.id);
    if (!row) return c.json({ error: "表单不存在" }, 404);
    const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 12) || 12));
    const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
    const countRow = getOne<{ total: number }>(
      appDb,
      `select count(*) as total
       from prompt_template_export_downloads
       where template_id = ? and user_id = ?`,
      row.id,
      user.id
    );
    const total = Number(countRow?.total ?? 0) || 0;
    const rows = getAll<PromptTemplateExportDownloadRow>(
      appDb,
      `select * from prompt_template_export_downloads
       where template_id = ? and user_id = ?
       order by issued_at desc, created_at desc
       limit ? offset ?`,
      row.id,
      user.id,
      limit,
      offset
    );
    const allRows = getAll<PromptTemplateExportDownloadRow>(
      appDb,
      `select * from prompt_template_export_downloads
       where template_id = ? and user_id = ?`,
      row.id,
      user.id
    );
    const downloads = rows.map(publicPromptTemplateExportDownload);
    const counts = allRows.map(publicPromptTemplateExportDownload).reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});
    return c.json({
      downloads,
      counts,
      pageInfo: {
        limit,
        offset,
        total,
        hasMore: offset + rows.length < total
      }
    });
  });

  api.post("/prompt-templates/:id/export-downloads/revoke", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const row = visibleTemplate(c.req.param("id"), user.id);
    if (!row) return c.json({ error: "表单不存在" }, 404);
    const revokedAt = Date.now();
    const timestamp = now();
    run(
      appDb,
      `insert into prompt_template_export_revocations (template_id, user_id, revoked_after, updated_at)
       values (?, ?, ?, ?)
       on conflict(template_id, user_id) do update set
         revoked_after = excluded.revoked_after,
         updated_at = excluded.updated_at`,
      row.id,
      user.id,
      revokedAt,
      timestamp
    );
    const activeRows = getAll<{ id: string }>(
      appDb,
      `select id from prompt_template_export_downloads
       where template_id = ? and user_id = ? and variant = 'ai' and status = 'active'
         and (expires_at is null or expires_at > ?)`,
      row.id,
      user.id,
      revokedAt
    );
    run(
      appDb,
      `update prompt_template_export_downloads
       set status = 'revoked', revoked_at = ?, updated_at = ?
       where template_id = ? and user_id = ? and variant = 'ai' and status = 'active'
         and (expires_at is null or expires_at > ?)`,
      revokedAt,
      timestamp,
      row.id,
      user.id,
      revokedAt
    );
    const rows = getAll<PromptTemplateExportDownloadRow>(
      appDb,
      `select * from prompt_template_export_downloads
       where template_id = ? and user_id = ?
       order by issued_at desc, created_at desc
       limit 12`,
      row.id,
      user.id
    );
    return c.json({
      revokedAt,
      revokedCount: activeRows.length,
      downloads: rows.map(publicPromptTemplateExportDownload)
    });
  });

  api.options("/prompt-templates/:id/export-optimize", () => new Response(null, {
    status: 204,
    headers: PROMPT_TEMPLATE_EXPORT_CORS_HEADERS
  }));

  api.post("/prompt-templates/:id/export-optimize", async (c) => {
    const templateId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const record = body as Record<string, unknown>;
    const token = String(record.exportToken ?? record.token ?? "").trim();
    const access = verifyPromptTemplateExportToken(token, templateId);
    if (!access) return exportJsonResponse({ error: "AI 优化链接已过期或已失效，请重新下载网页" }, 401);
    const row = visibleTemplate(templateId, access.userId);
    if (!row) return exportJsonResponse({ error: "表单不存在" }, 404);
    const basePrompt = String(record.basePrompt ?? "").trim();
    if (!basePrompt) return exportJsonResponse({ error: "基础提示词为空，请先填写表单内容" }, 400);
    const provider = getOne<PromptOptimizerProviderRow>(
      configDb,
      "select * from prompt_optimizer_providers where enabled = 1 order by sort_order asc, created_at asc limit 1"
    );
    if (!provider) return exportJsonResponse({ error: "请先在配置页启用提示词优化模型" }, 400);
    const styleGroups = userPreferences(access.userId).promptOptimizeStyleGroups;
    const template = publicPromptTemplate(row, access.userId, styleGroups);
    const output = template.output as Record<string, unknown>;
    const manualNegativePrompt = templateManualNegativePrompt(template);
    const negativeEnabled = Boolean(output.negativeEnabled) && !manualNegativePrompt;
    const formValues = record.formValues ?? {};
    const optimizeStyle = normalizePromptOptimizeStyle(record.optimizeStyle, styleGroups);
    const customInstruction = normalizePromptOptimizeCustomInstruction(record.customInstruction ?? record.optimizeDirection);
    if (provider.stream_enabled) {
      return withExportCors(streamPromptTemplateOptimizeResponse({
        row,
        userId: access.userId,
        provider,
        template,
        formValues,
        language: "zh",
        basePrompt,
        negativeEnabled,
        optimizeStyle,
        styleGroups,
        customInstruction,
        manualNegativePrompt,
        source: "prompt-template-export"
      }));
    }
    let optimized;
    try {
      optimized = await optimizePromptWithProvider({
        provider,
        template,
        formValues,
        basePrompt,
        negativeEnabled,
        optimizeStyle,
        styleGroups,
        customInstruction,
        manualNegativePrompt,
        logContext: { userId: access.userId, jobId: row.id, source: "prompt-template-export" }
      });
    } catch (error) {
      return exportJsonResponse({ error: error instanceof Error ? error.message : "提示词优化失败" }, 502);
    }
    const result = savePromptTemplateOptimizeResult({
      row,
      userId: access.userId,
      language: "zh",
      basePrompt,
      formValues,
      optimized,
      negativeEnabled: Boolean(optimized.negativePrompt.trim()),
      provider
    });
    return exportJsonResponse({ result });
  });

  api.options("/prompt-templates/:id/export-translate", () => new Response(null, {
    status: 204,
    headers: PROMPT_TEMPLATE_EXPORT_CORS_HEADERS
  }));

  api.post("/prompt-templates/:id/export-translate", async (c) => {
    const templateId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const record = body as Record<string, unknown>;
    const token = String(record.exportToken ?? record.token ?? "").trim();
    const access = verifyPromptTemplateExportToken(token, templateId);
    if (!access) return exportJsonResponse({ error: "AI 优化链接已过期或已失效，请重新下载网页" }, 401);
    const row = visibleTemplate(templateId, access.userId);
    if (!row) return exportJsonResponse({ error: "表单不存在" }, 404);
    const prompt = String(record.prompt ?? record.text ?? "").trim();
    const negativePrompt = String(record.negativePrompt ?? "").trim();
    const signature = String(record.signature ?? "").trim();
    if (!prompt) return exportJsonResponse({ error: "待翻译提示词为空" }, 400);
    const provider = getOne<PromptOptimizerProviderRow>(
      configDb,
      "select * from prompt_optimizer_providers where enabled = 1 order by sort_order asc, created_at asc limit 1"
    );
    if (!provider) return exportJsonResponse({ error: "请先在配置页启用提示词优化模型" }, 400);
    return withExportCors(streamPromptTemplateTranslationResponse({
      provider,
      templateId: row.id,
      userId: access.userId,
      prompt,
      negativePrompt,
      signature,
      source: "prompt-template-export"
    }));
  });

  api.post("/prompt-templates/:id/optimize", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const row = visibleTemplate(c.req.param("id"), user.id);
    if (!row) return c.json({ error: "表单不存在" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const record = body as Record<string, unknown>;
    const language = "zh";
    const basePrompt = String(record.basePrompt ?? "").trim();
    if (!basePrompt) return c.json({ error: "基础提示词为空，请先填写表单内容" }, 400);
    const provider = getOne<PromptOptimizerProviderRow>(
      configDb,
      "select * from prompt_optimizer_providers where enabled = 1 order by sort_order asc, created_at asc limit 1"
    );
    if (!provider) return c.json({ error: "请先在配置页启用提示词优化模型" }, 400);
    const styleGroups = userPreferences(user.id).promptOptimizeStyleGroups;
    const template = publicPromptTemplate(row, user.id, styleGroups);
    const output = template.output as Record<string, unknown>;
    const manualNegativePrompt = templateManualNegativePrompt(template);
    const negativeEnabled = Boolean(output.negativeEnabled) && !manualNegativePrompt;
    const formValues = record.formValues ?? {};
    const optimizeStyle = normalizePromptOptimizeStyle(record.optimizeStyle, styleGroups);
    const customInstruction = normalizePromptOptimizeCustomInstruction(record.customInstruction ?? record.optimizeDirection);
    if (provider.stream_enabled) {
      return streamPromptTemplateOptimizeResponse({
        row,
        userId: user.id,
        provider,
        template,
        formValues,
        language,
        basePrompt,
        negativeEnabled,
        optimizeStyle,
        styleGroups,
        customInstruction,
        manualNegativePrompt,
        source: "prompt-template"
      });
    }
    let optimized;
    try {
      optimized = await optimizePromptWithProvider({
        provider,
        template,
        formValues,
        basePrompt,
        negativeEnabled,
        optimizeStyle,
        styleGroups,
        customInstruction,
        manualNegativePrompt,
        logContext: { userId: user.id, jobId: row.id, source: "prompt-template" }
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "提示词优化失败" }, 502);
    }
    const result = savePromptTemplateOptimizeResult({
      row,
      userId: user.id,
      language,
      basePrompt,
      formValues,
      optimized,
      negativeEnabled: Boolean(optimized.negativePrompt.trim()),
      provider
    });
    return c.json({ result });
  });

  api.post("/prompt-templates/:id/translate", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const row = visibleTemplate(c.req.param("id"), user.id);
    if (!row) return c.json({ error: "表单不存在" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const record = body as Record<string, unknown>;
    const prompt = String(record.prompt ?? record.text ?? "").trim();
    const negativePrompt = String(record.negativePrompt ?? "").trim();
    const signature = String(record.signature ?? "").trim();
    if (!prompt) return c.json({ error: "待翻译提示词为空" }, 400);
    const provider = getOne<PromptOptimizerProviderRow>(
      configDb,
      "select * from prompt_optimizer_providers where enabled = 1 order by sort_order asc, created_at asc limit 1"
    );
    if (!provider) return c.json({ error: "请先在配置页启用提示词优化模型" }, 400);
    return streamPromptTemplateTranslationResponse({ provider, templateId: row.id, userId: user.id, prompt, negativePrompt, signature, source: "prompt-template" });
  });

  api.get("/prompt-templates/:id/base-translation", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const row = visibleTemplate(c.req.param("id"), user.id);
    if (!row) return c.json({ error: "表单不存在" }, 404);
    const signature = String(c.req.query("signature") ?? "").trim();
    const translationRow = getOne<PromptTemplateBaseTranslationRow>(
      appDb,
      `select * from prompt_template_base_translations
       where template_id = ? and user_id = ?
       limit 1`,
      row.id,
      user.id
    );
    const translation = publicPromptTemplateBaseTranslation(translationRow ?? null);
    return c.json({
      translation: translation && (!signature || translation.signature === signature) ? translation : null,
      staleTranslation: translation && signature && translation.signature !== signature ? translation : null
    });
  });

  api.get("/prompt-templates/:id/results", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const row = visibleTemplate(c.req.param("id"), user.id);
    if (!row) return c.json({ error: "表单不存在" }, 404);
    const limit = Math.min(30, Math.max(1, Number(c.req.query("limit") ?? PROMPT_TEMPLATE_HISTORY_PAGE_SIZE) || PROMPT_TEMPLATE_HISTORY_PAGE_SIZE));
    const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
    const countRow = getOne<{ total: number }>(
      appDb,
      "select count(*) as total from prompt_template_results where template_id = ? and user_id = ?",
      row.id,
      user.id
    );
    const total = Number(countRow?.total ?? 0);
    const rows = getAll<PromptTemplateResultRow>(
      appDb,
      "select * from prompt_template_results where template_id = ? and user_id = ? order by created_at desc, id desc limit ? offset ?",
      row.id,
      user.id,
      limit,
      offset
    );
    return c.json({
      results: rows.map(publicPromptTemplateResult),
      pageInfo: {
        limit,
        offset,
        total,
        hasMore: offset + rows.length < total
      }
    });
  });

  api.delete("/prompt-template-results/:id", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const id = c.req.param("id");
    const existing = getOne<{ id: string }>(appDb, "select id from prompt_template_results where id = ? and user_id = ?", id, user.id);
    if (!existing) return c.json({ error: "历史结果不存在" }, 404);
    run(appDb, "delete from prompt_template_results where id = ? and user_id = ?", id, user.id);
    return c.json({ ok: true });
  });

  api.get("/prompt-templates/:id/export.html", async (c) => {
    return promptTemplateExportHtmlResponse(c);
  });

  api.post("/prompt-templates/:id/export.html", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const record = asJsonObject(body);
    return promptTemplateExportHtmlResponse(c, {
      aiOptimizeEnabled: record.ai,
      expiresDays: record.expiresDays,
      formValues: record.formValues,
      resultId: record.resultId
    });
  });
}
