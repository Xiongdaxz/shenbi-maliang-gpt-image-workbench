import { appDb, getAll, getOne } from "./db";
import type { CategoryType } from "./types";

export const UNCATEGORIZED_CASE_CATEGORY_ID = "casecat_uncategorized";
export const UNCATEGORIZED_CASE_CATEGORY_SLUG = "uncategorized";
export const UNCATEGORIZED_CASE_CATEGORY_NAME = "";
export const DEFAULT_TEAM_ID = "team_default";

export function defaultTeamId() {
  return DEFAULT_TEAM_ID;
}

export function makeCategorySlug(name: string, type: CategoryType) {
  const base =
    name
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tag";
  const scopedBase = type === "asset" ? `asset-${base}` : base;
  let slug = scopedBase;
  let suffix = 2;
  while (getOne<{ id: string }>(appDb, "select id from case_categories where slug = ?", slug)) {
    slug = `${scopedBase}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

export function ensureCategoryIds(categoryIds: string[], type: CategoryType) {
  if (categoryIds.length === 0) return true;
  const categories = getAll<{ id: string }>(
    appDb,
    `select id from case_categories where type = ? and id in (${categoryIds.map(() => "?").join(", ")})`,
    type,
    ...categoryIds
  );
  return categories.length === categoryIds.length;
}
