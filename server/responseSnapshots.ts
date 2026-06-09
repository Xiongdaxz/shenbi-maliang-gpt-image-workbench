const IMAGE_BASE64_KEYS = new Set(["b64_json", "base64", "image_base64"]);
const IMAGE_BASE64_PREFIX = /^data:image\/[a-z0-9.+-]+;base64,/i;

function base64Placeholder(value: string) {
  const mimeType = value.match(/^data:(image\/[a-z0-9.+-]+);base64,/i)?.[1] ?? "image/*";
  const clean = value.replace(IMAGE_BASE64_PREFIX, "");
  return `[image base64 omitted: ${mimeType}, ${clean.length} chars]`;
}

function looksLikeImageBase64(value: string) {
  const clean = value.replace(IMAGE_BASE64_PREFIX, "");
  return (
    value.startsWith("data:image/") ||
    clean.startsWith("iVBORw0KGgo") ||
    clean.startsWith("/9j/") ||
    clean.startsWith("UklGR")
  );
}

function sanitizeValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (IMAGE_BASE64_KEYS.has(key) || looksLikeImageBase64(value)) {
      return base64Placeholder(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryValue, entryKey)
      ])
    );
  }
  return value;
}

export function providerResponseSnapshot(responseJson: unknown) {
  return JSON.stringify(sanitizeValue(responseJson));
}
