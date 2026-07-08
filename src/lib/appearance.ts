export type AppearanceMode = "system" | "dark" | "light" | "maliang" | "chunyu";
export type ResolvedAppearance = "dark" | "light" | "maliang" | "chunyu";

export const APPEARANCE_STORAGE_KEY = "gpt-image.appearance-mode";

const APPEARANCE_MODES = new Set<AppearanceMode>(["system", "dark", "light", "maliang", "chunyu"]);
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function normalizeAppearanceMode(value: unknown): AppearanceMode {
  return typeof value === "string" && APPEARANCE_MODES.has(value as AppearanceMode) ? (value as AppearanceMode) : "system";
}

export function readAppearanceMode(): AppearanceMode {
  if (typeof window === "undefined") return "system";
  try {
    return normalizeAppearanceMode(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function writeAppearanceMode(mode: AppearanceMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, mode);
  } catch {
    // localStorage can be unavailable in private or restricted browser contexts.
  }
}

export function resolveAppearanceMode(mode: AppearanceMode = readAppearanceMode()): ResolvedAppearance {
  if (mode === "dark" || mode === "light" || mode === "maliang" || mode === "chunyu") return mode;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
}

export function applyAppearanceMode(mode: AppearanceMode = readAppearanceMode()): ResolvedAppearance {
  const resolved = resolveAppearanceMode(mode);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.appearanceMode = mode;
    document.documentElement.dataset.appearance = resolved;
    document.documentElement.style.colorScheme = resolved === "dark" ? "dark" : "light";
  }
  return resolved;
}

export function clearAppearanceMode() {
  if (typeof document === "undefined") return;
  delete document.documentElement.dataset.appearanceMode;
  delete document.documentElement.dataset.appearance;
  document.documentElement.style.colorScheme = "";
}

export function subscribeSystemAppearance(listener: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const mediaQuery = window.matchMedia(DARK_SCHEME_QUERY);
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }
  mediaQuery.addListener(listener);
  return () => mediaQuery.removeListener(listener);
}
