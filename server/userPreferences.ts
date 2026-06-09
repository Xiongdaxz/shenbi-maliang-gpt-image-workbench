import { appDb, getOne, run } from "./db";
import type { UserPreferencesRow } from "./types";
import { now } from "./utils";

export type EditSuggestionTone = "default" | "practical" | "creative" | "detail";

const EDIT_SUGGESTION_TONES = new Set<EditSuggestionTone>(["default", "practical", "creative", "detail"]);

export type PublicUserPreferences = {
  editSuggestionsEnabled: boolean;
  editSuggestionTone: EditSuggestionTone;
};

export function normalizeEditSuggestionTone(value: unknown): EditSuggestionTone {
  return typeof value === "string" && EDIT_SUGGESTION_TONES.has(value as EditSuggestionTone) ? (value as EditSuggestionTone) : "default";
}

export function defaultUserPreferences(): PublicUserPreferences {
  return {
    editSuggestionsEnabled: true,
    editSuggestionTone: "default"
  };
}

function publicUserPreferences(row: UserPreferencesRow | null | undefined): PublicUserPreferences {
  const fallback = defaultUserPreferences();
  if (!row) return fallback;
  return {
    editSuggestionsEnabled: Boolean(row.edit_suggestions_enabled),
    editSuggestionTone: normalizeEditSuggestionTone(row.edit_suggestion_tone)
  };
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
  const timestamp = now();
  run(
    appDb,
    `insert into user_preferences (
      user_id, edit_suggestions_enabled, edit_suggestion_tone, updated_at
    ) values (?, ?, ?, ?)
    on conflict(user_id) do update set
      edit_suggestions_enabled = excluded.edit_suggestions_enabled,
      edit_suggestion_tone = excluded.edit_suggestion_tone,
      updated_at = excluded.updated_at`,
    userId,
    editSuggestionsEnabled ? 1 : 0,
    editSuggestionTone,
    timestamp
  );
  return userPreferences(userId);
}
