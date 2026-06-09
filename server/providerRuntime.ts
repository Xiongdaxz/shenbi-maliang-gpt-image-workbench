import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { request as httpsRequest } from "node:https";
import {
  AUTO_PROVIDER_ID,
  CPA_RESPONSES_MODEL_FALLBACK,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_RESPONSES_MODEL,
  IMAGE_JOB_RUNNING_TIMEOUT_MS,
  PROVIDER_REQUEST_TIMEOUT_ERROR,
  STUDIO_BACKEND_BASE_URL,
  STUDIO_CODEX_USER_AGENT,
  STUDIO_LEGACY_USER_AGENT
} from "./constants";
import { logProviderRequest } from "./auditLog";
import { configDb, getAll, getOne, run } from "./db";
import { readImageDimensions } from "./imageDimensions";
import { ROOT } from "./paths";
import { providerFetch, providerHeaders, proxyFetch, withProviderRequestTimeout } from "./providerHttp";
import { cpaAccount, imageGenerationSettings, proxySettings } from "./settingsStore";
import type {
  CpaRemoteAuthFile,
  ImageAccountRow,
  ImageGenerationSettings,
  ProviderRow,
  RuntimeProviderRow
} from "./types";
import {
  inferChannelFromType,
  extractAuthJsonMeta,
  makeId,
  normalizeIdList,
  normalizeImageGenerationMode,
  normalizeImageAccountStatus,
  normalizePath,
  normalizeProviderChannel,
  normalizeQuotaMode,
  normalizeRouteMode,
  normalizeWebAccountMode,
  now,
  safeJson
} from "./utils";

type ProviderRequestContext = {
  userId?: string;
  jobId?: string;
  attemptNo?: number;
  maxAttempts?: number;
  isRetry?: boolean;
};

function providerRequestLogContext(context: ProviderRequestContext) {
  return {
    userId: context.userId,
    jobId: context.jobId,
    attemptNo: context.attemptNo,
    maxAttempts: context.maxAttempts,
    isRetry: context.isRetry
  };
}

function providerMatchesImageMode(provider: RuntimeProviderRow, settings = imageGenerationSettings()) {
  const mode = normalizeImageGenerationMode(settings.mode);
  if (mode === "auto") return true;
  return normalizeProviderChannel(provider.channel || inferChannelFromType(provider.type)) === mode;
}

export function shouldRequestOpenAiCompatibleBase64(provider: RuntimeProviderRow) {
  const channel = normalizeProviderChannel(provider.channel || inferChannelFromType(provider.type));
  return channel !== "chatgpt_web";
}

function imageModeLabel(mode: ImageGenerationSettings["mode"]) {
  if (mode === "cpa") return "CPA 渠道模式";
  if (mode === "chatgpt_web") return "官网模式";
  if (mode === "api") return "API 模式";
  return "自动选择模式";
}

function providerChannelSort(provider: RuntimeProviderRow) {
  const channel = normalizeProviderChannel(provider.channel || inferChannelFromType(provider.type));
  if (channel === "cpa") return 0;
  if (channel === "chatgpt_web") return 1;
  return 2;
}

function sortProvidersForRuntime(providers: RuntimeProviderRow[]) {
  return [...providers].sort((left, right) => {
    const channelOrder = providerChannelSort(left) - providerChannelSort(right);
    if (channelOrder !== 0) return channelOrder;
    return String(left.created_at).localeCompare(String(right.created_at));
  });
}

function enabledProviderRows() {
  return getAll<ProviderRow>(
    configDb,
    "select * from provider_configs where enabled = 1 order by created_at asc"
  );
}

export function enabledProvidersForCurrentMode() {
  const settings = imageGenerationSettings();
  return sortProvidersForRuntime(enabledProviderRows().filter((provider) => providerMatchesImageMode(provider, settings)));
}

export function providerChainById(id?: string) {
  const settings = imageGenerationSettings();
  const normalizedId = String(id ?? "").trim();
  const rows = enabledProvidersForCurrentMode();
  if (!normalizedId || normalizedId === AUTO_PROVIDER_ID) {
    if (rows.length === 0) throw new Error(`当前${imageModeLabel(settings.mode)}下没有可用的渠道配置`);
    return rows;
  }

  const row = rows.find((provider) => provider.id === normalizedId) ?? null;
  if (!row) throw new Error(`当前${imageModeLabel(settings.mode)}不能使用该渠道`);
  return [row];
}

export function providerById(id?: string) {
  return providerChainById(id)[0];
}

function cpaProviderId() {
  return getOne<{ id: string }>(
    configDb,
    "select id from provider_configs where channel = ? and enabled = 1 order by created_at asc limit 1",
    "cpa"
  )?.id ?? "";
}

function cpaManagementBaseUrl(value: string) {
  const trimmed = String(value ?? "").trim().replace(/\/+$/, "");
  const marker = "/v0/management/auth-files";
  const index = trimmed.indexOf(marker);
  return index >= 0 ? trimmed.slice(0, index).replace(/\/+$/, "") : trimmed;
}

function cpaManagementUrl(baseUrl: string, pathName: string) {
  return `${cpaManagementBaseUrl(baseUrl)}${pathName}`;
}

function decodeChunkedBody(body: Buffer) {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < body.length) {
    const lineEnd = body.indexOf("\r\n", offset);
    if (lineEnd < 0) break;
    const sizeText = body.subarray(offset, lineEnd).toString("ascii").split(";")[0]?.trim() ?? "";
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) break;
    offset = lineEnd + 2;
    if (size <= 0) break;
    if (offset + size > body.length) break;
    chunks.push(body.subarray(offset, offset + size));
    offset += size + 2;
  }
  return Buffer.concat(chunks);
}

function parseRawHttpResponse(chunks: Buffer[]) {
  const raw = Buffer.concat(chunks);
  const separator = Buffer.from("\r\n\r\n");
  const separatorIndex = raw.indexOf(separator);
  const headBuffer = separatorIndex >= 0 ? raw.subarray(0, separatorIndex) : raw;
  const bodyBuffer = separatorIndex >= 0 ? raw.subarray(separatorIndex + separator.length) : Buffer.alloc(0);
  const head = headBuffer.toString("latin1");
  const statusLine = head.split(/\r?\n/)[0] ?? "";
  const match = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)\s*(.*)$/);
  const body = /transfer-encoding:\s*chunked/i.test(head) ? decodeChunkedBody(bodyBuffer) : bodyBuffer;
  return {
    status: match ? Number(match[1]) : 0,
    statusText: match?.[2] ?? "",
    text: body.toString("utf8")
  };
}

function requestCpaManagement(endpoint: string, managementKey: string) {
  return new Promise<{ status: number; statusText: string; text: string }>((resolve, reject) => {
    const url = new URL(endpoint);
    if (url.protocol === "http:") {
      const chunks: Buffer[] = [];
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("CPA 管理接口请求超时"));
      }, 20000);
      void Bun.connect({
        hostname: url.hostname,
        port: Number(url.port || 80),
        socket: {
          open(socket) {
            const pathWithSearch = `${url.pathname || "/"}${url.search}`;
            socket.write(
              [
                `GET ${pathWithSearch} HTTP/1.1`,
                `Host: ${url.host}`,
                "Accept: application/json",
                `Authorization: Bearer ${managementKey}`,
                "Connection: close",
                "",
                ""
              ].join("\r\n")
            );
          },
          data(_socket, data) {
            chunks.push(Buffer.from(data));
          },
          close() {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(parseRawHttpResponse(chunks));
          },
          error(_socket, error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        }
      }).catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      return;
    }

    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${managementKey}`
        },
        timeout: 20000
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            text: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("CPA 管理接口请求超时")));
    request.on("error", reject);
    request.end();
  });
}

function cpaManagementKey(account: ReturnType<typeof cpaAccount>) {
  return String(account.passwordSecret || "").trim();
}

type CodexUsageSnapshot = {
  ok: boolean;
  planType: string;
  fiveHourUsedPercent: number | null;
  fiveHourResetAt: string;
  weekUsedPercent: number | null;
  weekResetAt: string;
  windows: Array<{
    label: string;
    usedPercent: number | null;
    resetAt: string;
  }>;
  creditsBalance: string;
  creditsUnlimited: boolean;
  error: string;
};

function recordValue(source: unknown, key: string) {
  return source && typeof source === "object" ? (source as Record<string, unknown>)[key] : undefined;
}

function objectAtPath(source: unknown, path: string[]) {
  let current = source;
  for (const key of path) {
    current = recordValue(current, key);
    if (!current || typeof current !== "object") return null;
  }
  return current as Record<string, unknown>;
}

function firstObjectAtPath(source: unknown, paths: string[][]) {
  for (const path of paths) {
    const found = objectAtPath(source, path);
    if (found) return found;
  }
  return null;
}

function firstNumberFromObject(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
}

function firstNumberEntryFromObject(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(numberValue)) return { key, value: numberValue };
  }
  return null;
}

function firstStringFromObject(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") return "";
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function normalizeUsagePercent(value: number | null, key = "") {
  if (value === null || !Number.isFinite(value)) return null;
  const normalizedKey = key.toLowerCase();
  const isExplicitPercent = normalizedKey.includes("percent") || normalizedKey.includes("percentage");
  const percent = !isExplicitPercent && value > 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
}

function normalizeResetAt(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return "";
}

function usageWindowSnapshot(window: Record<string, unknown> | null) {
  if (!window) return { usedPercent: null, resetAt: "" };
  const usedPercentEntry = firstNumberEntryFromObject(window, [
    "used_percent",
    "usage_percent",
    "percent_used",
    "utilization_percent",
    "usedPercentage",
    "percentage",
    "percent",
    "used"
  ]);
  const usedPercent = normalizeUsagePercent(usedPercentEntry?.value ?? null, usedPercentEntry?.key);
  const resetCandidate = ["resets_at", "reset_at", "resetAt", "resetsAt", "window_end"]
    .map((key) => window[key])
    .find((value) => typeof value === "string" || typeof value === "number");
  const resetAfterSeconds = firstNumberFromObject(window, ["resets_in_seconds", "reset_after_seconds", "reset_seconds"]);
  const resetAt = normalizeResetAt(resetCandidate) || (resetAfterSeconds ? new Date(Date.now() + resetAfterSeconds * 1000).toISOString() : "");
  return { usedPercent, resetAt };
}

function usageWindowPeriodFromText(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("5 小时") || normalized.includes("5小时") || normalized.includes("5h") || normalized.includes("five")) {
    return "5 小时限额";
  }
  if (normalized.includes("week") || normalized.includes("weekly") || normalized.includes("7d") || normalized.includes("周")) {
    return "周限额";
  }
  return "";
}

function usageWindowPeriodFromSeconds(value: unknown) {
  const seconds = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(seconds)) return "";
  if (seconds <= 18_000) return "5 小时限额";
  if (seconds >= 604_800) return "周限额";
  return "";
}

function formatUsageModelLabel(value: string) {
  return value
    .trim()
    .replace(/_/g, "-")
    .split("-")
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "gpt") return "GPT";
      if (lower === "codex") return "Codex";
      if (lower === "spark") return "Spark";
      return part;
    })
    .join("-");
}

function namedRateLimitWindows(source: unknown) {
  if (!Array.isArray(source)) return [];
  return source.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const limitName = firstStringFromObject(record, ["limit_name", "limitName", "name", "label", "display_name", "displayName"]);
    const rateLimit = recordValue(record, "rate_limit");
    if (!limitName || !rateLimit || typeof rateLimit !== "object" || Array.isArray(rateLimit)) return [];
    const result: Array<{ label: string; usedPercent: number | null; resetAt: string }> = [];
    for (const [key, value] of Object.entries(rateLimit as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const window = value as Record<string, unknown>;
      const snapshot = usageWindowSnapshot(window);
      if (snapshot.usedPercent === null && !snapshot.resetAt) continue;
      const period =
        usageWindowPeriodFromText(key) ||
        usageWindowPeriodFromSeconds(window.limit_window_seconds) ||
        usageWindowPeriodFromText(firstStringFromObject(window, ["window", "window_type", "windowType", "bucket", "duration", "period", "limit_type", "limitType", "type"])) ||
        "限额";
      result.push({
        label: `${formatUsageModelLabel(limitName)} ${period}`,
        ...snapshot
      });
    }
    return result;
  });
}

function usageWindowLabel(window: Record<string, unknown>, path: string[]) {
  const direct = firstStringFromObject(window, [
    "label",
    "name",
    "display_name",
    "displayName",
    "title",
    "description"
  ]);
  const model =
    firstStringFromObject(window, ["model", "model_name", "modelName", "model_slug", "modelSlug", "slug"]) ||
    path.find((part) => /gpt|codex.*spark|spark/i.test(part)) ||
    "";
  const period =
    usageWindowPeriodFromText(direct) ||
    usageWindowPeriodFromSeconds(window.limit_window_seconds) ||
    usageWindowPeriodFromText(firstStringFromObject(window, ["window", "window_type", "windowType", "bucket", "duration", "period", "limit_type", "limitType", "type"])) ||
    usageWindowPeriodFromText(path.join(" "));
  if (direct && (direct.includes("限额") || /gpt|codex|spark|week|weekly|5h|5 小时|5小时/i.test(direct))) {
    return direct.replace(/\s+/g, " ").trim();
  }
  if (model) return `${formatUsageModelLabel(model)} ${period || "限额"}`.trim();
  return period;
}

function looksLikeUsageWindow(window: Record<string, unknown>, path: string[]) {
  const snapshot = usageWindowSnapshot(window);
  if (snapshot.usedPercent === null && !snapshot.resetAt) return false;
  if (usageWindowLabel(window, path)) return true;
  return path.some((part) => /window|limit|usage|quota|5h|week|weekly/i.test(part));
}

function collectUsageWindows(source: unknown, path: string[] = []): Array<{ label: string; usedPercent: number | null; resetAt: string }> {
  if (Array.isArray(source)) {
    return source.flatMap((item) => collectUsageWindows(item, path));
  }
  if (!source || typeof source !== "object") return [];
  const record = source as Record<string, unknown>;
  const found: Array<{ label: string; usedPercent: number | null; resetAt: string }> = [];
  if (looksLikeUsageWindow(record, path)) {
    const snapshot = usageWindowSnapshot(record);
    const label = usageWindowLabel(record, path);
    if (label) found.push({ label, ...snapshot });
  }
  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === "object") {
      found.push(...collectUsageWindows(value, [...path, key]));
    }
  }
  return found;
}

function dedupeUsageWindows(windows: Array<{ label: string; usedPercent: number | null; resetAt: string }>) {
  const seen = new Set<string>();
  const normalized: Array<{ label: string; usedPercent: number | null; resetAt: string }> = [];
  for (const window of windows) {
    const label = window.label.replace(/\s+/g, " ").trim();
    if (!label || (window.usedPercent === null && !window.resetAt)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      label,
      usedPercent: window.usedPercent,
      resetAt: window.resetAt
    });
  }
  return normalized.slice(0, 12);
}

function parseCodexUsagePayload(payload: unknown): CodexUsageSnapshot {
  const usage = recordValue(payload, "usage") ?? payload;
  const primaryWindow = firstObjectAtPath(usage, [
    ["primary_window"],
    ["five_hour_window"],
    ["five_hour"],
    ["5h"],
    ["rate_limit", "primary_window"],
    ["rate_limit", "five_hour_window"],
    ["limits", "primary_window"],
    ["limits", "five_hour_window"]
  ]);
  const secondaryWindow = firstObjectAtPath(usage, [
    ["secondary_window"],
    ["weekly_window"],
    ["week_window"],
    ["weekly"],
    ["week"],
    ["7d"],
    ["rate_limit", "secondary_window"],
    ["rate_limit", "weekly_window"],
    ["limits", "secondary_window"],
    ["limits", "weekly_window"]
  ]);
  const credits =
    firstObjectAtPath(usage, [["credits"], ["credit"], ["limits", "credits"]]) ??
    firstObjectAtPath(payload, [["credits"], ["credit"]]);
  const fiveHour = usageWindowSnapshot(primaryWindow);
  const week = usageWindowSnapshot(secondaryWindow);
  const windows = dedupeUsageWindows([
    ...(fiveHour.usedPercent !== null || fiveHour.resetAt ? [{ label: "5 小时限额", ...fiveHour }] : []),
    ...(week.usedPercent !== null || week.resetAt ? [{ label: "周限额", ...week }] : []),
    ...namedRateLimitWindows(recordValue(usage, "additional_rate_limits")),
    ...collectUsageWindows(usage)
  ]);
  return {
    ok: true,
    planType: firstStringFromObject(payload, ["plan_type", "planType"]) || firstStringFromObject(usage, ["plan_type", "planType"]),
    fiveHourUsedPercent: fiveHour.usedPercent,
    fiveHourResetAt: fiveHour.resetAt,
    weekUsedPercent: week.usedPercent,
    weekResetAt: week.resetAt,
    windows,
    creditsBalance:
      firstStringFromObject(credits, ["balance", "remaining", "remaining_credits", "available", "limit"]) ||
      firstStringFromObject(usage, ["credits_balance", "credit_balance"]),
    creditsUnlimited: Boolean(
      recordValue(credits, "unlimited") ??
        recordValue(credits, "has_unlimited_credits") ??
        recordValue(usage, "credits_unlimited")
    ),
    error: ""
  };
}

async function fetchCodexUsageSnapshot(accessToken: string, accountId: string): Promise<CodexUsageSnapshot> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": STUDIO_CODEX_USER_AGENT
  };
  if (accountId) headers["ChatGPT-Account-ID"] = accountId;
  const endpoints = ["/wham/usage", "/codex/usage"].map((pathName) => `${STUDIO_BACKEND_BASE_URL}${pathName}`);
  const errors: string[] = [];
  for (const endpoint of endpoints) {
    try {
      const { status, text } = await withProviderRequestTimeout(async (signal) => {
        const response = await proxyFetch(endpoint, { method: "GET", headers, signal });
        return { status: response.status, text: await response.text() };
      });
      if (status >= 200 && status < 300) {
        return parseCodexUsagePayload(safeJson(text, {}));
      }
      errors.push(`${endpoint.replace(STUDIO_BACKEND_BASE_URL, "")} ${status}: ${text.slice(0, 180)}`);
      if (status !== 404) break;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      break;
    }
  }
  return {
    ok: false,
    planType: "",
    fiveHourUsedPercent: null,
    fiveHourResetAt: "",
    weekUsedPercent: null,
    weekResetAt: "",
    windows: [],
    creditsBalance: "",
    creditsUnlimited: false,
    error: errors.join("；") || "Codex 额度查询失败"
  };
}

function remoteAuthFileDownloadNames(file: CpaRemoteAuthFile) {
  return Array.from(
    new Set(
      [file.name, file.id, file.path ? file.path.split(/[\\/]/).pop() : ""]
        .map((item) => String(item ?? "").trim())
        .filter((item) => item.toLowerCase().endsWith(".json"))
    )
  );
}

function compactJsonString(value: unknown) {
  if (!value || typeof value !== "object") return "";
  return JSON.stringify(value);
}

function authInfoJsonFromRemote(file: CpaRemoteAuthFile, authJson: string) {
  const downloaded = safeJson(authJson, {}) as Record<string, unknown>;
  const idToken =
    file.id_token && typeof file.id_token === "object"
      ? file.id_token
      : downloaded.id_token && typeof downloaded.id_token === "object"
        ? downloaded.id_token
        : null;
  const info: Record<string, unknown> = {
    account: file.account ?? downloaded.email ?? file.email ?? "",
    email: file.email ?? downloaded.email ?? file.account ?? "",
    account_type: file.account_type ?? downloaded.type ?? "",
    provider: file.provider ?? "codex",
    auth_index: file.auth_index ?? "",
    id_token: idToken ?? undefined
  };
  return compactJsonString(Object.fromEntries(Object.entries(info).filter(([, value]) => value !== "" && value !== undefined)));
}

async function downloadCpaAuthJson(file: CpaRemoteAuthFile, baseUrl: string, managementKey: string) {
  if (file.runtime_only || String(file.source ?? "").toLowerCase() === "memory") return "";
  for (const name of remoteAuthFileDownloadNames(file)) {
    const endpoint = cpaManagementUrl(baseUrl, `/v0/management/auth-files/download?name=${encodeURIComponent(name)}`);
    try {
      const response = await requestCpaManagement(endpoint, managementKey);
      if (response.status >= 200 && response.status < 300) return response.text.trim();
    } catch {
      // A non-downloadable runtime account can still be represented by management metadata.
    }
  }
  return "";
}

function remoteUsageCount(file: CpaRemoteAuthFile, keys: string[]) {
  const sources = [file, recordValue(file, "usage")];
  for (const source of sources) {
    const value = firstNumberFromObject(source, keys);
    if (value !== null) return Math.max(0, Math.round(value));
  }
  return 0;
}

function normalizeRecentUsageBuckets(value: unknown) {
  const parsedValue =
    typeof value === "string" && value.trim().startsWith("[") ? safeJson(value, []) : value;
  if (!Array.isArray(parsedValue)) return "[]";
  const buckets = parsedValue
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const bucket = String(recordValue(item, "bucket") ?? recordValue(item, "time") ?? recordValue(item, "minute") ?? "").trim();
      const label = String(recordValue(item, "label") ?? recordValue(item, "name") ?? bucket).trim();
      const success = firstNumberFromObject(item, ["success", "success_count", "ok", "count"]);
      const failure = firstNumberFromObject(item, ["failure", "failed", "failed_count", "error", "error_count"]);
      const total = firstNumberFromObject(item, ["total", "requests", "request_count"]);
      return {
        bucket,
        label,
        success: Math.max(0, Math.round(success ?? 0)),
        failure: Math.max(0, Math.round(failure ?? 0)),
        total: Math.max(0, Math.round(total ?? (success ?? 0) + (failure ?? 0)))
      };
    })
    .filter(Boolean)
    .slice(-12);
  return JSON.stringify(buckets);
}

function remoteRecentUsage(file: CpaRemoteAuthFile) {
  const usage = recordValue(file, "usage");
  return normalizeRecentUsageBuckets(
    file.recent_requests ??
      file.recent_stats ??
      recordValue(usage, "recent_requests") ??
      recordValue(usage, "recent_stats") ??
      recordValue(usage, "buckets")
  );
}

async function accountUsageSnapshot(authJson: string, accessToken: string) {
  const meta = authJson ? extractAuthJsonMeta(authJson) : { accessToken: "", accountId: "" };
  const token = accessToken || meta.accessToken;
  if (!token) {
    return {
      ok: false,
      planType: "",
      fiveHourUsedPercent: null,
      fiveHourResetAt: "",
      weekUsedPercent: null,
      weekResetAt: "",
      windows: [],
      creditsBalance: "",
      creditsUnlimited: false,
      error: "缺少 Access Token，无法查询 Codex 额度"
    };
  }
  return fetchCodexUsageSnapshot(token, meta.accountId);
}

function cpaRemoteAuthMatchesProvider(file: CpaRemoteAuthFile) {
  const values = [file.type, file.provider].map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean);
  return values.length === 0 || values.includes("codex");
}

function planLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "free") return "Free";
  if (normalized === "plus") return "Plus";
  if (normalized === "pro") return "Pro";
  if (normalized === "team") return "Team";
  if (normalized === "enterprise") return "Enterprise";
  return value.trim();
}

function inferCpaPlanType(file: CpaRemoteAuthFile) {
  const message = safeJson<{ error?: { plan_type?: string }; plan_type?: string }>(file.status_message, {});
  const candidates = [
    file.id_token?.plan_type,
    message.error?.plan_type,
    message.plan_type,
    String(file.name ?? file.id ?? "").match(/-(free|plus|pro|team|enterprise)\.json$/i)?.[1],
    file.account_type
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (!value) continue;
    if (["oauth", "codex"].includes(value.toLowerCase())) continue;
    return planLabel(value);
  }
  return "";
}

function normalizeRemoteImageAccountStatus(file: CpaRemoteAuthFile) {
  if (file.disabled || file.unavailable) return "disabled";
  const status = String(file.status ?? "").trim().toLowerCase();
  const message = String(file.status_message ?? "").toLowerCase();
  if (status === "active" || status === "normal" || status === "ok") return "normal";
  if (status === "limited" || status === "rate_limited" || message.includes("usage_limit_reached")) return "limited";
  if (status === "error" || status === "failed" || message.includes("\"error\"")) return "abnormal";
  return "normal";
}

function imageAccountStatusFromUsage(currentStatus: string, usage: CodexUsageSnapshot) {
  const normalized = normalizeImageAccountStatus(currentStatus);
  if (!usage.ok) return normalized;
  const trackedWindows = [
    ...usage.windows,
    ...(usage.fiveHourUsedPercent !== null ? [{ label: "5 小时限额", usedPercent: usage.fiveHourUsedPercent, resetAt: usage.fiveHourResetAt }] : []),
    ...(usage.weekUsedPercent !== null ? [{ label: "周限额", usedPercent: usage.weekUsedPercent, resetAt: usage.weekResetAt }] : [])
  ].filter((window) => typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent));
  if (trackedWindows.length > 0 && trackedWindows.every((window) => Number(window.usedPercent) >= 100)) {
    return "limited";
  }
  return "normal";
}

async function upsertRemoteImageAccount(file: CpaRemoteAuthFile, timestamp: string, baseUrl: string, managementKey: string) {
  const remoteName = String(file.name ?? file.id ?? "").trim();
  if (!remoteName) return "skipped";
  const email = String(file.email ?? file.account ?? "").trim();
  const existing = getOne<ImageAccountRow>(
    configDb,
    "select * from image_accounts where remote_name = ? or (? <> '' and email = ?) order by updated_at desc limit 1",
    remoteName,
    email,
    email
  );
  const displayName = String(file.label ?? "").trim() || email || remoteName;
  const accountType = inferCpaPlanType(file) || existing?.account_type || "";
  const priority = Number(file.priority ?? existing?.priority ?? 0) || 0;
  const channelId = existing?.channel_id || cpaProviderId() || null;
  const statusMessage = String(file.status_message ?? "").trim();
  const note = String(file.note ?? "").trim() || (statusMessage && statusMessage.length < 500 ? statusMessage : existing?.note ?? "");
  const downloadedAuthJson = await downloadCpaAuthJson(file, baseUrl, managementKey);
  const authJson = downloadedAuthJson || existing?.auth_json || "";
  const authInfoJson = authInfoJsonFromRemote(file, authJson) || existing?.auth_info_json || "";
  const meta = authJson ? extractAuthJsonMeta(authJson) : { accessToken: "", accountType: "", email: "", accountId: "", cookies: "" };
  const accessToken = String(file.access_token ?? "").trim() || meta.accessToken || existing?.access_token || "";
  const usage = await accountUsageSnapshot(authJson, accessToken);
  const usageSuccessCount =
    remoteUsageCount(file, ["success_count", "success", "ok_count", "total_success_count"]) ||
    existing?.usage_success_count ||
    0;
  const usageFailureCount =
    remoteUsageCount(file, ["failure_count", "failed_count", "error_count", "failed", "total_failure_count"]) ||
    existing?.usage_failure_count ||
    0;
  const usageRecentRequests = remoteRecentUsage(file);
  const resolvedAccountType = usage.planType || accountType || meta.accountType || existing?.account_type || "";
  const resolvedEmail = email || meta.email || existing?.email || "";
  const resolvedStatus = imageAccountStatusFromUsage(normalizeRemoteImageAccountStatus(file), usage);
  if (existing) {
    run(
      configDb,
      `update image_accounts set
        name = ?, remote_name = ?, channel_id = ?, email = ?, account_type = ?,
        status = ?, quota = ?, used_quota = ?, usage_success_count = ?, usage_failure_count = ?,
        usage_recent_requests = ?, codex_5h_used_percent = ?, codex_5h_reset_at = ?,
        codex_week_used_percent = ?, codex_week_reset_at = ?, codex_credits_balance = ?,
        codex_credits_unlimited = ?, codex_usage_windows = ?, codex_usage_updated_at = ?,
        codex_usage_error = ?, priority = ?, access_token = ?, auth_json = ?, auth_info_json = ?, note = ?,
        sync_status = ?, last_refreshed_at = ?, updated_at = ?
       where id = ?`,
      displayName,
      remoteName,
      channelId,
      resolvedEmail,
      resolvedAccountType,
      resolvedStatus,
      existing.quota,
      existing.used_quota,
      usageSuccessCount,
      usageFailureCount,
      usageRecentRequests,
      usage.ok ? usage.fiveHourUsedPercent : existing.codex_5h_used_percent,
      usage.ok ? usage.fiveHourResetAt : existing.codex_5h_reset_at,
      usage.ok ? usage.weekUsedPercent : existing.codex_week_used_percent,
      usage.ok ? usage.weekResetAt : existing.codex_week_reset_at,
      usage.ok ? usage.creditsBalance : existing.codex_credits_balance,
      usage.ok ? (usage.creditsUnlimited ? 1 : 0) : existing.codex_credits_unlimited,
      usage.ok ? JSON.stringify(usage.windows) : existing.codex_usage_windows,
      usage.ok ? timestamp : existing.codex_usage_updated_at,
      usage.ok ? "" : usage.error || existing.codex_usage_error,
      priority,
      accessToken,
      authJson,
      authInfoJson,
      note,
      "synced",
      timestamp,
      timestamp,
      existing.id
    );
    return "updated";
  }
  run(
    configDb,
    `insert into image_accounts (
      id, name, remote_name, channel_id, email, account_type, status, quota, used_quota,
      usage_success_count, usage_failure_count, usage_recent_requests,
      codex_5h_used_percent, codex_5h_reset_at, codex_week_used_percent, codex_week_reset_at,
      codex_credits_balance, codex_credits_unlimited, codex_usage_windows, codex_usage_updated_at,
      codex_usage_error, priority, access_token, auth_json, auth_info_json, note, sync_status, last_refreshed_at,
      created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    makeId("acct"),
    displayName,
    remoteName,
    channelId,
    resolvedEmail,
    resolvedAccountType,
    resolvedStatus,
    0,
    0,
    usageSuccessCount,
    usageFailureCount,
    usageRecentRequests,
    usage.ok ? usage.fiveHourUsedPercent : null,
    usage.ok ? usage.fiveHourResetAt : null,
    usage.ok ? usage.weekUsedPercent : null,
    usage.ok ? usage.weekResetAt : null,
    usage.ok ? usage.creditsBalance : "",
    usage.ok && usage.creditsUnlimited ? 1 : 0,
    usage.ok ? JSON.stringify(usage.windows) : "[]",
    usage.ok ? timestamp : null,
    usage.ok ? "" : usage.error,
    priority,
    accessToken,
    authJson,
    authInfoJson,
    note,
    "synced",
    timestamp,
    timestamp,
    timestamp
  );
  return "created";
}

export async function pullCpaImageAccounts(account: ReturnType<typeof cpaAccount>) {
  const baseUrl = cpaManagementBaseUrl(account.syncUrl);
  const managementKey = cpaManagementKey(account);
  if (!baseUrl || !managementKey) {
    return { ok: false, created: 0, updated: 0, skipped: 0, message: "CPA 同步未配置管理地址或访问密码" };
  }

  const endpoint = cpaManagementUrl(baseUrl, "/v0/management/auth-files");
  const response = await requestCpaManagement(endpoint, managementKey);
  const text = response.text;
  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      created: 0,
      updated: 0,
      skipped: 0,
      message: `CPA 同步失败 ${response.status}: ${text.slice(0, 300) || response.statusText}`
    };
  }

  const payload = safeJson(text, {}) as { files?: CpaRemoteAuthFile[] };
  const files = Array.isArray(payload.files) ? payload.files.filter(cpaRemoteAuthMatchesProvider) : [];
  const timestamp = now();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const file of files) {
    const result = await upsertRemoteImageAccount(file, timestamp, baseUrl, managementKey);
    if (result === "created") created += 1;
    else if (result === "updated") updated += 1;
    else skipped += 1;
  }
  return {
    ok: true,
    created,
    updated,
    skipped,
    message: `CPA 同步成功：新增 ${created} 个，更新 ${updated} 个，跳过 ${skipped} 个`
  };
}

export async function refreshImageAccountUsages(accountId?: string) {
  const rows = accountId
    ? getAll<ImageAccountRow>(configDb, "select * from image_accounts where id = ?", accountId)
    : getAll<ImageAccountRow>(
        configDb,
        "select * from image_accounts order by status asc, priority desc, updated_at desc"
      );
  const timestamp = now();
  let updated = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows) {
    const authJson = row.auth_json ?? "";
    const usage = await accountUsageSnapshot(authJson, row.access_token ?? "");
    if (usage.ok) {
      const nextStatus = imageAccountStatusFromUsage(row.status, usage);
      run(
        configDb,
        `update image_accounts set
          account_type = case when ? <> '' then ? else account_type end,
          status = ?,
          codex_5h_used_percent = ?, codex_5h_reset_at = ?,
          codex_week_used_percent = ?, codex_week_reset_at = ?,
          codex_credits_balance = ?, codex_credits_unlimited = ?,
          codex_usage_windows = ?, codex_usage_updated_at = ?,
          codex_usage_error = '', updated_at = ?
         where id = ?`,
        usage.planType,
        usage.planType,
        nextStatus,
        usage.fiveHourUsedPercent,
        usage.fiveHourResetAt,
        usage.weekUsedPercent,
        usage.weekResetAt,
        usage.creditsBalance,
        usage.creditsUnlimited ? 1 : 0,
        JSON.stringify(usage.windows),
        timestamp,
        timestamp,
        row.id
      );
      updated += 1;
    } else if (authJson || row.access_token) {
      run(
        configDb,
        "update image_accounts set codex_usage_error = ?, updated_at = ? where id = ?",
        usage.error,
        timestamp,
        row.id
      );
      failed += 1;
    } else {
      skipped += 1;
    }
  }
  return {
    ok: failed === 0,
    updated,
    failed,
    skipped,
    message: `额度刷新完成：更新 ${updated} 个，失败 ${failed} 个，跳过 ${skipped} 个`
  };
}

function responsesInputImages(payload: Record<string, unknown>) {
  const images = Array.isArray(payload.images) ? payload.images : [];
  return images
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return String((item as Record<string, unknown>).image_url ?? "");
      }
      return "";
    })
    .filter(Boolean);
}

function buildResponsesPayload(
  provider: ProviderRow,
  mode: "generation" | "edit",
  payload: Record<string, unknown>,
  stream = false,
  responsesModel?: string
) {
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: String(payload.prompt ?? "").trim()
    }
  ];
  for (const imageUrl of responsesInputImages(payload)) {
    content.push({
      type: "input_image",
      image_url: imageUrl
    });
  }

  const tool: Record<string, unknown> = {
    type: "image_generation",
    action: mode === "edit" ? "edit" : "generate",
    model: provider.model || "gpt-image-2",
    output_format: "png"
  };
  if (payload.size) tool.size = String(payload.size);
  if (payload.quality) tool.quality = String(payload.quality);
  if (payload.background) tool.background = String(payload.background);
  if (mode === "edit" && typeof payload.mask === "string" && payload.mask.trim()) {
    tool.input_image_mask = {
      image_url: payload.mask.trim()
    };
  }

  return {
    model: resolveResponsesModel(provider, responsesModel),
    input: [
      {
        type: "message",
        role: "user",
        content
      }
    ],
    tools: [tool],
    tool_choice: { type: "image_generation" },
    instructions: "",
    stream,
    reasoning: { effort: "medium", summary: "auto" },
    store: false,
    parallel_tool_calls: true,
    include: ["reasoning.encrypted_content"]
  };
}

function resolveResponsesModel(provider: ProviderRow, override?: string) {
  const explicit = String(override ?? "").trim();
  if (explicit) return explicit;
  const configured = String(provider.responses_model ?? "").trim();
  return configured || DEFAULT_RESPONSES_MODEL;
}

function collectResponsesImageData(frames: unknown[]) {
  const completed: Array<Record<string, unknown>> = [];
  const partials: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  function pushImage(target: Array<Record<string, unknown>>, value: unknown, source: Record<string, unknown>) {
    if (typeof value !== "string" || !value.trim()) return;
    const key = value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
    if (seen.has(key)) return;
    seen.add(key);
    target.push({
      b64_json: value,
      revised_prompt: String(source.revised_prompt ?? source.prompt ?? ""),
      gen_id: String(source.id ?? source.call_id ?? source.output_index ?? "")
    });
  }

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const type = String(record.type ?? "");
    const status = String(record.status ?? "");
    if (type.includes("image_generation_call")) {
      const result = record.result ?? record.b64_json ?? record.image_base64 ?? record.image;
      if (status === "completed" || status === "succeeded" || type.includes("completed") || type.includes("done")) {
        pushImage(completed, result, record);
      }
      const partial = record.partial_image_b64 ?? record.partial_image ?? record.delta;
      if (partial) pushImage(partials, partial, record);
    }
    for (const item of Object.values(record)) visit(item);
  }

  for (const frame of frames) visit(frame);
  return completed.length > 0 ? completed : partials.slice(-1);
}

function parseProviderResponse(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const frames = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s*/, "").trim())
      .filter((line) => line && line !== "[DONE]")
      .map((line) => safeJson<unknown>(line, null))
      .filter((item) => item !== null);
    const imageData = collectResponsesImageData(frames);
    if (imageData.length > 0) {
      return {
        data: imageData,
        events: frames
      };
    }
    for (let index = frames.length - 1; index >= 0; index--) {
      try {
        return {
          ...(frames[index] && typeof frames[index] === "object" && !Array.isArray(frames[index])
            ? (frames[index] as Record<string, unknown>)
            : { data: frames[index] }),
          events: frames
        };
      } catch {
        // Keep scanning earlier SSE chunks.
      }
    }
  }
  throw new Error("图片接口返回不是有效 JSON");
}

function httpErrorDetail(text: string) {
  const parsed = safeJson<any>(text, null);
  const error = parsed && typeof parsed === "object" ? parsed.error : null;
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && typeof error.message === "string"
        ? error.message
        : parsed && typeof parsed === "object" && typeof parsed.message === "string"
          ? parsed.message
          : text;
  return String(message ?? "").trim() || "接口未返回错误详情";
}

function looksLikeHtmlResponse(value: string) {
  return /^\s*<!doctype\s+html/i.test(value) || /^\s*<html[\s>]/i.test(value);
}

function providerHttpErrorMessage(status: number, text: string) {
  const detail = httpErrorDetail(text);
  if (/^\s*<!doctype\s+html/i.test(detail) || /^\s*<html[\s>]/i.test(detail)) {
    return `图片接口请求失败 ${status}: 接口返回了 HTML 页面，通常是 ChatGPT 网页防护或会话 Cookie 拦截；请检查代理/Cookie，或优先使用 Codex Responses 链路`;
  }
  return `图片接口请求失败 ${status}: ${detail.slice(0, 400)}`;
}

function chatGptWebRouteLabel(routeMode: string) {
  if (routeMode.includes("codex_responses")) return "ChatGPT 官网 Codex Responses";
  if (routeMode.includes("prepare")) return "ChatGPT 官网会话准备";
  if (routeMode.includes("conversation")) return "ChatGPT 官网会话链路";
  return "ChatGPT 官网接口";
}

function chatGptWebHttpErrorMessage(status: number, text: string, routeLabel: string) {
  const detail = httpErrorDetail(text);
  if (looksLikeHtmlResponse(detail)) {
    return `${routeLabel}返回 HTML 防护页（${status}）：通常是 ChatGPT 网页防护、代理没有生效，或首页预热拿到的会话 Cookie 不可用；官网普通额度已改走 /f/conversation，不再调用 /images/generations。可以继续使用 Codex 优先，或在渠道/账号授权 JSON 里补充浏览器 Cookie`;
  }
  return `${routeLabel}请求失败 ${status}: ${detail.slice(0, 400)}`;
}

async function executeProviderJsonRequest(
  provider: ProviderRow,
  operation: "generation" | "edit",
  routeMode: string,
  endpoint: string,
  payload: Record<string, unknown>,
  accept = "application/json",
  context: ProviderRequestContext = {}
) {
  const started = performance.now();
  let statusCode: number | null = null;
  try {
    const { response, text } = await withProviderRequestTimeout(async (signal) => {
      const response = await providerFetch(provider, endpoint, {
        method: "POST",
        headers: providerHeaders(provider, "application/json", accept),
        body: JSON.stringify(payload),
        signal
      });
      return { response, text: await response.text() };
    });

    statusCode = response.status;
    if (!response.ok) {
      throw new Error(providerHttpErrorMessage(response.status, text));
    }

    const parsed = parseProviderResponse(text);
    logProviderRequest({
      provider,
      operation,
      routeMode,
      endpoint,
      statusCode,
      durationMs: performance.now() - started,
      success: true,
      ...providerRequestLogContext(context)
    });
    return parsed;
  } catch (error) {
    logProviderRequest({
      provider,
      operation,
      routeMode,
      endpoint,
      statusCode,
      durationMs: performance.now() - started,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      ...providerRequestLogContext(context)
    });
    throw error;
  }
}

function fileFromDataUrl(dataUrl: string, fileName: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("图片数据格式不正确");
  const mimeType = match[1] || "image/png";
  const payload = match[3] ?? "";
  const buffer = match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload));
  return new File([buffer], fileName, { type: mimeType });
}

function bufferFromDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("图片数据格式不正确");
  const mimeType = match[1] || "image/png";
  const payload = match[3] ?? "";
  const buffer = match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload));
  return { mimeType, buffer };
}

function buildImageEditForm(payload: Record<string, unknown>) {
  const form = new FormData();
  const images = responsesInputImages(payload);
  if (images.length === 0) throw new Error("请选择要编辑的图片或素材");
  form.set("model", String(payload.model ?? "gpt-image-2"));
  form.set("prompt", String(payload.prompt ?? ""));
  if (payload.size) form.set("size", String(payload.size));
  if (payload.quality) form.set("quality", String(payload.quality));
  if (payload.n) form.set("n", String(payload.n));
  if (payload.response_format) form.set("response_format", String(payload.response_format));
  images.forEach((imageUrl, index) => {
    form.append("image", fileFromDataUrl(imageUrl, `image-${index + 1}.png`));
  });
  if (typeof payload.mask === "string" && payload.mask.trim()) {
    form.set("mask", fileFromDataUrl(payload.mask, "mask.png"));
  }
  if (payload.sourceReference && typeof payload.sourceReference === "object") {
    const sourceReference = payload.sourceReference as Record<string, unknown>;
    for (const [field, value] of Object.entries(sourceReference)) {
      const text = typeof value === "string" ? value.trim() : "";
      if (text) form.set(field, text);
    }
  }
  return form;
}

async function executeProviderFormRequest(
  provider: ProviderRow,
  operation: "generation" | "edit",
  routeMode: string,
  endpoint: string,
  form: FormData,
  context: ProviderRequestContext = {}
) {
  const started = performance.now();
  let statusCode: number | null = null;
  try {
    const { response, text } = await withProviderRequestTimeout(async (signal) => {
      const response = await providerFetch(provider, endpoint, {
        method: "POST",
        headers: providerHeaders(provider, "", "application/json"),
        body: form,
        signal
      });
      return { response, text: await response.text() };
    });

    statusCode = response.status;
    if (!response.ok) {
      throw new Error(providerHttpErrorMessage(response.status, text));
    }

    const parsed = parseProviderResponse(text);
    logProviderRequest({
      provider,
      operation,
      routeMode,
      endpoint,
      statusCode,
      durationMs: performance.now() - started,
      success: true,
      ...providerRequestLogContext(context)
    });
    return parsed;
  } catch (error) {
    logProviderRequest({
      provider,
      operation,
      routeMode,
      endpoint,
      statusCode,
      durationMs: performance.now() - started,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      ...providerRequestLogContext(context)
    });
    throw error;
  }
}

function sseJsonFrames(chunkBuffer: string) {
  const parts = chunkBuffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  const frames = parts
    .map((part) =>
      part
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s*/, ""))
        .join("\n")
        .trim()
    )
    .filter((line) => line && line !== "[DONE]")
    .map((line) => safeJson<unknown>(line, null))
    .filter(Boolean);
  return { frames, rest };
}

function streamImageValues(event: unknown) {
  if (!event || typeof event !== "object") return [];
  const record = event as Record<string, any>;
  const type = String(record.type ?? "");
  if (type.includes("partial_image")) return [];
  if (type && !type.includes("completed") && !type.includes("done")) return [];
  const dataItems = Array.isArray(record.data) ? record.data : [];
  const candidates = [
    record.b64_json,
    record.image?.b64_json,
    record.result,
    ...dataItems.flatMap((item) =>
      item && typeof item === "object"
        ? [
            (item as Record<string, unknown>).b64_json,
            (item as Record<string, unknown>).base64,
            (item as Record<string, unknown>).image
          ]
        : []
    )
  ];
  const seen = new Set<string>();
  return candidates.filter((value): value is string => {
    if (typeof value !== "string" || !value.trim()) return false;
    const key = value.replace(/^data:image\/\w+;base64,/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function streamImageResponses(event: unknown) {
  const values = streamImageValues(event);
  if (values.length === 0 || !event || typeof event !== "object") return [];
  const record = event as Record<string, any>;
  return values.map((value) => ({
    data: [
      {
        b64_json: value,
        revised_prompt: record.revised_prompt ?? record.prompt ?? ""
      }
    ]
  }));
}

async function executeImagesApiStreamRequest(
  provider: ProviderRow,
  endpoint: string,
  payload: Record<string, unknown>,
  onImageResult: (responseJson: unknown) => Promise<void> | void,
  context: ProviderRequestContext = {}
) {
  const started = performance.now();
  let statusCode: number | null = null;
  const imageResponses: unknown[] = [];
  const seenImages = new Set<string>();
  try {
    const responseJson = await withProviderRequestTimeout(async (signal) => {
      const response = await providerFetch(provider, endpoint, {
        method: "POST",
        headers: providerHeaders(provider, "application/json", "text/event-stream"),
        body: JSON.stringify({ ...payload, stream: true, partial_images: 0 }),
        signal
      });
      statusCode = response.status;
      if (!response.ok) {
        const text = await response.text();
        throw new Error(providerHttpErrorMessage(response.status, text));
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const parsed = parseProviderResponse(await response.text());
        await onImageResult(parsed);
        return parsed;
      }
      if (!response.body) throw new Error("图片接口未返回流式内容");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = sseJsonFrames(buffer);
        buffer = parsed.rest;
        for (const frame of parsed.frames) {
          for (const imageResponse of streamImageResponses(frame)) {
            const value = (imageResponse as { data: Array<{ b64_json: string }> }).data[0]?.b64_json ?? "";
            const key = value.replace(/^data:image\/\w+;base64,/, "");
            if (!key || seenImages.has(key)) continue;
            seenImages.add(key);
            imageResponses.push(imageResponse);
            await onImageResult(imageResponse);
          }
        }
      }
      buffer += decoder.decode();
      const parsed = sseJsonFrames(`${buffer}\n\n`);
      for (const frame of parsed.frames) {
        for (const imageResponse of streamImageResponses(frame)) {
          const value = (imageResponse as { data: Array<{ b64_json: string }> }).data[0]?.b64_json ?? "";
          const key = value.replace(/^data:image\/\w+;base64,/, "");
          if (!key || seenImages.has(key)) continue;
          seenImages.add(key);
          imageResponses.push(imageResponse);
          await onImageResult(imageResponse);
        }
      }
      if (imageResponses.length === 0) throw new Error("图片接口流式返回中没有找到最终图片");
      return {
        data: imageResponses
          .flatMap((item) => (item as { data: unknown[] }).data)
      };
    });

    logProviderRequest({
      provider,
      operation: "generation",
      routeMode: "images_api_stream",
      endpoint,
      statusCode,
      durationMs: performance.now() - started,
      success: true,
      ...providerRequestLogContext(context)
    });
    return responseJson;
  } catch (error) {
    if (error instanceof Error) {
      (error as Error & { streamedImageCount?: number }).streamedImageCount = imageResponses.length;
    }
    logProviderRequest({
      provider,
      operation: "generation",
      routeMode: "images_api_stream",
      endpoint,
      statusCode,
      durationMs: performance.now() - started,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      ...providerRequestLogContext(context)
    });
    throw error;
  }
}

async function callImagesApiProvider(
  provider: ProviderRow,
  mode: "generation" | "edit",
  payload: Record<string, unknown>,
  context: ProviderRequestContext = {}
) {
  const endpoint = normalizePath(
    provider.base_url,
    mode === "generation" ? provider.generation_path : provider.edit_path
  );
  if (mode === "edit") {
    return executeProviderFormRequest(provider, mode, "images_api", endpoint, buildImageEditForm(payload), context);
  }
  return executeProviderJsonRequest(provider, mode, "images_api", endpoint, payload, "application/json", context);
}

async function callResponsesProvider(
  provider: ProviderRow,
  mode: "generation" | "edit",
  payload: Record<string, unknown>,
  stream = false,
  responsesModel?: string,
  context: ProviderRequestContext = {}
) {
  const endpoint = normalizePath(provider.base_url, provider.responses_path || "/v1/responses");
  return executeProviderJsonRequest(
    provider,
    mode,
    "responses",
    endpoint,
    buildResponsesPayload(provider, mode, payload, stream, responsesModel),
    stream ? "text/event-stream" : "application/json",
    context
  );
}

function shouldFallbackToResponses(provider: ProviderRow, hasMask: boolean, error: unknown) {
  if (hasMask || normalizeProviderChannel(provider.channel || inferChannelFromType(provider.type)) !== "cpa") {
    return false;
  }

  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("stream disconnected before completion") ||
    message.includes("upstream did not return image output") ||
    message.includes("invalid sse data json")
  );
}

function shouldRetryResponsesWithoutStream(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes("stream_not_supported") || message.includes("stream is not supported");
}

function shouldFallbackResponsesModel(provider: ProviderRow, model: string | undefined, error: unknown) {
  if (normalizeProviderChannel(provider.channel || inferChannelFromType(provider.type)) !== "cpa") {
    return false;
  }
  const currentModel = resolveResponsesModel(provider, model);
  if (!currentModel || currentModel === CPA_RESPONSES_MODEL_FALLBACK) return false;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes("auth_unavailable") && message.includes("no auth available");
}

async function callResponsesProviderWithCompatFallback(
  provider: ProviderRow,
  mode: "generation" | "edit",
  payload: Record<string, unknown>,
  responsesModel?: string,
  context: ProviderRequestContext = {}
) {
  try {
    return await callResponsesProvider(provider, mode, payload, false, responsesModel, context);
  } catch (error) {
    if (shouldFallbackResponsesModel(provider, responsesModel, error)) {
      return callResponsesProvider(provider, mode, payload, false, CPA_RESPONSES_MODEL_FALLBACK, context);
    }
    if (shouldRetryResponsesWithoutStream(error)) throw error;
    try {
      return await callResponsesProvider(provider, mode, payload, true, responsesModel, context);
    } catch (streamError) {
      const first = error instanceof Error ? error.message : String(error);
      const second = streamError instanceof Error ? streamError.message : String(streamError);
      throw new Error(`综合接口非流式请求失败：${first}; 流式请求失败：${second}`);
    }
  }
}

async function callImagesApiProviderWithCpaFallback(
  provider: ProviderRow,
  mode: "generation" | "edit",
  payload: Record<string, unknown>,
  hasMask: boolean,
  context: ProviderRequestContext = {}
) {
  try {
    return await callImagesApiProvider(provider, mode, payload, context);
  } catch (imagesError) {
    if (!shouldFallbackToResponses(provider, hasMask, imagesError)) throw imagesError;
    try {
      return await callResponsesProviderWithCompatFallback(provider, mode, payload, undefined, context);
    } catch (responsesError) {
      const first = imagesError instanceof Error ? imagesError.message : String(imagesError);
      const second = responsesError instanceof Error ? responsesError.message : String(responsesError);
      throw new Error(`图片接口直连失败：${first}; 综合接口回退失败：${second}`);
    }
  }
}

function shouldFallbackSourceReferenceEdit(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("source_context_missing") ||
    message.includes("source_context_required") ||
    message.includes("source_account_id_required") ||
    message.includes("source_account_not_found") ||
    message.includes("source_account_unavailable") ||
    message.includes("conversation not found") ||
    message.includes("image account is unavailable") ||
    message.includes("原始图片") ||
    message.includes("所属账号")
  );
}

async function callImagesApiProviderWithSourceReferenceFallback(
  provider: ProviderRow,
  mode: "generation" | "edit",
  payload: Record<string, unknown>,
  context: ProviderRequestContext = {}
) {
  try {
    return await callImagesApiProvider(provider, mode, payload, context);
  } catch (error) {
    if (!payload.sourceReference || !shouldFallbackSourceReferenceEdit(error)) throw error;
    const { sourceReference: _sourceReference, ...fallbackPayload } = payload;
    return callImagesApiProvider(provider, mode, fallbackPayload, context);
  }
}

type ChatGptWebSettings = {
  baseUrl: string;
  accessToken: string;
  cookies: string;
  accountId: string;
  sourceAccountId: string;
  deviceId: string;
  sessionId: string;
  powScriptSources: string[];
  powDataBuild: string;
  sessionBootstrapped?: boolean;
};

const chatGptWebAccountCursor = new Map<string, number>();
const STUDIO_LEGACY_CLIENT_VERSION = "prod-be885abbfcfe7b1f511e88b3003d9ee44757fbad";
const STUDIO_LEGACY_CLIENT_BUILD_NUMBER = "5955942";
const STUDIO_DEFAULT_POW_SCRIPT = "https://chatgpt.com/backend-api/sentinel/sdk.js";

function chatGptWebSessionFields() {
  return {
    deviceId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    powScriptSources: [STUDIO_DEFAULT_POW_SCRIPT],
    powDataBuild: ""
  };
}

function providerAccessToken(provider: ProviderRow) {
  return provider.api_key_value || (provider.api_key_env ? Bun.env[provider.api_key_env] ?? "" : "");
}

function imageAccountAuthMeta(account: ImageAccountRow) {
  const authMeta = account.auth_json ? extractAuthJsonMeta(account.auth_json) : { accessToken: "", cookies: "", accountId: "" };
  const infoMeta = account.auth_info_json ? extractAuthJsonMeta(account.auth_info_json) : { accessToken: "", cookies: "", accountId: "" };
  return {
    accessToken: account.access_token || authMeta.accessToken || infoMeta.accessToken || "",
    cookies: authMeta.cookies || infoMeta.cookies || "",
    accountId: authMeta.accountId || infoMeta.accountId || ""
  };
}

function selectedChatGptWebAccountRows(provider: ProviderRow) {
  const ids = normalizeIdList(provider.web_account_ids);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const foundRows = getAll<ImageAccountRow>(
    configDb,
    `select * from image_accounts where id in (${placeholders})`,
    ...ids
  );
  const byId = new Map(foundRows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is ImageAccountRow => Boolean(row));
}

function chatGptWebAccountUnavailableReason(account: ImageAccountRow) {
  const status = normalizeImageAccountStatus(account.status);
  if (status === "disabled") return `账号「${account.name}」已禁用`;
  if (status === "abnormal") return `账号「${account.name}」状态异常`;
  if (!imageAccountAuthMeta(account).accessToken) return `账号「${account.name}」缺少 Access Token`;
  return "";
}

function chatGptWebAccountCandidates(provider: ProviderRow, includeAllAccounts = false) {
  const rows = normalizeIdList(provider.web_account_ids).length > 0
    ? selectedChatGptWebAccountRows(provider)
    : includeAllAccounts
      ? getAll<ImageAccountRow>(configDb, "select * from image_accounts order by priority desc, updated_at desc")
      : [];
  return rows.filter((row) => !chatGptWebAccountUnavailableReason(row));
}

function chooseChatGptWebAccount(provider: ProviderRow, includeAllAccounts = false) {
  const candidates = chatGptWebAccountCandidates(provider, includeAllAccounts).sort((left, right) => {
    const priority = Number(right.priority) - Number(left.priority);
    if (priority !== 0) return priority;
    return String(right.updated_at).localeCompare(String(left.updated_at));
  });
  if (candidates.length === 0) return null;
  const mode = normalizeWebAccountMode(provider.web_account_mode);
  if (mode === "random") {
    return candidates[Math.floor(Math.random() * candidates.length)] ?? candidates[0];
  }
  if (mode === "round_robin") {
    const current = chatGptWebAccountCursor.get(provider.id) ?? 0;
    chatGptWebAccountCursor.set(provider.id, current + 1);
    return candidates[current % candidates.length] ?? candidates[0];
  }
  return candidates[0];
}

function chatGptWebSettingsFromAccount(provider: ProviderRow, account: ImageAccountRow): ChatGptWebSettings {
  const meta = imageAccountAuthMeta(account);
  return {
    baseUrl: provider.base_url || STUDIO_BACKEND_BASE_URL,
    accessToken: meta.accessToken,
    cookies: meta.cookies || provider.web_cookies || "",
    accountId: meta.accountId || provider.web_account_id || "",
    sourceAccountId: account.id,
    ...chatGptWebSessionFields()
  };
}

function sourceReferenceAccountId(payload: Record<string, unknown>) {
  const source = payload.sourceReference;
  if (source && typeof source === "object") {
    const accountId = String((source as Record<string, unknown>).source_account_id ?? "").trim();
    if (accountId) return accountId;
  }
  const webContext = payload.webConversationContext;
  if (webContext && typeof webContext === "object") {
    return String((webContext as Record<string, unknown>).source_account_id ?? "").trim();
  }
  return "";
}

function requireChatGptWebSettings(provider: ProviderRow, preferredSourceAccountId = "") {
  if (preferredSourceAccountId) {
    const account = getOne<ImageAccountRow>(configDb, "select * from image_accounts where id = ?", preferredSourceAccountId);
    if (account && !chatGptWebAccountUnavailableReason(account)) {
      return chatGptWebSettingsFromAccount(provider, account);
    }
  }
  const selectedAccountIds = normalizeIdList(provider.web_account_ids);
  if (selectedAccountIds.length > 0) {
    const account = chooseChatGptWebAccount(provider);
    if (account) {
      const settings = chatGptWebSettingsFromAccount(provider, account);
      if (!settings.accessToken) throw new Error(`官网号池账号「${account.name}」缺少 Access Token`);
      return settings;
    }
    const reasons = selectedChatGptWebAccountRows(provider)
      .map(chatGptWebAccountUnavailableReason)
      .filter(Boolean);
    throw new Error(
      reasons.length > 0
        ? `ChatGPT 官网渠道选择的号池账号不可用：${reasons.join("；")}`
        : "ChatGPT 官网渠道选择的号池账号不存在"
    );
  }
  const settings: ChatGptWebSettings = {
    baseUrl: provider.base_url || STUDIO_BACKEND_BASE_URL,
    accessToken: providerAccessToken(provider),
    cookies: provider.web_cookies ?? "",
    accountId: provider.web_account_id ?? "",
    sourceAccountId: "",
    ...chatGptWebSessionFields()
  };
  if (settings.accessToken) return settings;

  const account = chooseChatGptWebAccount(provider, true);
  if (account) return chatGptWebSettingsFromAccount(provider, account);

  throw new Error("ChatGPT 官网渠道缺少可用 Access Token：请选择号池账号，或在渠道里填写备用 Access Token");
}

function studioBackendUrl(settings: ChatGptWebSettings, childPath: string) {
  return normalizePath(settings.baseUrl || STUDIO_BACKEND_BASE_URL, childPath);
}

function studioBackendTargetPath(settings: ChatGptWebSettings, childPath: string) {
  const normalizedChild = `/${childPath.replace(/^\/+/, "")}`;
  try {
    const basePath = new URL(settings.baseUrl || STUDIO_BACKEND_BASE_URL).pathname.replace(/\/+$/, "");
    if (basePath.endsWith("/backend-api")) return `/backend-api${normalizedChild}`;
  } catch {
    // Fall back to ChatGPT's standard backend path below.
  }
  return normalizedChild.startsWith("/backend-api/") ? normalizedChild : `/backend-api${normalizedChild}`;
}

function studioResponsesHeaders(settings: ChatGptWebSettings) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${settings.accessToken}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "OpenAI-Beta": "responses=v1",
    "User-Agent": STUDIO_CODEX_USER_AGENT,
    Originator: "codex-tui",
    Session_id: crypto.randomUUID(),
    Connection: "Keep-Alive"
  };
  if (settings.accountId) headers["Chatgpt-Account-Id"] = settings.accountId;
  if (settings.cookies) headers.Cookie = settings.cookies;
  return headers;
}

function studioLegacyHeaders(settings: ChatGptWebSettings, accept = "*/*", targetPath = "") {
  const headers: Record<string, string> = {
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
    Authorization: `Bearer ${settings.accessToken}`,
    "Content-Type": "application/json",
    "OAI-Device-Id": settings.deviceId,
    "OAI-Session-Id": settings.sessionId,
    "OAI-Language": "en-US",
    "OAI-Client-Version": STUDIO_LEGACY_CLIENT_VERSION,
    "OAI-Client-Build-Number": STUDIO_LEGACY_CLIENT_BUILD_NUMBER,
    Origin: "https://chatgpt.com",
    Priority: "u=1, i",
    Referer: "https://chatgpt.com/",
    "Sec-CH-UA": `"Chromium";v="146", "Google Chrome";v="146", "Not?A_Brand";v="99"`,
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": `"macOS"`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": STUDIO_LEGACY_USER_AGENT
  };
  if (targetPath) {
    headers["X-OpenAI-Target-Path"] = targetPath;
    headers["X-OpenAI-Target-Route"] = targetPath;
  }
  if (settings.cookies) headers.Cookie = settings.cookies;
  return headers;
}

function studioBootstrapHeaders(settings: ChatGptWebSettings) {
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://chatgpt.com/",
    "Sec-CH-UA": `"Chromium";v="146", "Google Chrome";v="146", "Not?A_Brand";v="99"`,
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": `"macOS"`,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": STUDIO_LEGACY_USER_AGENT
  };
  if (settings.cookies) headers.Cookie = settings.cookies;
  return headers;
}

function chatGptWebOrigin(settings: ChatGptWebSettings) {
  try {
    return new URL(settings.baseUrl || STUDIO_BACKEND_BASE_URL).origin;
  } catch {
    return "https://chatgpt.com";
  }
}

function splitSetCookieHeader(value: string) {
  return value
    .split(/,\s*(?=[^;,=\s]+=[^;,]*)/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function responseSetCookieHeaders(headers: Headers) {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie().filter(Boolean);
  }
  const value = headers.get("set-cookie") || "";
  return value ? splitSetCookieHeader(value) : [];
}

function mergeCookieHeader(existing: string, setCookies: string[]) {
  const cookieMap = new Map<string, string>();
  for (const part of existing.split(";")) {
    const trimmed = part.trim();
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    cookieMap.set(trimmed.slice(0, index), trimmed.slice(index + 1));
  }
  for (const setCookie of setCookies) {
    const pair = setCookie.split(";", 1)[0]?.trim() ?? "";
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (/max-age=0/i.test(setCookie) || /expires=thu,\s*01\s*jan\s*1970/i.test(setCookie)) {
      cookieMap.delete(name);
    } else {
      cookieMap.set(name, value);
    }
  }
  return [...cookieMap.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function parseStudioPowResources(html: string) {
  const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map((match) => String(match[1] ?? "").trim())
    .filter(Boolean);
  let dataBuild = "";
  for (const source of scriptSources) {
    const match = source.match(/c\/[^/]*\//);
    if (match) {
      dataBuild = `${match[0]}_`;
      break;
    }
  }
  if (!dataBuild) {
    dataBuild = html.match(/<html[^>]*data-build=["']([^"']*)["']/i)?.[1] ?? "";
  }
  return {
    scriptSources: scriptSources.length > 0 ? scriptSources : [STUDIO_DEFAULT_POW_SCRIPT],
    dataBuild
  };
}

async function ensureChatGptWebSessionCookies(provider: RuntimeProviderRow, settings: ChatGptWebSettings) {
  if (settings.sessionBootstrapped) return;
  settings.sessionBootstrapped = true;
  const endpoint = `${chatGptWebOrigin(settings)}/`;
  try {
    const response = await withProviderRequestTimeout((signal) => {
      return providerFetch(provider, endpoint, {
        method: "GET",
        headers: studioBootstrapHeaders(settings),
        signal
      });
    });
    const setCookies = responseSetCookieHeaders(response.headers);
    if (setCookies.length > 0) {
      settings.cookies = mergeCookieHeader(settings.cookies, setCookies);
    }
    const text = await response.text().catch(() => "");
    if (text) {
      const resources = parseStudioPowResources(text);
      settings.powScriptSources = resources.scriptSources;
      settings.powDataBuild = resources.dataBuild;
    }
    if (!response.ok) {
      console.warn(chatGptWebHttpErrorMessage(response.status, text, "ChatGPT 官网首页预热"));
    }
  } catch (error) {
    console.warn(`ChatGPT 官网首页预热失败，将继续尝试会话接口：${error instanceof Error ? error.message : String(error)}`);
  }
}

function attachSourceAccountContext(responseJson: unknown, sourceAccountId: string): unknown {
  if (!sourceAccountId || !responseJson || typeof responseJson !== "object") return responseJson;
  if (Array.isArray(responseJson)) {
    return responseJson.map((item) => attachSourceAccountContext(item, sourceAccountId));
  }
  const record = responseJson as Record<string, unknown>;
  const hasImageValue = ["b64_json", "base64", "image_base64", "image", "result", "url", "image_url"].some(
    (key) => typeof record[key] === "string" && String(record[key]).trim()
  );
  const next: Record<string, unknown> = {
    ...record,
    ...(hasImageValue ? { source_account_id: sourceAccountId } : {})
  };
  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === "object") {
      next[key] = attachSourceAccountContext(value, sourceAccountId);
    }
  }
  return next;
}

async function executeStudioJsonRequest(
  provider: RuntimeProviderRow,
  operation: "generation" | "edit",
  routeMode: string,
  endpoint: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  sourceAccountId = "",
  context: ProviderRequestContext = {}
) {
  const started = performance.now();
  let statusCode: number | null = null;
  try {
    const { response, text } = await withProviderRequestTimeout(async (signal) => {
      const response = await providerFetch(provider, endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal
      });
      return { response, text: await response.text() };
    });

    statusCode = response.status;
    if (!response.ok) {
      throw new Error(chatGptWebHttpErrorMessage(response.status, text, chatGptWebRouteLabel(routeMode)));
    }

    const parsed = parseProviderResponse(text);
    logProviderRequest({
      provider,
      operation,
      routeMode,
      endpoint,
      statusCode,
      durationMs: performance.now() - started,
      success: true,
      sourceAccountId,
      ...providerRequestLogContext(context)
    });
    return parsed;
  } catch (error) {
    logProviderRequest({
      provider,
      operation,
      routeMode,
      endpoint,
      statusCode,
      durationMs: performance.now() - started,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      sourceAccountId,
      ...providerRequestLogContext(context)
    });
    throw error;
  }
}

type ChatGptWebBridgeResult = {
  ok?: boolean;
  endpoint?: string;
  route_mode?: string;
  status_code?: number | null;
  data?: unknown;
  error?: string;
};

function runBridgeProcess(input: Record<string, unknown>) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const python = Bun.env.CHATGPT_WEB_BRIDGE_PYTHON || "python";
    const scriptPath = path.join(ROOT, "scripts", "chatgpt_web_bridge.py");
    const child = spawn(python, [scriptPath], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const timeoutId = setTimeout(() => {
      child.kill();
      reject(new Error(PROVIDER_REQUEST_TIMEOUT_ERROR));
    }, IMAGE_JOB_RUNNING_TIMEOUT_MS);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({ stdout, stderr, code });
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

async function executeChatGptWebBridgeRequest(
  provider: RuntimeProviderRow,
  settings: ChatGptWebSettings,
  mode: "generation" | "edit",
  routeMode: string,
  payload: Record<string, unknown>,
  context: ProviderRequestContext = {}
) {
  const started = performance.now();
  let statusCode: number | null = null;
  let endpoint = studioBackendUrl(settings, "/f/conversation");
  let loggedRouteMode = routeMode;
  try {
    const proxy = proxySettings();
    const { stdout, stderr, code } = await runBridgeProcess({
      operation: mode,
      baseUrl: settings.baseUrl || STUDIO_BACKEND_BASE_URL,
      accessToken: settings.accessToken,
      cookies: settings.cookies,
      accountId: settings.accountId,
      sourceAccountId: settings.sourceAccountId,
      model: provider.model || DEFAULT_IMAGE_MODEL,
      payload,
      proxy: proxy.enabled && proxy.url ? proxy.url : "",
      retryCount: proxy.enabled && proxy.url ? proxy.retryCount : 0
    });
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
    const result = safeJson<ChatGptWebBridgeResult>(line, {});
    endpoint = String(result.endpoint || endpoint);
    loggedRouteMode = String(result.route_mode || routeMode);
    statusCode = typeof result.status_code === "number" ? result.status_code : code === 0 ? 200 : null;
    if (code !== 0 || result.ok === false) {
      const detail = String(result.error || stderr || stdout || `bridge exited with code ${code}`).trim();
      throw new Error(detail);
    }
    const responseJson = {
      data: Array.isArray(result.data) ? result.data : []
    };
    if (responseJson.data.length === 0) throw new Error("ChatGPT 官网 bridge 未返回图片数据");
    logProviderRequest({
      provider,
      operation: mode,
      routeMode: loggedRouteMode,
      endpoint,
      statusCode,
      durationMs: performance.now() - started,
      success: true,
      sourceAccountId: settings.sourceAccountId,
      ...providerRequestLogContext(context)
    });
    return attachSourceAccountContext(responseJson, settings.sourceAccountId);
  } catch (error) {
    logProviderRequest({
      provider,
      operation: mode,
      routeMode: loggedRouteMode,
      endpoint,
      statusCode,
      durationMs: performance.now() - started,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      sourceAccountId: settings.sourceAccountId,
      ...providerRequestLogContext(context)
    });
    throw error;
  }
}

function base64Json(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

function randomChoice<T>(values: T[]) {
  return values[Math.floor(Math.random() * values.length)] ?? values[0];
}

function studioLegacyParseTime() {
  const date = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${weekdays[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${pad(date.getUTCDate())} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} GMT-0500 (Eastern Standard Time)`;
}

function buildStudioBrowserConfig(settings: ChatGptWebSettings) {
  const perfCounter = performance.now();
  const timeOrigin = Date.now() - perfCounter;
  return [
    randomChoice([3000, 4000, 5000]),
    studioLegacyParseTime(),
    4294705152,
    0,
    STUDIO_LEGACY_USER_AGENT,
    randomChoice(settings.powScriptSources.length > 0 ? settings.powScriptSources : [STUDIO_DEFAULT_POW_SCRIPT]),
    settings.powDataBuild,
    "en-US",
    "en-US,es-US,en,es",
    0,
    randomChoice([
      "webdriver-false",
      "cookieEnabled-true",
      "vendor-Google Inc.",
      "language-en-US",
      "hardwareConcurrency-32",
      "pdfViewerEnabled-true"
    ]),
    randomChoice(["_reactListeningo743lnnpvdg", "location"]),
    randomChoice(["window", "self", "document", "location", "navigator", "performance", "crypto", "fetch"]),
    perfCounter,
    crypto.randomUUID(),
    "",
    randomChoice([8, 16, 24, 32]),
    timeOrigin
  ];
}

function bytesLessOrEqual(left: Buffer, right: Buffer) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] < right[index]) return true;
    if (left[index] > right[index]) return false;
  }
  return left.length <= right.length;
}

function studioPowFallback(seed: string) {
  return `wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D${Buffer.from(JSON.stringify(seed)).toString("base64")}`;
}

function solveStudioProofOfWorkAnswer(seed: string, difficulty: string, settings: ChatGptWebSettings) {
  const difficultyBytes = Buffer.from(difficulty, "hex");
  const config = buildStudioBrowserConfig(settings);
  for (let index = 0; index < 500000; index += 1) {
    config[3] = index;
    config[9] = index >> 1;
    const encoded = base64Json(config);
    const hash = createHash("sha3-512").update(seed).update(encoded).digest();
    if (bytesLessOrEqual(hash.subarray(0, difficultyBytes.length), difficultyBytes)) {
      return { answer: encoded, solved: true };
    }
  }
  return { answer: studioPowFallback(seed), solved: false };
}

function generateStudioRequirementsToken(settings: ChatGptWebSettings) {
  const seed = String(Math.random());
  const { answer } = solveStudioProofOfWorkAnswer(seed, "0fffff", settings);
  return `gAAAAAC${answer}`;
}

function solveStudioProofOfWork(seed: string, difficulty: string, settings: ChatGptWebSettings) {
  const { answer, solved } = solveStudioProofOfWorkAnswer(seed, difficulty, settings);
  if (!solved) throw new Error(`ChatGPT 官网 proof token 计算失败：difficulty=${difficulty}`);
  return `gAAAAAB${answer}`;
}

async function studioSentinelTokens(settings: ChatGptWebSettings, provider: RuntimeProviderRow) {
  await ensureChatGptWebSessionCookies(provider, settings);
  const endpoint = studioBackendUrl(settings, "/sentinel/chat-requirements");
  const targetPath = studioBackendTargetPath(settings, "/sentinel/chat-requirements");
  const response = await providerFetch(provider, endpoint, {
    method: "POST",
    headers: studioLegacyHeaders(settings, "application/json", targetPath),
    body: JSON.stringify({ p: generateStudioRequirementsToken(settings) })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(chatGptWebHttpErrorMessage(response.status, text, "ChatGPT 官网 chat-requirements"));
  }
  const payload = safeJson(text, {}) as {
    token?: string;
    proofofwork?: { required?: boolean; seed?: string; difficulty?: string };
  };
  const chatToken = String(payload.token ?? "").trim();
  if (!chatToken) throw new Error("chat-requirements 未返回 token");
  const pow = payload.proofofwork;
  const proofToken =
    pow?.required && pow.seed && pow.difficulty ? solveStudioProofOfWork(pow.seed, pow.difficulty, settings) : "";
  return { chatToken, proofToken };
}

async function uploadChatGptWebImage(
  provider: RuntimeProviderRow,
  settings: ChatGptWebSettings,
  dataUrl: string,
  index: number
): Promise<ChatGptUploadedFile> {
  const { mimeType, buffer } = bufferFromDataUrl(dataUrl);
  const dimensions = readImageDimensions(buffer);
  const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  const fileName = `image-${index + 1}.${extension}`;
  const createEndpoint = studioBackendUrl(settings, "/files");
  const createResponse = await providerFetch(provider, createEndpoint, {
    method: "POST",
    headers: studioLegacyHeaders(settings, "application/json", studioBackendTargetPath(settings, "/files")),
    body: JSON.stringify({
      file_name: fileName,
      file_size: buffer.length,
      use_case: "multimodal",
      width: dimensions.width,
      height: dimensions.height
    })
  });
  const createText = await createResponse.text();
  if (!createResponse.ok) {
    throw new Error(chatGptWebHttpErrorMessage(createResponse.status, createText, "ChatGPT 官网文件创建"));
  }
  const created = safeJson<any>(createText, {});
  const fileId = String(created.file_id ?? created.id ?? "").trim();
  const uploadUrl = String(created.upload_url ?? "").trim();
  if (!fileId) throw new Error("ChatGPT 官网文件上传未返回 file_id");
  if (uploadUrl) {
    const uploadHeaders: Record<string, string> = {
      "Content-Type": mimeType
    };
    const responseHeaders = created.upload_headers ?? created.uploadHeaders ?? created.headers;
    if (responseHeaders && typeof responseHeaders === "object" && !Array.isArray(responseHeaders)) {
      for (const [key, value] of Object.entries(responseHeaders as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim()) uploadHeaders[key] = value.trim();
      }
    }
    if (/(^|\.)blob\.core\.windows\.net\//i.test(uploadUrl) && !Object.keys(uploadHeaders).some((key) => key.toLowerCase() === "x-ms-blob-type")) {
      uploadHeaders["x-ms-blob-type"] = "BlockBlob";
    }
    const uploadResponse = await providerFetch(provider, uploadUrl, {
      method: "PUT",
      headers: uploadHeaders,
      body: new Uint8Array(buffer)
    });
    if (!uploadResponse.ok) {
      const uploadText = await uploadResponse.text().catch(() => "");
      throw new Error(
        uploadText
          ? chatGptWebHttpErrorMessage(uploadResponse.status, uploadText, "ChatGPT 官网文件上传")
          : `ChatGPT 官网文件上传失败 ${uploadResponse.status}: ${uploadResponse.statusText}`
      );
    }
  }
  const completeEndpoint = studioBackendUrl(settings, `/files/${encodeURIComponent(fileId)}/uploaded`);
  const completePath = `/files/${encodeURIComponent(fileId)}/uploaded`;
  const completeResponse = await providerFetch(provider, completeEndpoint, {
    method: "POST",
    headers: studioLegacyHeaders(settings, "application/json", studioBackendTargetPath(settings, completePath)),
    body: JSON.stringify({})
  });
  const completeText = await completeResponse.text();
  if (!completeResponse.ok) {
    throw new Error(chatGptWebHttpErrorMessage(completeResponse.status, completeText, "ChatGPT 官网文件确认"));
  }
  return {
    fileId,
    fileName,
    mimeType,
    size: buffer.length,
    width: dimensions.width,
    height: dimensions.height
  };
}

function buildStudioLegacyPrompt(payload: Record<string, unknown>) {
  let prompt = String(payload.prompt ?? "").trim();
  const size = String(payload.size ?? "");
  const quality = String(payload.quality ?? "");
  if (size && size !== "auto" && size !== "1024x1024") {
    prompt = `Generate an image with size ${size}. ${prompt}`;
  }
  if (quality === "hd" || quality === "high") {
    prompt = `Generate a high-quality, detailed image: ${prompt}`;
  }
  return prompt;
}

type ChatGptUploadedFile = {
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
};

function chatGptWebConversationModel(model: string) {
  const normalized = String(model ?? "").trim();
  if (!normalized || normalized === DEFAULT_IMAGE_MODEL || normalized === "codex-gpt-image-2") return DEFAULT_RESPONSES_MODEL;
  return normalized;
}

function buildStudioConversationBody(prompt: string, model: string, uploadedFiles: ChatGptUploadedFile[] = []) {
  const messageId = crypto.randomUUID();
  const imageParts = uploadedFiles.map((file) => ({
    content_type: "image_asset_pointer",
    asset_pointer: `file-service://${file.fileId}`,
    size_bytes: file.size,
    width: file.width,
    height: file.height,
    fovea: null,
    metadata: {
      file_name: file.fileName,
      mime_type: file.mimeType
    }
  }));
  return {
    action: "next",
    messages: [
      {
        id: messageId,
        author: { role: "user" },
        content: {
          content_type: uploadedFiles.length > 0 ? "multimodal_text" : "text",
          parts: uploadedFiles.length > 0 ? [...imageParts, prompt] : [prompt]
        },
        metadata: {
          system_hints: ["picture_v2"],
          ...(uploadedFiles.length > 0
            ? {
                attachments: uploadedFiles.map((file) => ({
                  id: file.fileId,
                  name: file.fileName,
                  mime_type: file.mimeType,
                  size: file.size
                }))
              }
            : {}),
          serialization_metadata: { custom_symbol_offsets: [] }
        }
      }
    ],
    parent_message_id: "client-created-root",
    model: chatGptWebConversationModel(model),
    timezone_offset_min: 420,
    timezone: "America/Los_Angeles",
    conversation_mode: { kind: "primary_assistant" },
    enable_message_followups: true,
    system_hints: ["picture_v2"],
    supports_buffering: true,
    supported_encodings: [],
    client_contextual_info: {
      is_dark_mode: true,
      time_since_loaded: 1000,
      page_height: 717,
      page_width: 1200,
      pixel_ratio: 2,
      screen_height: 878,
      screen_width: 1352,
      app_name: "chatgpt.com"
    },
    paragen_cot_summary_display_override: "allow",
    force_parallel_switch: "auto"
  };
}

function cloneJsonRecord(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function parseSseJsonFrames(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, "").trim())
    .filter((line) => line && line !== "[DONE]")
    .map((line) => safeJson<unknown>(line, null))
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
}

function extractStudioFileId(pointer: string) {
  return pointer.replace(/^sediment:\/\//, "").replace(/^file-service:\/\//, "");
}

function studioImageDataUrl(mimeType: string, buffer: ArrayBuffer) {
  return `data:${mimeType || "image/png"};base64,${Buffer.from(buffer).toString("base64")}`;
}

async function fetchStudioImageDataUrl(url: string, settings: ChatGptWebSettings, provider: RuntimeProviderRow) {
  const response = await providerFetch(provider, url, {
    method: "GET",
    headers: url.includes("chatgpt.com") ? studioLegacyHeaders(settings, "image/*") : { Accept: "image/*" }
  });
  if (!response.ok) throw new Error(`图片下载失败 ${response.status}`);
  return studioImageDataUrl(response.headers.get("content-type") || "image/png", await response.arrayBuffer());
}

async function fetchStudioAttachmentDataUrl(
  pointer: string,
  conversationId: string,
  settings: ChatGptWebSettings,
  provider: RuntimeProviderRow
) {
  const fileId = extractStudioFileId(pointer);
  if (!fileId || !conversationId) return "";
  const endpoint = pointer.startsWith("sediment://")
    ? studioBackendUrl(settings, `/conversation/${encodeURIComponent(conversationId)}/attachment/${encodeURIComponent(fileId)}/download`)
    : studioBackendUrl(settings, `/files/${encodeURIComponent(fileId)}/download`);
  const targetPath = pointer.startsWith("sediment://")
    ? `/conversation/${encodeURIComponent(conversationId)}/attachment/${encodeURIComponent(fileId)}/download`
    : `/files/${encodeURIComponent(fileId)}/download`;
  const response = await providerFetch(provider, endpoint, {
    method: "GET",
    headers: studioLegacyHeaders(settings, "application/json,image/*", studioBackendTargetPath(settings, targetPath))
  });
  if (!response.ok && !pointer.startsWith("sediment://")) {
    const fallbackEndpoint = studioBackendUrl(
      settings,
      `/files/download/${encodeURIComponent(fileId)}?conversation_id=${encodeURIComponent(conversationId)}&inline=false`
    );
    const fallbackResponse = await providerFetch(provider, fallbackEndpoint, {
      method: "GET",
      headers: studioLegacyHeaders(
        settings,
        "application/json,image/*",
        studioBackendTargetPath(settings, `/files/download/${encodeURIComponent(fileId)}`)
      )
    });
    if (!fallbackResponse.ok) throw new Error(`图片下载地址获取失败 ${fallbackResponse.status}`);
    const fallbackContentType = fallbackResponse.headers.get("content-type") || "";
    if (fallbackContentType.startsWith("image/")) return studioImageDataUrl(fallbackContentType, await fallbackResponse.arrayBuffer());
    const fallbackPayload = safeJson(await fallbackResponse.text(), {}) as { download_url?: string };
    if (!fallbackPayload.download_url) throw new Error(`图片下载地址为空：${fileId}`);
    return fetchStudioImageDataUrl(fallbackPayload.download_url, settings, provider);
  }
  if (!response.ok) throw new Error(`图片下载地址获取失败 ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (contentType.startsWith("image/")) return studioImageDataUrl(contentType, await response.arrayBuffer());
  const payload = safeJson(await response.text(), {}) as { download_url?: string };
  if (!payload.download_url) throw new Error(`图片下载地址为空：${fileId}`);
  return fetchStudioImageDataUrl(payload.download_url, settings, provider);
}

async function extractStudioLegacyImages(
  message: unknown,
  conversationId: string,
  settings: ChatGptWebSettings,
  provider: RuntimeProviderRow
) {
  if (!message || typeof message !== "object") return [];
  const record = message as Record<string, any>;
  const role = String(record.author?.role ?? "");
  if (role === "user" || role === "system") return [];
  if (record.status && record.status !== "finished_successfully") return [];
  const content = record.content;
  if (!content || content.content_type !== "multimodal_text" || !Array.isArray(content.parts)) return [];

  const images: Array<{ dataUrl: string; revisedPrompt: string }> = [];
  for (const part of content.parts) {
    if (!part || typeof part !== "object") continue;
    const pointer = String(part.asset_pointer ?? "");
    if (part.content_type !== "image_asset_pointer" || !pointer) continue;
    const dataUrl = await fetchStudioAttachmentDataUrl(pointer, conversationId, settings, provider);
    if (dataUrl) {
      images.push({
        dataUrl,
        revisedPrompt: String(part.metadata?.dalle?.prompt ?? "")
      });
    }
  }
  return images;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollStudioLegacyImages(
  conversationId: string,
  settings: ChatGptWebSettings,
  provider: RuntimeProviderRow
) {
  for (let index = 0; index < 24; index += 1) {
    await delay(2500);
    const endpoint = studioBackendUrl(settings, `/conversation/${encodeURIComponent(conversationId)}`);
    const response = await providerFetch(provider, endpoint, {
      method: "GET",
      headers: studioLegacyHeaders(settings, "application/json", studioBackendTargetPath(settings, `/conversation/${encodeURIComponent(conversationId)}`))
    });
    if (!response.ok) continue;
    const payload = safeJson(await response.text(), {}) as { mapping?: Record<string, { message?: unknown }> };
    const mapping = payload.mapping && typeof payload.mapping === "object" ? payload.mapping : {};
    const images: Array<{ dataUrl: string; revisedPrompt: string }> = [];
    for (const node of Object.values(mapping)) {
      images.push(...(await extractStudioLegacyImages(node?.message, conversationId, settings, provider)));
    }
    if (images.length > 0) return images;
  }
  return [];
}

async function parseStudioLegacyResponse(
  text: string,
  settings: ChatGptWebSettings,
  provider: RuntimeProviderRow,
  fallbackPrompt: string
) {
  let conversationId = "";
  let asyncMode = false;
  const images: Array<{ dataUrl: string; revisedPrompt: string }> = [];

  for (const frame of parseSseJsonFrames(text)) {
    if (typeof frame.conversation_id === "string" && frame.conversation_id) {
      conversationId = frame.conversation_id;
    }
    if (Number(frame.async_status) > 0) asyncMode = true;
    if (frame.message) {
      images.push(...(await extractStudioLegacyImages(frame.message, conversationId, settings, provider)));
    }
  }

  if (images.length === 0 && asyncMode && conversationId) {
    images.push(...(await pollStudioLegacyImages(conversationId, settings, provider)));
  }
  if (images.length === 0) throw new Error("ChatGPT 官网会话链路未返回图片数据");

  return {
    data: images.map((image) => ({
      b64_json: image.dataUrl,
      revised_prompt: image.revisedPrompt || fallbackPrompt
    }))
  };
}

async function executeStudioLegacyConversation(
  provider: RuntimeProviderRow,
  settings: ChatGptWebSettings,
  endpoint: string,
  routeMode: string,
  body: Record<string, unknown>,
  prompt: string,
  context: ProviderRequestContext = {}
) {
  const started = performance.now();
  let statusCode: number | null = null;
  try {
    const sentinel = await studioSentinelTokens(settings, provider);
    const targetPath = new URL(endpoint).pathname.replace(/^\/backend-api(?=\/)/, "");
    const headers = studioLegacyHeaders(settings, "text/event-stream", studioBackendTargetPath(settings, targetPath));
    headers["openai-sentinel-chat-requirements-token"] = sentinel.chatToken;
    if (sentinel.proofToken) headers["openai-sentinel-proof-token"] = sentinel.proofToken;

    const { response, text } = await withProviderRequestTimeout(async (signal) => {
      const response = await providerFetch(provider, endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal
      });
      return { response, text: await response.text() };
    });
    statusCode = response.status;
    if (!response.ok) {
      throw new Error(chatGptWebHttpErrorMessage(response.status, text, chatGptWebRouteLabel(routeMode)));
    }
    const parsed = await parseStudioLegacyResponse(text, settings, provider, prompt);
    logProviderRequest({
      provider,
      operation: "generation",
      routeMode,
      endpoint,
      statusCode,
      durationMs: performance.now() - started,
      success: true,
      sourceAccountId: settings.sourceAccountId,
      ...providerRequestLogContext(context)
    });
    return attachSourceAccountContext(parsed, settings.sourceAccountId);
  } catch (error) {
    logProviderRequest({
      provider,
      operation: "generation",
      routeMode,
      endpoint,
      statusCode,
      durationMs: performance.now() - started,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      sourceAccountId: settings.sourceAccountId,
      ...providerRequestLogContext(context)
    });
    throw error;
  }
}

async function prepareChatGptWebConversation(
  provider: RuntimeProviderRow,
  settings: ChatGptWebSettings,
  mode: "generation" | "edit",
  body: Record<string, unknown>,
  context: ProviderRequestContext = {}
) {
  const sentinel = await studioSentinelTokens(settings, provider);
  const headers = studioLegacyHeaders(settings, "application/json", studioBackendTargetPath(settings, "/f/conversation/prepare"));
  headers["openai-sentinel-chat-requirements-token"] = sentinel.chatToken;
  if (sentinel.proofToken) headers["openai-sentinel-proof-token"] = sentinel.proofToken;
  const payload = await executeStudioJsonRequest(
    provider,
    mode,
    "chatgpt_web_conversation_prepare",
    studioBackendUrl(settings, "/f/conversation/prepare"),
    body,
    headers,
    settings.sourceAccountId,
    context
  );
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  return String(record.client_prepare_state ?? record.prepare_state ?? record.state ?? "").trim();
}

function chatGptWebQuotaOrder(provider: RuntimeProviderRow) {
  const quotaMode = normalizeQuotaMode(provider.quota_mode);
  if (quotaMode === "official_first") return ["official", "codex"] as const;
  if (quotaMode === "codex_only") return ["codex"] as const;
  if (quotaMode === "official_only") return ["official"] as const;
  return ["codex", "official"] as const;
}

function chatGptWebImagePayload(payload: Record<string, unknown>, quota: "codex" | "official") {
  const { response_format: _responseFormat, ...rest } = payload;
  return {
    ...rest,
    model: quota === "codex" ? "codex-gpt-image-2" : DEFAULT_IMAGE_MODEL
  };
}

function isChatGptWebInpaintPayload(payload: Record<string, unknown>) {
  const source = payload.sourceReference;
  if (!source || typeof source !== "object") return false;
  const record = source as Record<string, unknown>;
  return Boolean(
    typeof payload.mask === "string" &&
    payload.mask.trim() &&
    String(record.original_file_id ?? "").trim() &&
    String(record.source_account_id ?? "").trim()
  );
}

function chatGptWebCodexResponsesPath(provider: RuntimeProviderRow) {
  const configured = String(provider.responses_path || "").trim();
  if (
    !configured ||
    configured === "/v1/responses" ||
    configured === "/codex/images/generations" ||
    configured.endsWith("/codex/images/generations")
  ) {
    return "/codex/responses";
  }
  return configured;
}

function chatGptWebEndpoint(settings: ChatGptWebSettings, childPath: string) {
  const pathName = childPath.trim();
  if (/^https?:\/\//i.test(pathName)) return pathName;
  const baseUrl = settings.baseUrl || STUDIO_BACKEND_BASE_URL;
  if (/\/codex\/?$/i.test(baseUrl) && /^\/?codex\//i.test(pathName)) {
    return normalizePath(baseUrl, pathName.replace(/^\/?codex\/?/i, "/"));
  }
  return normalizePath(baseUrl, pathName);
}

function chatGptWebCodexResponsesPayload(
  provider: RuntimeProviderRow,
  mode: "generation" | "edit",
  payload: Record<string, unknown>
) {
  const body = buildResponsesPayload(
    provider,
    mode,
    payload,
    true,
    resolveResponsesModel(provider)
  ) as Record<string, unknown>;
  body.instructions = String(body.instructions ?? "").trim() || "You are a helpful assistant.";
  body.store = false;
  body.stream = true;
  return body;
}

async function callChatGptWebCodexResponsesProvider(
  provider: RuntimeProviderRow,
  mode: "generation" | "edit",
  payload: Record<string, unknown>,
  context: ProviderRequestContext = {}
) {
  const settings = requireChatGptWebSettings(provider, sourceReferenceAccountId(payload));
  const responseJson = await executeStudioJsonRequest(
    provider,
    mode,
    "chatgpt_web_codex_responses",
    chatGptWebEndpoint(settings, chatGptWebCodexResponsesPath(provider)),
    chatGptWebCodexResponsesPayload(provider, mode, payload),
    studioResponsesHeaders(settings),
    settings.sourceAccountId,
    context
  );
  return attachSourceAccountContext(responseJson, settings.sourceAccountId);
}

async function callChatGptWebQuotaProvider(
  provider: RuntimeProviderRow,
  mode: "generation" | "edit",
  payload: Record<string, unknown>,
  quota: "codex" | "official",
  context: ProviderRequestContext = {}
) {
  if (quota === "codex") return callChatGptWebCodexResponsesProvider(provider, mode, payload, context);
  return callChatGptWebConversationProvider(
    provider,
    mode,
    chatGptWebImagePayload(payload, quota),
    mode === "edit"
      ? isChatGptWebInpaintPayload(payload)
        ? "chatgpt_web_official_inpaint_conversation"
        : "chatgpt_web_official_edit_conversation"
      : "chatgpt_web_official_conversation",
    context
  );
}

async function callChatGptWebConversationProvider(
  provider: RuntimeProviderRow,
  mode: "generation" | "edit",
  payload: Record<string, unknown>,
  routeMode = "chatgpt_web_conversation",
  context: ProviderRequestContext = {}
) {
  const settings = requireChatGptWebSettings(provider, sourceReferenceAccountId(payload));
  return executeChatGptWebBridgeRequest(provider, settings, mode, routeMode, payload, context);
}

async function callChatGptWebProvider(
  provider: RuntimeProviderRow,
  mode: "generation" | "edit",
  payload: Record<string, unknown>,
  context: ProviderRequestContext = {}
) {
  const errors: string[] = [];
  for (const quota of chatGptWebQuotaOrder(provider)) {
    try {
      return await callChatGptWebQuotaProvider(provider, mode, payload, quota, context);
    } catch (error) {
      errors.push(`${quota === "codex" ? "Codex 额度" : "官网额度"}失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(errors.join("; ") || "ChatGPT 官网渠道调用失败");
}

export async function callProvider(
  provider: RuntimeProviderRow,
  mode: "generation" | "edit",
  payload: Record<string, unknown>,
  context: ProviderRequestContext = {}
) {
  const routeMode = normalizeRouteMode(provider.route_mode);
  const hasMask = typeof payload.mask === "string" && payload.mask.trim();
  const channel = normalizeProviderChannel(provider.channel || inferChannelFromType(provider.type));
  if (channel === "chatgpt_web") {
    return callChatGptWebProvider(provider, mode, payload, context);
  }
  if (mode === "edit" && hasMask && channel === "cpa") {
    return callResponsesProviderWithCompatFallback(provider, mode, payload, undefined, context);
  }
  if (routeMode === "responses") {
    return callResponsesProviderWithCompatFallback(provider, mode, payload, undefined, context);
  }
  if (mode === "edit" && hasMask) {
    return callImagesApiProviderWithSourceReferenceFallback(provider, mode, payload, context);
  }
  if (routeMode === "auto") {
    try {
      return await callImagesApiProvider(provider, mode, payload, context);
    } catch (imagesError) {
      try {
        return await callResponsesProviderWithCompatFallback(provider, mode, payload, undefined, context);
      } catch (responsesError) {
        const first = imagesError instanceof Error ? imagesError.message : String(imagesError);
        const second = responsesError instanceof Error ? responsesError.message : String(responsesError);
        throw new Error(`图片接口直连失败：${first}; 综合接口回退失败：${second}`);
      }
    }
  }
  return callImagesApiProviderWithCpaFallback(provider, mode, payload, Boolean(hasMask), context);
}

function payloadForProvider(provider: RuntimeProviderRow, payload: Record<string, unknown>) {
  const channel = normalizeProviderChannel(provider.channel || inferChannelFromType(provider.type));
  const hasMask = typeof payload.mask === "string" && payload.mask.trim();
  const nextPayload: Record<string, unknown> = {
    ...payload,
    model: String(provider.model || "").trim() || DEFAULT_IMAGE_MODEL
  };
  if (shouldRequestOpenAiCompatibleBase64(provider)) {
    nextPayload.response_format = "b64_json";
  } else {
    delete nextPayload.response_format;
  }
  if (channel !== "chatgpt_web" && !(channel === "cpa" && hasMask)) {
    delete nextPayload.sourceReference;
  }
  if (channel !== "chatgpt_web") {
    delete nextPayload.webConversationContext;
  }
  return nextPayload;
}

export async function callProviderChain(
  providers: RuntimeProviderRow[],
  mode: "generation" | "edit",
  payload: Record<string, unknown>,
  context: ProviderRequestContext = {}
) {
  const errors: string[] = [];
  for (const provider of providers) {
    try {
      const responseJson = await callProvider(provider, mode, payloadForProvider(provider, payload), context);
      return { provider, responseJson };
    } catch (error) {
      errors.push(`${provider.name}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(errors.join("; ") || `${mode === "edit" ? "图片编辑" : "图片生成"}没有可用渠道`);
}

export async function callProviderGenerationWithProgress(
  provider: RuntimeProviderRow,
  payload: Record<string, unknown>,
  onImageResult: (responseJson: unknown) => Promise<void> | void,
  context: ProviderRequestContext = {}
) {
  if (normalizeProviderChannel(provider.channel || inferChannelFromType(provider.type)) !== "chatgpt_web" && normalizeRouteMode(provider.route_mode) !== "responses") {
    const endpoint = normalizePath(provider.base_url, provider.generation_path);
    try {
      const responseJson = await executeImagesApiStreamRequest(provider, endpoint, payload, onImageResult, context);
      return { responseJson, streamed: true };
    } catch (error) {
      const streamedImageCount = error instanceof Error ? (error as Error & { streamedImageCount?: number }).streamedImageCount ?? 0 : 0;
      if (streamedImageCount === 0) {
        const responseJson = await callImagesApiProvider(provider, "generation", payload, context);
        return { responseJson, streamed: false };
      }
      throw error;
    }
  }
  const responseJson = await callProvider(provider, "generation", payload, context);
  return { responseJson, streamed: false };
}

