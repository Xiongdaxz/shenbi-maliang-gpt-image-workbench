export const APP_COOKIE = "app_session";
export const CONFIG_COOKIE = "config_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
export const IMAGE_JOB_RUNNING_TIMEOUT_MS = 30 * 60 * 1000;
export const IMAGE_JOB_TIMEOUT_ERROR = "任务已超时，请重新生成";
export const PROVIDER_REQUEST_TIMEOUT_ERROR = "图片接口请求超时，请重新生成";
export const DEFAULT_RESPONSES_MODEL = "gpt-5.5";
export const CPA_RESPONSES_MODEL_FALLBACK = "gpt-5.4-mini";
export const DEFAULT_IMAGE_MODEL = "gpt-image-2";
export const DEFAULT_REQUEST_SIZE = "auto";
export const DEFAULT_IMAGE_RESULT_RETRY_COUNT = 1;
export const DEFAULT_IMAGE_SIZES = ["1024x1024", "1536x2048", "1152x2048", "2048x1536", "2048x1152"];
export const DEFAULT_IMAGE_QUALITIES = ["low", "medium", "high"];
export const LOGIN_ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
export const AUTO_PROVIDER_ID = "auto";
export const STUDIO_BACKEND_BASE_URL = "https://chatgpt.com/backend-api";
export const STUDIO_CODEX_USER_AGENT =
  "codex-tui/0.118.0 (Mac OS 26.3.1; arm64) iTerm.app/3.6.9 (codex-tui; 0.118.0)";
export const STUDIO_LEGACY_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

export function requestImageSize(value: unknown) {
  const size = String(value ?? "").trim();
  return size || DEFAULT_REQUEST_SIZE;
}

export function requestImageCount(value: unknown) {
  const count = Number.parseInt(String(value ?? "1"), 10);
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(10, count));
}

export function requestImageResultRetryCount(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const count = Number.parseInt(text, 10);
  if (!Number.isFinite(count)) return null;
  return Math.max(0, Math.min(10, count));
}

export function resolveImageResultRetryCount(value: unknown) {
  return requestImageResultRetryCount(value) ?? 0;
}
