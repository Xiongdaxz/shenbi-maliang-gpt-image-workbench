import type { Database } from "bun:sqlite";
import { UNCATEGORIZED_CASE_CATEGORY_ID, makeCategorySlug } from "./categories";
import { getAll, getOne, run } from "./db";
import type { CategoryType } from "./types";
import { makeId, now, parseJsonArray } from "./utils";

export type ManagedContentCategory = {
  id: string;
  type: CategoryType;
  name: string;
  slug: string;
  sortOrder: number;
  itemCount: number;
  suggestionCount: number;
};

export class CategoryManagementError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message);
  }
}

type CategoryRow = {
  id: string;
  type: CategoryType;
  name: string;
  slug: string;
  sort_order: number;
};

function categoryLabel(type: CategoryType) {
  return type === "case" ? "灵感风格" : "素材标签";
}

function normalizedCategoryName(name: unknown) {
  return String(name ?? "").trim();
}

function requireCategory(db: Database, id: string) {
  const category = getOne<CategoryRow>(db, "select id, type, name, slug, sort_order from case_categories where id = ?", id);
  if (!category) throw new CategoryManagementError("分类不存在", 404);
  return category;
}

function requireMutableCategory(category: CategoryRow) {
  if (category.id === UNCATEGORIZED_CASE_CATEGORY_ID) {
    throw new CategoryManagementError("系统未分类项不能修改", 400);
  }
}

function ensureUniqueName(db: Database, type: CategoryType, name: string, excludeId = "") {
  const existing = getOne<{ id: string }>(
    db,
    "select id from case_categories where type = ? and lower(name) = lower(?) and id <> ? limit 1",
    type,
    name,
    excludeId
  );
  if (existing) throw new CategoryManagementError(`${categoryLabel(type)}已存在`, 409);
}

function categoryItemCounts(db: Database, type: CategoryType) {
  if (type === "case") {
    return new Map(
      getAll<{ category_id: string; count: number }>(
        db,
        `select category_id, count(distinct coalesce(nullif(group_id, ''), id)) as count
         from case_items
         group by category_id`
      ).map((row) => [row.category_id, Number(row.count ?? 0)])
    );
  }
  return new Map(
    getAll<{ category_id: string; count: number }>(
      db,
      "select category_id, count(distinct asset_id) as count from asset_categories group by category_id"
    ).map((row) => [row.category_id, Number(row.count ?? 0)])
  );
}

function categorySuggestionCounts(db: Database, type: CategoryType) {
  const column = type === "case" ? "suggested_case_category_ids_json" : "suggested_asset_category_ids_json";
  const counts = new Map<string, number>();
  const rows = getAll<{ category_ids_json: string }>(db, `select ${column} as category_ids_json from images where ${column} <> '[]'`);
  for (const row of rows) {
    const categoryIds = new Set(parseJsonArray(row.category_ids_json, []));
    for (const categoryId of categoryIds) counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  }
  return counts;
}

export function listManagedContentCategories(db: Database, type: CategoryType): ManagedContentCategory[] {
  const rows = getAll<CategoryRow>(
    db,
    `select id, type, name, slug, sort_order
     from case_categories
     where type = ? and id <> ?
     order by sort_order asc, rowid asc`,
    type,
    UNCATEGORIZED_CASE_CATEGORY_ID
  );
  const itemCounts = categoryItemCounts(db, type);
  const suggestionCounts = categorySuggestionCounts(db, type);
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sort_order,
    itemCount: itemCounts.get(row.id) ?? 0,
    suggestionCount: suggestionCounts.get(row.id) ?? 0
  }));
}

export function createManagedContentCategory(db: Database, type: CategoryType, rawName: unknown) {
  const name = normalizedCategoryName(rawName);
  if (!name) throw new CategoryManagementError(`请填写${categoryLabel(type)}名称`, 400);
  ensureUniqueName(db, type, name);
  const id = makeId(type === "case" ? "casecat" : "assetcat");
  const slug = makeCategorySlug(name, type, db);
  const sortOrder =
    (getOne<{ max_sort: number | null }>(db, "select max(sort_order) as max_sort from case_categories where type = ?", type)
      ?.max_sort ?? 0) + 10;
  run(
    db,
    "insert into case_categories (id, type, name, slug, sort_order) values (?, ?, ?, ?, ?)",
    id,
    type,
    name,
    slug,
    sortOrder
  );
  return { id, type, name, slug, sortOrder, itemCount: 0, suggestionCount: 0 } satisfies ManagedContentCategory;
}

export function renameManagedContentCategory(db: Database, id: string, rawName: unknown) {
  const category = requireCategory(db, id);
  requireMutableCategory(category);
  const name = normalizedCategoryName(rawName);
  if (!name) throw new CategoryManagementError(`请填写${categoryLabel(category.type)}名称`, 400);
  ensureUniqueName(db, category.type, name, category.id);
  run(db, "update case_categories set name = ? where id = ?", name, category.id);
  return listManagedContentCategories(db, category.type).find((item) => item.id === category.id)!;
}

function compactSortOrders(db: Database, type: CategoryType) {
  const ids = getAll<{ id: string }>(
    db,
    "select id from case_categories where type = ? and id <> ? order by sort_order asc, rowid asc",
    type,
    UNCATEGORIZED_CASE_CATEGORY_ID
  ).map((row) => row.id);
  ids.forEach((id, index) => run(db, "update case_categories set sort_order = ? where id = ?", (index + 1) * 10, id));
  if (type === "case") run(db, "update case_categories set sort_order = 0 where id = ?", UNCATEGORIZED_CASE_CATEGORY_ID);
}

export function reorderManagedContentCategories(db: Database, type: CategoryType, rawOrderedIds: unknown) {
  if (!Array.isArray(rawOrderedIds)) throw new CategoryManagementError("排序数据格式错误", 400);
  const orderedIds = rawOrderedIds.map((id) => String(id ?? "").trim()).filter(Boolean);
  const currentIds = getAll<{ id: string }>(
    db,
    "select id from case_categories where type = ? and id <> ?",
    type,
    UNCATEGORIZED_CASE_CATEGORY_ID
  ).map((row) => row.id);
  if (
    orderedIds.length !== currentIds.length ||
    new Set(orderedIds).size !== currentIds.length ||
    currentIds.some((id) => !orderedIds.includes(id))
  ) {
    throw new CategoryManagementError("排序列表必须包含当前类型的全部分类", 400);
  }
  db.transaction(() => {
    orderedIds.forEach((id, index) => run(db, "update case_categories set sort_order = ? where id = ?", (index + 1) * 10, id));
    if (type === "case") run(db, "update case_categories set sort_order = 0 where id = ?", UNCATEGORIZED_CASE_CATEGORY_ID);
  })();
  return listManagedContentCategories(db, type);
}

function remapCaseItemReferences(db: Database, removedId: string, survivorId: string) {
  run(db, "update case_prompt_usage_events set case_item_id = ? where case_item_id = ?", survivorId, removedId);
  run(db, "update image_asset_references set source_case_item_id = ? where source_case_item_id = ?", survivorId, removedId);
  run(db, "update message_source_references set source_case_item_id = ? where source_case_item_id = ?", survivorId, removedId);
}

function mergeCaseCategoryReferences(db: Database, sourceId: string, targetId: string) {
  const sourceRows = getAll<{ id: string; group_id: string; row_id: number }>(
    db,
    "select id, group_id, rowid as row_id from case_items where category_id = ? order by rowid asc",
    sourceId
  );
  const rowsByGroup = new Map<string, typeof sourceRows>();
  for (const row of sourceRows) {
    const groupId = row.group_id || row.id;
    const rows = rowsByGroup.get(groupId) ?? [];
    rows.push(row);
    rowsByGroup.set(groupId, rows);
  }

  for (const [groupId, groupSourceRows] of rowsByGroup) {
    const targetRows = getAll<{ id: string; group_id: string; row_id: number }>(
      db,
      `select id, group_id, rowid as row_id
       from case_items
       where category_id = ? and coalesce(nullif(group_id, ''), id) = ?
       order by rowid asc`,
      targetId,
      groupId
    );
    const survivor = targetRows[0] ?? groupSourceRows[0];
    if (!targetRows.length) run(db, "update case_items set category_id = ? where id = ?", targetId, survivor.id);
    const duplicateIds = [...targetRows, ...groupSourceRows]
      .filter((row) => row.id !== survivor.id)
      .map((row) => row.id);
    for (const duplicateId of new Set(duplicateIds)) {
      remapCaseItemReferences(db, duplicateId, survivor.id);
      run(db, "delete from case_items where id = ?", duplicateId);
    }
  }
}

function mergeAssetCategoryReferences(db: Database, sourceId: string, targetId: string) {
  run(
    db,
    `insert or ignore into asset_categories (asset_id, category_id, created_at)
     select asset_id, ?, created_at from asset_categories where category_id = ?`,
    targetId,
    sourceId
  );
  run(db, "delete from asset_categories where category_id = ?", sourceId);
}

function remapSuggestionReferences(db: Database, type: CategoryType, sourceId: string, targetId: string) {
  const column = type === "case" ? "suggested_case_category_ids_json" : "suggested_asset_category_ids_json";
  const rows = getAll<{ id: string; category_ids_json: string }>(
    db,
    `select id, ${column} as category_ids_json from images where ${column} like ?`,
    `%${sourceId}%`
  );
  let changed = 0;
  for (const row of rows) {
    const current = parseJsonArray(row.category_ids_json, []);
    if (!current.includes(sourceId)) continue;
    const seen = new Set<string>();
    const next: string[] = [];
    for (const categoryId of current) {
      const mappedId = categoryId === sourceId ? targetId : categoryId;
      if (!seen.has(mappedId)) {
        seen.add(mappedId);
        next.push(mappedId);
      }
    }
    run(db, `update images set ${column} = ? where id = ?`, JSON.stringify(next), row.id);
    changed += 1;
  }
  return changed;
}

function removeSuggestionReferences(db: Database, type: CategoryType, categoryId: string) {
  const column = type === "case" ? "suggested_case_category_ids_json" : "suggested_asset_category_ids_json";
  const rows = getAll<{ id: string; category_ids_json: string }>(
    db,
    `select id, ${column} as category_ids_json from images where ${column} like ?`,
    `%${categoryId}%`
  );
  let changed = 0;
  for (const row of rows) {
    const current = parseJsonArray(row.category_ids_json, []);
    if (!current.includes(categoryId)) continue;
    run(db, `update images set ${column} = ? where id = ?`, JSON.stringify(current.filter((id) => id !== categoryId)), row.id);
    changed += 1;
  }
  return changed;
}

export function mergeManagedContentCategory(db: Database, sourceId: string, targetId: string) {
  const source = requireCategory(db, sourceId);
  const target = requireCategory(db, targetId);
  requireMutableCategory(source);
  requireMutableCategory(target);
  if (source.id === target.id) throw new CategoryManagementError("不能合并到自身", 400);
  if (source.type !== target.type) throw new CategoryManagementError("只能合并同类型分类", 400);
  const sourceSummary = listManagedContentCategories(db, source.type).find((item) => item.id === source.id)!;
  let migratedSuggestionCount = 0;
  db.transaction(() => {
    if (source.type === "case") mergeCaseCategoryReferences(db, source.id, target.id);
    else mergeAssetCategoryReferences(db, source.id, target.id);
    migratedSuggestionCount = remapSuggestionReferences(db, source.type, source.id, target.id);
    run(db, "delete from case_categories where id = ?", source.id);
    compactSortOrders(db, source.type);
  })();
  return {
    sourceId: source.id,
    targetId: target.id,
    type: source.type,
    migratedItemCount: sourceSummary.itemCount,
    migratedSuggestionCount,
    categories: listManagedContentCategories(db, source.type)
  };
}

export function deleteManagedContentCategory(db: Database, id: string) {
  const category = requireCategory(db, id);
  requireMutableCategory(category);
  const summary = listManagedContentCategories(db, category.type).find((item) => item.id === category.id)!;
  let removedSuggestionCount = 0;
  db.transaction(() => {
    if (category.type === "case") mergeCaseCategoryReferences(db, category.id, UNCATEGORIZED_CASE_CATEGORY_ID);
    else run(db, "delete from asset_categories where category_id = ?", category.id);
    removedSuggestionCount = removeSuggestionReferences(db, category.type, category.id);
    run(db, "delete from case_categories where id = ?", category.id);
    compactSortOrders(db, category.type);
  })();
  return {
    id: category.id,
    type: category.type,
    detachedItemCount: summary.itemCount,
    removedSuggestionCount,
    categories: listManagedContentCategories(db, category.type),
    deletedAt: now()
  };
}
