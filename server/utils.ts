import path from "node:path";
import type { AssetRow, AssetShareStatus, AssetSpace, AssetUploadMode, CategoryType, ImageGenerationSettings } from "./types";

export function now() {
  return localTimestamp();
}

export function utcNow() {
  return new Date().toISOString();
}

export function localTimestamp(date = new Date()) {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
    ".",
    pad(date.getMilliseconds(), 3)
  ].join("");
}

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function padProviderDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function makeProviderConfigId(channel: string | null | undefined, value = new Date()) {
  const normalizedChannel = normalizeProviderChannel(channel);
  const prefix = normalizedChannel === "chatgpt_web" ? "CHATGPT-WEB" : normalizedChannel.toUpperCase();
  const timestamp = [
    value.getFullYear(),
    padProviderDatePart(value.getMonth() + 1),
    padProviderDatePart(value.getDate()),
    padProviderDatePart(value.getHours()),
    padProviderDatePart(value.getMinutes())
  ].join("");
  return `${prefix}-${timestamp}`;
}

export function normalizeCategoryType(value: unknown): CategoryType {
  return String(value ?? "").trim() === "asset" ? "asset" : "case";
}

export function normalizeAssetSpace(value: unknown): AssetSpace {
  return String(value ?? "").trim() === "shared" ? "shared" : "private";
}

export function normalizeAssetUploadMode(value: unknown, fallbackSpace?: unknown): AssetUploadMode {
  const normalized = String(value ?? "").trim();
  if (normalized === "private_shared") return "private_shared";
  if (normalized === "shared") return "shared";
  if (normalized === "private") return "private";
  return normalizeAssetSpace(fallbackSpace);
}

export function normalizeAssetShareStatus(value: unknown): AssetShareStatus {
  const normalized = String(value ?? "").trim();
  if (normalized === "pending" || normalized === "approved" || normalized === "rejected") return normalized;
  return "none";
}

export type ReviewStatus = "pending" | "approved" | "rejected";

export function normalizeReviewStatus(value: unknown): ReviewStatus {
  const normalized = String(value ?? "").trim();
  if (normalized === "pending" || normalized === "rejected") return normalized;
  return "approved";
}

export function approvedSharedAssetSql(alias = "assets") {
  return `((${alias}.space = 'shared' or ${alias}.shared = 1) and coalesce(${alias}.share_status, 'approved') = 'approved')`;
}

export function visibleAssetSql(alias = "assets") {
  return `(${alias}.user_id = ? or ${approvedSharedAssetSql(alias)})`;
}

export function reviewableSharedAssetSql(alias = "assets") {
  return `(coalesce(${alias}.share_status, 'none') in ('pending', 'approved', 'rejected') or ${approvedSharedAssetSql(alias)})`;
}

export function approvedCaseSql(alias = "case_items") {
  return `coalesce(${alias}.review_status, 'approved') = 'approved'`;
}

export function visibleCaseSql(alias = "case_items") {
  return `(${alias}.user_id = ? or ${approvedCaseSql(alias)})`;
}

export function reviewableCaseSql(alias = "case_items") {
  return `coalesce(${alias}.review_status, 'approved') in ('pending', 'approved', 'rejected')`;
}

export function normalizeIdList(value: unknown): string[] {
  const rawValues =
    typeof value === "string" && value.trim().startsWith("[")
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [value];
          } catch {
            return [value];
          }
        })()
      : Array.isArray(value)
        ? value
        : [value];
  return Array.from(
    new Set(
      rawValues
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    )
  );
}

export function normalizeAssetNameInput(value: unknown, asset: AssetRow) {
  const ext = path.extname(asset.name) || path.extname(asset.path);
  const rawName = String(value ?? "")
    .trim()
    .replace(/[\\/]/g, " ")
    .replace(/\s+/g, " ");
  const inputExt = path.extname(rawName);
  const baseName = (inputExt ? rawName.slice(0, -inputExt.length) : rawName).trim();
  if (!baseName) return "";
  return ext ? `${baseName}${ext}` : baseName;
}

export function parseJsonArray(value: string | null | undefined, fallback: string[]) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : fallback;
  } catch {
    return fallback;
  }
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function maskSecret(value: string | null | undefined) {
  if (!value) return "";
  if (value.includes("****")) return value;
  if (value.length <= 6) return "******";
  return `${value.slice(0, 3)}****${value.slice(-3)}`;
}

export function escapeToml(value: string | null | undefined) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function normalizePath(baseUrl: string, childPath: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${childPath.replace(/^\/+/, "")}`;
}

export function normalizeProviderChannel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "cpa" || normalized === "chatgpt_web" || normalized === "api") return normalized;
  if (normalized === "studio" || normalized === "official" || normalized === "chatgpt" || normalized === "web") {
    return "chatgpt_web";
  }
  return "api";
}

export function normalizeImageGenerationMode(value: string | null | undefined): ImageGenerationSettings["mode"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "chatgpt_web" ||
    normalized === "web" ||
    normalized === "legacy" ||
    normalized === "conversation" ||
    normalized === "studio_legacy" ||
    normalized === "official" ||
    normalized === "studio" ||
    normalized === "responses" ||
    normalized === "studio_responses"
  ) {
    return "chatgpt_web";
  }
  if (normalized === "cpa") return "cpa";
  if (normalized === "api" || normalized === "custom" || normalized === "openai") return "api";
  return "auto";
}

export function normalizeRouteMode(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "responses" || normalized === "auto") return normalized;
  return "images_api";
}

export function inferChannelFromType(type: string | null | undefined) {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (normalized.includes("studio") || normalized.includes("official") || normalized.includes("chatgpt")) {
    return "chatgpt_web";
  }
  if (normalized.includes("cpa")) return "cpa";
  return "api";
}

export function normalizeQuotaMode(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "official_first" ||
    normalized === "codex_only" ||
    normalized === "official_only"
  ) {
    return normalized;
  }
  return "codex_first";
}

export function normalizeWebAccountMode(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "round_robin" || normalized === "random") return normalized;
  return "priority";
}

export function normalizeImageAccountStatus(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "limited" || normalized === "abnormal" || normalized === "disabled") {
    return normalized;
  }
  return "normal";
}

function firstStringFromObject(source: unknown, keys: string[]): string {
  if (!source || typeof source !== "object") return "";
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      const found = firstStringFromObject(value, keys);
      if (found) return found;
    }
  }
  return "";
}

export function extractAuthJsonMeta(authJson: string) {
  try {
    const parsed = JSON.parse(authJson);
    return {
      accessToken: firstStringFromObject(parsed, ["access_token", "accessToken", "token"]),
      email: firstStringFromObject(parsed, ["email", "account_email", "username"]),
      accountType: firstStringFromObject(parsed, ["account_type", "type", "plan_type", "chatgpt_plan_type"]),
      accountId: firstStringFromObject(parsed, ["account_id", "accountId", "chatgpt_account_id", "chatgptAccountId"]),
      cookies: firstStringFromObject(parsed, ["cookies", "cookie"])
    };
  } catch {
    return { accessToken: "", email: "", accountType: "", accountId: "", cookies: "" };
  }
}
