import { IMAGE_JOB_RUNNING_TIMEOUT_MS, PROVIDER_REQUEST_TIMEOUT_ERROR } from "./constants";
import { ImageRequestError } from "./imageRequestErrors";
import { proxySettings, shouldUseProxy } from "./settingsStore";
import type { ProviderRow } from "./types";

type ProxyRequestInit = RequestInit & { proxy?: string };
export type ProviderFetchPolicy = { boundCodexOAuth?: boolean };
type ConfiguredFetchPolicy = ProviderFetchPolicy & { retryOverride?: number };

function boundCodexOAuthTarget(input: RequestInfo | URL) {
  let url: URL | undefined;
  try {
    url = new URL(input instanceof Request ? input.url : input);
  } catch { /* An invalid URL must not be used with a bound credential. */ }
  if (!url || url.protocol !== "https:" || url.origin !== "https://chatgpt.com" || url.username || url.password) {
    throw new ImageRequestError("绑定的 ChatGPT OAuth 凭据仅允许发往 https://chatgpt.com，请检查渠道服务地址和接口路径", false);
  }
  return input instanceof Request ? input : url;
}

function providerApiKey(provider: ProviderRow) {
  return provider.api_key_value || (provider.api_key_env ? Bun.env[provider.api_key_env] : "");
}

export function providerHeaders(provider: ProviderRow, contentType = "application/json", accept = "application/json") {
  const apiKey = providerApiKey(provider);
  const headers: Record<string, string> = {
    Accept: accept
  };
  if (contentType) headers["Content-Type"] = contentType;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (provider.channel === "chatgpt_web") {
    headers["Accept-Language"] = "en-US,en;q=0.9";
    headers.Origin = "https://chatgpt.com";
    headers.Referer = "https://chatgpt.com/";
    headers["User-Agent"] =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
    if (provider.web_account_id) headers["Chatgpt-Account-Id"] = provider.web_account_id;
    if (provider.web_cookies) headers.Cookie = provider.web_cookies;
  }
  return headers;
}

function retryDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.min(1500, 300 * (attempt + 1))));
}

async function fetchWithConfiguredRetry(input: RequestInfo | URL, init: RequestInit, useProxy: boolean, policy: ConfiguredFetchPolicy = {}) {
  const target = policy.boundCodexOAuth ? boundCodexOAuthTarget(input) : input;
  const settings = proxySettings();
  const finalInit = { ...init } as ProxyRequestInit;
  if (policy.boundCodexOAuth) finalInit.redirect = "error";
  if (useProxy) finalInit.proxy = settings.url;
  const retryCount = policy.retryOverride ?? (useProxy ? settings.retryCount : 0);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await fetch(target, finalInit);
    } catch (error) {
      lastError = error;
      if (!useProxy || finalInit.signal?.aborted || attempt >= retryCount) throw error;
      await retryDelay(attempt);
    }
  }
  throw lastError;
}

export async function providerFetch(provider: ProviderRow, input: RequestInfo | URL, init: RequestInit, policy?: ProviderFetchPolicy) {
  return fetchWithConfiguredRetry(input, init, shouldUseProxy(provider), policy);
}

function imageDownloadTarget(input: string | URL) {
  const url = new URL(input);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("图片下载地址必须为不含登录信息的 HTTP 或 HTTPS 地址");
  }
  return url;
}

export async function providerImageDownload(provider: ProviderRow, input: string | URL, signal?: AbortSignal) {
  let target = imageDownloadTarget(input);
  let credentialOrigin = "";
  try { credentialOrigin = imageDownloadTarget(provider.base_url).origin; } catch { /* An invalid provider origin cannot receive credentials. */ }
  for (let redirects = 0; ; redirects += 1) {
    const response = await providerFetch(provider, target, {
      method: "GET",
      headers: target.origin === credentialOrigin ? providerHeaders(provider, "", "image/*") : { Accept: "image/*" },
      redirect: "manual",
      credentials: "omit",
      signal
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    await response.body?.cancel();
    if (redirects >= 5) throw new Error("图片下载重定向次数过多");
    target = imageDownloadTarget(new URL(location, target));
  }
}

// A lost image response does not prove the request was rejected; do not replay its POST in the proxy layer.
export async function providerFetchOnce(provider: ProviderRow, input: RequestInfo | URL, init: RequestInit, policy?: ProviderFetchPolicy) {
  return fetchWithConfiguredRetry(input, init, shouldUseProxy(provider), { ...policy, retryOverride: 0 });
}

export async function proxyFetch(input: RequestInfo | URL, init: RequestInit, policy?: ProviderFetchPolicy) {
  const settings = proxySettings();
  return fetchWithConfiguredRetry(input, init, Boolean(settings.enabled && settings.url), policy);
}

function mergeAbortSignals(signals: AbortSignal[]) {
  if (signals.length === 1) return { signal: signals[0], cleanup: () => undefined };
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const signal of signals) signal.removeEventListener("abort", abort);
    }
  };
}

export async function withProviderRequestTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, externalSignal?: AbortSignal) {
  const timeoutController = new AbortController();
  const { signal, cleanup } = mergeAbortSignals([timeoutController.signal, ...(externalSignal ? [externalSignal] : [])]);
  const timeoutId = setTimeout(() => timeoutController.abort(), IMAGE_JOB_RUNNING_TIMEOUT_MS);
  try {
    return await operation(signal);
  } catch (error) {
    if (timeoutController.signal.aborted) throw new Error(PROVIDER_REQUEST_TIMEOUT_ERROR);
    throw error;
  } finally {
    clearTimeout(timeoutId);
    cleanup();
  }
}
