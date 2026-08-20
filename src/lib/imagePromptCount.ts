export const MIN_IMAGE_COUNT = 1;
export const MAX_IMAGE_COUNT = 10;

const CHINESE_DIGITS: Record<string, number> = {
  "〇": 0,
  "零": 0,
  "一": 1,
  "二": 2,
  "两": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
  "七": 7,
  "八": 8,
  "九": 9
};

function normalizeFullWidthDigits(value: string) {
  return value.replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10));
}

export function resolveSelectedImageCount(value: unknown) {
  const count = Number.parseInt(String(value ?? MIN_IMAGE_COUNT), 10);
  if (!Number.isFinite(count)) return MIN_IMAGE_COUNT;
  return Math.max(MIN_IMAGE_COUNT, Math.min(MAX_IMAGE_COUNT, count));
}

function numberTokenValue(value: string) {
  const token = normalizeFullWidthDigits(value.trim());
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
  if (!token || /[^〇零一二两三四五六七八九十]/.test(token)) return 0;
  const tenIndex = token.indexOf("十");
  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : CHINESE_DIGITS[token[tenIndex - 1] ?? ""] ?? 0;
    const units = tenIndex === token.length - 1 ? 0 : CHINESE_DIGITS[token[tenIndex + 1] ?? ""] ?? 0;
    return tens * 10 + units;
  }
  return Array.from(token).reduce((count, digit) => count * 10 + (CHINESE_DIGITS[digit] ?? 0), 0);
}

function imageCountMatchIsReferenceInput(prompt: string, index: number, length: number) {
  const before = prompt.slice(Math.max(0, index - 36), index);
  const after = prompt.slice(index + length, index + length + 36);
  const hasOutputVerb = /(?:生成|制作|创建|输出|绘制|画|做|来|给我|generate|create|make|render|produce|output)[^，,。；;\n]{0,18}$/i.test(before);
  if (hasOutputVerb) return false;
  return /(?:使用|采用|基于|依据|参考|输入|上传|提供|选取|选择|从|use|using|based\s+on|reference|upload|provide|select\s+from)[^，,。；;\n]{0,14}$/i.test(before)
    || /^(?:\s*(?:作为|用作|当作|为)\s*(?:输入|参考|素材|原图|底图|references?|inputs?|source\s+images?))/i.test(after);
}

function firstExplicitImageCount(prompt: string) {
  const normalized = normalizeFullWidthDigits(prompt);
  const matches: Array<{ index: number; count: number }> = [];
  const patterns = [
    /([0-9〇零一二两三四五六七八九十]+)\s*(?:张|幅)\s*(?:(?:不同|独立|单独|连续|连贯|风格各异|各不相同)\s*(?:的\s*)?)?(?:图片|图像|图|照片|相片|海报|插图|作品)/gi,
    /(?:生成|制作|创建|输出|绘制|画|做|来|给我)\s*([0-9〇零一二两三四五六七八九十]+)\s*(?:张|幅)\s*[^，,。；;\n]{0,18}?(?:图片|图像|图|照片|相片|海报|插图|作品)/gi,
    /(?:生成|制作|创建|输出|绘制|画|做|来|给我)\s*([0-9〇零一二两三四五六七八九十]+)\s*(?:张|幅)(?=$|[\s，,。；;])/gi,
    /\b(?:generate|create|make|render|produce|output)\s+([0-9]+)\s+(?:images?|pictures?|photos?|illustrations?|renders?|posters?)\b/gi,
    /\b([0-9]+)\s+(?:images?|pictures?|photos?|illustrations?|renders?|posters?)\b/gi
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const countToken = match[1] ?? "";
      const count = numberTokenValue(countToken);
      const countOffset = match[0].indexOf(countToken);
      const index = (match.index ?? 0) + Math.max(0, countOffset);
      if (count > 0 && !imageCountMatchIsReferenceInput(normalized, index, countToken.length)) {
        matches.push({ index, count });
      }
    }
  }
  matches.sort((left, right) => left.index - right.index);
  return matches[0]?.count ?? 0;
}

function groupedPromptImageCount(prompt: string) {
  const normalized = normalizeFullWidthDigits(prompt);
  const indexes = new Set<number>();
  const groupPattern = /(?:^|[\r\n])\s*(?:图|图片|画面|海报|image|picture|photo)\s*([0-9〇零一二两三四五六七八九十]+)(?=\s*[:：、,.，]|\s+)/gim;
  for (const match of normalized.matchAll(groupPattern)) {
    const index = numberTokenValue(match[1] ?? "");
    if (index > 0 && index <= MAX_IMAGE_COUNT) indexes.add(index);
  }
  if (indexes.size >= 2 && indexes.has(1)) return Math.max(...indexes);

  if (!/(?:分别|依次|逐张|逐图|separately|one\s+by\s+one)/i.test(normalized)) return 0;
  const numberedIndexes = new Set<number>();
  const numberedPattern = /(?:^|[\r\n])\s*([0-9〇零一二两三四五六七八九十]+)\s*[.、:：]\s*\S/gm;
  for (const match of normalized.matchAll(numberedPattern)) {
    const index = numberTokenValue(match[1] ?? "");
    if (index > 0 && index <= MAX_IMAGE_COUNT) numberedIndexes.add(index);
  }
  return numberedIndexes.size >= 2 && numberedIndexes.has(1) ? Math.max(...numberedIndexes) : 0;
}

function requestsUnspecifiedMultipleImages(prompt: string) {
  const pattern = /(?:多张|多幅|多图|若干张|几张)\s*(?:图片|图像|图|照片|相片|海报|插图)?|一组\s*(?:图片|图像|图|照片|相片|海报|插图)|\b(?:multiple|several|various)\s+(?:images?|pictures?|photos?|illustrations?|renders?|posters?)\b|\ba\s+series\s+of\s+(?:images?|pictures?|photos?|illustrations?|renders?|posters?)\b/gi;
  for (const match of prompt.matchAll(pattern)) {
    const index = match.index ?? 0;
    const before = prompt.slice(Math.max(0, index - 24), index);
    const after = prompt.slice(index, index + 48);
    if (/(?:生成|制作|创建|输出|绘制|画|做|给我|想要|需要|请|generate|create|make|render|produce|output|want|need)\s*[^，,。；;\n]{0,12}$/i.test(before)) {
      return true;
    }
    if (!prompt.slice(0, index).trim() && !/(?:参考|素材|输入|作为参考|references?|source\s+images?)/i.test(after)) {
      return true;
    }
  }
  return false;
}

export function resolvePromptImageCount(prompt: string, selectedCount: unknown) {
  const selected = resolveSelectedImageCount(selectedCount);
  const explicitCount = firstExplicitImageCount(prompt);
  if (explicitCount > 0) return resolveSelectedImageCount(explicitCount);
  const groupedCount = groupedPromptImageCount(prompt);
  if (groupedCount > 0) return resolveSelectedImageCount(groupedCount);
  if (requestsUnspecifiedMultipleImages(prompt)) return selected > 1 ? selected : 2;
  return selected;
}
