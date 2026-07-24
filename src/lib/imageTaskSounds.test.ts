import { describe, expect, test } from "bun:test";
import { enabledLocales } from "../i18n/locales";
import imageTaskSoundMessages from "../i18n/messages/imageTaskSoundMessages";
import {
  DEFAULT_IMAGE_TASK_FAILURE_SOUND_ID,
  DEFAULT_IMAGE_TASK_SUCCESS_SOUND_ID,
  normalizeImageTaskSoundId,
  resolveImageTaskSoundPreferenceIds
} from "./imageTaskSounds";

describe("image task sound catalog preferences", () => {
  test("starts empty and preserves legacy id migrations", () => {
    expect(DEFAULT_IMAGE_TASK_SUCCESS_SOUND_ID).toBe("");
    expect(DEFAULT_IMAGE_TASK_FAILURE_SOUND_ID).toBe("");
    expect(normalizeImageTaskSoundId("legacy-2870")).toBe("maliang-001");
    expect(normalizeImageTaskSoundId("legacy-946")).toBe("maliang-002");
    expect(normalizeImageTaskSoundId("custom-sound")).toBe("custom-sound");
    expect(normalizeImageTaskSoundId(null)).toBe("");
  });

  test("keeps available selections and falls back by success/failure order", () => {
    expect(resolveImageTaskSoundPreferenceIds("sound-b", "sound-a", ["sound-a", "sound-b"])).toEqual({
      successId: "sound-b",
      failureId: "sound-a"
    });
    expect(resolveImageTaskSoundPreferenceIds("missing", "missing", ["sound-a", "sound-b"])).toEqual({
      successId: "sound-a",
      failureId: "sound-b"
    });
    expect(resolveImageTaskSoundPreferenceIds("missing", "missing", [])).toEqual({ successId: "", failureId: "" });
  });

  test("has empty-catalog copy for every enabled locale", () => {
    expect(enabledLocales).toHaveLength(11);
    for (const locale of enabledLocales) {
      expect(imageTaskSoundMessages[locale.code]["settings.nav.sound"]).toBeTruthy();
      expect(imageTaskSoundMessages[locale.code]["settings.nav.soundMenu"]).toBeTruthy();
      expect(imageTaskSoundMessages[locale.code]["settings.sound.catalog.loading"]).toBeTruthy();
      expect(imageTaskSoundMessages[locale.code]["settings.sound.catalog.empty"]).toBeTruthy();
      expect(imageTaskSoundMessages[locale.code]["toast.imageTaskBrowserNotificationInsecureContext"]).toBeTruthy();
      expect(imageTaskSoundMessages[locale.code]["toast.imageTaskBrowserNotificationPermissionBlocked"]).toBeTruthy();
    }
  });
});
