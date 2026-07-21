import { appDb, getOne, run } from "./db";
import type { UserPreferencesRow } from "./types";
import { now } from "./utils";
import {
  cloneDefaultPromptOptimizeStyleGroups,
  sanitizePromptOptimizeStyleGroups,
  type PromptOptimizeStyleGroup
} from "../src/lib/promptOptimizeStyles";

export type EditSuggestionTone = "default" | "practical" | "creative" | "detail";
export type LanguagePreference = "auto" | "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR" | "es-ES" | "fr-FR" | "de-DE" | "pt-BR" | "ru-RU" | "fa-IR";
export type ImagePreviewWheelMode = "zoom" | "pan";
export type ImagePreviewOpenMode = "contain" | "actual";

const EDIT_SUGGESTION_TONES = new Set<EditSuggestionTone>(["default", "practical", "creative", "detail"]);
const LANGUAGE_PREFERENCES = new Set<LanguagePreference>(["auto", "zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR", "es-ES", "fr-FR", "de-DE", "pt-BR", "ru-RU", "fa-IR"]);
const IMAGE_PREVIEW_WHEEL_MODES = new Set<ImagePreviewWheelMode>(["zoom", "pan"]);
const IMAGE_PREVIEW_OPEN_MODES = new Set<ImagePreviewOpenMode>(["contain", "actual"]);

export type PublicUserPreferences = {
  language: LanguagePreference;
  imagePreviewWheelMode: ImagePreviewWheelMode;
  imagePreviewOpenMode: ImagePreviewOpenMode;
  editSuggestionsEnabled: boolean;
  editSuggestionTone: EditSuggestionTone;
  autoUploadPastedAssets: boolean;
  promptOptimizeStyleGroups: PromptOptimizeStyleGroup[];
  promptOptimizeCustomInstruction: string;
};

export function normalizeEditSuggestionTone(value: unknown): EditSuggestionTone {
  return typeof value === "string" && EDIT_SUGGESTION_TONES.has(value as EditSuggestionTone) ? (value as EditSuggestionTone) : "default";
}

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  return typeof value === "string" && LANGUAGE_PREFERENCES.has(value as LanguagePreference) ? (value as LanguagePreference) : "auto";
}

export function normalizeImagePreviewWheelMode(value: unknown): ImagePreviewWheelMode {
  return typeof value === "string" && IMAGE_PREVIEW_WHEEL_MODES.has(value as ImagePreviewWheelMode) ? (value as ImagePreviewWheelMode) : "pan";
}

export function normalizeImagePreviewOpenMode(value: unknown): ImagePreviewOpenMode {
  return typeof value === "string" && IMAGE_PREVIEW_OPEN_MODES.has(value as ImagePreviewOpenMode) ? (value as ImagePreviewOpenMode) : "contain";
}

export function defaultUserPreferences(): PublicUserPreferences {
  return {
    language: "auto",
    imagePreviewWheelMode: "pan",
    imagePreviewOpenMode: "contain",
    editSuggestionsEnabled: true,
    editSuggestionTone: "default",
    autoUploadPastedAssets: true,
    promptOptimizeStyleGroups: cloneDefaultPromptOptimizeStyleGroups(),
    promptOptimizeCustomInstruction: ""
  };
}

function storedPromptOptimizeStyleGroups(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return cloneDefaultPromptOptimizeStyleGroups();
  try {
    return sanitizePromptOptimizeStyleGroups(JSON.parse(text));
  } catch {
    return cloneDefaultPromptOptimizeStyleGroups();
  }
}

function publicUserPreferences(row: UserPreferencesRow | null | undefined): PublicUserPreferences {
  const fallback = defaultUserPreferences();
  if (!row) return fallback;
  return {
    language: normalizeLanguagePreference(row.language),
    imagePreviewWheelMode: normalizeImagePreviewWheelMode(row.image_preview_wheel_mode),
    imagePreviewOpenMode: normalizeImagePreviewOpenMode(row.image_preview_open_mode),
    editSuggestionsEnabled: Boolean(row.edit_suggestions_enabled),
    editSuggestionTone: normalizeEditSuggestionTone(row.edit_suggestion_tone),
    autoUploadPastedAssets: row.auto_upload_pasted_assets !== 0,
    promptOptimizeStyleGroups: storedPromptOptimizeStyleGroups(row.prompt_optimize_styles_json),
    promptOptimizeCustomInstruction: normalizePromptOptimizeCustomInstruction(row.prompt_optimize_custom_instruction)
  };
}

function normalizePromptOptimizeCustomInstruction(value: unknown) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return "";
  return Array.from(text).slice(0, 500).join("");
}

export function userPreferences(userId: string): PublicUserPreferences {
  const row = getOne<UserPreferencesRow>(appDb, "select * from user_preferences where user_id = ?", userId);
  return publicUserPreferences(row);
}

export function saveUserPreferences(userId: string, input: Record<string, unknown>) {
  const current = userPreferences(userId);
  const language =
    input.language === undefined ? current.language : normalizeLanguagePreference(input.language);
  const imagePreviewWheelMode =
    input.imagePreviewWheelMode === undefined ? current.imagePreviewWheelMode : normalizeImagePreviewWheelMode(input.imagePreviewWheelMode);
  const imagePreviewOpenMode =
    input.imagePreviewOpenMode === undefined ? current.imagePreviewOpenMode : normalizeImagePreviewOpenMode(input.imagePreviewOpenMode);
  const editSuggestionsEnabled =
    typeof input.editSuggestionsEnabled === "boolean" ? input.editSuggestionsEnabled : current.editSuggestionsEnabled;
  const editSuggestionTone =
    input.editSuggestionTone === undefined ? current.editSuggestionTone : normalizeEditSuggestionTone(input.editSuggestionTone);
  const autoUploadPastedAssets =
    typeof input.autoUploadPastedAssets === "boolean" ? input.autoUploadPastedAssets : current.autoUploadPastedAssets;
  const promptOptimizeStyleGroups =
    input.promptOptimizeStyleGroups === undefined
      ? current.promptOptimizeStyleGroups
      : sanitizePromptOptimizeStyleGroups(input.promptOptimizeStyleGroups);
  const promptOptimizeCustomInstruction =
    input.promptOptimizeCustomInstruction === undefined
      ? current.promptOptimizeCustomInstruction
      : normalizePromptOptimizeCustomInstruction(input.promptOptimizeCustomInstruction);
  const timestamp = now();
  run(
    appDb,
    `insert into user_preferences (
      user_id, language, image_preview_wheel_mode, image_preview_open_mode,
      edit_suggestions_enabled, edit_suggestion_tone, auto_upload_pasted_assets,
      prompt_optimize_styles_json, prompt_optimize_custom_instruction, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(user_id) do update set
      language = excluded.language,
      image_preview_wheel_mode = excluded.image_preview_wheel_mode,
      image_preview_open_mode = excluded.image_preview_open_mode,
      edit_suggestions_enabled = excluded.edit_suggestions_enabled,
      edit_suggestion_tone = excluded.edit_suggestion_tone,
      auto_upload_pasted_assets = excluded.auto_upload_pasted_assets,
      prompt_optimize_styles_json = excluded.prompt_optimize_styles_json,
      prompt_optimize_custom_instruction = excluded.prompt_optimize_custom_instruction,
      updated_at = excluded.updated_at`,
    userId,
    language,
    imagePreviewWheelMode,
    imagePreviewOpenMode,
    editSuggestionsEnabled ? 1 : 0,
    editSuggestionTone,
    autoUploadPastedAssets ? 1 : 0,
    JSON.stringify(promptOptimizeStyleGroups),
    promptOptimizeCustomInstruction,
    timestamp
  );
  return userPreferences(userId);
}
