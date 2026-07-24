export const DEFAULT_IMAGE_TASK_SUCCESS_SOUND_ID = "";
export const DEFAULT_IMAGE_TASK_FAILURE_SOUND_ID = "";
export const DEFAULT_IMAGE_TASK_SOUND_VOLUME = 70;

export type ImageTaskSoundId = string;

const legacySoundIdByNumericSuffix: Readonly<Record<string, ImageTaskSoundId>> = {
  "2870": "maliang-001",
  "946": "maliang-002",
  "2358": "maliang-003",
  "2309": "maliang-004",
  "616": "maliang-005",
  "2889": "maliang-006",
  "579": "maliang-007",
  "2879": "maliang-008",
  "2816": "maliang-009",
  "2210": "maliang-010",
  "1": "maliang-011",
  "93": "maliang-012",
  "1751": "maliang-013",
  "2462": "maliang-014"
};

export function isImageTaskSoundId(value: unknown): value is ImageTaskSoundId {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

export function normalizeImageTaskSoundId(value: unknown, fallback: ImageTaskSoundId = ""): ImageTaskSoundId {
  if (isImageTaskSoundId(value)) {
    const numericSuffix = /-(\d+)$/.exec(value)?.[1];
    return numericSuffix && legacySoundIdByNumericSuffix[numericSuffix]
      ? legacySoundIdByNumericSuffix[numericSuffix]
      : value.trim();
  }
  return fallback;
}

export function normalizeImageTaskSoundVolume(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_IMAGE_TASK_SOUND_VOLUME;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

export function resolveImageTaskSoundPreferenceIds(
  successValue: unknown,
  failureValue: unknown,
  availableIds: readonly string[]
) {
  const available = Array.from(new Set(availableIds.filter(isImageTaskSoundId)));
  const availableSet = new Set(available);
  const storedSuccess = normalizeImageTaskSoundId(successValue);
  const storedFailure = normalizeImageTaskSoundId(failureValue);
  return {
    successId: availableSet.has(storedSuccess) ? storedSuccess : available[0] ?? "",
    failureId: availableSet.has(storedFailure) ? storedFailure : available[1] ?? available[0] ?? ""
  };
}
