const IMAGE_BASE64_KEYS = new Set(["b64_json", "base64", "image_base64"]);
const IMAGE_BASE64_PREFIX = /^data:image\/[a-z0-9.+-]+;base64,/i;
const RESPONSE_ERROR_KEYS = new Set([
  "cause",
  "detail",
  "details",
  "description",
  "error",
  "error_message",
  "failure_reason",
  "incomplete_details",
  "last_error",
  "message",
  "reason",
  "status_message",
  "user_message"
]);
const ERROR_LIKE_KEYS = new Set([
  "error",
  "errors",
  "failed",
  "failure",
  "failure_reason",
  "incomplete_details",
  "last_error"
]);
const ERROR_LIKE_STATUS_PATTERN = /error|fail|failed|failure|incomplete|cancel|cancelled|refus|denied|blocked/i;
const GENERIC_RESPONSE_ERROR_TEXT = new Set([
  "blocked",
  "cancel",
  "cancelled",
  "denied",
  "error",
  "fail",
  "failed",
  "failure",
  "incomplete",
  "refused"
]);

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

function normalizeResponseErrorText(value: unknown) {
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function responseErrorObjectText(record: Record<string, unknown>) {
  const directParts: string[] = [];
  for (const key of RESPONSE_ERROR_KEYS) {
    const value = record[key];
    const text = normalizeResponseErrorText(value);
    if (text) directParts.push(text);
  }
  if (directParts.length > 0) return directParts.join("；");

  const code = normalizeResponseErrorText(record.code);
  if (code) return code;
  const status = normalizeResponseErrorText(record.status);
  if (ERROR_LIKE_STATUS_PATTERN.test(status)) return status;
  const type = normalizeResponseErrorText(record.type);
  return ERROR_LIKE_STATUS_PATTERN.test(type) ? type : "";
}

function pushUnique(parts: string[], value: unknown) {
  const text = normalizeResponseErrorText(value);
  if (!text || looksLikeImageBase64(text)) return;
  const normalized = text.slice(0, 500);
  if (!parts.includes(normalized)) parts.push(normalized);
}

function collectResponseErrorDetails(value: unknown, parts: string[], key = "", depth = 0) {
  if (parts.length >= 6 || depth > 8 || value == null) return;

  if (typeof value === "string") {
    if (ERROR_LIKE_KEYS.has(key)) pushUnique(parts, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectResponseErrorDetails(item, parts, key, depth + 1);
    return;
  }

  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const type = normalizeResponseErrorText(record.type);
  const status = normalizeResponseErrorText(record.status);
  const objectLooksLikeError =
    ERROR_LIKE_KEYS.has(key) ||
    ERROR_LIKE_STATUS_PATTERN.test(type) ||
    ERROR_LIKE_STATUS_PATTERN.test(status) ||
    Object.keys(record).some((entryKey) => ERROR_LIKE_KEYS.has(entryKey));

  if (objectLooksLikeError) {
    pushUnique(parts, responseErrorObjectText(record));
  }

  for (const [entryKey, entryValue] of Object.entries(record)) {
    if (RESPONSE_ERROR_KEYS.has(entryKey) || ERROR_LIKE_KEYS.has(entryKey)) {
      const directText = normalizeResponseErrorText(entryValue);
      if (directText) pushUnique(parts, directText);
    }
    collectResponseErrorDetails(entryValue, parts, entryKey, depth + 1);
  }
}

function collectResponseOutputTextDetails(value: unknown, parts: string[], depth = 0) {
  if (parts.length >= 3 || depth > 8 || value == null) return;

  if (Array.isArray(value)) {
    for (const item of value) collectResponseOutputTextDetails(item, parts, depth + 1);
    return;
  }

  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const type = normalizeResponseErrorText(record.type);
  if (type === "output_text" || type === "response.output_text.done") {
    pushUnique(parts, record.text);
  }

  for (const entryValue of Object.values(record)) {
    collectResponseOutputTextDetails(entryValue, parts, depth + 1);
  }
}

export function providerResponseErrorDetail(responseJson: unknown) {
  const parts: string[] = [];
  collectResponseErrorDetails(responseJson, parts);
  const specificParts = parts.filter((part) => !GENERIC_RESPONSE_ERROR_TEXT.has(part.toLowerCase()));
  if (specificParts.length > 0) return specificParts.join("；").slice(0, 800);

  const outputTextParts: string[] = [];
  collectResponseOutputTextDetails(responseJson, outputTextParts);
  if (outputTextParts.length > 0) return outputTextParts.join("；").slice(0, 800);

  return parts.join("；").slice(0, 800);
}
