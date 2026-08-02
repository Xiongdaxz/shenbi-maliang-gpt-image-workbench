import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Database } from "bun:sqlite";
import type { Context } from "hono";
import { currentUser } from "./auth";
import { appDb, getOne, run } from "./db";
import { localLanIpv4, resolvePublicHttpOrigin } from "./publicOrigin";
import { storedSitePublicBaseUrl } from "./siteSettings";
import type { UserRow } from "./types";
import { localTimestamp, now, utcNow } from "./utils";

export const MALIANG_MCP_SCOPES = ["profile:read", "images:generate"] as const;
export type MaliangMcpScope = (typeof MALIANG_MCP_SCOPES)[number];
export const EXTERNAL_MCP_CLIENT_IP_HEADER = "x-maliang-external-mcp-client-ip";
export const EXTERNAL_MCP_DEVICE_HOSTNAME_HEADER = "x-maliang-device-hostname";
export const EXTERNAL_MCP_DEVICE_NAME_HEADER = "x-maliang-device-name";
export const EXTERNAL_MCP_DEVICE_OS_HEADER = "x-maliang-device-os";
export const EXTERNAL_MCP_DEVICE_OSTYPE_HEADER = "x-maliang-device-ostype";

export type ExternalMcpPrincipal = {
  token: string;
  tokenId: string;
  grantId: string;
  grantVersion: number;
  clientId: string;
  user: UserRow;
  scopes: MaliangMcpScope[];
  expiresAt: string;
  resource: string;
};

export function normalizeExternalMcpDeviceName(...values: unknown[]) {
  for (const value of values) {
    const normalized = String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 120);
    if (normalized) return normalized;
  }
  return "";
}

const GENERIC_EXTERNAL_MCP_DEVICE_NAMES = new Set([
  "android",
  "claude code",
  "codex",
  "codex device",
  "codex 设备",
  "ios",
  "iphone",
  "ipad",
  "linux",
  "localhost",
  "macos",
  "mcp client",
  "mcp 客户端",
  "trae",
  "unknown device",
  "windows",
  "workbuddy",
  "客户端",
  "客户端设备",
  "智能体",
  "未知设备"
]);

export function isGenericOrPlaceholderExternalMcpDeviceName(value: unknown) {
  const normalized = normalizeExternalMcpDeviceName(value).toLowerCase();
  if (!normalized || GENERIC_EXTERNAL_MCP_DEVICE_NAMES.has(normalized)) return true;
  return /^__[^\r\n]+__$/.test(normalized)
    || /^\{\{[^\r\n]+\}\}$/.test(normalized)
    || /^\$\{[^\r\n]+\}$/.test(normalized)
    || /^<[^\r\n]+>$/.test(normalized);
}

export function normalizeUsableExternalMcpDeviceName(...values: unknown[]) {
  for (const value of values) {
    const normalized = normalizeExternalMcpDeviceName(value);
    if (!isGenericOrPlaceholderExternalMcpDeviceName(normalized)) return normalized;
  }
  return "";
}

export function normalizeExternalMcpDeviceType(...values: unknown[]) {
  for (const value of values) {
    const normalized = String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 80);
    if (!normalized) continue;
    const lower = normalized.toLowerCase();
    if (lower.includes("windows") || lower === "win32") return "Windows";
    if (lower.includes("darwin") || lower.includes("macos") || lower.includes("mac os")) return "macOS";
    if (lower.includes("iphone") || lower.includes("ipad") || lower.includes("ios")) return "iOS";
    if (lower.includes("android")) return "Android";
    if (lower.includes("linux")) return "Linux";
  }
  return "";
}

export function normalizeExternalMcpClientFamily(...values: unknown[]) {
  const normalized = values
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (!normalized) return "";
  if (normalized.includes("trae")) return "trae";
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("claude")) return "claude-code";
  if (normalized.includes("workbuddy")) return "workbuddy";
  return normalized
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function externalMcpLogicalDeviceId(input: {
  clientName?: unknown;
  softwareId?: unknown;
  userAgent?: unknown;
  deviceName?: unknown;
  deviceType?: unknown;
}) {
  const deviceName = normalizeUsableExternalMcpDeviceName(input.deviceName).toLowerCase();
  const deviceType = normalizeExternalMcpDeviceType(input.deviceType).toLowerCase();
  const clientFamily = normalizeExternalMcpClientFamily(input.softwareId, input.clientName, input.userAgent);
  if (!deviceName || !deviceType || !clientFamily) return "";
  return `mdevice_${createHash("sha256")
    .update(`${clientFamily}\n${deviceType}\n${deviceName}`)
    .digest("hex")
    .slice(0, 32)}`;
}

export function externalMcpRequestMetadata(
  c: Context,
  fallback: { accessIp?: string; accessUserAgent?: string } = {}
) {
  return {
    accessIp: String(c.req.header(EXTERNAL_MCP_CLIENT_IP_HEADER) ?? "").trim().slice(0, 128)
      || String(fallback.accessIp ?? "").trim().slice(0, 128),
    accessUserAgent: String(c.req.header("user-agent") ?? "").trim().slice(0, 500)
      || String(fallback.accessUserAgent ?? "").trim().slice(0, 500),
    deviceName: normalizeUsableExternalMcpDeviceName(
      c.req.header(EXTERNAL_MCP_DEVICE_NAME_HEADER),
      c.req.header(EXTERNAL_MCP_DEVICE_HOSTNAME_HEADER)
    ),
    deviceType: normalizeExternalMcpDeviceType(
      c.req.header(EXTERNAL_MCP_DEVICE_OS_HEADER),
      c.req.header(EXTERNAL_MCP_DEVICE_OSTYPE_HEADER)
    )
  };
}

export function recordExternalMcpGrantAccess(
  db: Database,
  input: {
    grantId: string;
    clientId: string;
    accessIp: string;
    accessUserAgent: string;
    deviceName?: string;
    deviceType?: string;
    timestamp?: string;
    throttle?: boolean;
  }
) {
  const timestamp = input.timestamp ?? now();
  if (input.throttle) {
    const staleBefore = localTimestamp(new Date(Date.now() - 30_000));
    run(
      db,
      `update oauth_grants
       set last_access_at = ?, last_access_ip = ?, last_user_agent = ?
       where id = ?
         and (last_access_at is null or last_access_at < ? or last_access_ip <> ? or last_user_agent <> ?)`,
      timestamp,
      input.accessIp,
      input.accessUserAgent,
      input.grantId,
      staleBefore,
      input.accessIp,
      input.accessUserAgent
    );
  } else {
    run(
      db,
      "update oauth_grants set last_access_at = ?, last_access_ip = ?, last_user_agent = ? where id = ?",
      timestamp,
      input.accessIp,
      input.accessUserAgent,
      input.grantId
    );
  }
  const deviceName = normalizeUsableExternalMcpDeviceName(input.deviceName);
  if (!isGenericOrPlaceholderExternalMcpDeviceName(deviceName)) {
    run(
      db,
      `update oauth_clients
       set device_name = ?, updated_at = ?
       where id = ? and device_name <> ?`,
      deviceName,
      timestamp,
      input.clientId,
      deviceName
    );
  }
  const deviceType = normalizeExternalMcpDeviceType(input.deviceType);
  if (deviceType) {
    run(
      db,
      `update oauth_clients
       set device_type = ?, updated_at = ?
       where id = ? and device_type <> ?`,
      deviceType,
      timestamp,
      input.clientId,
      deviceType
    );
  }
}

export function updateExternalMcpClientDevice(
  db: Database,
  input: {
    clientId: string;
    deviceName: unknown;
    deviceType: unknown;
    timestamp?: string;
  }
) {
  const deviceName = normalizeUsableExternalMcpDeviceName(input.deviceName);
  const deviceType = normalizeExternalMcpDeviceType(input.deviceType);
  if (isGenericOrPlaceholderExternalMcpDeviceName(deviceName) || !deviceType) return null;
  const timestamp = input.timestamp ?? now();
  const result = run(
    db,
    `update oauth_clients
     set device_name = ?, device_type = ?, updated_at = ?
     where id = ?`,
    deviceName,
    deviceType,
    timestamp,
    input.clientId
  );
  return Number(result.changes ?? 0) === 1
    ? { deviceName, deviceType, updatedAt: timestamp }
    : null;
}

export function externalMcpClientNeedsDeviceReport(db: Database, clientId: string) {
  const client = getOne<{ device_name: string; device_type: string }>(
    db,
    "select device_name, device_type from oauth_clients where id = ?",
    clientId
  );
  return !client
    || isGenericOrPlaceholderExternalMcpDeviceName(client.device_name)
    || !normalizeExternalMcpDeviceType(client.device_type);
}

function httpOrigin(value: unknown) {
  try {
    const url = new URL(String(value ?? "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function privateOrLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  const ipVersion = isIP(normalized);
  if (ipVersion === 6) {
    return normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || normalized.startsWith("fe80:");
  }
  if (ipVersion !== 4) return false;
  const parts = normalized.split(".").map((part) => Number(part));
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && (parts[1] ?? 0) >= 64 && (parts[1] ?? 0) <= 127);
}

export function validateMaliangPublicOrigin(value: string) {
  const origin = httpOrigin(value);
  if (!origin) throw new Error("神笔马良公开地址必须是有效的 HTTP(S) origin");
  const url = new URL(origin);
  if (url.protocol === "http:" && !privateOrLoopbackHostname(url.hostname)) {
    throw new Error("神笔马良公开 MCP/OAuth 地址必须使用 HTTPS；HTTP 仅允许本机或私有局域网测试地址");
  }
  return origin;
}

export function resolveConfiguredMaliangPublicBaseUrl(input: {
  appPublicUrl?: string | null;
  maliangPublicBaseUrl?: string | null;
  sitePublicBaseUrl?: string | null;
}) {
  const appPublicUrl = String(input.appPublicUrl ?? "").trim();
  const maliangPublicBaseUrl = String(input.maliangPublicBaseUrl ?? "").trim();
  const appOrigin = appPublicUrl ? validateMaliangPublicOrigin(appPublicUrl) : "";
  const compatibilityOrigin = maliangPublicBaseUrl ? validateMaliangPublicOrigin(maliangPublicBaseUrl) : "";
  if (appOrigin && compatibilityOrigin && appOrigin !== compatibilityOrigin) {
    throw new Error("APP_PUBLIC_URL 与 MALIANG_PUBLIC_BASE_URL 配置冲突，请只保留一个公开地址或将两者设为相同 origin");
  }
  if (appOrigin || compatibilityOrigin) return appOrigin || compatibilityOrigin;
  const sitePublicBaseUrl = String(input.sitePublicBaseUrl ?? "").trim();
  return sitePublicBaseUrl ? validateMaliangPublicOrigin(sitePublicBaseUrl) : "";
}

export type MaliangPublicBaseUrlSource =
  | "APP_PUBLIC_URL"
  | "MALIANG_PUBLIC_BASE_URL"
  | "site_settings"
  | "automatic";

export function configuredMaliangPublicBaseUrl(input: { sitePublicBaseUrl?: string | null } = {}) {
  const appPublicUrl = String(Bun.env.APP_PUBLIC_URL ?? "").trim();
  const maliangPublicBaseUrl = String(Bun.env.MALIANG_PUBLIC_BASE_URL ?? "").trim();
  const sitePublicBaseUrl = appPublicUrl || maliangPublicBaseUrl
    ? ""
    : input.sitePublicBaseUrl === undefined
      ? storedSitePublicBaseUrl()
      : String(input.sitePublicBaseUrl ?? "").trim();
  const publicBaseUrl = resolveConfiguredMaliangPublicBaseUrl({
    appPublicUrl,
    maliangPublicBaseUrl,
    sitePublicBaseUrl
  });
  const source: MaliangPublicBaseUrlSource = appPublicUrl
    ? "APP_PUBLIC_URL"
    : maliangPublicBaseUrl
      ? "MALIANG_PUBLIC_BASE_URL"
      : sitePublicBaseUrl
        ? "site_settings"
        : "automatic";
  return {
    publicBaseUrl,
    source,
    environmentOverride: source === "APP_PUBLIC_URL" || source === "MALIANG_PUBLIC_BASE_URL"
  };
}

function firstForwardedValue(value: unknown) {
  return String(value ?? "").split(",")[0]?.trim() ?? "";
}

export function resolveMaliangPublicBaseUrl(input: {
  configuredUrl?: string | null;
  requestUrl: string;
  trustProxy?: boolean;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  lanAddress?: string | null;
}) {
  const configuredValue = String(input.configuredUrl ?? "").trim();
  if (configuredValue) return validateMaliangPublicOrigin(configuredValue);
  const requestOrigin = httpOrigin(input.requestUrl);
  if (!requestOrigin) throw new Error("无法从当前请求解析神笔马良公开地址");
  let resolvedOrigin = requestOrigin;
  if (input.trustProxy) {
    const request = new URL(input.requestUrl);
    const forwardedProto = firstForwardedValue(input.forwardedProto).replace(/:$/, "");
    const protocol = forwardedProto ? `${forwardedProto}:` : request.protocol;
    const host = firstForwardedValue(input.forwardedHost) || request.host;
    resolvedOrigin = httpOrigin(`${protocol}//${host}`) || requestOrigin;
  }
  const publicOrigin = resolvePublicHttpOrigin(resolvedOrigin, String(input.lanAddress ?? "")) || resolvedOrigin;
  return validateMaliangPublicOrigin(publicOrigin);
}

export function maliangPublicBaseUrl(c: Context, configuredUrl = configuredMaliangPublicBaseUrl().publicBaseUrl) {
  const trustProxy = ["1", "true", "on"].includes(String(Bun.env.APP_TRUST_PROXY ?? "").trim().toLowerCase());
  return resolveMaliangPublicBaseUrl({
    configuredUrl,
    requestUrl: c.req.url,
    trustProxy,
    forwardedHost: c.req.header("x-forwarded-host"),
    forwardedProto: c.req.header("x-forwarded-proto"),
    lanAddress: localLanIpv4()
  });
}

export function maliangMcpResourceUrl(c: Context) {
  return `${maliangPublicBaseUrl(c)}/api/external-mcp/mcp`;
}

export function maliangProtectedResourceMetadataUrl(c: Context) {
  return `${maliangPublicBaseUrl(c)}/.well-known/oauth-protected-resource/api/external-mcp/mcp`;
}

export function oauthTokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function oauthTokensEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function normalizeMcpScopes(value: unknown): MaliangMcpScope[] {
  const requested = Array.isArray(value)
    ? value.map((item) => String(item).trim())
    : String(value ?? "").split(/\s+/).map((item) => item.trim());
  const unique = new Set(requested.filter(Boolean));
  return MALIANG_MCP_SCOPES.filter((scope) => unique.has(scope));
}

export function mcpScopeText(scopes: readonly string[]) {
  return scopes.join(" ");
}

function bearerToken(c: Context) {
  const authorization = c.req.header("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function resolveMcpAccessToken(c: Context, requiredScopes: readonly MaliangMcpScope[] = []) {
  const token = bearerToken(c);
  if (!token) return null;
  const row = getOne<{
    id: string;
    grant_id: string;
    user_id: string;
    client_id: string;
    scope: string;
    resource: string;
    expires_at: string;
    revoked_at: string | null;
    grant_revoked_at: string | null;
    grant_credential_version: number;
    last_access_at: string | null;
    last_access_ip: string;
    last_user_agent: string;
  }>(
    appDb,
    `select oauth_access_tokens.id, oauth_access_tokens.grant_id, oauth_access_tokens.user_id, oauth_access_tokens.client_id,
            oauth_access_tokens.scope, oauth_access_tokens.resource, oauth_access_tokens.expires_at,
            oauth_access_tokens.revoked_at, oauth_grants.revoked_at as grant_revoked_at,
            oauth_grants.credential_version as grant_credential_version,
            oauth_grants.last_access_at, oauth_grants.last_access_ip, oauth_grants.last_user_agent
     from oauth_access_tokens
     join oauth_grants on oauth_grants.id = oauth_access_tokens.grant_id
     where oauth_access_tokens.token_hash = ?`,
    oauthTokenHash(token)
  );
  if (!row || row.revoked_at || row.grant_revoked_at || row.expires_at <= utcNow()) return null;
  if (row.resource !== maliangMcpResourceUrl(c)) return null;
  const scopes = normalizeMcpScopes(row.scope);
  if (requiredScopes.some((scope) => !scopes.includes(scope))) return null;
  const user = getOne<UserRow>(appDb, "select * from users where id = ? and disabled = 0", row.user_id);
  if (!user) return null;
  try {
    const metadata = externalMcpRequestMetadata(c, {
      accessIp: row.last_access_ip,
      accessUserAgent: row.last_user_agent
    });
    recordExternalMcpGrantAccess(appDb, {
      grantId: row.grant_id,
      clientId: row.client_id,
      ...metadata,
      throttle: true
    });
  } catch {
    // Access-time telemetry must never make an otherwise valid MCP request fail.
  }
  return {
    token,
    tokenId: row.id,
    grantId: row.grant_id,
    grantVersion: row.grant_credential_version,
    clientId: row.client_id,
    user,
    scopes,
    expiresAt: row.expires_at,
    resource: row.resource
  } satisfies ExternalMcpPrincipal;
}

export function mcpUnauthorized(c: Context, description = "Maliang MCP authorization required") {
  c.header(
    "WWW-Authenticate",
    `Bearer resource_metadata="${maliangProtectedResourceMetadataUrl(c)}", error="invalid_token", error_description="${description}"`
  );
  return c.json({ error: "unauthorized", error_description: "需要有效的神笔马良 MCP 授权" }, 401);
}

export async function requireImageRouteUser(c: Context) {
  const websiteUser = await currentUser(c);
  if (websiteUser) return websiteUser;
  return resolveMcpAccessToken(c, ["images:generate"])?.user ?? null;
}
