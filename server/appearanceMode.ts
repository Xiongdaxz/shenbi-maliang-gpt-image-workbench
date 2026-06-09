export type AppearanceMode = "system" | "dark" | "light" | "maliang";

const APPEARANCE_MODES = new Set<AppearanceMode>(["system", "dark", "light", "maliang"]);

export function normalizeAppearanceMode(value: unknown): AppearanceMode {
  return typeof value === "string" && APPEARANCE_MODES.has(value as AppearanceMode) ? (value as AppearanceMode) : "system";
}
