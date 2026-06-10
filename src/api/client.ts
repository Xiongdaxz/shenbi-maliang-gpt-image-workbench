const API_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function parseResponseBody(text: string) {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

function responseErrorMessage(data: unknown, fallback: string) {
  if (typeof data === "string" && data.trim()) return data.trim();
  if (data && typeof data === "object") {
    const error = (data as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) return error.trim();
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    const message = (data as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return fallback;
}

function mergeAbortSignals(signals: Array<AbortSignal | null | undefined>) {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 1) return { signal: activeSignals[0], cleanup: () => undefined };

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const signal of activeSignals) signal.removeEventListener("abort", abort);
    }
  };
}

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const timeoutController = new AbortController();
  const { signal, cleanup } = mergeAbortSignals([init.signal, timeoutController.signal]);
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, API_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      credentials: "include",
      ...init,
      signal,
      headers: {
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(init.headers ?? {})
      }
    });
    const text = await response.text();
    const data = parseResponseBody(text);
    if (!response.ok) {
      const message = responseErrorMessage(data, response.statusText || "请求失败");
      throw new ApiError(message, response.status);
    }
    if (typeof data === "string") throw new ApiError("接口返回数据格式不正确", response.status || 500);
    return data as T;
  } catch (error) {
    if (timedOut) throw new ApiError("请求超时，请重新生成", 408);
    throw error;
  } finally {
    clearTimeout(timeoutId);
    cleanup();
  }
}
