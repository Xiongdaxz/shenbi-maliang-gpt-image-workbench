import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { Context, Hono } from "hono";
import { currentUser, futureDate, requireUser } from "./auth";
import { appDb, getAll, getOne, run } from "./db";
import {
  externalMcpLogicalDeviceId,
  externalMcpRequestMetadata,
  isGenericOrPlaceholderExternalMcpDeviceName,
  MALIANG_MCP_SCOPES,
  maliangMcpResourceUrl,
  maliangProtectedResourceMetadataUrl,
  maliangPublicBaseUrl,
  mcpScopeText,
  normalizeExternalMcpDeviceType,
  normalizeUsableExternalMcpDeviceName,
  normalizeMcpScopes,
  oauthTokenHash,
  oauthTokensEqual,
  recordExternalMcpGrantAccess
} from "./externalMcpAuth";
import { isPublicIpAddress, normalizeIpAddress, resolvePublicIpLocation } from "./ipLocation";
import { externalMcpTokenTtlSeconds } from "./externalMcpSettings";
import { localTimestamp, makeId, now, parseJsonArray, utcNow } from "./utils";

const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
const AUTHORIZATION_REQUEST_TTL_SECONDS = 10 * 60;
const ACCESS_LOCATION_REFRESH_MS = 6 * 60 * 60 * 1000;
const OAUTH_CLIENT_ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
const OAUTH_REGISTRATION_BODY_MAX_BYTES = 16 * 1024;
const OAUTH_FORM_BODY_MAX_BYTES = 16 * 1024;
const OAUTH_FORM_FIELD_MAX_COUNT = 16;
const OAUTH_FORM_FIELD_NAME_MAX_LENGTH = 64;
const OAUTH_FORM_FIELD_VALUE_MAX_LENGTH = 4_096;
const OAUTH_FORM_FIELD_VALUE_LIMITS: Readonly<Record<string, number>> = {
  client_id: 200,
  code: 512,
  code_verifier: 128,
  decision: 16,
  grant_type: 64,
  redirect_uri: 2_048,
  refresh_token: 512,
  request_id: 200,
  scope: 512,
  token: 512,
  token_type_hint: 128
};
const OAUTH_TOKEN_CLEANUP_BATCH_SIZE = 1_000;
const OAUTH_REGISTRATION_LIMIT = 12;
const OAUTH_REGISTRATION_WINDOW_MS = 60 * 1000;
export const OAUTH_BROWSER_REDIRECT_STATUS = 303 as const;

type RegistrationLimitEntry = { count: number; resetAt: number };

export class ExternalMcpRegistrationLimiter {
  private readonly entries = new Map<string, RegistrationLimitEntry>();

  constructor(
    private readonly limit = OAUTH_REGISTRATION_LIMIT,
    private readonly windowMs = OAUTH_REGISTRATION_WINDOW_MS,
    private readonly maximumKeys = 5_000
  ) {}

  consume(key: string, timestamp = Date.now()) {
    const normalizedKey = key.trim() || "unknown";
    let entry = this.entries.get(normalizedKey);
    if (!entry || entry.resetAt <= timestamp) {
      if (this.entries.size >= this.maximumKeys) {
        for (const [candidate, value] of this.entries) {
          if (value.resetAt <= timestamp) this.entries.delete(candidate);
        }
        if (this.entries.size >= this.maximumKeys) {
          const oldest = [...this.entries.entries()].sort((left, right) => left[1].resetAt - right[1].resetAt)[0]?.[0];
          if (oldest) this.entries.delete(oldest);
        }
      }
      entry = { count: 0, resetAt: timestamp + this.windowMs };
      this.entries.set(normalizedKey, entry);
    }
    if (entry.count >= this.limit) return Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1000));
    entry.count += 1;
    return 0;
  }
}

const externalMcpRegistrationLimiter = new ExternalMcpRegistrationLimiter();

export async function readExternalMcpRegistrationBody(
  request: Request,
  maximumBytes = OAUTH_REGISTRATION_BODY_MAX_BYTES
) {
  const contentType = String(request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType && !contentType.includes("application/json")) throw new Error("registration_content_type");
  const declaredLengthText = String(request.headers.get("content-length") ?? "").trim();
  if (declaredLengthText) {
    const declaredLength = Number(declaredLengthText);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) throw new Error("registration_body_invalid");
    if (declaredLength > maximumBytes) throw new Error("registration_body_too_large");
  }
  if (!request.body) return {} as Record<string, unknown>;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("registration_body_too_large");
    }
    chunks.push(value);
  }
  try {
    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    const value = text ? JSON.parse(text) as unknown : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("registration_body_invalid");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === "registration_body_invalid") throw error;
    throw new Error("registration_body_invalid");
  }
}

export async function readExternalMcpFormBody(
  request: Request,
  maximumBytes = OAUTH_FORM_BODY_MAX_BYTES
) {
  const contentType = String(request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") throw new Error("oauth_form_content_type");
  const declaredLengthText = String(request.headers.get("content-length") ?? "").trim();
  if (declaredLengthText) {
    const declaredLength = Number(declaredLengthText);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) throw new Error("oauth_form_invalid");
    if (declaredLength > maximumBytes) throw new Error("oauth_form_too_large");
  }
  if (!request.body) return new URLSearchParams();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("oauth_form_too_large");
    }
    chunks.push(value);
  }
  const form = new URLSearchParams(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
  const names = new Set<string>();
  let fieldCount = 0;
  for (const [name, value] of form) {
    fieldCount += 1;
    if (
      fieldCount > OAUTH_FORM_FIELD_MAX_COUNT
      || !name
      || name.length > OAUTH_FORM_FIELD_NAME_MAX_LENGTH
      || value.length > (OAUTH_FORM_FIELD_VALUE_LIMITS[name] ?? OAUTH_FORM_FIELD_VALUE_MAX_LENGTH)
      || names.has(name)
    ) throw new Error("oauth_form_invalid");
    names.add(name);
  }
  return form;
}

type ExternalMcpAccessLocationRow = {
  client_id: string;
  last_access_at: string | null;
  last_access_ip: string;
  last_access_public_ip: string;
  last_access_region: string;
  last_access_geo_at: string | null;
};

function accessLocationExpired(value: string | null) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return !Number.isFinite(timestamp) || Date.now() - timestamp >= ACCESS_LOCATION_REFRESH_MS;
}

export async function enrichExternalMcpAccessLocation(
  db: Database,
  userId: string,
  row: ExternalMcpAccessLocationRow
) {
  const transportIp = normalizeIpAddress(row.last_access_ip);
  const transportIsPublic = isPublicIpAddress(transportIp);
  if (!transportIsPublic) {
    if (row.last_access_public_ip || row.last_access_region || row.last_access_geo_at) {
      run(
        db,
        "update oauth_grants set last_access_public_ip = '', last_access_region = '', last_access_geo_at = null where user_id = ? and client_id = ?",
        userId,
        row.client_id
      );
    }
    return {
      ip: transportIp,
      region: "",
      status: row.last_access_at && transportIp ? "private" as const : "unavailable" as const
    };
  }

  const currentPublicIp = transportIp;
  const currentRegion = currentPublicIp === row.last_access_public_ip.trim() ? row.last_access_region.trim() : "";
  const shouldRefresh = Boolean(row.last_access_at) && (
    !currentPublicIp
    || !currentRegion
    || accessLocationExpired(row.last_access_geo_at)
    || (transportIsPublic && currentPublicIp !== row.last_access_public_ip.trim())
  );
  if (!shouldRefresh) return { ip: currentPublicIp, region: currentRegion, status: "available" as const };

  const location = await resolvePublicIpLocation(transportIp);
  if (!location) {
    if (currentPublicIp !== row.last_access_public_ip.trim()) {
      run(
        db,
        "update oauth_grants set last_access_public_ip = ?, last_access_region = '', last_access_geo_at = null where user_id = ? and client_id = ?",
        currentPublicIp,
        userId,
        row.client_id
      );
    }
    return { ip: currentPublicIp, region: currentRegion, status: "available" as const };
  }

  run(
    db,
    "update oauth_grants set last_access_public_ip = ?, last_access_region = ?, last_access_geo_at = ? where user_id = ? and client_id = ?",
    location.ip,
    location.region,
    now(),
    userId,
    row.client_id
  );
  return { ...location, status: "available" as const };
}

type OAuthClientRow = {
  id: string;
  application_type: string;
  client_name: string;
  client_uri: string;
  software_id: string;
  software_version: string;
  device_name: string;
  device_type: string;
  user_agent: string;
  redirect_uris_json: string;
  grant_types_json: string;
  response_types_json: string;
  token_endpoint_auth_method: string;
  created_at: string;
  updated_at: string;
};

type ExternalMcpDeviceGrantRow = {
  grant_id: string;
  client_id: string;
  client_name: string;
  software_id: string;
  device_name: string;
  device_type: string;
  user_agent: string;
  revoked_at: string | null;
};

export function externalMcpConnectionDeviceId(row: Omit<ExternalMcpDeviceGrantRow, "grant_id" | "revoked_at">) {
  return externalMcpLogicalDeviceId({
    clientName: row.client_name,
    softwareId: row.software_id,
    userAgent: row.user_agent,
    deviceName: row.device_name,
    deviceType: row.device_type
  }) || row.client_id;
}

function externalMcpDeviceGrantRows(db: Database, userId: string) {
  return getAll<ExternalMcpDeviceGrantRow>(
    db,
    `select oauth_grants.id as grant_id, oauth_grants.client_id, oauth_grants.revoked_at,
            oauth_clients.client_name, oauth_clients.software_id, oauth_clients.device_name,
            oauth_clients.device_type, oauth_clients.user_agent
     from oauth_grants
     join oauth_clients on oauth_clients.id = oauth_grants.client_id
     where oauth_grants.user_id = ?`,
    userId
  );
}

function externalMcpDeviceGrantGroup(db: Database, userId: string, deviceIdOrClientId: string) {
  const rows = externalMcpDeviceGrantRows(db, userId);
  const target = rows.find((row) => (
    row.client_id === deviceIdOrClientId || externalMcpConnectionDeviceId(row) === deviceIdOrClientId
  ));
  if (!target) return [];
  const deviceId = externalMcpConnectionDeviceId(target);
  return rows.filter((row) => externalMcpConnectionDeviceId(row) === deviceId);
}

type AuthorizationRequestRow = {
  id: string;
  user_id: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

function randomOAuthToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function oauthClientMetadataText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

function oauthClientMetadataUrl(value: unknown) {
  const raw = oauthClientMetadataText(value, 500);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function inferExternalMcpDeviceName(userAgent: string, _clientName = "") {
  void userAgent;
  return "未知设备";
}

export function inferExternalMcpDeviceType(userAgent: string) {
  return normalizeExternalMcpDeviceType(userAgent);
}

export function resolveExternalMcpRegistrationDeviceMetadata(input: {
  clientName: string;
  userAgent: string;
  deviceName?: unknown;
  deviceLabel?: unknown;
  deviceType?: unknown;
  devicePlatform?: unknown;
  requestDeviceName?: unknown;
  requestDeviceType?: unknown;
}) {
  const deviceName = normalizeUsableExternalMcpDeviceName(
    input.deviceName,
    input.deviceLabel,
    input.requestDeviceName
  );
  return {
    deviceName: resolveExternalMcpDeviceName(deviceName, input.userAgent),
    deviceType: normalizeExternalMcpDeviceType(
      input.deviceType,
      input.devicePlatform,
      input.requestDeviceType
    ) || inferExternalMcpDeviceType(input.userAgent)
  };
}

function genericExternalMcpDeviceName(value: string) {
  return isGenericOrPlaceholderExternalMcpDeviceName(value);
}

export function resolveExternalMcpDeviceName(deviceName: string, userAgent: string) {
  const registeredName = deviceName.trim();
  if (!genericExternalMcpDeviceName(registeredName)) return registeredName;
  return inferExternalMcpDeviceName(userAgent);
}

export function resolveExternalMcpDeviceType(deviceType: string, userAgent: string) {
  return normalizeExternalMcpDeviceType(deviceType) || inferExternalMcpDeviceType(userAgent);
}

export function isExternalMcpLocalDevice(
  deviceName: string,
  localDeviceNames: Array<string | undefined> = [Bun.env.COMPUTERNAME, Bun.env.HOSTNAME]
) {
  const normalizedDeviceName = deviceName.trim().toLowerCase();
  if (!normalizedDeviceName || genericExternalMcpDeviceName(normalizedDeviceName)) return false;
  return localDeviceNames.some((value) => value?.trim().toLowerCase() === normalizedDeviceName);
}

export function inferExternalMcpSoftwareVersion(userAgent: string, clientName = "") {
  const normalizedName = clientName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    normalizedName ? new RegExp(`${normalizedName}(?:_cli_rs)?[\\s/]([0-9][A-Za-z0-9._+-]*)`, "i") : null,
    /codex(?:_cli_rs)?[\s/]([0-9][A-Za-z0-9._+-]*)/i
  ].filter((pattern): pattern is RegExp => Boolean(pattern));
  for (const pattern of patterns) {
    const match = userAgent.match(pattern);
    if (match?.[1]) return match[1].slice(0, 80);
  }
  return "";
}

function noStore(c: Context) {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
}

function oauthError(c: Context, error: string, description: string, status: 400 | 401 | 413 | 429 = 400) {
  noStore(c);
  return c.json({ error, error_description: description }, status);
}

function oauthFormError(c: Context, error: unknown) {
  const reason = error instanceof Error ? error.message : "oauth_form_invalid";
  if (reason === "oauth_form_too_large") {
    return oauthError(c, "invalid_request", "OAuth 请求体不能超过 16 KB", 413);
  }
  if (reason === "oauth_form_content_type") {
    return oauthError(c, "invalid_request", "OAuth 请求必须使用 application/x-www-form-urlencoded");
  }
  return oauthError(c, "invalid_request", "OAuth 表单字段无效或重复");
}

function oauthAuthorizationFormError(c: Context, error: unknown) {
  const reason = error instanceof Error ? error.message : "oauth_form_invalid";
  const tooLarge = reason === "oauth_form_too_large";
  const message = tooLarge
    ? "授权请求体不能超过 16 KB，请回到智能体重新发起连接。"
    : "授权表单无效，请回到智能体重新发起连接。";
  return c.html(externalMcpAuthorizationErrorPage(message), tooLarge ? 413 : 400);
}

function redirectWithParams(redirectUri: string, params: Record<string, string>) {
  const target = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) target.searchParams.set(key, value);
  }
  return target.toString();
}

export function externalMcpAuthorizationResponseParams<T extends Record<string, string>>(
  issuer: string,
  params: T
): T & { iss: string } {
  return { ...params, iss: issuer };
}

export function externalMcpAuthorizationRedirectUrl<T extends Record<string, string>>(
  redirectUri: string,
  issuer: string,
  params: T
) {
  return redirectWithParams(redirectUri, externalMcpAuthorizationResponseParams(issuer, params));
}

export function externalMcpAuthorizationCodeRedirectUriMatches(
  authorizationRedirectUri: string,
  tokenRedirectUri: string
) {
  return authorizationRedirectUri === tokenRedirectUri;
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export type ExternalMcpRedirectUriKind = "https" | "loopback" | "workbuddy";

const WORKBUDDY_CALLBACK_PATH = /^\/mcp\/(?:custom-mcp|connector)(?::|%3[Aa])[A-Za-z0-9](?:[A-Za-z0-9._~-]{0,127})?\/oauth\/callback$/;

export function classifyExternalMcpRedirectUri(value: unknown): ExternalMcpRedirectUriKind | null {
  try {
    if (typeof value !== "string" || !value || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
    const url = new URL(value);
    if (url.username || url.password || url.hash) return null;
    if (url.protocol === "https:") return "https";
    if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return "loopback";
    if (
      url.protocol === "workbuddy:"
      && url.hostname === "workbuddy"
      && !url.port
      && !url.search
      && WORKBUDDY_CALLBACK_PATH.test(url.pathname)
    ) return "workbuddy";
    return null;
  } catch {
    return null;
  }
}

export function isExternalMcpRedirectUriAllowed(value: unknown, applicationType: string) {
  const kind = classifyExternalMcpRedirectUri(value);
  const normalizedApplicationType = applicationType.trim().toLowerCase();
  if (!kind || (normalizedApplicationType !== "native" && normalizedApplicationType !== "web")) return false;
  return normalizedApplicationType === "web" ? kind === "https" : true;
}

function externalMcpRedirectUriCspSource(redirectUri: string) {
  return classifyExternalMcpRedirectUri(redirectUri) === "workbuddy"
    ? "workbuddy:"
    : new URL(redirectUri).origin;
}

export function externalMcpRedirectUriDisplay(redirectUri: string) {
  return classifyExternalMcpRedirectUri(redirectUri) === "workbuddy"
    ? "workbuddy://workbuddy"
    : new URL(redirectUri).origin;
}

function clientRedirectUris(client: OAuthClientRow) {
  return parseJsonArray(client.redirect_uris_json, []);
}

export function externalMcpClientSupportsGrant(grantTypesJson: string, grantType: string) {
  return parseJsonArray(grantTypesJson, []).includes(grantType);
}

function clientResponseTypes(client: OAuthClientRow) {
  return parseJsonArray(client.response_types_json, []);
}

function oauthClientMetadataArray(
  value: unknown,
  fallback: readonly string[],
  allowedValues: readonly string[],
  maximumItems: number,
  maximumItemLength = 200
) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumItems) return null;
  const values = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (values.some((item) => !item || item.length > maximumItemLength || !allowedValues.includes(item))) return null;
  return Array.from(new Set(values));
}

export function normalizeExternalMcpGrantTypes(value: unknown) {
  return oauthClientMetadataArray(
    value,
    ["authorization_code"],
    ["authorization_code", "refresh_token"],
    2
  );
}

function requestedScopes(value: unknown) {
  const raw = String(value ?? "").trim();
  const normalized = normalizeMcpScopes(raw || MALIANG_MCP_SCOPES);
  const requestedCount = (raw || mcpScopeText(MALIANG_MCP_SCOPES)).split(/\s+/).filter(Boolean).length;
  return normalized.length === requestedCount ? normalized : null;
}

function validCodeChallenge(value: string) {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function validCodeVerifier(value: string) {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

function cleanupOAuthRecords() {
  const cutoff = utcNow();
  cleanupExpiredExternalMcpTokens(appDb, cutoff);
  run(appDb, "delete from oauth_authorization_codes where expires_at <= ?", cutoff);
  run(
    appDb,
    `delete from oauth_authorization_requests
     where expires_at <= ?
       and not exists (
         select 1 from oauth_authorization_codes
         where oauth_authorization_codes.request_id = oauth_authorization_requests.id
           and oauth_authorization_codes.expires_at > ?
           and oauth_authorization_codes.consumed_at is null
       )`,
    cutoff,
    cutoff
  );
  cleanupOrphanedExternalMcpClients(
    appDb,
    localTimestamp(new Date(Date.now() - OAUTH_CLIENT_ORPHAN_TTL_MS))
  );
}

export function cleanupExpiredExternalMcpTokens(db: Database, expiredBefore = utcNow()) {
  return db.transaction(() => {
    const accessResult = run(
      db,
      `delete from oauth_access_tokens
       where id in (
         select id from oauth_access_tokens
         where expires_at <= ?
         order by expires_at, id
         limit ?
       )`,
      expiredBefore,
      OAUTH_TOKEN_CLEANUP_BATCH_SIZE
    );
    run(
      db,
      `update oauth_refresh_tokens
       set parent_token_id = null
       where parent_token_id in (
         select id from oauth_refresh_tokens
         where expires_at <= ?
         order by expires_at, id
         limit ?
       )`,
      expiredBefore,
      OAUTH_TOKEN_CLEANUP_BATCH_SIZE
    );
    const refreshResult = run(
      db,
      `delete from oauth_refresh_tokens
       where id in (
         select id from oauth_refresh_tokens
         where expires_at <= ?
         order by expires_at, id
         limit ?
       )`,
      expiredBefore,
      OAUTH_TOKEN_CLEANUP_BATCH_SIZE
    );
    return {
      accessTokens: Number(accessResult.changes ?? 0),
      refreshTokens: Number(refreshResult.changes ?? 0)
    };
  })();
}

export function invalidateExternalMcpCredentialsForReauthorization(
  db: Database,
  grantId: string,
  previousScope: string,
  nextScope: string,
  timestamp = now()
) {
  run(
    db,
    "update oauth_authorization_codes set consumed_at = coalesce(consumed_at, ?) where grant_id = ?",
    timestamp,
    grantId
  );
  if (mcpScopeText(normalizeMcpScopes(previousScope)) === mcpScopeText(normalizeMcpScopes(nextScope))) return false;
  run(db, "update oauth_access_tokens set revoked_at = coalesce(revoked_at, ?) where grant_id = ?", timestamp, grantId);
  run(db, "update oauth_refresh_tokens set revoked_at = coalesce(revoked_at, ?) where grant_id = ?", timestamp, grantId);
  return true;
}

export function cleanupOrphanedExternalMcpClients(db: Database, createdBefore: string) {
  const result = run(
    db,
    `delete from oauth_clients
     where created_at <= ?
       and not exists (
         select 1 from oauth_authorization_requests
         where oauth_authorization_requests.client_id = oauth_clients.id
       )
       and not exists (
         select 1 from oauth_grants
         where oauth_grants.client_id = oauth_clients.id
       )`,
    createdBefore
  );
  return Number(result.changes ?? 0);
}

export function externalMcpAuthorizationPage(input: {
  clientName: string;
  callbackOrigin: string;
  userName: string;
  requestId: string;
  scopes: string[];
  scriptNonce: string;
}) {
  const { clientName, callbackOrigin, userName, requestId, scopes, scriptNonce } = input;
  const permissionRows = scopes.map((scope) => {
    const permission = scope === "profile:read"
      ? { name: "读取账号信息", description: "识别当前账号并确认登录状态" }
      : { name: "使用图片生成与编辑", description: "创建、编辑和查看由你发起的图片任务" };
    return `<li><span class="permission-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.68 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg></span><div><strong>${escapeHtml(permission.name)}</strong><p>${escapeHtml(permission.description)}</p></div></li>`;
  }).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>授权连接神笔马良</title>
  <link rel="icon" type="image/webp" href="/image/logo-small.webp" />
  <style>
    :root{color-scheme:light;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f1e9;color:#2b211c}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;background:radial-gradient(circle at 12% 8%,rgba(240,170,91,.22) 0,transparent 32%),radial-gradient(circle at 92% 88%,rgba(201,100,66,.13) 0,transparent 34%),#f5f1e9}
    main{width:min(520px,100%);background:rgba(255,253,248,.96);border:1px solid rgba(122,83,59,.16);border-radius:22px;box-shadow:0 24px 65px rgba(74,47,31,.14);padding:30px}
    .brand{display:flex;align-items:center;gap:12px;color:#7a3c27;font-weight:800}.brand-icon{width:46px;height:46px;display:grid;place-items:center;border:1px solid #ead8c6;border-radius:14px;background:#fff8ed;box-shadow:0 7px 18px rgba(135,75,41,.1)}.brand-icon img{display:block;width:42px;height:42px;object-fit:contain}
    h1{margin:24px 0 8px;font-size:26px;line-height:1.3;letter-spacing:-.015em}.lead{margin:0;color:#6f6259;line-height:1.75}.client{color:#2b211c;font-weight:750}
    ul{list-style:none;padding:0;margin:24px 0;border-top:1px solid #eadfd4}li{display:flex;gap:12px;padding:16px 0;border-bottom:1px solid #eadfd4}.permission-icon{display:grid;place-items:center;flex:0 0 28px;height:28px;border:1px solid #efd8c8;border-radius:9px;background:#fff3e8;color:#b95c3d}.permission-icon svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}li strong{font-size:14px}li p{margin:4px 0 0;color:#756960;font-size:13px;line-height:1.55}
    .account,.client-warning{padding:12px 14px;border:1px solid #eee2d7;border-radius:12px;background:#faf5ee;color:#5f5148;font-size:13px}.client-warning{margin-top:10px;background:#fff8ed;border-color:#efd8c8;line-height:1.6}.client-warning strong{display:block;color:#8a442e}.callback{display:block;margin-top:4px;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#5c4438}.actions{display:grid;grid-template-columns:1fr 1.5fr;gap:12px;margin-top:22px}button{border:0;border-radius:12px;padding:13px 16px;font:inherit;font-weight:750;cursor:pointer;transition:opacity .15s ease,filter .15s ease,box-shadow .15s ease,transform .15s ease}button:not(:disabled):active{transform:translateY(1px)}button:disabled{cursor:wait;opacity:.62;box-shadow:none}.deny{background:#f0ebe5;color:#5b5049}.allow{background:#c96442;color:white;box-shadow:0 10px 24px rgba(166,75,47,.22)}.allow:hover{filter:brightness(.96)}.submit-status{margin:12px 0 0;color:#a54d30;font-size:13px;font-weight:700;line-height:1.55;text-align:center}.notice{margin:18px 0 0;color:#91847a;font-size:12px;line-height:1.65;text-align:center}
    @media(prefers-color-scheme:dark){:root{color-scheme:dark;background:#211a17;color:#f7efe8}body{background:radial-gradient(circle at 12% 8%,rgba(154,89,45,.23) 0,transparent 32%),radial-gradient(circle at 92% 88%,rgba(138,64,43,.17) 0,transparent 34%),#211a17}main{background:rgba(43,34,29,.97);border-color:#5b4639}.brand{color:#f2b394}.brand-icon{border-color:#684b39;background:#382a23}.lead,li p,.account{color:#c6b7ac}.client{color:#fff8f2}ul,li{border-color:#58463a}.permission-icon{border-color:#704a38;background:#3d2b23;color:#f0a280}.account{border-color:#58463a;background:#352a24}.client-warning{border-color:#704a38;background:#3d2b23;color:#d7c4b7}.client-warning strong{color:#f0a280}.callback{color:#ead8ca}.deny{background:#3c302a;color:#e8ddd5}.notice{color:#a9978a}}
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="brand-icon"><img src="/image/logo-small.webp" alt="" /></span><span>神笔马良</span></div>
    <h1>允许 <span class="client">${escapeHtml(clientName)}</span> 连接？</h1>
    <p class="lead">连接后，该智能体会通过你的马良账号使用以下功能。你的密码和登录凭据不会提供给智能体。</p>
    <ul>${permissionRows}</ul>
    <div class="account">当前账号：${escapeHtml(userName)}</div>
    <div class="client-warning"><strong>动态注册的未验证智能体</strong>智能体名称由连接方自行提供，授权结果将返回到：<span class="callback">${escapeHtml(callbackOrigin)}</span></div>
    <form method="post" action="/oauth/authorize" data-oauth-authorize-form>
      <input type="hidden" name="request_id" value="${escapeHtml(requestId)}" />
      <div class="actions">
        <button class="deny" type="submit" name="decision" value="deny">取消</button>
        <button class="allow" type="submit" name="decision" value="allow">允许连接</button>
      </div>
      <p class="submit-status" data-oauth-submit-status role="status" aria-live="polite" hidden>正在处理，请勿重复点击、刷新或返回…</p>
    </form>
    <p class="notice">授权后可前往神笔马良「设置 &gt; 插件」随时断开或移除。请只连接你信任的智能体。</p>
  </main>
  <script nonce="${escapeHtml(scriptNonce)}">
    (() => {
      const form = document.querySelector("[data-oauth-authorize-form]");
      const status = document.querySelector("[data-oauth-submit-status]");
      if (!(form instanceof HTMLFormElement)) return;
      let submitted = false;
      form.addEventListener("submit", (event) => {
        if (submitted) {
          event.preventDefault();
          return;
        }
        submitted = true;
        const submitter = event.submitter;
        if (submitter instanceof HTMLButtonElement && submitter.name) {
          const decision = document.createElement("input");
          decision.type = "hidden";
          decision.name = submitter.name;
          decision.value = submitter.value;
          form.appendChild(decision);
        }
        form.setAttribute("aria-busy", "true");
        for (const button of form.querySelectorAll("button")) button.disabled = true;
        if (status instanceof HTMLElement) {
          status.hidden = false;
          status.textContent = submitter instanceof HTMLButtonElement && submitter.value === "deny"
            ? "正在取消连接，请稍候…"
            : "正在完成授权，请勿重复点击、刷新或返回…";
        }
      });
    })();
  </script>
</body>
</html>`;
}

export function externalMcpAuthorizationPageCsp(scriptNonce: string, redirectUri: string) {
  const callbackSource = externalMcpRedirectUriCspSource(redirectUri);
  return `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; form-action 'self' ${callbackSource}; frame-ancestors 'none'; base-uri 'none'`;
}

export function externalMcpAuthorizationSuccessPage(input: {
  callbackUrl: string;
  clientName: string;
  scriptNonce: string;
  statusUrl: string;
}) {
  const { callbackUrl, scriptNonce, statusUrl } = input;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>正在完成授权 - 神笔马良</title>
  <link rel="icon" type="image/webp" href="/image/logo-small.webp" />
  <style>
    :root{color-scheme:light;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f1e9;color:#2b211c}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 14% 12%,rgba(240,170,91,.18) 0,transparent 34%),radial-gradient(circle at 88% 88%,rgba(201,100,66,.1) 0,transparent 36%),#f5f1e9}
    main{width:min(420px,100%);background:rgba(255,253,248,.98);border:1px solid rgba(122,83,59,.14);border-radius:22px;box-shadow:0 22px 58px rgba(74,47,31,.12);padding:36px 30px;text-align:center}
    .brand{display:grid;place-items:center;gap:11px;color:#7a3c27;font-weight:800}.brand-icon{position:relative;width:66px;height:66px;display:grid;place-items:center;border:1px solid #ead8c6;border-radius:20px;background:#fff8ed;box-shadow:0 10px 26px rgba(135,75,41,.12)}.brand-icon img{display:block;width:60px;height:60px;object-fit:contain}.brand-check{position:absolute;right:-5px;bottom:-5px;width:25px;height:25px;display:none;place-items:center;border:3px solid #fffdf8;border-radius:999px;background:#4f875a;color:#fff}.brand-check svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}.is-complete .brand-check{display:grid}
    .title{margin:25px 0 0;font-size:28px;line-height:1.25;letter-spacing:-.02em}.message{max-width:320px;margin:11px auto 0;color:#7d6d63;font-size:14px;line-height:1.7}.action{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin-top:24px;border-radius:999px;background:#c96442;color:#fff;padding:0 23px;font-size:14px;font-weight:750;text-decoration:none;box-shadow:0 10px 24px rgba(166,75,47,.2)}.action:hover{filter:brightness(.96)}.action[hidden]{display:none}.is-failed .brand-icon{border-color:#e8c7ba;background:#fff1eb}.is-failed .brand-check{display:grid;background:#b7553a}.is-failed .brand-check svg{display:none}.is-failed .brand-check::before{content:"!";font-size:13px;font-weight:850;line-height:1}
    @media(prefers-color-scheme:dark){:root{color-scheme:dark;background:#211a17;color:#f7efe8}body{background:radial-gradient(circle at 14% 12%,rgba(154,89,45,.18) 0,transparent 34%),radial-gradient(circle at 88% 88%,rgba(138,64,43,.12) 0,transparent 36%),#211a17}main{background:#2b221d;border-color:#5b4639}.brand{color:#f2b394}.brand-icon{border-color:#684b39;background:#382a23}.brand-check{border-color:#2b221d}.message{color:#bba99d}.is-failed .brand-icon{border-color:#794938;background:#3b2821}}
  </style>
</head>
<body>
  <main data-success-card data-callback-url="${escapeHtml(callbackUrl)}" data-status-url="${escapeHtml(statusUrl)}">
    <div class="brand"><span class="brand-icon"><img src="/image/logo-small.webp" alt="" /><span class="brand-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-8" /></svg></span></span><span>神笔马良</span></div>
    <h1 class="title" data-success-title>正在完成授权</h1>
    <p class="message" data-success-message>正在将授权结果返回智能体，请稍候…</p>
    <a class="action" href="/" data-success-action hidden>返回神笔马良</a>
  </main>
  <script nonce="${escapeHtml(scriptNonce)}">
    (() => {
      const card = document.querySelector("[data-success-card]");
      if (!(card instanceof HTMLElement)) return;
      const callbackUrl = card.dataset.callbackUrl || "";
      const statusUrl = card.dataset.statusUrl || "";
      const title = card.querySelector("[data-success-title]");
      const message = card.querySelector("[data-success-message]");
      const action = card.querySelector("[data-success-action]");
      let settled = false;
      const complete = () => {
        if (settled) return;
        settled = true;
        card.classList.add("is-complete");
        document.title = "授权成功 - 神笔马良";
        if (title) title.textContent = "授权成功";
        if (message) message.textContent = "授权已完成，你可以返回神笔马良继续使用。";
        if (action instanceof HTMLElement) action.hidden = false;
      };
      const failed = (detail = "请返回智能体重新发起授权。") => {
        if (settled) return;
        settled = true;
        card.classList.add("is-failed");
        document.title = "授权未完成 - 神笔马良";
        if (title) title.textContent = "授权未完成";
        if (message) message.textContent = detail;
        if (action instanceof HTMLElement) action.hidden = false;
      };
      if (!callbackUrl || !statusUrl) {
        failed();
        return;
      }
      const handoffController = new AbortController();
      const handoffTimeout = window.setTimeout(() => handoffController.abort(), 10000);
      fetch(callbackUrl, {
        method: "GET",
        mode: "no-cors",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: handoffController.signal
      }).catch(() => failed("未能将授权结果返回智能体，请重新发起授权。"))
        .finally(() => window.clearTimeout(handoffTimeout));

      const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
      const pollStatus = async () => {
        const deadline = Date.now() + 30000;
        while (!settled && Date.now() < deadline) {
          const statusController = new AbortController();
          const statusTimeout = window.setTimeout(() => statusController.abort(), 2500);
          try {
            const response = await fetch(statusUrl, {
              method: "GET",
              credentials: "same-origin",
              cache: "no-store",
              headers: { Accept: "application/json" },
              signal: statusController.signal
            });
            if (response.ok) {
              const result = await response.json();
              if (result.status === "succeeded") {
                complete();
                return;
              }
              if (result.status === "expired") {
                failed("本次授权已过期，请返回智能体重新发起授权。");
                return;
              }
              if (result.status === "failed") {
                failed();
                return;
              }
            } else if (response.status === 401 || response.status === 404) {
              failed("登录状态或授权请求已失效，请重新发起授权。");
              return;
            }
          } catch {
            // 短暂网络异常由下一次轮询重试，最终仍以服务端令牌状态为准。
          } finally {
            window.clearTimeout(statusTimeout);
          }
          await wait(300);
        }
        if (!settled) failed("未能确认令牌签发，请返回智能体重新发起授权。");
      };
      void pollStatus();
    })();
  </script>
</body>
</html>`;
}

export function externalMcpAuthorizationSuccessPageCsp(scriptNonce: string, redirectUri: string) {
  const callbackSource = externalMcpRedirectUriCspSource(redirectUri);
  return `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; connect-src 'self' ${callbackSource}; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`;
}

export function externalMcpAuthorizationErrorPage(message: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>授权失败 - 神笔马良</title><link rel="icon" type="image/webp" href="/image/logo-small.webp"><style>*{box-sizing:border-box}body{font-family:Inter,system-ui,"Microsoft YaHei";background:#f5f1e9;color:#2b211c;min-height:100vh;display:grid;place-items:center;margin:0;padding:24px}.card{width:min(520px,100%);background:#fffdf8;border:1px solid #eadfd4;border-radius:20px;padding:30px;box-shadow:0 20px 60px #4a2f1f1c}.brand{display:flex;align-items:center;gap:10px;color:#7a3c27;font-weight:800}.brand-icon{width:42px;height:42px;display:grid;place-items:center;border:1px solid #ead8c6;border-radius:13px;background:#fff8ed}.brand-icon img{display:block;width:38px;height:38px;object-fit:contain}h1{margin:24px 0 8px;font-size:26px}p{margin:0;color:#6f6259;line-height:1.7}a{display:inline-flex;margin-top:22px;border-radius:999px;background:#f0ebe5;color:#5b5049;padding:10px 16px;font-size:14px;font-weight:700;text-decoration:none}</style></head><body><main class="card"><div class="brand"><span class="brand-icon"><img src="/image/logo-small.webp" alt=""></span><span>神笔马良</span></div><h1>暂时无法授权</h1><p>${escapeHtml(message)}</p><a href="/mcp">返回安装说明</a></main></body></html>`;
}

function issueTokens(input: {
  grantId: string;
  userId: string;
  clientId: string;
  scope: string;
  resource: string;
  familyId?: string;
  parentRefreshTokenId?: string | null;
  issueRefreshToken: boolean;
}) {
  const timestamp = now();
  const { accessTokenTtlSeconds, refreshTokenTtlSeconds } = externalMcpTokenTtlSeconds();
  const accessToken = randomOAuthToken();
  const familyId = input.familyId ?? randomUUID();
  const accessTokenId = makeId("oauthat");
  run(
    appDb,
    `insert into oauth_access_tokens
      (id, token_hash, family_id, grant_id, user_id, client_id, scope, resource, expires_at, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    accessTokenId,
    oauthTokenHash(accessToken),
    familyId,
    input.grantId,
    input.userId,
    input.clientId,
    input.scope,
    input.resource,
    futureDate(accessTokenTtlSeconds),
    timestamp
  );
  const response = {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: accessTokenTtlSeconds,
    scope: input.scope
  };
  if (!input.issueRefreshToken) return response;
  const refreshToken = randomOAuthToken(48);
  run(
    appDb,
    `insert into oauth_refresh_tokens
      (id, token_hash, family_id, parent_token_id, grant_id, user_id, client_id, scope, resource, expires_at, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    makeId("oauthrt"),
    oauthTokenHash(refreshToken),
    familyId,
    input.parentRefreshTokenId ?? null,
    input.grantId,
    input.userId,
    input.clientId,
    input.scope,
    input.resource,
    futureDate(refreshTokenTtlSeconds),
    timestamp
  );
  return { ...response, refresh_token: refreshToken };
}

export function recordExternalMcpRefreshSuccess(db: Database, grantId: string, timestamp = now()) {
  run(
    db,
    `update oauth_grants
     set last_refresh_at = ?, last_refresh_error = '', last_refresh_error_at = null, updated_at = ?
     where id = ?`,
    timestamp,
    timestamp,
    grantId
  );
}

export function recordExternalMcpRefreshFailure(
  db: Database,
  grantId: string,
  message: string,
  timestamp = now()
) {
  run(
    db,
    `update oauth_grants
     set last_refresh_error = ?, last_refresh_error_at = ?, updated_at = ?
     where id = ?`,
    message,
    timestamp,
    timestamp,
    grantId
  );
}

function revokeTokenFamily(familyId: string) {
  const timestamp = now();
  run(appDb, "update oauth_access_tokens set revoked_at = coalesce(revoked_at, ?) where family_id = ?", timestamp, familyId);
  run(appDb, "update oauth_refresh_tokens set revoked_at = coalesce(revoked_at, ?) where family_id = ?", timestamp, familyId);
}

export function revokeExternalMcpGrant(db: Database, userId: string, clientId: string, timestamp = now()) {
  const grants = externalMcpDeviceGrantGroup(db, userId, clientId);
  if (grants.length === 0) return false;
  db.transaction(() => {
    for (const grant of grants) {
      if (grant.revoked_at) continue;
      run(
        db,
        "update oauth_grants set revoked_at = ?, credential_version = credential_version + 1, updated_at = ? where id = ? and revoked_at is null",
        timestamp,
        timestamp,
        grant.grant_id
      );
      run(db, "update oauth_access_tokens set revoked_at = coalesce(revoked_at, ?) where grant_id = ?", timestamp, grant.grant_id);
      run(db, "update oauth_refresh_tokens set revoked_at = coalesce(revoked_at, ?) where grant_id = ?", timestamp, grant.grant_id);
      run(db, "update oauth_authorization_codes set consumed_at = coalesce(consumed_at, ?) where grant_id = ?", timestamp, grant.grant_id);
    }
  })();
  return true;
}

export type RestoreExternalMcpGrantResult = "restored" | "already_active" | "reauthorize" | "not_found";

export function restoreExternalMcpGrant(
  db: Database,
  userId: string,
  clientId: string,
  timestamp = now(),
  validAfter = utcNow()
): RestoreExternalMcpGrantResult {
  const grants = externalMcpDeviceGrantGroup(db, userId, clientId);
  if (grants.length === 0) return "not_found";
  if (grants.some((grant) => !grant.revoked_at)) return "already_active";
  const disconnectedAt = grants.reduce<string>((latest, grant) => (
    grant.revoked_at && grant.revoked_at > latest ? grant.revoked_at : latest
  ), "");
  if (!disconnectedAt) return "reauthorize";

  return db.transaction(() => {
    const restorableGrantIds = grants
      .filter((grant) => grant.revoked_at === disconnectedAt)
      .filter((grant) => Boolean(getOne<{ restorable: number }>(
        db,
        `select (
           exists(
             select 1 from oauth_access_tokens
             where grant_id = ? and revoked_at = ? and expires_at > ?
           )
           or exists(
             select 1 from oauth_refresh_tokens
             where grant_id = ? and revoked_at = ? and consumed_at is null and expires_at > ?
           )
         ) as restorable`,
        grant.grant_id,
        disconnectedAt,
        validAfter,
        grant.grant_id,
        disconnectedAt,
        validAfter
      )?.restorable))
      .map((grant) => grant.grant_id);
    if (restorableGrantIds.length === 0) return "reauthorize" as const;

    for (const grantId of restorableGrantIds) {
      run(
        db,
        "update oauth_access_tokens set revoked_at = null where grant_id = ? and revoked_at = ? and expires_at > ?",
        grantId,
        disconnectedAt,
        validAfter
      );
      run(
        db,
        "update oauth_refresh_tokens set revoked_at = null where grant_id = ? and revoked_at = ? and consumed_at is null and expires_at > ?",
        grantId,
        disconnectedAt,
        validAfter
      );
      run(
        db,
        "update oauth_grants set revoked_at = null, credential_version = credential_version + 1, updated_at = ? where id = ? and revoked_at = ?",
        timestamp,
        grantId,
        disconnectedAt
      );
    }
    return "restored" as const;
  })();
}

export function upsertExternalMcpGrantForAuthorization(
  db: Database,
  input: { userId: string; clientId: string; scope: string; timestamp?: string }
) {
  const timestamp = input.timestamp ?? now();
  const existing = getOne<{ id: string; scope: string }>(
    db,
    "select id, scope from oauth_grants where user_id = ? and client_id = ?",
    input.userId,
    input.clientId
  );
  const grantId = existing?.id ?? makeId("oauthgrant");
  if (existing) {
    invalidateExternalMcpCredentialsForReauthorization(db, grantId, existing.scope, input.scope, timestamp);
  }
  run(
    db,
    `insert into oauth_grants (id, user_id, client_id, scope, last_access_at, credential_version, revoked_at, created_at, updated_at)
     values (?, ?, ?, ?, null, 1, null, ?, ?)
     on conflict(user_id, client_id) do update set
       scope = excluded.scope,
       last_access_at = null,
       credential_version = oauth_grants.credential_version + 1,
       revoked_at = null,
       updated_at = excluded.updated_at`,
    grantId,
    input.userId,
    input.clientId,
    input.scope,
    timestamp,
    timestamp
  );
  return grantId;
}

export function updateExternalMcpGrantLabel(
  db: Database,
  userId: string,
  clientId: string,
  userLabel: string,
  timestamp = now()
) {
  const grants = externalMcpDeviceGrantGroup(db, userId, clientId);
  if (grants.length === 0) return false;
  db.transaction(() => {
    for (const grant of grants) {
      run(db, "update oauth_grants set user_label = ?, updated_at = ? where id = ?", userLabel, timestamp, grant.grant_id);
    }
  })();
  return true;
}

export function removeExternalMcpGrant(db: Database, userId: string, clientId: string) {
  const grants = externalMcpDeviceGrantGroup(db, userId, clientId);
  if (grants.length === 0) return false;
  db.transaction(() => {
    for (const grant of grants) run(db, "delete from oauth_grants where id = ? and user_id = ?", grant.grant_id, userId);
    for (const currentClientId of new Set(grants.map((grant) => grant.client_id))) {
      const remainingGrant = getOne<{ id: string }>(db, "select id from oauth_grants where client_id = ? limit 1", currentClientId);
      if (!remainingGrant) run(db, "delete from oauth_clients where id = ?", currentClientId);
    }
  })();
  return true;
}

export function hasCompletedExternalMcpGrant(db: Database, grantId: string) {
  const row = getOne<{ issued: number }>(
    db,
    `select (
       exists(select 1 from oauth_access_tokens where grant_id = ?)
       or exists(select 1 from oauth_refresh_tokens where grant_id = ?)
     ) as issued`,
    grantId,
    grantId
  );
  return Boolean(row?.issued);
}

export type ExternalMcpAuthorizationStatus = "pending" | "succeeded" | "expired" | "failed";

export function getExternalMcpAuthorizationStatus(
  db: Database,
  userId: string,
  requestId: string,
  timestamp = utcNow()
): ExternalMcpAuthorizationStatus | null {
  if (!requestId.trim()) return null;
  const row = getOne<{
    request_expires_at: string;
    request_consumed_at: string | null;
    code_id: string | null;
    code_expires_at: string | null;
    code_consumed_at: string | null;
    tokens_issued: number;
  }>(
    db,
    `select oauth_authorization_requests.expires_at as request_expires_at,
            oauth_authorization_requests.consumed_at as request_consumed_at,
            oauth_authorization_codes.id as code_id,
            oauth_authorization_codes.expires_at as code_expires_at,
            oauth_authorization_codes.consumed_at as code_consumed_at,
            case when oauth_authorization_codes.grant_id is not null and (
              exists(select 1 from oauth_access_tokens where grant_id = oauth_authorization_codes.grant_id)
              or exists(select 1 from oauth_refresh_tokens where grant_id = oauth_authorization_codes.grant_id)
            ) then 1 else 0 end as tokens_issued
       from oauth_authorization_requests
       left join oauth_authorization_codes
         on oauth_authorization_codes.request_id = oauth_authorization_requests.id
      where oauth_authorization_requests.id = ?
        and oauth_authorization_requests.user_id = ?
      order by oauth_authorization_codes.created_at desc
      limit 1`,
    requestId,
    userId
  );
  if (!row) return null;
  if (!row.code_id) {
    if (row.request_expires_at <= timestamp) return "expired";
    return row.request_consumed_at ? "failed" : "pending";
  }
  if (row.code_consumed_at) return row.tokens_issued ? "succeeded" : "failed";
  if (!row.code_expires_at || row.code_expires_at <= timestamp) return "expired";
  return "pending";
}

export function cleanupExpiredIncompleteExternalMcpGrants(
  db: Database,
  userId: string,
  timestamp = utcNow()
) {
  run(
    db,
    `delete from oauth_grants
     where user_id = ?
       and not exists (
         select 1 from oauth_access_tokens
         where oauth_access_tokens.grant_id = oauth_grants.id
       )
       and not exists (
         select 1 from oauth_refresh_tokens
         where oauth_refresh_tokens.grant_id = oauth_grants.id
       )
       and not exists (
         select 1 from oauth_authorization_codes
         where oauth_authorization_codes.grant_id = oauth_grants.id
           and oauth_authorization_codes.consumed_at is null
           and oauth_authorization_codes.expires_at > ?
       )`,
    userId,
    timestamp
  );
}

export function externalMcpAuthorizationServerMetadata(publicBaseUrl: string) {
  return {
    issuer: publicBaseUrl,
    authorization_endpoint: `${publicBaseUrl}/oauth/authorize`,
    token_endpoint: `${publicBaseUrl}/oauth/token`,
    registration_endpoint: `${publicBaseUrl}/oauth/register`,
    revocation_endpoint: `${publicBaseUrl}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MALIANG_MCP_SCOPES],
    service_documentation: `${publicBaseUrl}/mcp`
  };
}

export function externalMcpAuthorizationCallbackMode(applicationType: string, redirectUri = "") {
  const normalized = applicationType.trim().toLowerCase();
  return normalized === "web" || classifyExternalMcpRedirectUri(redirectUri) === "workbuddy"
    ? "redirect" as const
    : "background" as const;
}

export type ExternalMcpConnectionListRow = ExternalMcpDeviceGrantRow & {
  client_uri: string;
  software_version: string;
  grant_types_json: string;
  scope: string;
  user_label: string;
  last_access_at: string | null;
  last_access_ip: string;
  last_access_public_ip: string;
  last_access_region: string;
  last_access_geo_at: string | null;
  last_user_agent: string;
  last_refresh_at: string | null;
  last_refresh_error: string;
  last_refresh_error_at: string | null;
  created_at: string;
  updated_at: string;
  access_expires_at: string | null;
  refresh_expires_at: string | null;
  can_restore: number;
};

function latestTimestamp(values: Array<string | null | undefined>) {
  return values.reduce<string>((latest, value) => value && value > latest ? value : latest, "");
}

function earliestTimestamp(values: Array<string | null | undefined>) {
  return values.reduce<string>((earliest, value) => value && (!earliest || value < earliest) ? value : earliest, "");
}

export function groupExternalMcpConnectionRows(rows: ExternalMcpConnectionListRow[]) {
  const groups = new Map<string, ExternalMcpConnectionListRow[]>();
  for (const row of rows) {
    const deviceId = externalMcpConnectionDeviceId(row);
    const group = groups.get(deviceId);
    if (group) group.push(row);
    else groups.set(deviceId, [row]);
  }

  return [...groups.entries()].map(([deviceId, groupRows]) => {
    const representative = groupRows.find((row) => !row.revoked_at) ?? groupRows[0]!;
    const lastAccessRow = groupRows.reduce<ExternalMcpConnectionListRow>((latest, row) => (
      (row.last_access_at ?? "") > (latest.last_access_at ?? "") ? row : latest
    ), representative);
    const active = groupRows.some((row) => !row.revoked_at);
    const revokedAt = active ? "" : latestTimestamp(groupRows.map((row) => row.revoked_at));
    const lastRefreshAt = latestTimestamp(groupRows.map((row) => row.last_refresh_at));
    const lastRefreshErrorRow = groupRows.reduce<ExternalMcpConnectionListRow | null>((latest, row) => (
      (row.last_refresh_error_at ?? "") > (latest?.last_refresh_error_at ?? "") ? row : latest
    ), null);
    const lastRefreshErrorAt = lastRefreshErrorRow?.last_refresh_error_at ?? "";
    const supportsRefresh = groupRows.some((row) => externalMcpClientSupportsGrant(row.grant_types_json, "refresh_token"));
    return {
      deviceId,
      rows: groupRows,
      representative,
      lastAccessRow,
      active,
      canRestore: !active && groupRows.some((row) => row.revoked_at === revokedAt && Boolean(row.can_restore)),
      userLabel: representative.user_label || groupRows.find((row) => row.user_label)?.user_label || "",
      scopes: normalizeMcpScopes(groupRows.map((row) => row.scope).join(" ")),
      revokedAt,
      createdAt: earliestTimestamp(groupRows.map((row) => row.created_at)),
      updatedAt: latestTimestamp(groupRows.map((row) => row.updated_at)),
      accessExpiresAt: latestTimestamp(groupRows.map((row) => row.access_expires_at)),
      refreshExpiresAt: latestTimestamp(groupRows.map((row) => row.refresh_expires_at)),
      refreshCapability: lastRefreshAt ? "verified" as const : supportsRefresh ? "declared" as const : "unsupported" as const,
      lastRefreshAt,
      lastRefreshError: lastRefreshErrorAt > lastRefreshAt ? lastRefreshErrorRow?.last_refresh_error ?? "" : "",
      lastRefreshErrorAt: lastRefreshErrorAt > lastRefreshAt ? lastRefreshErrorAt : ""
    };
  });
}

export function getExternalMcpConnectionRows(db: Database, userId: string, validAfter = utcNow()) {
  return getAll<ExternalMcpConnectionListRow>(
    db,
    `select oauth_grants.id as grant_id, oauth_grants.client_id, oauth_clients.client_name, oauth_clients.client_uri,
            oauth_clients.software_id, oauth_clients.software_version, oauth_clients.device_name, oauth_clients.device_type,
            oauth_clients.user_agent, oauth_clients.grant_types_json, oauth_grants.scope, oauth_grants.user_label,
            oauth_grants.last_access_at, oauth_grants.last_access_ip, oauth_grants.last_access_public_ip,
            oauth_grants.last_access_region, oauth_grants.last_access_geo_at, oauth_grants.last_user_agent,
            oauth_grants.last_refresh_at, oauth_grants.last_refresh_error, oauth_grants.last_refresh_error_at,
            oauth_grants.revoked_at, oauth_grants.created_at, oauth_grants.updated_at,
            (select max(expires_at) from oauth_access_tokens where grant_id = oauth_grants.id and revoked_at is null) as access_expires_at,
            (select max(expires_at) from oauth_refresh_tokens
             where grant_id = oauth_grants.id and revoked_at is null and consumed_at is null) as refresh_expires_at,
            (
              exists(
                select 1 from oauth_access_tokens
                where grant_id = oauth_grants.id and revoked_at = oauth_grants.revoked_at and expires_at > ?
              )
              or exists(
                select 1 from oauth_refresh_tokens
                where grant_id = oauth_grants.id and revoked_at = oauth_grants.revoked_at
                  and consumed_at is null and expires_at > ?
              )
            ) as can_restore
     from oauth_grants
     join oauth_clients on oauth_clients.id = oauth_grants.client_id
     where oauth_grants.user_id = ?
     order by oauth_grants.created_at desc, oauth_grants.id desc`,
    validAfter,
    validAfter,
    userId
  );
}

export function registerExternalMcpOAuthRoutes(app: Hono, api: Hono) {
  const protectedResourceMetadata = (c: Context) => ({
    resource: maliangMcpResourceUrl(c),
    authorization_servers: [maliangPublicBaseUrl(c)],
    scopes_supported: [...MALIANG_MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${maliangPublicBaseUrl(c)}/mcp`
  });

  app.get("/.well-known/oauth-protected-resource", (c) => c.json(protectedResourceMetadata(c)));
  app.get("/.well-known/oauth-protected-resource/api/external-mcp/mcp", (c) => c.json(protectedResourceMetadata(c)));
  app.get("/.well-known/oauth-authorization-server", (c) => c.json(
    externalMcpAuthorizationServerMetadata(maliangPublicBaseUrl(c))
  ));

  app.post("/oauth/register", async (c) => {
    noStore(c);
    const registrationIp = externalMcpRequestMetadata(c).accessIp || "unknown";
    const retryAfter = externalMcpRegistrationLimiter.consume(registrationIp);
    if (retryAfter) {
      c.header("Retry-After", String(retryAfter));
      return oauthError(c, "temporarily_unavailable", "动态智能体注册请求过于频繁，请稍后重试", 429);
    }
    cleanupOAuthRecords();
    let body: Record<string, unknown>;
    try {
      body = await readExternalMcpRegistrationBody(c.req.raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "registration_body_invalid";
      if (reason === "registration_body_too_large") {
        return oauthError(c, "invalid_client_metadata", "智能体注册请求体不能超过 16 KB", 413);
      }
      if (reason === "registration_content_type") {
        return oauthError(c, "invalid_client_metadata", "智能体注册必须使用 application/json", 400);
      }
      return oauthError(c, "invalid_client_metadata", "智能体注册请求体必须是有效的 JSON 对象", 400);
    }
    const applicationType = String(body.application_type ?? "native").trim().toLowerCase();
    if (applicationType !== "native" && applicationType !== "web") {
      return oauthError(c, "invalid_client_metadata", "application_type 只支持 native 或 web");
    }
    const rawRedirectUris = body.redirect_uris;
    const redirectUriCount = Array.isArray(rawRedirectUris) ? rawRedirectUris.length : 0;
    const redirectUris = Array.isArray(rawRedirectUris)
      ? Array.from(new Set(rawRedirectUris.map((item: unknown) => typeof item === "string" ? item.trim() : "").filter(Boolean)))
      : [];
    if (
      redirectUris.length === 0
      || redirectUris.length > 10
      || redirectUris.some((uri) => uri.length > 2_048 || !isExternalMcpRedirectUriAllowed(uri, applicationType))
      || redirectUris.length !== redirectUriCount
    ) {
      return oauthError(c, "invalid_redirect_uri", applicationType === "web"
        ? "Web 智能体的 redirect_uris 必须使用 HTTPS"
        : "Native 智能体的 redirect_uris 只允许 HTTPS、本机 loopback HTTP 或 WorkBuddy 官方回调地址");
    }
    const tokenMethod = String(body.token_endpoint_auth_method ?? "none");
    if (tokenMethod !== "none") return oauthError(c, "invalid_client_metadata", "仅支持无密钥的 PKCE 智能体");
    const grantTypes = normalizeExternalMcpGrantTypes(body.grant_types);
    const responseTypes = oauthClientMetadataArray(body.response_types, ["code"], ["code"], 1);
    if (!grantTypes || !responseTypes) {
      return oauthError(c, "invalid_client_metadata", "仅支持 authorization_code、refresh_token 和 code 响应");
    }
    if (!grantTypes.includes("authorization_code") || responseTypes.length !== 1 || responseTypes[0] !== "code") {
      return oauthError(c, "invalid_client_metadata", "智能体必须注册 authorization_code 和 code；refresh_token 可选");
    }
    const clientName = String(body.client_name ?? "智能体").trim().slice(0, 120) || "智能体";
    const clientUri = oauthClientMetadataUrl(body.client_uri);
    const softwareId = oauthClientMetadataText(body.software_id, 200);
    const userAgent = oauthClientMetadataText(c.req.header("user-agent"), 500);
    const softwareVersion = oauthClientMetadataText(body.software_version, 80)
      || inferExternalMcpSoftwareVersion(userAgent, clientName);
    const requestMetadata = externalMcpRequestMetadata(c);
    const { deviceName, deviceType } = resolveExternalMcpRegistrationDeviceMetadata({
      clientName,
      userAgent,
      deviceName: body.device_name,
      deviceLabel: body.device_label,
      deviceType: body.device_type,
      devicePlatform: body.device_platform,
      requestDeviceName: requestMetadata.deviceName,
      requestDeviceType: requestMetadata.deviceType
    });
    const clientId = randomUUID();
    const timestamp = now();
    run(
      appDb,
       `insert into oauth_clients
        (id, application_type, client_name, client_uri, software_id, software_version, device_name, device_type, user_agent,
         redirect_uris_json, grant_types_json, response_types_json, token_endpoint_auth_method, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
       clientId,
       applicationType,
       clientName,
       clientUri,
       softwareId,
       softwareVersion,
       deviceName,
       deviceType,
       userAgent,
       JSON.stringify(redirectUris),
      JSON.stringify(grantTypes),
      JSON.stringify(responseTypes),
      tokenMethod,
      timestamp,
      timestamp
    );
    return c.json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      application_type: applicationType,
      client_name: clientName,
      ...(clientUri ? { client_uri: clientUri } : {}),
      ...(softwareId ? { software_id: softwareId } : {}),
      ...(softwareVersion ? { software_version: softwareVersion } : {}),
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: tokenMethod
    }, 201);
  });

  app.get("/oauth/authorize", async (c) => {
    noStore(c);
    cleanupOAuthRecords();
    const clientId = String(c.req.query("client_id") ?? "").trim();
    const redirectUri = String(c.req.query("redirect_uri") ?? "").trim();
    const responseType = String(c.req.query("response_type") ?? "").trim();
    const state = String(c.req.query("state") ?? "");
    const codeChallenge = String(c.req.query("code_challenge") ?? "").trim();
    const codeChallengeMethod = String(c.req.query("code_challenge_method") ?? "").trim();
    const resource = String(c.req.query("resource") ?? maliangMcpResourceUrl(c)).trim();
    const scopes = requestedScopes(c.req.query("scope"));
    const client = clientId ? getOne<OAuthClientRow>(appDb, "select * from oauth_clients where id = ?", clientId) : null;
    if (!client || !redirectUri || !clientRedirectUris(client).includes(redirectUri)) {
      return c.html(externalMcpAuthorizationErrorPage("智能体信息或回调地址无效。请回到智能体重新发起连接。"), 400);
    }
    if (
      responseType !== "code"
      || !externalMcpClientSupportsGrant(client.grant_types_json, "authorization_code")
      || !clientResponseTypes(client).includes("code")
      || !scopes
      || !validCodeChallenge(codeChallenge)
      || codeChallengeMethod !== "S256"
    ) {
      return c.html(externalMcpAuthorizationErrorPage("授权请求必须使用 Authorization Code + PKCE S256，并且只能申请马良支持的权限。"), 400);
    }
    if (resource !== maliangMcpResourceUrl(c)) {
      return c.html(externalMcpAuthorizationErrorPage("授权请求的 MCP 资源地址不匹配。"), 400);
    }
    const user = await currentUser(c);
    if (!user) {
      const target = new URL(c.req.url);
      const next = `${target.pathname}${target.search}`;
      return c.redirect(`/?auth=login&connect=${encodeURIComponent(client.client_name)}&next=${encodeURIComponent(next)}`);
    }
    const requestId = makeId("oauthreq");
    run(
      appDb,
      `insert into oauth_authorization_requests
        (id, user_id, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, resource, expires_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      requestId,
      user.id,
      client.id,
      redirectUri,
      mcpScopeText(scopes),
      state,
      codeChallenge,
      codeChallengeMethod,
      resource,
      futureDate(AUTHORIZATION_REQUEST_TTL_SECONDS),
      now()
    );
    const scriptNonce = randomOAuthToken(18);
    c.header("Content-Security-Policy", externalMcpAuthorizationPageCsp(scriptNonce, redirectUri));
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    return c.html(externalMcpAuthorizationPage({
      clientName: client.client_name,
      callbackOrigin: externalMcpRedirectUriDisplay(redirectUri),
      userName: user.username || user.account || user.id,
      requestId,
      scopes,
      scriptNonce
    }));
  });

  app.get("/oauth/authorize/status", async (c) => {
    noStore(c);
    const user = await currentUser(c);
    if (!user) return c.json({ status: "failed" }, 401);
    const requestId = String(c.req.query("request_id") ?? "").trim();
    const status = getExternalMcpAuthorizationStatus(appDb, user.id, requestId);
    if (!status) return c.json({ status: "failed" }, 404);
    return c.json({ status });
  });

  app.post("/oauth/authorize", async (c) => {
    noStore(c);
    let form: URLSearchParams;
    try {
      form = await readExternalMcpFormBody(c.req.raw);
    } catch (error) {
      return oauthAuthorizationFormError(c, error);
    }
    const user = await currentUser(c);
    if (!user) return c.html(externalMcpAuthorizationErrorPage("登录状态已失效，请重新从智能体发起连接。"), 401);
    const requestId = String(form.get("request_id") ?? "").trim();
    const decision = String(form.get("decision") ?? "deny");
    const request = getOne<AuthorizationRequestRow>(
      appDb,
      "select * from oauth_authorization_requests where id = ? and user_id = ?",
      requestId,
      user.id
    );
    if (!request || request.consumed_at || request.expires_at <= utcNow()) {
      return c.html(externalMcpAuthorizationErrorPage("授权请求已失效，请回到智能体重新连接。"), 400);
    }
    if (decision !== "allow") {
      run(appDb, "update oauth_authorization_requests set consumed_at = ? where id = ? and consumed_at is null", now(), request.id);
      return c.redirect(
        redirectWithParams(request.redirect_uri, externalMcpAuthorizationResponseParams(maliangPublicBaseUrl(c), {
          error: "access_denied",
          state: request.state
        })),
        OAUTH_BROWSER_REDIRECT_STATUS
      );
    }

    const code = randomOAuthToken();
    const timestamp = now();
    const authorizationUserAgent = oauthClientMetadataText(c.req.header("user-agent"), 500);
    try {
      appDb.transaction(() => {
        const consumed = run(
          appDb,
          "update oauth_authorization_requests set consumed_at = ? where id = ? and consumed_at is null and expires_at > ?",
          timestamp,
          request.id,
          utcNow()
        );
        if (Number(consumed.changes ?? 0) !== 1) throw new Error("authorization_request_consumed");
        const registeredClient = getOne<{ device_name: string; device_type: string }>(
          appDb,
          "select device_name, device_type from oauth_clients where id = ?",
          request.client_id
        );
        const authorizedDeviceName = resolveExternalMcpDeviceName(
          registeredClient?.device_name ?? "",
          authorizationUserAgent
        );
        if (authorizedDeviceName !== "未知设备" && authorizedDeviceName !== registeredClient?.device_name) {
          run(
            appDb,
            "update oauth_clients set device_name = ?, updated_at = ? where id = ?",
            authorizedDeviceName,
            timestamp,
            request.client_id
          );
        }
        const authorizedDeviceType = resolveExternalMcpDeviceType(
          registeredClient?.device_type ?? "",
          authorizationUserAgent
        );
        if (authorizedDeviceType && authorizedDeviceType !== registeredClient?.device_type) {
          run(
            appDb,
            "update oauth_clients set device_type = ?, updated_at = ? where id = ?",
            authorizedDeviceType,
            timestamp,
            request.client_id
          );
        }
        const grantId = upsertExternalMcpGrantForAuthorization(appDb, {
          userId: user.id,
          clientId: request.client_id,
          scope: request.scope,
          timestamp
        });
        run(
          appDb,
          `insert into oauth_authorization_codes
            (id, code_hash, request_id, grant_id, user_id, client_id, redirect_uri, scope, code_challenge, resource, expires_at, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          makeId("oauthcode"),
          oauthTokenHash(code),
          request.id,
          grantId,
          user.id,
          request.client_id,
          request.redirect_uri,
          request.scope,
          request.code_challenge,
          request.resource,
          futureDate(AUTHORIZATION_CODE_TTL_SECONDS),
          timestamp
        );
      })();
    } catch (error) {
      if (error instanceof Error && error.message === "authorization_request_consumed") {
        return c.html(externalMcpAuthorizationErrorPage("授权请求已被处理，请回到智能体查看。"), 409);
      }
      throw error;
    }
    const callbackUrl = redirectWithParams(request.redirect_uri, externalMcpAuthorizationResponseParams(maliangPublicBaseUrl(c), {
      code,
      state: request.state
    }));
    const authorizedClient = getOne<{ client_name: string; application_type: string }>(
      appDb,
      "select client_name, application_type from oauth_clients where id = ?",
      request.client_id
    );
    c.header("Referrer-Policy", "no-referrer");
    if (externalMcpAuthorizationCallbackMode(
      authorizedClient?.application_type ?? "native",
      request.redirect_uri
    ) === "redirect") {
      return c.redirect(callbackUrl, OAUTH_BROWSER_REDIRECT_STATUS);
    }
    const scriptNonce = randomOAuthToken(18);
    c.header("Content-Security-Policy", externalMcpAuthorizationSuccessPageCsp(scriptNonce, request.redirect_uri));
    c.header("X-Frame-Options", "DENY");
    return c.html(externalMcpAuthorizationSuccessPage({
      callbackUrl,
      clientName: authorizedClient?.client_name ?? "智能体",
      scriptNonce,
      statusUrl: `/oauth/authorize/status?request_id=${encodeURIComponent(request.id)}`
    }));
  });

  app.post("/oauth/token", async (c) => {
    noStore(c);
    let form: URLSearchParams;
    try {
      form = await readExternalMcpFormBody(c.req.raw);
    } catch (error) {
      return oauthFormError(c, error);
    }
    cleanupOAuthRecords();
    const grantType = String(form.get("grant_type") ?? "");
    const clientId = String(form.get("client_id") ?? "").trim();
    const client = clientId ? getOne<OAuthClientRow>(appDb, "select * from oauth_clients where id = ?", clientId) : null;
    if (!client || client.token_endpoint_auth_method !== "none") return oauthError(c, "invalid_client", "智能体不存在", 401);

    if (grantType === "authorization_code") {
      if (!externalMcpClientSupportsGrant(client.grant_types_json, "authorization_code") || !clientResponseTypes(client).includes("code")) {
        return oauthError(c, "unauthorized_client", "智能体未注册 Authorization Code 能力");
      }
      const code = String(form.get("code") ?? "").trim();
      const redirectUri = String(form.get("redirect_uri") ?? "").trim();
      const codeVerifier = String(form.get("code_verifier") ?? "").trim();
      if (!code || !redirectUri || !validCodeVerifier(codeVerifier)) {
        return oauthError(c, "invalid_grant", "授权码、回调地址或 PKCE verifier 无效");
      }
      const row = getOne<{
        id: string;
        grant_id: string;
        user_id: string;
        client_id: string;
        redirect_uri: string;
        scope: string;
        code_challenge: string;
        resource: string;
        expires_at: string;
        consumed_at: string | null;
        grant_revoked_at: string | null;
        grant_scope: string;
      }>(
        appDb,
        `select oauth_authorization_codes.*, oauth_grants.revoked_at as grant_revoked_at,
                oauth_grants.scope as grant_scope
         from oauth_authorization_codes
         join oauth_grants on oauth_grants.id = oauth_authorization_codes.grant_id
         where oauth_authorization_codes.code_hash = ?`,
        oauthTokenHash(code)
      );
      const computedChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
      const authorizationScopes = row ? normalizeMcpScopes(row.scope) : [];
      const grantScopes = row ? normalizeMcpScopes(row.grant_scope) : [];
      if (
        !row || row.consumed_at || row.grant_revoked_at || row.expires_at <= utcNow()
        || row.client_id !== clientId || !externalMcpAuthorizationCodeRedirectUriMatches(row.redirect_uri, redirectUri)
        || !oauthTokensEqual(computedChallenge, row.code_challenge)
        || authorizationScopes.some((scope) => !grantScopes.includes(scope))
      ) return oauthError(c, "invalid_grant", "授权码无效、已使用或已过期");
      const tokens = appDb.transaction(() => {
        const consumed = run(
          appDb,
          "update oauth_authorization_codes set consumed_at = ? where id = ? and consumed_at is null and expires_at > ?",
          now(),
          row.id,
          utcNow()
        );
        if (Number(consumed.changes ?? 0) !== 1) return null;
        return issueTokens({
          grantId: row.grant_id,
          userId: row.user_id,
          clientId: row.client_id,
          scope: row.scope,
          resource: row.resource,
          issueRefreshToken: externalMcpClientSupportsGrant(client.grant_types_json, "refresh_token")
        });
      })();
      if (!tokens) return oauthError(c, "invalid_grant", "授权码已被使用");
      recordExternalMcpGrantAccess(appDb, {
        grantId: row.grant_id,
        clientId: row.client_id,
        ...externalMcpRequestMetadata(c)
      });
      return c.json(tokens);
    }

    if (grantType === "refresh_token") {
      if (!externalMcpClientSupportsGrant(client.grant_types_json, "refresh_token")) {
        return oauthError(c, "unauthorized_client", "智能体未注册 Refresh Token 能力");
      }
      const refreshToken = String(form.get("refresh_token") ?? "").trim();
      const row = refreshToken ? getOne<{
        id: string;
        family_id: string;
        grant_id: string;
        user_id: string;
        client_id: string;
        scope: string;
        resource: string;
        expires_at: string;
        consumed_at: string | null;
        revoked_at: string | null;
        grant_revoked_at: string | null;
        grant_scope: string;
      }>(
        appDb,
        `select oauth_refresh_tokens.*, oauth_grants.revoked_at as grant_revoked_at,
                oauth_grants.scope as grant_scope
         from oauth_refresh_tokens
         join oauth_grants on oauth_grants.id = oauth_refresh_tokens.grant_id
         where oauth_refresh_tokens.token_hash = ?`,
        oauthTokenHash(refreshToken)
      ) : null;
      if (row?.consumed_at) {
        revokeTokenFamily(row.family_id);
        recordExternalMcpRefreshFailure(appDb, row.grant_id, "Refresh Token 已被重复使用，当前连接已撤销");
        return oauthError(c, "invalid_grant", "Refresh Token 已被重复使用，当前连接已撤销");
      }
      if (!row || row.revoked_at || row.grant_revoked_at || row.expires_at <= utcNow() || row.client_id !== clientId) {
        if (row) recordExternalMcpRefreshFailure(appDb, row.grant_id, "Refresh Token 无效或已过期");
        return oauthError(c, "invalid_grant", "Refresh Token 无效或已过期");
      }
      const requested = String(form.get("scope") ?? "").trim();
      const currentScopes = normalizeMcpScopes(row.scope);
      const grantScopes = normalizeMcpScopes(row.grant_scope);
      const nextScopes = requested ? requestedScopes(requested) : currentScopes;
      if (!nextScopes || nextScopes.some((scope) => !currentScopes.includes(scope) || !grantScopes.includes(scope))) {
        recordExternalMcpRefreshFailure(appDb, row.grant_id, "刷新请求的权限范围无效");
        return oauthError(c, "invalid_scope", "刷新令牌不能扩大权限范围，且必须符合当前授权");
      }
      const tokens = appDb.transaction(() => {
        const consumed = run(
          appDb,
          "update oauth_refresh_tokens set consumed_at = ? where id = ? and consumed_at is null and revoked_at is null",
          now(),
          row.id
        );
        if (Number(consumed.changes ?? 0) !== 1) return null;
        const issued = issueTokens({
          grantId: row.grant_id,
          userId: row.user_id,
          clientId: row.client_id,
          scope: mcpScopeText(nextScopes),
          resource: row.resource,
          familyId: row.family_id,
          parentRefreshTokenId: row.id,
          issueRefreshToken: true
        });
        recordExternalMcpRefreshSuccess(appDb, row.grant_id);
        return issued;
      })();
      if (!tokens) {
        revokeTokenFamily(row.family_id);
        recordExternalMcpRefreshFailure(appDb, row.grant_id, "Refresh Token 已失效");
        return oauthError(c, "invalid_grant", "Refresh Token 已失效");
      }
      recordExternalMcpGrantAccess(appDb, {
        grantId: row.grant_id,
        clientId: row.client_id,
        ...externalMcpRequestMetadata(c)
      });
      return c.json(tokens);
    }

    return oauthError(c, "unsupported_grant_type", "仅支持 authorization_code 或 refresh_token");
  });

  app.post("/oauth/revoke", async (c) => {
    noStore(c);
    let form: URLSearchParams;
    try {
      form = await readExternalMcpFormBody(c.req.raw);
    } catch (error) {
      return oauthFormError(c, error);
    }
    cleanupOAuthRecords();
    const token = String(form.get("token") ?? "").trim();
    const clientId = String(form.get("client_id") ?? "").trim();
    if (!token) return c.json({ ok: true });
    const hash = oauthTokenHash(token);
    const refresh = getOne<{ id: string; family_id: string; client_id: string }>(
      appDb,
      "select id, family_id, client_id from oauth_refresh_tokens where token_hash = ?",
      hash
    );
    if (refresh && (!clientId || clientId === refresh.client_id)) revokeTokenFamily(refresh.family_id);
    const access = getOne<{ id: string; client_id: string }>(
      appDb,
      "select id, client_id from oauth_access_tokens where token_hash = ?",
      hash
    );
    if (access && (!clientId || clientId === access.client_id)) {
      run(appDb, "update oauth_access_tokens set revoked_at = coalesce(revoked_at, ?) where id = ?", now(), access.id);
    }
    return c.json({ ok: true });
  });

  api.get("/external-mcp/connections", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    cleanupExpiredIncompleteExternalMcpGrants(appDb, user.id);
    const connections = getExternalMcpConnectionRows(appDb, user.id);
    const completedConnections = connections.filter((row) => hasCompletedExternalMcpGrant(appDb, row.grant_id));
    const groupedConnections = groupExternalMcpConnectionRows(completedConnections);
    const accessLocations = await Promise.all(
      groupedConnections.map((group) => enrichExternalMcpAccessLocation(appDb, user.id, group.lastAccessRow))
    );
    return c.json({
      resource: maliangMcpResourceUrl(c),
      metadataUrl: maliangProtectedResourceMetadataUrl(c),
      connections: groupedConnections.map((group, index) => {
        const row = group.representative;
        const deviceName = resolveExternalMcpDeviceName(row.device_name, row.user_agent);
        return {
          deviceId: group.deviceId,
          clientId: row.client_id,
          clientName: row.client_name,
          clientUri: row.client_uri,
          softwareId: row.software_id,
          softwareVersion: row.software_version || inferExternalMcpSoftwareVersion(row.last_user_agent || row.user_agent, row.client_name),
          deviceName,
          deviceType: resolveExternalMcpDeviceType(row.device_type, row.user_agent),
          isLocalDevice: group.rows.some((candidate) => isExternalMcpLocalDevice(
            resolveExternalMcpDeviceName(candidate.device_name, candidate.user_agent)
          )),
          userLabel: group.userLabel,
          userAgent: row.user_agent,
          lastUserAgent: group.lastAccessRow.last_user_agent,
          scopes: group.scopes,
          active: group.active,
          canRestore: group.canRestore,
          lastAccessAt: group.lastAccessRow.last_access_at ?? "",
          lastAccessIp: accessLocations[index]?.ip ?? "",
          lastAccessRegion: accessLocations[index]?.region ?? "",
          lastAccessIpStatus: accessLocations[index]?.status ?? "unavailable",
          revokedAt: group.revokedAt,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
          accessExpiresAt: group.accessExpiresAt,
          refreshExpiresAt: group.refreshExpiresAt,
          refreshCapability: group.refreshCapability,
          lastRefreshAt: group.lastRefreshAt,
          lastRefreshError: group.lastRefreshError,
          lastRefreshErrorAt: group.lastRefreshErrorAt
        };
      })
    });
  });

  api.patch("/external-mcp/connections/:clientId", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const userLabel = String(body.userLabel ?? "").trim();
    if (userLabel.length > 80) return c.json({ error: "连接备注不能超过 80 个字符" }, 400);
    if (!updateExternalMcpGrantLabel(appDb, user.id, c.req.param("clientId"), userLabel)) {
      return c.json({ error: "连接不存在" }, 404);
    }
    return c.json({ ok: true, userLabel });
  });

  api.delete("/external-mcp/connections/:clientId", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    if (!revokeExternalMcpGrant(appDb, user.id, c.req.param("clientId"))) {
      return c.json({ error: "连接不存在" }, 404);
    }
    return c.json({ ok: true });
  });

  api.post("/external-mcp/connections/:clientId/restore", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const result = restoreExternalMcpGrant(appDb, user.id, c.req.param("clientId"));
    if (result === "not_found") return c.json({ error: "连接不存在" }, 404);
    if (result === "reauthorize") return c.json({ error: "现有凭据已过期，请在客户端重新授权" }, 409);
    return c.json({ ok: true, restored: result === "restored" });
  });

  api.delete("/external-mcp/connections/:clientId/remove", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    if (!removeExternalMcpGrant(appDb, user.id, c.req.param("clientId"))) {
      return c.json({ error: "连接不存在" }, 404);
    }
    return c.json({ ok: true });
  });
}
