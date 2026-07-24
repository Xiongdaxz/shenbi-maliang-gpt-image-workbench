import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  defaultUserPreferences,
  normalizeImagePreviewWheelMode,
  saveUserPreferencesToDb,
  userPreferencesFromDb
} from "./userPreferences";
import { migrateImagePreviewWheelDefault, migrateImageTaskSoundPreferences } from "./schema";
import {
  DEFAULT_IMAGE_TASK_FAILURE_SOUND_ID,
  DEFAULT_IMAGE_TASK_SOUND_VOLUME,
  DEFAULT_IMAGE_TASK_SUCCESS_SOUND_ID,
  normalizeImageTaskSoundVolume
} from "../src/lib/imageTaskSounds";

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

function createUserPreferencesTable(db: Database) {
  db.exec(`create table user_preferences (
    user_id text primary key,
    language text not null default 'auto',
    image_preview_wheel_mode text not null default 'pan',
    image_preview_open_mode text not null default 'contain',
    edit_suggestions_enabled integer not null default 1,
    edit_suggestion_tone text not null default 'default',
    auto_upload_pasted_assets integer not null default 1,
    image_task_sound_enabled integer not null default 1,
    image_task_browser_notification_enabled integer not null default 0,
    image_task_sound_volume integer not null default 70,
    image_task_success_sound_id text not null default '',
    image_task_failure_sound_id text not null default '',
    prompt_optimize_styles_json text not null default '',
    prompt_optimize_custom_instruction text not null default '',
    updated_at text not null
  )`);
}

describe("image task sound preferences", () => {
  test("uses the documented defaults and clamps volume", () => {
    const defaults = defaultUserPreferences();
    expect(defaults.imageTaskSoundEnabled).toBe(true);
    expect(defaults.imageTaskBrowserNotificationEnabled).toBe(false);
    expect(defaults.imageTaskSoundVolume).toBe(DEFAULT_IMAGE_TASK_SOUND_VOLUME);
    expect(defaults.imageTaskSuccessSoundId).toBe(DEFAULT_IMAGE_TASK_SUCCESS_SOUND_ID);
    expect(defaults.imageTaskFailureSoundId).toBe(DEFAULT_IMAGE_TASK_FAILURE_SOUND_ID);
    expect(normalizeImageTaskSoundVolume(-1)).toBe(0);
    expect(normalizeImageTaskSoundVolume(101)).toBe(100);
    expect(normalizeImageTaskSoundVolume(42.6)).toBe(43);
    expect(normalizeImageTaskSoundVolume("invalid")).toBe(DEFAULT_IMAGE_TASK_SOUND_VOLUME);
  });

  test("adds sound columns to existing preference tables", () => {
    const db = new Database(":memory:");
    databases.push(db);
    db.exec("create table user_preferences (user_id text primary key, updated_at text not null)");
    db.query("insert into user_preferences (user_id, updated_at) values (?, ?)").run("user_1", "2026-07-22");
    migrateImageTaskSoundPreferences(db);
    expect(db.query(`select
      image_task_sound_enabled as enabled,
      image_task_browser_notification_enabled as browserNotificationEnabled,
      image_task_sound_volume as volume,
      image_task_success_sound_id as successId,
      image_task_failure_sound_id as failureId
      from user_preferences where user_id = ?`).get("user_1")).toEqual({
        enabled: 1,
        browserNotificationEnabled: 0,
        volume: DEFAULT_IMAGE_TASK_SOUND_VOLUME,
        successId: "",
        failureId: ""
      });
  });

  test("migrates legacy sound ids to internal ids", () => {
    const db = new Database(":memory:");
    databases.push(db);
    createUserPreferencesTable(db);
    db.query(`insert into user_preferences (
      user_id, image_task_success_sound_id, image_task_failure_sound_id, updated_at
    ) values (?, ?, ?, ?)`).run("user_1", "legacy-2870", "legacy-946", "2026-07-22");
    migrateImageTaskSoundPreferences(db);
    expect(db.query(`select
      image_task_success_sound_id as successId,
      image_task_failure_sound_id as failureId
      from user_preferences where user_id = ?`).get("user_1")).toEqual({
        successId: "maliang-001",
        failureId: "maliang-002"
      });
  });

  test("persists valid values and falls back for invalid sound ids", () => {
    const db = new Database(":memory:");
    databases.push(db);
    createUserPreferencesTable(db);
    const availableSoundIds = ["maliang-001", "maliang-002", "maliang-004"];
    const saved = saveUserPreferencesToDb(db, "user_1", {
      imageTaskSoundEnabled: false,
      imageTaskBrowserNotificationEnabled: true,
      imageTaskSoundVolume: 88,
      imageTaskSuccessSoundId: "maliang-004",
      imageTaskFailureSoundId: "missing-sound"
    }, availableSoundIds);
    expect(saved.imageTaskSoundEnabled).toBe(false);
    expect(saved.imageTaskBrowserNotificationEnabled).toBe(true);
    expect(saved.imageTaskSoundVolume).toBe(88);
    expect(saved.imageTaskSuccessSoundId).toBe("maliang-004");
    expect(saved.imageTaskFailureSoundId).toBe("maliang-002");

    db.query("update user_preferences set image_task_success_sound_id = ?, image_task_failure_sound_id = ? where user_id = ?")
      .run("removed", "removed", "user_1");
    const normalized = userPreferencesFromDb(db, "user_1", availableSoundIds);
    expect(normalized.imageTaskSuccessSoundId).toBe("maliang-001");
    expect(normalized.imageTaskFailureSoundId).toBe("maliang-002");
  });

  test("does not overwrite temporarily unavailable sound ids when saving another preference", () => {
    const db = new Database(":memory:");
    databases.push(db);
    createUserPreferencesTable(db);
    db.query(`insert into user_preferences (
      user_id, image_task_success_sound_id, image_task_failure_sound_id, updated_at
    ) values (?, ?, ?, ?)`).run("user_1", "disabled-success", "deleted-failure", "2026-07-22");

    const saved = saveUserPreferencesToDb(db, "user_1", { language: "en-US" }, ["maliang-001", "maliang-002"]);
    expect(saved.imageTaskSuccessSoundId).toBe("maliang-001");
    expect(saved.imageTaskFailureSoundId).toBe("maliang-002");
    expect(db.query(`select
      image_task_success_sound_id as successId,
      image_task_failure_sound_id as failureId
      from user_preferences where user_id = ?`).get("user_1")).toEqual({
        successId: "disabled-success",
        failureId: "deleted-failure"
      });
  });
});
