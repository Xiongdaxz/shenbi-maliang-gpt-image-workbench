import { appDb, getOne, run } from "./db";
import type { UserPreferencesRow } from "./types";
import { now } from "./utils";
import {
  cloneDefaultPromptOptimizeStyleGroups,
  sanitizePromptOptimizeStyleGroups,
  type PromptOptimizeStyleGroup
} from "../src/lib/promptOptimizeStyles";

export type EditSuggestionTone = "default" | "practical" | "creative" | "detail";

const EDIT_SUGGESTION_TONES = new Set<EditSuggestionTone>(["default", "practical", "creative", "detail"]);

export type PublicUserPreferences = {
  editSuggestionsEnabled: boolean;
  editSuggestionTone: EditSuggestionTone;
  promptOptimizeStyleGroups: PromptOptimizeStyleGroup[];
  promptOptimizeCustomInstruction: string;
};

export function normalizeEditSuggestionTone(value: unknown): EditSuggestionTone {
  return typeof value === "string" && EDIT_SUGGESTION_TONES.has(value as EditSuggestionTone) ? (value as EditSuggestionTone) : "default";
}

export function defaultUserPreferences(): PublicUserPreferences {
  return {
    editSuggestionsEnabled: true,
    editSuggestionTone: "default",
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
    editSuggestionsEnabled: Boolean(row.edit_suggestions_enabled),
    editSuggestionTone: normalizeEditSuggestionTone(row.edit_suggestion_tone),
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
  const editSuggestionsEnabled =
    typeof input.editSuggestionsEnabled === "boolean" ? input.editSuggestionsEnabled : current.editSuggestionsEnabled;
  const editSuggestionTone =
    input.editSuggestionTone === undefined ? current.editSuggestionTone : normalizeEditSuggestionTone(input.editSuggestionTone);
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
      user_id, edit_suggestions_enabled, edit_suggestion_tone, prompt_optimize_styles_json, prompt_optimize_custom_instruction, updated_at
    ) values (?, ?, ?, ?, ?, ?)
    on conflict(user_id) do update set
      edit_suggestions_enabled = excluded.edit_suggestions_enabled,
      edit_suggestion_tone = excluded.edit_suggestion_tone,
      prompt_optimize_styles_json = excluded.prompt_optimize_styles_json,
      prompt_optimize_custom_instruction = excluded.prompt_optimize_custom_instruction,
      updated_at = excluded.updated_at`,
    userId,
    editSuggestionsEnabled ? 1 : 0,
    editSuggestionTone,
    JSON.stringify(promptOptimizeStyleGroups),
    promptOptimizeCustomInstruction,
    timestamp
  );
  return userPreferences(userId);
}
