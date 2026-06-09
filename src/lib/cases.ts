import type { CaseCategory } from "../types";

export const UNCATEGORIZED_CASE_CATEGORY_ID = "casecat_uncategorized";

export function defaultCaseTitleFromPrompt(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "新的灵感";
  return normalized.match(/^(.+?)([。！？!?；;.]|$)/)?.[1]?.trim() || normalized;
}

export function isUncategorizedCaseCategory(category: CaseCategory) {
  return category.id === UNCATEGORIZED_CASE_CATEGORY_ID;
}
