import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { defaultUserPreferences, normalizeImagePreviewWheelMode } from "./userPreferences";
import { migrateImagePreviewWheelDefault } from "./schema";

const databases: Database[] = [];

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("image preview wheel defaults", () => {
  test("uses pan for missing and invalid preferences", () => {
    expect(defaultUserPreferences().imagePreviewWheelMode).toBe("pan");
    expect(normalizeImagePreviewWheelMode(undefined)).toBe("pan");
    expect(normalizeImagePreviewWheelMode("invalid")).toBe("pan");
    expect(normalizeImagePreviewWheelMode("zoom")).toBe("zoom");
  });

  test("migrates zoom once and preserves a later explicit zoom choice", () => {
    const db = new Database(":memory:");
    databases.push(db);
    db.exec("create table user_preferences (user_id text primary key, image_preview_wheel_mode text not null)");
    db.query("insert into user_preferences values (?, ?)").run("user_1", "zoom");
    migrateImagePreviewWheelDefault(db, "2026-07-20");
    expect(db.query("select image_preview_wheel_mode as mode from user_preferences where user_id = ?").get("user_1")).toEqual({ mode: "pan" });
    db.query("update user_preferences set image_preview_wheel_mode = ? where user_id = ?").run("zoom", "user_1");
    migrateImagePreviewWheelDefault(db, "2026-07-21");
    expect(db.query("select image_preview_wheel_mode as mode from user_preferences where user_id = ?").get("user_1")).toEqual({ mode: "zoom" });
  });
});
