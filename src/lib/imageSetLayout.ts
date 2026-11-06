export type ImageSetLayoutPreferences = { left: number; right: number; candidates: number };
export const IMAGE_SET_LAYOUT_KEY = "gpt-image.image-sets.layout.v1";
export const DEFAULT_IMAGE_SET_LAYOUT: ImageSetLayoutPreferences = { left: .15, right: .25, candidates: 150 };
export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, max), Math.max(min, value));
export function parseImageSetLayout(raw: string | null): ImageSetLayoutPreferences {
  try {
    if (!raw || raw.length > 1000) return { ...DEFAULT_IMAGE_SET_LAYOUT };
    const value = JSON.parse(raw);
    if (!value || ![value.left, value.right, value.candidates].every(n => typeof n === "number" && Number.isFinite(n))) return { ...DEFAULT_IMAGE_SET_LAYOUT };
    return { left: clamp(value.left, .08, .4), right: clamp(value.right, .12, .5), candidates: clamp(value.candidates, 110, 260) };
  } catch { return { ...DEFAULT_IMAGE_SET_LAYOUT }; }
}
export function imageSetLayoutGeometry(width: number, height: number, preferences: ImageSetLayoutPreferences) {
  const mode = width >= 900 ? "wide" : width >= 650 ? "narrow" : "stacked";
  const usable = Math.max(0, width - 20);
  const left = mode === "wide" ? clamp(preferences.left * usable, 160, Math.min(300, usable - 700)) : 0;
  const right = mode === "wide" ? clamp(preferences.right * usable, 280, Math.min(440, usable - left - 420)) : 280;
  const candidateMax = Math.min(260, Math.max(110, height - 370));
  return { mode, usable, left, right, canvas: usable - left - right, candidateMax, candidates: clamp(preferences.candidates, 110, candidateMax) };
}
