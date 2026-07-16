import { IMAGE_JOB_RUNNING_TIMEOUT_MS, PROVIDER_REQUEST_TIMEOUT_ERROR } from "./constants";
import { proxySettings, shouldUseProxy } from "./settingsStore";
import type { ProviderRow } from "./types";

type ProxyRequestInit = RequestInit & { proxy?: string };

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

async function fetchWithConfiguredRetry(input: RequestInfo | URL, init: RequestInit, useProxy: boolean) {
  const settings = proxySettings();
  const finalInit = { ...init } as ProxyRequestInit;
  if (useProxy) finalInit.proxy = settings.url;
  const retryCount = useProxy ? settings.retryCount : 0;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await fetch(input, finalInit);
    } catch (error) {
      lastError = error;
      if (!useProxy || finalInit.signal?.aborted || attempt >= retryCount) throw error;
      await retryDelay(attempt);
    }
  }
  throw lastError;
}

export async function providerFetch(provider: ProviderRow, input: RequestInfo | URL, init: RequestInit) {
  return fetchWithConfiguredRetry(input, init, shouldUseProxy(provider));
}

export async function proxyFetch(input: RequestInfo | URL, init: RequestInit) {
  const settings = proxySettings();
  return fetchWithConfiguredRetry(input, init, Boolean(settings.enabled && settings.url));
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
