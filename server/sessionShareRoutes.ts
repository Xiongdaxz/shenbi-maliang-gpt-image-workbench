import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import type { Context, Hono } from "hono";
import { audit } from "./auditLog";
import { requireUser } from "./auth";
import { expireStaleImageJobs } from "./chatStore";
import { appDb, configDb, getAll, getOne, run } from "./db";
import { getOrCreateImageDerivative, normalizeImageVariant, type ImageVariant } from "./imageDerivatives";
import { imageExtensionFromMime, mimeTypeFromPath } from "./imageFiles";
import { pageInfo, paginationFromQuery } from "./pagination";
import { readStoredFile } from "./secureFiles";
import { now, safeJson } from "./utils";

const SESSION_SHARE_TOKEN_VERSION = "v1";
const SESSION_SHARE_TOKEN_SCOPE = "session-share";
const SESSION_SHARE_SECRET_ID = "default";
const SESSION_SHARE_MAX_MESSAGES = 2_000;
const PUBLIC_NOT_FOUND_MESSAGE = "分享链接不存在或已失效";
export const SESSION_SHARE_CLIENT_IP_HEADER = "x-gpt-image-client-ip";

type SessionShareLinkRow = {
  id: string;
  public_token: string;
  user_id: string;
  session_id: string;
  title: string;
  created_at: string;
  message_count?: number | null;
};

type SharedMessageRow = {
  share_sort_order: number;
  id: string;
  role: string;
  content: string;
  image_id: string | null;
  metadata: string | null;
  created_at: string;
  image_path: string | null;
  image_job_id: string | null;
  image_prompt: string | null;
  image_kind: string | null;
  image_size: string | null;
  image_width: number | null;
  image_height: number | null;
  image_file_size: number | null;
  image_quality: string | null;
  image_mime_type: string | null;
};

type SharedReferenceRow = {
  id: string;
  message_id: string;
  source_name: string;
  path: string;
  mime_type: string;
  size: number;
  image_width: number;
  image_height: number;
  created_at: string;
};

type SharedImageReferenceRow = Omit<SharedReferenceRow, "message_id"> & {
  image_id: string;
};

type SharedMessageMediaRow = {
  message_id: string;
  role: string;
  metadata: string | null;
  image_id: string;
  job_id: string | null;
  path: string;
  prompt: string;
  mime_type: string;
  image_width: number;
  image_height: number;
  image_file_size: number;
};

type ShareRateCategory = "read" | "media" | "download";

const SHARE_RATE_LIMITS: Record<ShareRateCategory, { limit: number; windowMs: number }> = {
  read: { limit: 120, windowMs: 60_000 },
  media: { limit: 240, windowMs: 60_000 },
  download: { limit: 40, windowMs: 60_000 }
};
const SHARE_LOOKUP_RATE_LIMIT = { limit: 600, windowMs: 60_000 };

const shareRateBuckets = new Map<string, { count: number; resetAt: number }>();

function shareTokenPayload(shareId: string) {
  return `${SESSION_SHARE_TOKEN_SCOPE}:${SESSION_SHARE_TOKEN_VERSION}:${shareId}`;
}

export function createSessionShareToken(shareId: string, secret: string) {
  const encodedId = Buffer.from(shareId, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(shareTokenPayload(shareId)).digest("base64url");
  return `${SESSION_SHARE_TOKEN_VERSION}.${encodedId}.${signature}`;
}

export function sessionShareIdFromToken(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_SHARE_TOKEN_VERSION) return null;
  const encodedId = parts[1] ?? "";
  const signature = parts[2] ?? "";
  if (!encodedId || !signature) return null;
  let shareId = "";
  try {
    shareId = Buffer.from(encodedId, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!shareId || Buffer.from(shareId, "utf8").toString("base64url") !== encodedId) return null;
  const actual = Buffer.from(signature, "base64url");
  const expected = createHmac("sha256", secret).update(shareTokenPayload(shareId)).digest();
  if (actual.toString("base64url") !== signature || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return shareId;
}

const SESSION_SHARE_PUBLIC_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeSessionSharePublicToken(value: string | null | undefined) {
  const token = String(value ?? "").trim();
  return SESSION_SHARE_PUBLIC_TOKEN_PATTERN.test(token) ? token.toLowerCase() : null;
}

export function sessionShareTokenForLink(shareId: string, publicToken: string | null | undefined, secret: string) {
  return normalizeSessionSharePublicToken(publicToken) ?? createSessionShareToken(shareId, secret);
}

export function sessionShareTokenLookup(token: string, secret: string) {
  const publicToken = normalizeSessionSharePublicToken(token);
  if (publicToken) return { publicToken, shareId: null } as const;
  const shareId = sessionShareIdFromToken(token, secret);
  return shareId ? ({ publicToken: null, shareId } as const) : null;
}

function sessionShareSecret() {
  const row = getOne<{ signing_secret: string }>(
    configDb,
    "select signing_secret from session_share_signing_settings where id = ?",
    SESSION_SHARE_SECRET_ID
  );
  if (!row?.signing_secret) throw new Error("会话分享签名密钥尚未初始化");
  return row.signing_secret;
}

function publicSecurityHeaders() {
  return {
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive"
  } as const;
}

function applyPublicSecurityHeaders(c: Context) {
  for (const [name, value] of Object.entries(publicSecurityHeaders())) c.header(name, value);
}

function publicNotFound(c: Context) {
  applyPublicSecurityHeaders(c);
  return c.json({ error: PUBLIC_NOT_FOUND_MESSAGE }, 404);
}

function publicRateLimited(c: Context) {
  applyPublicSecurityHeaders(c);
  c.header("Retry-After", "60");
  return c.json({ error: "访问过于频繁，请稍后重试" }, 429);
}

export function resolveSessionShareClientAddress(input: {
  socketAddress?: string | null;
  trustProxy: boolean;
  cfConnectingIp?: string | null;
  forwardedFor?: string | null;
  realIp?: string | null;
}) {
  const socketAddress = String(input.socketAddress ?? "").trim().slice(0, 128);
  if (!input.trustProxy) return socketAddress;
  return (
    String(input.cfConnectingIp ?? "").trim() ||
    String(input.forwardedFor ?? "").split(",")[0]?.trim() ||
    String(input.realIp ?? "").trim() ||
    socketAddress
  ).slice(0, 128);
}

function requestClientAddress(c: Context) {
  return c.req.header(SESSION_SHARE_CLIENT_IP_HEADER)?.trim().slice(0, 128) || "unknown";
}

function consumeShareRateBucket(key: string, config: { limit: number; windowMs: number }) {
  const timestamp = Date.now();
  const existing = shareRateBuckets.get(key);
  if (!existing || existing.resetAt <= timestamp) {
    if (shareRateBuckets.size > 5_000) {
      for (const [bucketKey, bucket] of shareRateBuckets) {
        if (bucket.resetAt <= timestamp) shareRateBuckets.delete(bucketKey);
      }
      if (shareRateBuckets.size > 5_000) shareRateBuckets.clear();
    }
    shareRateBuckets.set(key, { count: 1, resetAt: timestamp + config.windowMs });
    return true;
  }
  existing.count += 1;
  return existing.count <= config.limit;
}

export function withinShareLookupRateLimit(c: Context) {
  const clientHash = createHash("sha256").update(requestClientAddress(c)).digest("base64url").slice(0, 16);
  return consumeShareRateBucket(`lookup:${clientHash}`, SHARE_LOOKUP_RATE_LIMIT);
}

function withinShareRateLimit(c: Context, shareId: string, category: ShareRateCategory) {
  const config = SHARE_RATE_LIMITS[category];
  const clientHash = createHash("sha256").update(requestClientAddress(c)).digest("base64url").slice(0, 16);
  const shareHash = createHash("sha256").update(shareId).digest("base64url").slice(0, 16);
  const key = `${category}:${clientHash}:${shareHash}`;
  return consumeShareRateBucket(key, config);
}

function configuredPublicOrigin() {
  const configured = String(Bun.env.APP_PUBLIC_URL ?? "").trim();
  if (!configured) return "";
  try {
    const url = new URL(configured);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function ipv4Parts(value: string) {
  const parts = value.split(".").map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function loopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function localSessionShareLanIpv4() {
  const virtualAdapterPattern = /(?:loopback|vethernet|virtual|vmware|virtualbox|docker|wsl|hyper-v|tailscale|zerotier)/i;
  const candidates = Object.entries(networkInterfaces()).flatMap(([adapterName, addresses]) =>
    (addresses ?? []).flatMap((entry) => {
      const family = String(entry.family).toLowerCase();
      const parts = ipv4Parts(entry.address);
      if (entry.internal || (family !== "ipv4" && family !== "4") || !parts || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254)) return [];
      let score = 20;
      if (parts[0] === 192 && parts[1] === 168) score = 40;
      else if (parts[0] === 10) score = 35;
      else if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) score = 30;
      else if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) score = 25;
      if (virtualAdapterPattern.test(adapterName)) score -= 100;
      return [{ address: entry.address, adapterName, score }];
    })
  );
  candidates.sort((left, right) => right.score - left.score || left.adapterName.localeCompare(right.adapterName) || left.address.localeCompare(right.address));
  return candidates[0]?.address ?? "";
}

export function resolveSessionSharePublicOrigin(value: string, lanAddress = "") {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (loopbackHostname(url.hostname) && ipv4Parts(lanAddress) && !loopbackHostname(lanAddress)) url.hostname = lanAddress;
    return url.origin;
  } catch {
    return "";
  }
}

function sharePublicOrigin(c: Context) {
  const configured = configuredPublicOrigin();
  if (configured) return configured;
  const lanAddress = localSessionShareLanIpv4();
  const requestOrigin = String(c.req.header("origin") ?? "").trim();
  const originFromHeader = resolveSessionSharePublicOrigin(requestOrigin, lanAddress);
  return originFromHeader || resolveSessionSharePublicOrigin(c.req.url, lanAddress) || new URL(c.req.url).origin;
}

export function sessionShareMutationOriginAllowed(input: {
  secFetchSite?: string | null;
  origin?: string | null;
  requestUrl: string;
  configuredOrigin?: string | null;
}) {
  const fetchSite = String(input.secFetchSite ?? "").trim().toLowerCase();
  if (fetchSite === "cross-site") return false;
  if (fetchSite === "same-origin") return true;
  const origin = String(input.origin ?? "").trim();
  if (!origin) return true;
  const allowed = new Set([new URL(input.requestUrl).origin, String(input.configuredOrigin ?? "").trim()].filter(Boolean));
  try {
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

function sameOriginMutation(c: Context) {
  return sessionShareMutationOriginAllowed({
    secFetchSite: c.req.header("sec-fetch-site"),
    origin: c.req.header("origin"),
    requestUrl: c.req.url,
    configuredOrigin: configuredPublicOrigin()
  });
}

function sessionSharePath(row: Pick<SessionShareLinkRow, "id" | "public_token">) {
  const token = sessionShareTokenForLink(row.id, row.public_token, sessionShareSecret());
  return `/share/${encodeURIComponent(token)}`;
}

function publicShareLink(row: SessionShareLinkRow, c: Context) {
  const path = sessionSharePath(row);
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    type: "chat" as const,
    path,
    url: `${sharePublicOrigin(c)}${path}`,
    messageCount: Number(row.message_count ?? 0),
    createdAt: row.created_at
  };
}

function activeShareFromToken(token: string) {
  const lookup = sessionShareTokenLookup(token, sessionShareSecret());
  if (!lookup) return null;
  return getOne<SessionShareLinkRow>(
    appDb,
    `select l.*
     from session_share_links l
     join users u on u.id = l.user_id and u.disabled = 0
     join sessions s on s.id = l.session_id and s.user_id = l.user_id and s.deleted_at is null
     where ${lookup.publicToken ? "l.public_token" : "l.id"} = ?`,
    lookup.publicToken ?? lookup.shareId
  );
}

function localMessageId(sortOrder: number) {
  return `shared-message-${sortOrder + 1}`;
}

function sortOrderFromLocalMessageId(value: string) {
  const match = value.match(/^shared-message-([1-9]\d*)$/);
  if (!match) return null;
  const valueNumber = Number(match[1]);
  return Number.isSafeInteger(valueNumber) && valueNumber <= SESSION_SHARE_MAX_MESSAGES ? valueNumber - 1 : null;
}

function sortOrderFromLocalImageId(value: string) {
  const match = value.match(/^shared-image-([1-9]\d*)$/);
  if (!match) return null;
  const valueNumber = Number(match[1]);
  return Number.isSafeInteger(valueNumber) && valueNumber <= SESSION_SHARE_MAX_MESSAGES ? valueNumber - 1 : null;
}

function sharedMessageBaseUrl(token: string, sortOrder: number) {
  return `/api/shared-sessions/${encodeURIComponent(token)}/messages/${localMessageId(sortOrder)}`;
}

function parsedSharedMessageMetadata(value: string | null | Record<string, unknown>) {
  return typeof value === "string" || value === null ? safeJson<Record<string, unknown>>(value, {}) : value;
}

export function sharedMessageHidesReferences(value: string | null | Record<string, unknown>) {
  return parsedSharedMessageMetadata(value).hideReference === true;
}

export function sharedMessageJobId(value: string | null | Record<string, unknown>) {
  const jobId = parsedSharedMessageMetadata(value).jobId;
  return typeof jobId === "string" ? jobId.trim() : "";
}

export function sharedAssistantReferencesHidden(
  value: string | null | Record<string, unknown>,
  hiddenReferenceJobIds: ReadonlySet<string>,
  imageJobId = ""
) {
  const jobId = imageJobId.trim() || sharedMessageJobId(value);
  return Boolean(jobId && hiddenReferenceJobIds.has(jobId));
}

export function safeSharedMessageMetadata(value: string | null | Record<string, unknown>, localJobId = "") {
  const raw = parsedSharedMessageMetadata(value);
  const metadata: Record<string, unknown> = {};
  const mode = String(raw.mode ?? "").trim();
  if (mode === "generation" || mode === "edit") metadata.mode = mode;
  if (localJobId) metadata.jobId = localJobId;
  if (raw.hideReference === true) metadata.hideReference = true;
  return metadata;
}

function safeScopedMetadata() {
  const jobs = new Map<string, string>();
  return (row: SharedMessageRow) => {
    const raw = safeJson<Record<string, unknown>>(row.metadata, {});
    const actualJobId = typeof raw.jobId === "string" ? raw.jobId.trim() : "";
    let localJobId = "";
    if (actualJobId) {
      localJobId = jobs.get(actualJobId) ?? `shared-job-${jobs.size + 1}`;
      jobs.set(actualJobId, localJobId);
    }
    return safeSharedMessageMetadata(raw, localJobId);
  };
}

function hiddenReferenceJobIdsForSession(share: Pick<SessionShareLinkRow, "user_id" | "session_id">) {
  const hiddenJobIds = new Set<string>();
  const rows = getAll<{ metadata: string | null }>(
    appDb,
    `select metadata from messages
     where user_id = ? and session_id = ? and role = 'user' and metadata is not null
     order by created_at asc, rowid asc`,
    share.user_id,
    share.session_id
  );
  for (const row of rows) {
    if (!sharedMessageHidesReferences(row.metadata)) continue;
    const jobId = sharedMessageJobId(row.metadata);
    if (jobId) hiddenJobIds.add(jobId);
  }
  return hiddenJobIds;
}

export function sharedImageViewUrls(token: string, sortOrder: number) {
  const baseUrl = sharedMessageBaseUrl(token, sortOrder);
  return {
    imageUrl: `${baseUrl}/image?variant=preview`,
    imageOriginalUrl: `${baseUrl}/image?variant=original`,
    imagePreviewUrl: `${baseUrl}/image?variant=preview`,
    imageThumbnailUrl: `${baseUrl}/image?variant=thumb`
  };
}

export function sharedReferenceViewUrls(baseUrl: string) {
  return {
    url: `${baseUrl}?variant=preview`,
    originalUrl: `${baseUrl}/download`,
    previewUrl: `${baseUrl}?variant=preview`,
    thumbnailUrl: `${baseUrl}?variant=thumb`
  };
}

export function sharedInlineImageVariantAllowed(variant: ImageVariant, role: string) {
  return variant !== "original" || role === "assistant";
}

function sharedMessages(share: SessionShareLinkRow, token: string) {
  const rows = getAll<SharedMessageRow>(
    appDb,
    `select sm.sort_order as share_sort_order,
            m.id, m.role, m.content, m.image_id, m.metadata, m.created_at,
            i.path as image_path, i.job_id as image_job_id, i.prompt as image_prompt, i.kind as image_kind,
            i.size as image_size, i.image_width, i.image_height, i.image_file_size,
            i.quality as image_quality, i.mime_type as image_mime_type
     from session_share_messages sm
     join messages m on m.id = sm.message_id and m.session_id = ? and m.user_id = ?
     left join images i on i.id = m.image_id and i.user_id = ?
     where sm.share_id = ?
     order by sm.sort_order asc`,
    share.session_id,
    share.user_id,
    share.user_id,
    share.id
  );
  if (rows.length === 0) return [];

  const hiddenReferenceJobIds = hiddenReferenceJobIdsForSession(share);
  const referenceVisibleMessageIds = rows
    .filter((row) => !sharedMessageHidesReferences(row.metadata))
    .map((row) => row.id);
  const imageIds = rows
    .filter((row) => {
      if (sharedMessageHidesReferences(row.metadata)) return false;
      return row.role !== "assistant" || !sharedAssistantReferencesHidden(row.metadata, hiddenReferenceJobIds, row.image_job_id ?? "");
    })
    .map((row) => row.image_id ?? "")
    .filter(Boolean);
  const messageReferences = referenceVisibleMessageIds.length > 0
    ? getAll<SharedReferenceRow>(
        appDb,
        `select id, message_id, source_name, path, mime_type, size, image_width, image_height, created_at
         from message_source_references
         where user_id = ? and message_id in (${referenceVisibleMessageIds.map(() => "?").join(", ")})
         order by message_id asc, sort_order asc, created_at asc, id asc`,
        share.user_id,
        ...referenceVisibleMessageIds
      )
    : [];
  const imageReferences = imageIds.length > 0
    ? getAll<SharedImageReferenceRow>(
        appDb,
        `select id, image_id, source_name, path, mime_type, size, image_width, image_height, created_at
         from image_asset_references
         where user_id = ? and image_id in (${imageIds.map(() => "?").join(", ")})
         order by image_id asc, sort_order asc, created_at asc, id asc`,
        share.user_id,
        ...imageIds
      )
    : [];
  const messageReferenceMap = new Map<string, SharedReferenceRow[]>();
  for (const reference of messageReferences) {
    messageReferenceMap.set(reference.message_id, [...(messageReferenceMap.get(reference.message_id) ?? []), reference]);
  }
  const imageReferenceMap = new Map<string, SharedImageReferenceRow[]>();
  for (const reference of imageReferences) {
    imageReferenceMap.set(reference.image_id, [...(imageReferenceMap.get(reference.image_id) ?? []), reference]);
  }
  const metadataFor = safeScopedMetadata();

  return rows.map((row) => {
    const baseUrl = sharedMessageBaseUrl(token, row.share_sort_order);
    const hideReference = row.role === "user" && sharedMessageHidesReferences(row.metadata);
    const hasImage = Boolean(row.image_id && row.image_path) && !hideReference;
    const viewUrls = hasImage ? sharedImageViewUrls(token, row.share_sort_order) : null;
    const imageUrl = viewUrls?.imageUrl ?? null;
    const imageOriginalUrl = viewUrls?.imageOriginalUrl ?? null;
    const imagePreviewUrl = viewUrls?.imagePreviewUrl ?? null;
    const imageThumbnailUrl = viewUrls?.imageThumbnailUrl ?? null;
    const imageDownloadUrl = hasImage ? `${baseUrl}/image/download?variant=original` : null;
    const sourceReferences = (messageReferenceMap.get(row.id) ?? []).map((reference, index) => {
      const referenceBase = `${baseUrl}/source-references/${index + 1}`;
      return {
        id: `shared-source-reference-${row.share_sort_order + 1}-${index + 1}`,
        kind: "asset" as const,
        name: reference.source_name,
        ...sharedReferenceViewUrls(referenceBase),
        imageWidth: reference.image_width ?? 0,
        imageHeight: reference.image_height ?? 0
      };
    });
    const primaryReference = !hasImage ? sourceReferences[0] ?? null : null;
    const outputReferences = row.image_id && !sharedAssistantReferencesHidden(row.metadata, hiddenReferenceJobIds, row.image_job_id ?? "")
      ? (imageReferenceMap.get(row.image_id) ?? []).map((reference, index) => {
          const referenceBase = `${baseUrl}/image-references/${index + 1}`;
          return {
            id: `shared-image-reference-${row.share_sort_order + 1}-${index + 1}`,
            name: reference.source_name,
            ...sharedReferenceViewUrls(referenceBase),
            mimeType: reference.mime_type,
            size: reference.size ?? 0,
            imageWidth: reference.image_width ?? 0,
            imageHeight: reference.image_height ?? 0,
            createdAt: reference.created_at
          };
        })
      : [];

    return {
      id: localMessageId(row.share_sort_order),
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content,
      imageId: hasImage ? `shared-image-${row.share_sort_order + 1}` : null,
      imageUrl,
      imageOriginalUrl,
      imagePreviewUrl,
      imageThumbnailUrl,
      imagePrompt: row.role === "assistant" ? row.image_prompt ?? null : null,
      referenceImageUrl: primaryReference?.url ?? (row.role === "user" ? imageUrl : null),
      referenceImageOriginalUrl: primaryReference?.originalUrl ?? (row.role === "user" ? imageDownloadUrl : null),
      referenceImagePreviewUrl: primaryReference?.previewUrl ?? (row.role === "user" ? imagePreviewUrl : null),
      referenceImageThumbnailUrl: primaryReference?.thumbnailUrl ?? (row.role === "user" ? imageThumbnailUrl : null),
      referenceImagePrompt: primaryReference?.name ?? (row.role === "user" && hasImage ? "参考图片" : null),
      referenceImageKind: row.role === "user" && (primaryReference || hasImage) ? (primaryReference ? "asset" : "image") : null,
      referenceImageWidth: primaryReference?.imageWidth ?? row.image_width ?? 0,
      referenceImageHeight: primaryReference?.imageHeight ?? row.image_height ?? 0,
      sourceReferenceImages: sourceReferences,
      imageKind: row.image_kind === "edit" ? "edit" : row.image_kind ? "generation" : null,
      imageSize: row.image_size ?? null,
      imageWidth: row.image_width ?? 0,
      imageHeight: row.image_height ?? 0,
      imageFileSize: row.image_file_size ?? 0,
      imageQuality: row.image_quality ?? null,
      referenceImages: outputReferences,
      metadata: metadataFor(row),
      createdAt: row.created_at
    };
  });
}

function sharedMessageMedia(share: SessionShareLinkRow, localId: string) {
  const sortOrder = sortOrderFromLocalMessageId(localId);
  if (sortOrder === null) return null;
  const media = getOne<SharedMessageMediaRow>(
    appDb,
    `select m.id as message_id, m.role, m.metadata, i.id as image_id, i.job_id, i.path, i.prompt,
            i.mime_type, i.image_width, i.image_height, i.image_file_size
     from session_share_messages sm
     join messages m on m.id = sm.message_id and m.session_id = ? and m.user_id = ?
     join images i on i.id = m.image_id and i.user_id = ?
     where sm.share_id = ? and sm.sort_order = ?`,
    share.session_id,
    share.user_id,
    share.user_id,
    share.id,
    sortOrder
  );
  if (media?.role === "user" && sharedMessageHidesReferences(media.metadata)) return null;
  return media;
}

function sharedResultImageMedia(share: SessionShareLinkRow, localImageId: string) {
  const sortOrder = sortOrderFromLocalImageId(localImageId);
  return sortOrder === null ? null : sharedMessageMedia(share, localMessageId(sortOrder));
}

function sharedReferenceByIndex(
  share: SessionShareLinkRow,
  localId: string,
  rawIndex: string,
  type: "source" | "image"
) {
  const sortOrder = sortOrderFromLocalMessageId(localId);
  const index = Number(rawIndex);
  if (sortOrder === null || !Number.isSafeInteger(index) || index < 1 || index > 100) return null;
  const offset = index - 1;
  const message = getOne<{ id: string; role: string; metadata: string | null; image_id: string | null; image_job_id: string | null }>(
    appDb,
    `select m.id, m.role, m.metadata, m.image_id, i.job_id as image_job_id
     from session_share_messages sm
     join messages m on m.id = sm.message_id and m.session_id = ? and m.user_id = ?
     left join images i on i.id = m.image_id and i.user_id = ?
     where sm.share_id = ? and sm.sort_order = ?`,
    share.session_id,
    share.user_id,
    share.user_id,
    share.id,
    sortOrder
  );
  if (!message) return null;
  if (type === "source") {
    if (sharedMessageHidesReferences(message.metadata)) return null;
    return getOne<SharedReferenceRow>(
      appDb,
      `select r.id, r.message_id, r.source_name, r.path, r.mime_type, r.size,
              r.image_width, r.image_height, r.created_at
       from message_source_references r
       where r.message_id = ? and r.user_id = ?
       order by r.sort_order asc, r.created_at asc, r.id asc
       limit 1 offset ?`,
      message.id,
      share.user_id,
      offset
    );
  }
  if (
    message.role !== "assistant" ||
    !message.image_id ||
    sharedAssistantReferencesHidden(message.metadata, hiddenReferenceJobIdsForSession(share), message.image_job_id ?? "")
  ) {
    return null;
  }
  return getOne<SharedImageReferenceRow>(
    appDb,
    `select r.id, r.image_id, r.source_name, r.path, r.mime_type, r.size,
            r.image_width, r.image_height, r.created_at
     from image_asset_references r
     where r.image_id = ? and r.user_id = ?
     order by r.sort_order asc, r.created_at asc, r.id asc
     limit 1 offset ?`,
    message.image_id,
    share.user_id,
    offset
  );
}

async function sharedImageFile(
  source: { sourceType: "image" | "image-reference" | "message-source-reference"; sourceId: string; path: string; mimeType: string },
  variant: ImageVariant
) {
  if (variant === "original") {
    return { buffer: await readStoredFile(source.path), mimeType: source.mimeType || mimeTypeFromPath(source.path) };
  }
  const derivative = await getOrCreateImageDerivative(
    { sourceType: source.sourceType, sourceId: source.sourceId, path: source.path },
    variant
  );
  return { buffer: derivative.buffer, mimeType: derivative.mimeType };
}

function sharedImageResponse(file: { buffer: Buffer; mimeType: string }) {
  const headers: Record<string, string> = {
    ...publicSecurityHeaders(),
    "Content-Length": String(file.buffer.length),
    "Content-Type": file.mimeType || "image/png"
  };
  return new Response(new Uint8Array(file.buffer), { headers });
}

function safeDownloadName(prompt: string, mimeType: string, suffix: string) {
  const base = prompt
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\.(png|jpe?g|webp|avif)$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim() || "分享图片";
  return `${base}-${suffix}.${imageExtensionFromMime(mimeType)}`;
}

async function sharedImageDownloadOptions(baseUrl: string, image: SharedMessageMediaRow) {
  const configs = [
    { variant: "thumb" as const, label: "缩略图", description: "WebP，小文件", suffix: "缩略图" },
    { variant: "preview" as const, label: "预览图", description: "WebP，快速查看", suffix: "预览图" },
    { variant: "original" as const, label: "原图", description: "保留原格式和最高质量", suffix: "原图" }
  ];
  const options = [];
  for (const config of configs) {
    if (config.variant === "original") {
      await readStoredFile(image.path);
      const mimeType = image.mime_type || mimeTypeFromPath(image.path);
      options.push({
        variant: config.variant,
        label: config.label,
        description: config.description,
        url: `${baseUrl}?variant=${config.variant}`,
        downloadName: safeDownloadName(image.prompt, mimeType, config.suffix),
        mimeType,
        fileSize: image.image_file_size ?? 0,
        width: image.image_width ?? 0,
        height: image.image_height ?? 0
      });
      continue;
    }
    const derivative = await getOrCreateImageDerivative(
      { sourceType: "image", sourceId: image.image_id, path: image.path },
      config.variant
    );
    options.push({
      variant: config.variant,
      label: config.label,
      description: config.description,
      url: `${baseUrl}?variant=${config.variant}`,
      downloadName: safeDownloadName(image.prompt, derivative.mimeType, config.suffix),
      mimeType: derivative.mimeType,
      fileSize: derivative.size ?? 0,
      width: derivative.width ?? 0,
      height: derivative.height ?? 0
    });
  }
  return options;
}

function requestedMessageIds(value: unknown) {
  if (!Array.isArray(value)) return { error: "请选择要分享的消息" } as const;
  const ids = value.map((item) => String(item ?? "").trim());
  if (ids.length === 0) return { error: "当前会话没有可分享的消息" } as const;
  if (ids.length > SESSION_SHARE_MAX_MESSAGES) return { error: `单次最多分享 ${SESSION_SHARE_MAX_MESSAGES} 条消息` } as const;
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return { error: "分享消息列表无效" } as const;
  return { ids } as const;
}

export function sessionShareSnapshotMatches(existingMessageIds: readonly string[], requestedMessageIds: readonly string[]) {
  return (
    existingMessageIds.length === requestedMessageIds.length &&
    existingMessageIds.every((messageId, index) => messageId === requestedMessageIds[index])
  );
}

export function registerSessionShareRoutes(api: Hono) {
  api.use("/shared-sessions/*", async (c, next) => {
    if (!withinShareLookupRateLimit(c)) return publicRateLimited(c);
    await next();
  });

  api.post("/sessions/:sessionId/share-links", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    if (!sameOriginMutation(c)) return c.json({ error: "请求来源无效" }, 403);
    const body = await c.req.json().catch(() => ({}));
    const requested = requestedMessageIds((body as Record<string, unknown>).messageIds);
    if ("error" in requested) return c.json({ error: requested.error }, 400);
    const sessionId = c.req.param("sessionId");
    expireStaleImageJobs(user.id, sessionId);

    const creation = appDb.transaction(() => {
      const session = getOne<{ id: string; title: string }>(
        appDb,
        "select id, title from sessions where id = ? and user_id = ? and deleted_at is null",
        sessionId,
        user.id
      );
      if (!session) return { error: "对话不存在", status: 404 as const };
      const running = getOne<{ id: string }>(
        appDb,
        "select id from image_jobs where session_id = ? and user_id = ? and status = 'running' limit 1",
        sessionId,
        user.id
      );
      if (running) return { error: "图片仍在生成中，请完成后再分享", status: 409 as const };
      const rows = getAll<{ id: string; role: string }>(
        appDb,
        `select id, role from messages
         where session_id = ? and user_id = ? and id in (${requested.ids.map(() => "?").join(", ")})
         order by created_at asc, rowid asc`,
        sessionId,
        user.id,
        ...requested.ids
      );
      if (
        rows.length !== requested.ids.length ||
        rows.some((row) => row.role !== "user" && row.role !== "assistant") ||
        rows.some((row, index) => row.id !== requested.ids[index])
      ) {
        return { error: "消息列表已变化，请刷新会话后重试", status: 409 as const };
      }
      const existingShares = getAll<SessionShareLinkRow>(
        appDb,
        `select l.*,
                (select count(*) from session_share_messages sm where sm.share_id = l.id) as message_count
         from session_share_links l
         where l.user_id = ? and l.session_id = ?
           and (select count(*) from session_share_messages sm where sm.share_id = l.id) = ?
         order by l.created_at asc, l.rowid asc`,
        user.id,
        sessionId,
        rows.length
      );
      const requestedIds = rows.map((row) => row.id);
      const existingShare = existingShares.find((share) => {
        const existingMessageIds = getAll<{ message_id: string }>(
          appDb,
          "select message_id from session_share_messages where share_id = ? order by sort_order asc",
          share.id
        ).map((item) => item.message_id);
        return sessionShareSnapshotMatches(existingMessageIds, requestedIds);
      });
      if (existingShare) return { row: existingShare, reused: true as const };

      const id = `share_${randomUUID().replaceAll("-", "")}`;
      const publicToken = randomUUID();
      const timestamp = now();
      run(
        appDb,
        "insert into session_share_links (id, public_token, user_id, session_id, title, created_at) values (?, ?, ?, ?, ?, ?)",
        id,
        publicToken,
        user.id,
        sessionId,
        session.title,
        timestamp
      );
      rows.forEach((row, index) => {
        run(
          appDb,
          "insert into session_share_messages (share_id, message_id, sort_order) values (?, ?, ?)",
          id,
          row.id,
          index
        );
      });
      return {
        row: {
          id,
          public_token: publicToken,
          user_id: user.id,
          session_id: sessionId,
          title: session.title,
          created_at: timestamp,
          message_count: rows.length
        } satisfies SessionShareLinkRow,
        reused: false as const
      };
    })();

    if ("error" in creation) return c.json({ error: creation.error }, creation.status);
    audit(creation.reused ? "session_share.reuse" : "session_share.create", {
      shareId: creation.row.id,
      sessionId: creation.row.session_id,
      messageCount: creation.row.message_count,
      reused: creation.reused
    });
    return c.json({ shareLink: publicShareLink(creation.row, c) });
  });

  api.get("/session-share-links", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const pagination = paginationFromQuery(c);
    const total = getOne<{ total: number }>(
      appDb,
      `select count(*) as total
       from session_share_links l
       join sessions s on s.id = l.session_id and s.user_id = l.user_id and s.deleted_at is null
       where l.user_id = ?`,
      user.id
    )?.total ?? 0;
    const limitSql = pagination.enabled ? " limit ? offset ?" : "";
    const rows = getAll<SessionShareLinkRow>(
      appDb,
      `select l.*,
              (select count(*) from session_share_messages sm where sm.share_id = l.id) as message_count
       from session_share_links l
       join sessions s on s.id = l.session_id and s.user_id = l.user_id and s.deleted_at is null
       where l.user_id = ?
       order by l.created_at desc, l.rowid desc${limitSql}`,
      user.id,
      ...(pagination.enabled ? [pagination.limit, pagination.offset] : [])
    );
    return c.json({ links: rows.map((row) => publicShareLink(row, c)), pageInfo: pageInfo(total, pagination) });
  });

  api.delete("/session-share-links/:shareId", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    if (!sameOriginMutation(c)) return c.json({ error: "请求来源无效" }, 403);
    const shareId = c.req.param("shareId");
    const existing = getOne<Pick<SessionShareLinkRow, "id" | "session_id">>(
      appDb,
      "select id, session_id from session_share_links where id = ? and user_id = ?",
      shareId,
      user.id
    );
    if (!existing) return c.json({ error: "分享链接不存在" }, 404);
    appDb.transaction(() => {
      run(appDb, "delete from session_share_messages where share_id = ?", shareId);
      run(appDb, "delete from session_share_links where id = ? and user_id = ?", shareId, user.id);
    })();
    audit("session_share.delete", { shareId, sessionId: existing.session_id });
    return c.json({ ok: true });
  });

  api.delete("/session-share-links", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    if (!sameOriginMutation(c)) return c.json({ error: "请求来源无效" }, 403);
    const deleted = appDb.transaction(() => {
      run(
        appDb,
        "delete from session_share_messages where share_id in (select id from session_share_links where user_id = ?)",
        user.id
      );
      const result = run(appDb, "delete from session_share_links where user_id = ?", user.id);
      return Number(result.changes ?? 0);
    })();
    audit("session_share.delete_all", { userId: user.id, deleted });
    return c.json({ ok: true, deleted });
  });

  api.get("/shared-sessions/:token", (c) => {
    const token = c.req.param("token");
    const share = activeShareFromToken(token);
    if (!share) return publicNotFound(c);
    if (!withinShareRateLimit(c, share.id, "read")) return publicRateLimited(c);
    applyPublicSecurityHeaders(c);
    return c.json({
      share: { title: share.title, createdAt: share.created_at },
      messages: sharedMessages(share, token)
    });
  });

  api.get("/shared-sessions/:token/messages/:messageId/image/download-options", async (c) => {
    const token = c.req.param("token");
    const share = activeShareFromToken(token);
    if (!share) return publicNotFound(c);
    if (!withinShareRateLimit(c, share.id, "download")) return publicRateLimited(c);
    const image = sharedMessageMedia(share, c.req.param("messageId"));
    if (!image || image.role !== "assistant") return publicNotFound(c);
    try {
      const options = await sharedImageDownloadOptions(
        `/api/shared-sessions/${encodeURIComponent(token)}/messages/${encodeURIComponent(c.req.param("messageId"))}/image/download`,
        image
      );
      applyPublicSecurityHeaders(c);
      return c.json({ options });
    } catch {
      return publicNotFound(c);
    }
  });

  api.get("/shared-sessions/:token/messages/:messageId/image/download", async (c) => {
    const token = c.req.param("token");
    const share = activeShareFromToken(token);
    if (!share) return publicNotFound(c);
    if (!withinShareRateLimit(c, share.id, "download")) return publicRateLimited(c);
    const image = sharedMessageMedia(share, c.req.param("messageId"));
    if (!image) return publicNotFound(c);
    const variant = normalizeImageVariant(c.req.query("variant"));
    try {
      const file = await sharedImageFile(
        { sourceType: "image", sourceId: image.image_id, path: image.path, mimeType: image.mime_type },
        variant
      );
      return sharedImageResponse(file);
    } catch {
      return publicNotFound(c);
    }
  });

  api.get("/shared-sessions/:token/messages/:messageId/image", async (c) => {
    const token = c.req.param("token");
    const share = activeShareFromToken(token);
    if (!share) return publicNotFound(c);
    if (!withinShareRateLimit(c, share.id, "media")) return publicRateLimited(c);
    const image = sharedMessageMedia(share, c.req.param("messageId"));
    if (!image) return publicNotFound(c);
    const variant = normalizeImageVariant(c.req.query("variant"));
    if (!sharedInlineImageVariantAllowed(variant, image.role)) return publicNotFound(c);
    try {
      return sharedImageResponse(
        await sharedImageFile(
          { sourceType: "image", sourceId: image.image_id, path: image.path, mimeType: image.mime_type },
          variant
        )
      );
    } catch {
      return publicNotFound(c);
    }
  });

  api.get("/shared-sessions/:token/result-images/:imageId/download-options", async (c) => {
    const token = c.req.param("token");
    const share = activeShareFromToken(token);
    if (!share) return publicNotFound(c);
    if (!withinShareRateLimit(c, share.id, "download")) return publicRateLimited(c);
    const image = sharedResultImageMedia(share, c.req.param("imageId"));
    if (!image || image.role !== "assistant") return publicNotFound(c);
    try {
      const options = await sharedImageDownloadOptions(
        `/api/shared-sessions/${encodeURIComponent(token)}/result-images/${encodeURIComponent(c.req.param("imageId"))}/download`,
        image
      );
      applyPublicSecurityHeaders(c);
      return c.json({ options });
    } catch {
      return publicNotFound(c);
    }
  });

  api.get("/shared-sessions/:token/result-images/:imageId/download", async (c) => {
    const token = c.req.param("token");
    const share = activeShareFromToken(token);
    if (!share) return publicNotFound(c);
    if (!withinShareRateLimit(c, share.id, "download")) return publicRateLimited(c);
    const image = sharedResultImageMedia(share, c.req.param("imageId"));
    if (!image || image.role !== "assistant") return publicNotFound(c);
    const variant = normalizeImageVariant(c.req.query("variant"));
    try {
      const file = await sharedImageFile(
        { sourceType: "image", sourceId: image.image_id, path: image.path, mimeType: image.mime_type },
        variant
      );
      return sharedImageResponse(file);
    } catch {
      return publicNotFound(c);
    }
  });

  api.get("/shared-sessions/:token/messages/:messageId/source-references/:index", async (c) => {
    const token = c.req.param("token");
    const share = activeShareFromToken(token);
    if (!share) return publicNotFound(c);
    if (!withinShareRateLimit(c, share.id, "media")) return publicRateLimited(c);
    const reference = sharedReferenceByIndex(share, c.req.param("messageId"), c.req.param("index"), "source");
    const variant = normalizeImageVariant(c.req.query("variant"));
    if (!reference || variant === "original") return publicNotFound(c);
    try {
      return sharedImageResponse(
        await sharedImageFile(
          { sourceType: "message-source-reference", sourceId: reference.id, path: reference.path, mimeType: reference.mime_type },
          variant
        )
      );
    } catch {
      return publicNotFound(c);
    }
  });

  api.get("/shared-sessions/:token/messages/:messageId/source-references/:index/download", async (c) => {
    const token = c.req.param("token");
    const share = activeShareFromToken(token);
    if (!share) return publicNotFound(c);
    if (!withinShareRateLimit(c, share.id, "download")) return publicRateLimited(c);
    const reference = sharedReferenceByIndex(share, c.req.param("messageId"), c.req.param("index"), "source");
    if (!reference) return publicNotFound(c);
    try {
      return sharedImageResponse(
        await sharedImageFile(
          { sourceType: "message-source-reference", sourceId: reference.id, path: reference.path, mimeType: reference.mime_type },
          "original"
        )
      );
    } catch {
      return publicNotFound(c);
    }
  });

  api.get("/shared-sessions/:token/messages/:messageId/image-references/:index", async (c) => {
    const token = c.req.param("token");
    const share = activeShareFromToken(token);
    if (!share) return publicNotFound(c);
    if (!withinShareRateLimit(c, share.id, "media")) return publicRateLimited(c);
    const reference = sharedReferenceByIndex(share, c.req.param("messageId"), c.req.param("index"), "image");
    const variant = normalizeImageVariant(c.req.query("variant"));
    if (!reference || variant === "original") return publicNotFound(c);
    try {
      return sharedImageResponse(
        await sharedImageFile(
          { sourceType: "image-reference", sourceId: reference.id, path: reference.path, mimeType: reference.mime_type },
          variant
        )
      );
    } catch {
      return publicNotFound(c);
    }
  });

  api.get("/shared-sessions/:token/messages/:messageId/image-references/:index/download", async (c) => {
    const token = c.req.param("token");
    const share = activeShareFromToken(token);
    if (!share) return publicNotFound(c);
    if (!withinShareRateLimit(c, share.id, "download")) return publicRateLimited(c);
    const reference = sharedReferenceByIndex(share, c.req.param("messageId"), c.req.param("index"), "image");
    if (!reference) return publicNotFound(c);
    try {
      return sharedImageResponse(
        await sharedImageFile(
          { sourceType: "image-reference", sourceId: reference.id, path: reference.path, mimeType: reference.mime_type },
          "original"
        )
      );
    } catch {
      return publicNotFound(c);
    }
  });
}
