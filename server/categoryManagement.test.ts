import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { UNCATEGORIZED_CASE_CATEGORY_ID } from "./categories";
import {
  CategoryManagementError,
  deleteManagedContentCategory,
  listManagedContentCategories,
  mergeManagedContentCategory,
  renameManagedContentCategory,
  reorderManagedContentCategories
} from "./categoryManagement";
import { seedCases } from "./schema";

const databases: Database[] = [];

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function createCategoryDatabase() {
  const db = new Database(":memory:");
  databases.push(db);
  db.exec("pragma foreign_keys = on");
  db.exec(`
    create table app_migrations (id text primary key, created_at text not null);
    create table case_categories (
      id text primary key,
      type text not null,
      name text not null,
      slug text not null unique,
      sort_order integer not null default 0
    );
    create table case_items (
      id text primary key,
      group_id text not null default '',
      category_id text not null,
      foreign key (category_id) references case_categories(id)
    );
    create table assets (
      id text primary key
    );
    create table asset_categories (
      asset_id text not null,
      category_id text not null,
      created_at text not null,
      primary key (asset_id, category_id),
      foreign key (category_id) references case_categories(id)
    );
    create table images (
      id text primary key,
      suggested_case_category_ids_json text not null default '[]',
      suggested_asset_category_ids_json text not null default '[]'
    );
    create table case_prompt_usage_events (id text primary key, case_item_id text not null);
    create table image_asset_references (id text primary key, source_case_item_id text);
    create table message_source_references (id text primary key, source_case_item_id text);
  `);
  db.query("insert into case_categories values (?, 'case', '', 'uncategorized', 0)").run(UNCATEGORIZED_CASE_CATEGORY_ID);
  return db;
}

function insertCategory(db: Database, id: string, type: "case" | "asset", name: string, order: number) {
  db.query("insert into case_categories values (?, ?, ?, ?, ?)").run(id, type, name, `${type}-${id}`, order);
}

describe("content category management", () => {
  test("renames without changing identity and atomically validates the full reorder list", () => {
    const db = createCategoryDatabase();
    insertCategory(db, "case_a", "case", "海报", 10);
    insertCategory(db, "case_b", "case", "摄影", 20);

    const renamed = renameManagedContentCategory(db, "case_a", "商业海报");
    expect(renamed).toMatchObject({ id: "case_a", name: "商业海报", slug: "case-case_a" });
    expect(() => renameManagedContentCategory(db, "case_b", "商业海报")).toThrow(CategoryManagementError);
    expect(() => reorderManagedContentCategories(db, "case", ["case_b"])).toThrow("排序列表必须包含当前类型的全部分类");

    const reordered = reorderManagedContentCategories(db, "case", ["case_b", "case_a"]);
    expect(reordered.map((item) => [item.id, item.sortOrder])).toEqual([
      ["case_b", 10],
      ["case_a", 20]
    ]);
    expect(db.query("select sort_order from case_categories where id = ?").get(UNCATEGORIZED_CASE_CATEGORY_ID)).toEqual({ sort_order: 0 });
  });

  test("deletes a used case category while preserving its content as uncategorized", () => {
    const db = createCategoryDatabase();
    insertCategory(db, "case_used", "case", "人物", 10);
    db.query("insert into case_items values (?, ?, ?)").run("item_1", "group_1", "case_used");
    db.query("insert into case_items values (?, ?, ?)").run("item_2", "group_1", "case_used");
    db.query("insert into images values (?, ?, '[]')").run("image_1", JSON.stringify(["case_used"]));

    expect(listManagedContentCategories(db, "case").find((item) => item.id === "case_used")).toMatchObject({
      itemCount: 1,
      suggestionCount: 1
    });
    expect(deleteManagedContentCategory(db, "case_used")).toMatchObject({
      id: "case_used",
      detachedItemCount: 1,
      removedSuggestionCount: 1
    });
    expect(db.query("select id, group_id, category_id from case_items").all()).toEqual([
      { id: "item_1", group_id: "group_1", category_id: UNCATEGORIZED_CASE_CATEGORY_ID }
    ]);
    expect(db.query("select suggested_case_category_ids_json as ids from images where id = 'image_1'").get()).toEqual({
      ids: "[]"
    });
    expect(db.query("select id from case_categories where id = 'case_used'").get()).toBeNull();
  });

  test("deletes an asset tag while preserving assets and removing tag suggestions", () => {
    const db = createCategoryDatabase();
    insertCategory(db, "asset_used", "asset", "产品图", 10);
    db.query("insert into assets values (?)").run("asset_1");
    db.query("insert into asset_categories values (?, ?, ?)").run("asset_1", "asset_used", "2026-07-23");
    db.query("insert into images values (?, '[]', ?)").run("image_1", JSON.stringify(["asset_used"]));

    expect(deleteManagedContentCategory(db, "asset_used")).toMatchObject({
      id: "asset_used",
      detachedItemCount: 1,
      removedSuggestionCount: 1
    });
    expect(db.query("select id from assets where id = 'asset_1'").get()).toEqual({ id: "asset_1" });
    expect(db.query("select * from asset_categories where asset_id = 'asset_1'").all()).toEqual([]);
    expect(db.query("select suggested_asset_category_ids_json as ids from images where id = 'image_1'").get()).toEqual({
      ids: "[]"
    });
  });

  test("merges asset links and cached suggestions without duplicate targets", () => {
    const db = createCategoryDatabase();
    insertCategory(db, "asset_source", "asset", "来源标签", 10);
    insertCategory(db, "asset_target", "asset", "目标标签", 20);
    db.query("insert into assets values (?)").run("asset_1");
    db.query("insert into assets values (?)").run("asset_2");
    db.query("insert into asset_categories values (?, ?, ?)").run("asset_1", "asset_source", "2026-07-23");
    db.query("insert into asset_categories values (?, ?, ?)").run("asset_1", "asset_target", "2026-07-23");
    db.query("insert into asset_categories values (?, ?, ?)").run("asset_2", "asset_source", "2026-07-23");
    db.query("insert into images values (?, '[]', ?)").run(
      "image_1",
      JSON.stringify(["asset_source", "asset_target", "asset_source"])
    );

    const result = mergeManagedContentCategory(db, "asset_source", "asset_target");
    expect(result).toMatchObject({ migratedItemCount: 2, migratedSuggestionCount: 1 });
    expect(db.query("select asset_id, category_id from asset_categories order by asset_id").all()).toEqual([
      { asset_id: "asset_1", category_id: "asset_target" },
      { asset_id: "asset_2", category_id: "asset_target" }
    ]);
    expect(db.query("select suggested_asset_category_ids_json as ids from images where id = 'image_1'").get()).toEqual({
      ids: JSON.stringify(["asset_target"])
    });
    expect(db.query("select id from case_categories where id = 'asset_source'").get()).toBeNull();
  });

  test("merges case groups, preserves a stable row, and remaps historical case-item references", () => {
    const db = createCategoryDatabase();
    insertCategory(db, "case_source", "case", "来源风格", 10);
    insertCategory(db, "case_target", "case", "目标风格", 20);
    db.query("insert into case_items values (?, ?, ?)").run("source_only", "group_1", "case_source");
    db.query("insert into case_items values (?, ?, ?)").run("source_duplicate", "group_2", "case_source");
    db.query("insert into case_items values (?, ?, ?)").run("target_survivor", "group_2", "case_target");
    db.query("insert into case_prompt_usage_events values (?, ?)").run("usage_1", "source_duplicate");
    db.query("insert into image_asset_references values (?, ?)").run("image_ref_1", "source_duplicate");
    db.query("insert into message_source_references values (?, ?)").run("message_ref_1", "source_duplicate");
    db.query("insert into images values (?, ?, '[]')").run(
      "image_1",
      JSON.stringify(["case_source", "case_target", "case_source"])
    );

    mergeManagedContentCategory(db, "case_source", "case_target");
    expect(db.query("select id, group_id, category_id from case_items order by group_id").all()).toEqual([
      { id: "source_only", group_id: "group_1", category_id: "case_target" },
      { id: "target_survivor", group_id: "group_2", category_id: "case_target" }
    ]);
    expect(db.query("select case_item_id from case_prompt_usage_events where id = 'usage_1'").get()).toEqual({
      case_item_id: "target_survivor"
    });
    expect(db.query("select source_case_item_id from image_asset_references where id = 'image_ref_1'").get()).toEqual({
      source_case_item_id: "target_survivor"
    });
    expect(db.query("select source_case_item_id from message_source_references where id = 'message_ref_1'").get()).toEqual({
      source_case_item_id: "target_survivor"
    });
  });

  test("seeds default case styles once so an administrator deletion survives restart", () => {
    const db = createCategoryDatabase();
    db.query("delete from case_categories").run();
    seedCases(db, "2026-07-23T00:00:00.000");
    expect(db.query("select count(*) as total from case_categories where type = 'case'").get()).toEqual({ total: 6 });
    db.query("delete from case_categories where id = 'casecat_poster'").run();

    seedCases(db, "2026-07-24T00:00:00.000");
    expect(db.query("select id from case_categories where id = 'casecat_poster'").get()).toBeNull();
    expect(db.query("select count(*) as total from app_migrations where id = 'case_category_defaults_initialized_20260723'").get()).toEqual({ total: 1 });
  });
});
