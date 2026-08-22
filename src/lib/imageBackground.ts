export const IMAGE_BACKGROUND_OPTIONS = ["auto", "opaque", "transparent"] as const;
export const TRANSPARENT_IMAGE_OUTPUT_FORMAT = "png" as const;

export type ImageBackgroundOption = (typeof IMAGE_BACKGROUND_OPTIONS)[number];
export type TransparentImageOutputFormat = "png" | "webp";

export const TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION =
  "透明背景要求：主体必须独立呈现在完全透明的 Alpha 背景上；不要生成棋盘格、纯色底、场景背景或主体外投影。";
export const OPAQUE_BACKGROUND_PROMPT_INSTRUCTION =
  "不透明背景要求：画布所有区域都必须保持完全不透明；不要输出透明、半透明或 Alpha 镂空背景。";

export function isImageBackgroundOption(value: unknown): value is ImageBackgroundOption {
  return IMAGE_BACKGROUND_OPTIONS.includes(String(value ?? "").trim().toLowerCase() as ImageBackgroundOption);
}

export function normalizeImageBackgroundOption(value: unknown): ImageBackgroundOption {
  const normalized = String(value ?? "").trim().toLowerCase();
  return isImageBackgroundOption(normalized) ? normalized : "auto";
}

export function isTransparentImageOutputFormat(value: unknown): value is TransparentImageOutputFormat {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "png" || normalized === "webp";
}

export function normalizeTransparentImageOutputFormat(value: unknown): TransparentImageOutputFormat {
  const normalized = String(value ?? "").trim().toLowerCase();
  return isTransparentImageOutputFormat(normalized) ? normalized : TRANSPARENT_IMAGE_OUTPUT_FORMAT;
}

export function imageBackgroundRequestOptions(
  background: ImageBackgroundOption,
  transparentOutputFormat: TransparentImageOutputFormat = TRANSPARENT_IMAGE_OUTPUT_FORMAT
) {
  const normalized = normalizeImageBackgroundOption(background);
  if (normalized === "transparent") {
    return {
      background: normalized,
      outputFormat: normalizeTransparentImageOutputFormat(transparentOutputFormat)
    };
  }
  return normalized === "opaque" ? { background: normalized } : {};
}

export function imageBackgroundRequestOptionsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  fallbackBackground: ImageBackgroundOption
) {
  const normalizedFallback = normalizeImageBackgroundOption(fallbackBackground);
  const metadataBackground = isImageBackgroundOption(metadata?.background)
    ? normalizeImageBackgroundOption(metadata?.background)
    : null;
  const fallbackIsExplicit = normalizedFallback !== "auto";
  const effectiveBackground = fallbackIsExplicit
    ? normalizedFallback
    : metadataBackground ?? normalizedFallback;
  const effectiveOutputFormat = fallbackIsExplicit
    ? TRANSPARENT_IMAGE_OUTPUT_FORMAT
    : normalizeTransparentImageOutputFormat(metadata?.outputFormat ?? metadata?.output_format);
  return imageBackgroundRequestOptions(effectiveBackground, effectiveOutputFormat);
}

export function isTransparentImageRequest(payload: Record<string, unknown>) {
  return normalizeImageBackgroundOption(payload.background) === "transparent";
}

export function injectImageBackgroundInstruction(
  prompt: unknown,
  background: unknown
) {
  const normalizedPrompt = String(prompt ?? "");
  const normalizedBackground = normalizeImageBackgroundOption(background);
  const instruction = normalizedBackground === "transparent"
    ? TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION
    : normalizedBackground === "opaque"
      ? OPAQUE_BACKGROUND_PROMPT_INSTRUCTION
      : "";
  if (!instruction || !normalizedPrompt.trim() || normalizedPrompt.includes(instruction)) return normalizedPrompt;
  return [normalizedPrompt, "", instruction].join("\n");
}
