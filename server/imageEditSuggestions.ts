import { appDb, getOne, run } from "./db";
import {
  FALLBACK_PROMPT_EDIT_SUGGESTIONS,
  generatePromptEditSuggestions,
  type PromptEditSuggestion
} from "./promptTitle";
import type { ImageEditSuggestionRow, ImageRow } from "./types";
import { normalizeEditSuggestionTone, type EditSuggestionTone } from "./userPreferences";
import { now, safeJson } from "./utils";

export type PublicImageEditSuggestion = PromptEditSuggestion & {
  id: string;
};

const EDIT_SUGGESTION_COUNT = 3;
const EDIT_SUGGESTION_PROMPT_UPDATED_AT = "2026-06-05T13:44:00.000";
const LEGACY_EDIT_SUGGESTION_LABELS = new Set([
  "增强光影层次",
  "简化背景突出主体",
  "提升商业质感",
  "换个叙事场景",
  "做成海报封面",
  "加入风格反差",
  "换成具体场景",
  "做成系列主图",
  "加入视觉记忆点",
  "加入互动瞬间",
  "换成野外故事",
  "做成电影海报",
  "延展品牌应用",
  "调整标志比例",
  "做成应用样机",
  "换成使用场景",
  "强化材质卖点",
  "做成电商主图",
  "补主副标题区",
  "拆成三块信息",
  "加编号和箭头",
  "拆成信息卡片",
  "加路线编号箭头"
]);
const LEGACY_EDIT_SUGGESTION_PATTERN =
  /光影层次|背景构图|背景.*主体|商业质感|细节锐度|背景虚化|更清晰|更立体|换个叙事场景|做成海报封面|加入风格反差|换成具体场景|做成系列主图|加入视觉记忆点|加入互动瞬间|换成野外故事|做成电影海报|延展品牌应用|调整标志比例|做成应用样机|换成使用场景|强化材质卖点|做成电商主图|主副标题区|拆成三块信息|编号和箭头|路线编号箭头/;

function normalizeStoredSuggestions(value: unknown) {
  const rawItems = Array.isArray(value) ? value : [];
  const suggestions: PromptEditSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of rawItems) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const label = String(record.label ?? "").trim();
    const prompt = String(record.prompt ?? "").trim();
    if (!label || !prompt) continue;
    const key = `${label}\u0000${prompt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ label, prompt });
    if (suggestions.length >= EDIT_SUGGESTION_COUNT) break;
  }
  return suggestions;
}

function publicEditSuggestions(suggestions: unknown): PublicImageEditSuggestion[] {
  const normalized = normalizeStoredSuggestions(suggestions);
  const filled = [...normalized];
  for (const fallback of FALLBACK_PROMPT_EDIT_SUGGESTIONS) {
    if (filled.length >= EDIT_SUGGESTION_COUNT) break;
    if (filled.some((item) => item.label === fallback.label && item.prompt === fallback.prompt)) continue;
    filled.push(fallback);
  }
  return filled.slice(0, EDIT_SUGGESTION_COUNT).map((item, index) => ({
    id: `edit-suggestion-${index + 1}`,
    label: item.label,
    prompt: item.prompt
  }));
}

function shouldRefreshStoredSuggestions(suggestions: PromptEditSuggestion[]) {
  if (suggestions.length < EDIT_SUGGESTION_COUNT) return true;
  if (suggestions.some((item) => /「[^」]{15,}」/.test(item.prompt))) return true;
  const legacyCount = suggestions.filter((item) =>
    LEGACY_EDIT_SUGGESTION_LABELS.has(item.label) || LEGACY_EDIT_SUGGESTION_PATTERN.test(`${item.label} ${item.prompt}`)
  ).length;
  return legacyCount >= 2;
}

export async function ensureImageEditSuggestionsForImage(image: ImageRow, originPrompt = "") {
  return ensureImageEditSuggestionsForImageWithTone(image, originPrompt, "default");
}

export async function ensureImageEditSuggestionsForImageWithTone(image: ImageRow, originPrompt = "", tone: EditSuggestionTone = "default") {
  const preferenceKey = normalizeEditSuggestionTone(tone);
  const existing = getOne<ImageEditSuggestionRow>(
    appDb,
    "select * from image_edit_suggestions where image_id = ? and user_id = ?",
    image.id,
    image.user_id
  );
  if (existing) {
    const storedSuggestions = normalizeStoredSuggestions(safeJson<unknown>(existing.suggestions_json, []));
    const promptVersionExpired = String(existing.updated_at ?? "") < EDIT_SUGGESTION_PROMPT_UPDATED_AT;
    const storedPreferenceKey = String(existing.preference_key ?? "default").trim() || "default";
    if (
      storedPreferenceKey === preferenceKey &&
      storedSuggestions.length === EDIT_SUGGESTION_COUNT &&
      !promptVersionExpired &&
      !shouldRefreshStoredSuggestions(storedSuggestions)
    ) {
      return { imageId: image.id, suggestions: publicEditSuggestions(storedSuggestions), generated: false };
    }
  }

  const suggestions = await generatePromptEditSuggestions({
    prompt: image.prompt,
    originPrompt,
    kind: image.kind,
    tone: preferenceKey
  });
  const timestamp = now();
  run(
    appDb,
    `insert into image_edit_suggestions (
      image_id, user_id, suggestions_json, preference_key, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?)
    on conflict(image_id) do update set
      user_id = excluded.user_id,
      suggestions_json = excluded.suggestions_json,
      preference_key = excluded.preference_key,
      updated_at = excluded.updated_at`,
    image.id,
    image.user_id,
    JSON.stringify(suggestions.slice(0, EDIT_SUGGESTION_COUNT)),
    preferenceKey,
    existing?.created_at ?? timestamp,
    timestamp
  );
  return {
    imageId: image.id,
    suggestions: publicEditSuggestions(suggestions),
    generated: true
  };
}
