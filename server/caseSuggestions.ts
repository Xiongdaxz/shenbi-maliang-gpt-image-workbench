import { UNCATEGORIZED_CASE_CATEGORY_ID } from "./categories";
import { appDb, getAll, run } from "./db";
import { generatePromptCaseStyleIds, generatePromptSummaryTitle } from "./promptTitle";
import type { ImageRow } from "./types";
import { parseJsonArray } from "./utils";

export const CASE_TITLE_SYSTEM_PROMPT =
  "你是灵感空间标题整理助手。请把生图提示词精简成一个中文标题，让用户一眼知道这段提示词是用来生成什么内容或什么用途。标题应概括画面主题、类型或场景，4到16个字。只输出标题，不要引号、标点、说明或 Markdown。";

function caseStyleOptions() {
  return getAll<{ id: string; name: string; slug: string }>(
    appDb,
    "select id, name, slug from case_categories where type = 'case' and id <> ? order by sort_order asc",
    UNCATEGORIZED_CASE_CATEGORY_ID
  );
}

export function generateCaseTitle(prompt: string) {
  return generatePromptSummaryTitle(prompt, {
    fallbackTitle: "新的灵感",
    logLabel: "灵感标题自动生成失败",
    systemPrompt: CASE_TITLE_SYSTEM_PROMPT
  });
}

export async function suggestCaseFields(prompt: string) {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) return { title: "", categoryIds: [] };
  const [title, categoryIds] = await Promise.all([
    generateCaseTitle(normalizedPrompt),
    generatePromptCaseStyleIds(normalizedPrompt, caseStyleOptions())
  ]);
  return { title, categoryIds };
}

export async function resolveCaseCategoryIds(rawPrompt: string, categoryIds: string[], autoCategory = true) {
  if (categoryIds.length > 0) return categoryIds;
  if (!autoCategory) return [UNCATEGORIZED_CASE_CATEGORY_ID];
  const autoCategoryIds = await generatePromptCaseStyleIds(rawPrompt, caseStyleOptions());
  return autoCategoryIds.length > 0 ? autoCategoryIds : [UNCATEGORIZED_CASE_CATEGORY_ID];
}

export async function applyCaseFieldSuggestionsToImages(imageIds: string[], prompt: string) {
  const ids = Array.from(new Set(imageIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0 || !prompt.trim()) return { title: "", categoryIds: [] };
  const suggestion = await suggestCaseFields(prompt);
  run(
    appDb,
    `update images
     set suggested_case_title = ?, suggested_case_category_ids_json = ?
     where id in (${ids.map(() => "?").join(", ")})`,
    suggestion.title,
    JSON.stringify(suggestion.categoryIds),
    ...ids
  );
  return suggestion;
}

export async function ensureCaseFieldSuggestionsForImage(image: ImageRow, promptOverride?: string) {
  const existingTitle = String(image.suggested_case_title ?? "").trim();
  if (existingTitle) {
    return {
      title: existingTitle,
      categoryIds: parseJsonArray(image.suggested_case_category_ids_json, []),
      generated: false
    };
  }

  const suggestion = await suggestCaseFields(String(promptOverride ?? image.prompt));
  run(
    appDb,
    `update images
     set suggested_case_title = ?, suggested_case_category_ids_json = ?
     where id = ?`,
    suggestion.title,
    JSON.stringify(suggestion.categoryIds),
    image.id
  );
  return { ...suggestion, generated: true };
}
