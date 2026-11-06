export const IMAGE_MODEL_IDS = [
  "gpt-image-2.6-flare",
  "gpt-image-2.6-sunburst",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
  "gpt-image-2"
] as const;

export type ImageModelId = (typeof IMAGE_MODEL_IDS)[number];

export const DEFAULT_GENERATION_IMAGE_MODEL: ImageModelId = "gpt-image-2.6-sunburst";
export const DEFAULT_EDIT_IMAGE_MODEL: ImageModelId = DEFAULT_GENERATION_IMAGE_MODEL;
export const DEFAULT_CHATGPT_WEB_IMAGE_MODEL: ImageModelId = "gpt-image-2.6-sunburst";
export const IMAGE_MODEL_FALLBACK: ImageModelId = "gpt-image-2";
export const DEFAULT_IMAGE_QUALITY = "auto" as const;

export type ConversationImageSelection = {
  imageModel: ImageModelId;
  quality: ImageQuality;
  complexity?: ImageComplexity;
};

export type ImageModelOption = {
  value: ImageModelId;
  labelKey: string;
  descriptionKey: string;
  shortLabelKey: string;
};

export function imageModelDisplayName(model: ImageModelId) {
  if (model === "gpt-image-2.5-flare") return "GPT Image 2.5 Flare";
  if (model === "gpt-image-2.5-sunburst") return "GPT Image 2.5 Sunburst";
  if (model === "gpt-image-2.6-flare") return "GPT Image 2.6 Flare";
  if (model === "gpt-image-2.6-sunburst") return "GPT Image 2.6 Sunburst";
  return "GPT Image 2";
}

export const IMAGE_MODEL_OPTIONS: ImageModelOption[] = [
  {
    value: "gpt-image-2.6-flare",
    labelKey: "picker.model.flare26",
    shortLabelKey: "picker.model.flare26Short",
    descriptionKey: "picker.model.flare26Desc"
  },
  {
    value: "gpt-image-2.6-sunburst",
    labelKey: "picker.model.sunburst26",
    shortLabelKey: "picker.model.sunburst26Short",
    descriptionKey: "picker.model.sunburst26Desc"
  },
  {
    value: "gpt-image-2.5-flare",
    labelKey: "picker.model.flare",
    shortLabelKey: "picker.model.flareShort",
    descriptionKey: "picker.model.flareDesc"
  },
  {
    value: "gpt-image-2.5-sunburst",
    labelKey: "picker.model.sunburst",
    shortLabelKey: "picker.model.sunburstShort",
    descriptionKey: "picker.model.sunburstDesc"
  },
  {
    value: "gpt-image-2",
    labelKey: "picker.model.compatible",
    shortLabelKey: "picker.model.compatibleShort",
    descriptionKey: "picker.model.compatibleDesc"
  }
];

export const GPT_IMAGE_2_QUALITIES = ["low", "medium", "high"] as const;
export const GPT_IMAGE_EXTENDED_QUALITIES = ["low", "medium", "high", "xhigh", "max"] as const;
export type ImageQuality = "auto" | (typeof GPT_IMAGE_EXTENDED_QUALITIES)[number];
export const GPT_IMAGE_26_COMPLEXITIES = ["low", "medium", "high"] as const;
export type ImageComplexity = (typeof GPT_IMAGE_26_COMPLEXITIES)[number];

export function isImageModelId(value: unknown): value is ImageModelId {
  return IMAGE_MODEL_IDS.includes(String(value ?? "").trim() as ImageModelId);
}

export function normalizeImageModel(value: unknown, fallback: ImageModelId): ImageModelId {
  const normalized = String(value ?? "").trim();
  return isImageModelId(normalized) ? normalized : fallback;
}

export function isGptImage25Model(value: unknown): value is Extract<ImageModelId, `gpt-image-2.5-${string}`> {
  return value === "gpt-image-2.5-flare" || value === "gpt-image-2.5-sunburst";
}

export function isGptImage26Model(value: unknown): value is Extract<ImageModelId, `gpt-image-2.6-${string}`> {
  return value === "gpt-image-2.6-flare" || value === "gpt-image-2.6-sunburst";
}

export function normalizeImageComplexity(model: unknown, complexity: unknown): ImageComplexity | undefined {
  if (!isGptImage26Model(model)) return undefined;
  const value = typeof complexity === "string" ? complexity.trim().toLowerCase() : "";
  return GPT_IMAGE_26_COMPLEXITIES.find(item => item === value);
}

export function imageModelQualities(model: ImageModelId): ImageQuality[] {
  return [...(isGptImage25Model(model) || isGptImage26Model(model) ? GPT_IMAGE_EXTENDED_QUALITIES : GPT_IMAGE_2_QUALITIES)];
}

export function isImageQualitySupported(model: ImageModelId, quality: unknown) {
  const normalized = String(quality ?? "").trim().toLowerCase();
  return normalized === "auto" || imageModelQualities(model).includes(normalized as ImageQuality);
}

export function fallbackImageQuality(quality: unknown): ImageQuality {
  const normalized = String(quality ?? "").trim().toLowerCase();
  if (normalized === "auto") return "auto";
  return GPT_IMAGE_2_QUALITIES.includes(normalized as (typeof GPT_IMAGE_2_QUALITIES)[number])
    ? normalized as (typeof GPT_IMAGE_2_QUALITIES)[number]
    : "high";
}

export function normalizeImageQuality(model: ImageModelId, quality: unknown): ImageQuality {
  const normalized = String(quality ?? "").trim().toLowerCase();
  return isImageQualitySupported(model, normalized) ? normalized as ImageQuality : DEFAULT_IMAGE_QUALITY;
}

export function latestConversationImageSelection(messages: ReadonlyArray<{
  role?: string;
  metadata?: Record<string, unknown> | null;
}>): ConversationImageSelection | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user" || !isImageModelId(message.metadata?.model)) continue;
    const imageModel = message.metadata.model;
    const complexity = normalizeImageComplexity(imageModel, message.metadata.complexity);
    return {
      imageModel,
      quality: normalizeImageQuality(imageModel, message.metadata.quality),
      ...(complexity ? { complexity } : {})
    };
  }
  return null;
}
