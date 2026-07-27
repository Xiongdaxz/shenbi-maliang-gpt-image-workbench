const STANDARD_STARTER_COPY_REQUEST_TIMEOUT_MS = 60 * 1000;
const THINKING_STARTER_COPY_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

type StarterCopyThinkingProvider = {
  name?: unknown;
  base_url?: unknown;
  endpoint_path?: unknown;
  model?: unknown;
  thinking_enabled?: number | null;
};

export function starterCopyThinkingMode(provider: StarterCopyThinkingProvider) {
  const isDeepSeek = [provider.name, provider.base_url, provider.endpoint_path, provider.model]
    .some((value) => String(value ?? "").toLowerCase().includes("deepseek"));
  if (!isDeepSeek) return null;
  return Number(provider.thinking_enabled ?? 1) !== 0 ? "enabled" : "disabled";
}

export function starterCopyRequestTimeoutMs(thinkingEnabled: boolean) {
  return thinkingEnabled
    ? THINKING_STARTER_COPY_REQUEST_TIMEOUT_MS
    : STANDARD_STARTER_COPY_REQUEST_TIMEOUT_MS;
}

export function starterCopyRequestError(error: unknown, timedOut: boolean, timeoutMs: number) {
  if (!timedOut) return error;
  return new Error(`每日文案模型请求超时（已等待 ${Math.round(timeoutMs / 1000)} 秒），请稍后重试`);
}
