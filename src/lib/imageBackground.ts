export const IMAGE_BACKGROUND_OPTIONS = ["auto", "opaque", "transparent"] as const;
export const TRANSPARENT_IMAGE_OUTPUT_FORMAT = "png" as const;
export const INHERITED_SOURCE_BACKGROUND_REQUEST_KEY = "_inheritedSourceBackground" as const;
export const REMOVE_IMAGE_BACKGROUND_PROMPT =
  "移除此图像的背景。保持所有前景主体不变且完整无损，边缘干净平滑。将背景设为透明。";

export type ImageBackgroundOption = (typeof IMAGE_BACKGROUND_OPTIONS)[number];
export type TransparentImageOutputFormat = "png" | "webp";

export const TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION =
  "透明背景要求：主体必须独立呈现在完全透明的 Alpha 背景上；不要生成棋盘格、纯色底、场景背景或主体外投影。";
export const OPAQUE_BACKGROUND_PROMPT_INSTRUCTION =
  "不透明背景要求：画布所有区域都必须保持完全不透明；不要输出透明、半透明或 Alpha 镂空背景。";
export const DEFAULT_OPAQUE_BACKGROUND_PROMPT_INSTRUCTION =
  "默认背景要求：除非用户明确要求透明背景、无背景或 Alpha 通道，否则保持或生成完整不透明画布；不要自动输出透明、半透明、Alpha 镂空背景或棋盘格。";

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

export function imagePromptRequestsTransparentBackground(prompt: unknown) {
  const normalized = String(prompt ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const explicitlyRejectsTransparency = [
    /(?:不要|不再|无需|不需要|取消|去掉|去除|移除).{0,10}(?:保持|保留|使用|输出)?\s*(?:透明图片|透明背景|透明效果|alpha\s*通道)/i,
    /(?:不透明|非透明)(?:图片|背景|底色|画布)?/i,
    /\b(?:do\s+not|don't|no\s+longer)\s+(?:keep|preserve|use|output)?\s*(?:a\s+)?transparent\s+(?:image|background)\b/i,
    /\b(?:opaque|non[-\s]?transparent)\s+(?:background|backdrop|image)\b/i
  ].some((pattern) => pattern.test(normalized));
  if (explicitlyRejectsTransparency) return false;
  return [
    /(?:保持|保留|继续|仍然|依旧|维持)[^，。！？；;]{0,12}(?:透明图片|透明背景|透明效果|alpha\s*通道|(?:背景|图片)[^，。！？；;]{0,6}透明)/i,
    /(?:添加|增加|新增|加上|创建|换成|换为|更换为?|替换为?|改成|改为|设为|设置为|使用)[^，。！？；;]{0,12}(?:透明背景|无背景)/i,
    /(?:背景|底色|底图)[^，。！？；;]{0,12}(?:保持|保留|继续|仍然|依旧|维持|换成|换为|更换为?|替换为?|改成|改为|设为|设置为)[^，。！？；;]{0,12}(?:透明|无背景)/i,
    /(?:透明图片|透明背景|无背景|alpha\s*通道)/i,
    /\btransparent\s+(?:background|backdrop|image|png)\b/i,
    /\b(?:keep|preserve|remain)\b[^,.!?;]{0,20}\b(?:transparent|alpha)\b/i,
    /\b(?:add|create|change|set|replace|make|use)\b[^,.!?;]{0,20}\btransparent\b[^,.!?;]{0,12}\b(?:background|backdrop)\b/i,
    /\b(?:add|create|change|set|replace|make|use)\b[^,.!?;]{0,20}\b(?:background|backdrop)\b[^,.!?;]{0,12}\btransparent\b/i
  ].some((pattern) => pattern.test(normalized));
}

export function resolveImageBackgroundOption(background: unknown, prompt: unknown): Exclude<ImageBackgroundOption, "auto"> {
  const normalized = normalizeImageBackgroundOption(background);
  if (normalized === "transparent" || normalized === "opaque") return normalized;
  return imagePromptRequestsTransparentBackground(prompt) ? "transparent" : "opaque";
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
  const basePrompt = [
    TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION,
    OPAQUE_BACKGROUND_PROMPT_INSTRUCTION,
    DEFAULT_OPAQUE_BACKGROUND_PROMPT_INSTRUCTION
  ].reduce(
    (current, existingInstruction) => current
      .replaceAll(`\n\n${existingInstruction}`, "")
      .replaceAll(existingInstruction, ""),
    normalizedPrompt
  ).trim();
  if (!basePrompt) return normalizedPrompt;
  const requestedBackground = normalizeImageBackgroundOption(background);
  const resolvedBackground = resolveImageBackgroundOption(requestedBackground, basePrompt);
  const instruction = resolvedBackground === "transparent"
    ? TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION
    : requestedBackground === "opaque"
      ? OPAQUE_BACKGROUND_PROMPT_INSTRUCTION
      : DEFAULT_OPAQUE_BACKGROUND_PROMPT_INSTRUCTION;
  return [basePrompt, "", instruction].join("\n");
}
