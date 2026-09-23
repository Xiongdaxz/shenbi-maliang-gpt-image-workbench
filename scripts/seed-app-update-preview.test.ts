import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyAppUpdatePreviewEntries } from "./seed-app-update-preview";

const databases: Database[] = [];

function memoryDatabase() {
  const db = new Database(":memory:");
  databases.push(db);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("app-update preview changelog seed", () => {
  test("preserves a real entry with the same version through seed and clear", () => {
    const db = memoryDatabase();
    applyAppUpdatePreviewEntries(db, true);
    db.query(`
      insert into changelog_entries (id, version, release_date, content, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?)
    `).run("real-release", "v0.1.80", "2026-09-01", "real notes", "old", "old");

    expect(applyAppUpdatePreviewEntries(db)).toEqual({ inserted: 1, skipped: 1, removed: 0 });
    expect(db.query("select id, content from changelog_entries where version = ?").get("v0.1.80"))
      .toEqual({ id: "real-release", content: "real notes" });

    expect(applyAppUpdatePreviewEntries(db, true).removed).toBe(1);
    expect(db.query("select id, content from changelog_entries where version = ?").get("v0.1.80"))
      .toEqual({ id: "real-release", content: "real notes" });
    expect(db.query("select id from changelog_entries where version = ?").get("v0.1.81")).toBeNull();
  });

  test("reseeding and clearing preserve a manually edited preview row", () => {
    const db = memoryDatabase();
    expect(applyAppUpdatePreviewEntries(db)).toEqual({ inserted: 2, skipped: 0, removed: 0 });
    db.query("update changelog_entries set content = ? where id = ?")
      .run("manual notes", "app-update-preview-v0.1.80");

    expect(applyAppUpdatePreviewEntries(db)).toEqual({ inserted: 0, skipped: 2, removed: 0 });
    expect(applyAppUpdatePreviewEntries(db, true).removed).toBe(1);
    const row = db.query("select content from changelog_entries where id = ?")
      .get("app-update-preview-v0.1.80") as { content: string };
    expect(row.content).toBe("manual notes");
  });

  test("a conflicting preview id rolls back the whole seed", () => {
    const db = memoryDatabase();
    applyAppUpdatePreviewEntries(db, true);
    db.query(`
      insert into changelog_entries (id, version, release_date, content, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?)
    `).run("app-update-preview-v0.1.81", "v9.9.9", "2026-09-01", "existing", "old", "old");

    expect(() => applyAppUpdatePreviewEntries(db)).toThrow();
    expect(db.query("select id from changelog_entries where version = ?").get("v0.1.80")).toBeNull();
    expect(db.query("select content from changelog_entries where id = ?").get("app-update-preview-v0.1.81"))
      .toEqual({ content: "existing" });
  });
});
