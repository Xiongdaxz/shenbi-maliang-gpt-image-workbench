import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { Context, Hono } from "hono";
import { appDb, configDb, getOne } from "./db";
import { mimeTypeFromPath } from "./imageFiles";
import { readStoredFile } from "./secureFiles";
import type { ImageRow } from "./types";

const MCP_IMAGE_RESULT_TOKEN_VERSION = "v2";
const WORKBUDDY_RESULT_TICKET_VERSION = "wb1";
const MCP_IMAGE_RESULT_TOKEN_SCOPE = "mcp-image-result";
const MCP_IMAGE_RESULT_SECRET_ID = "default";
const MCP_IMAGE_RESULT_TTL_MS = 60 * 60 * 1000;
export const MCP_IMAGE_RESULT_CACHE_CONTROL = "private, no-store";
export const WORKBUDDY_DELIVERY_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const WORKBUDDY_RESULT_TTL_MS = 5 * 60 * 1000;

type McpImageResultTokenPayload = {
  i: string;
  u: string;
  g: string;
  v: number;
  e: number;
  j?: string;
  d?: string;
};

type ImageResultOwner = { imageId: string; userId: string; grantId: string; grantVersion: number };

function signImageResult(payload: McpImageResultTokenPayload, secret: string, version: string) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(`${MCP_IMAGE_RESULT_TOKEN_SCOPE}:${version}:${encoded}`).digest("base64url");
  return `${version}.${encoded}.${signature}`;
}

function mcpImageResultSigningSecret() {
  const row = getOne<{ signing_secret: string }>(
    configDb,
    "select signing_secret from external_mcp_signing_settings where id = ?",
    MCP_IMAGE_RESULT_SECRET_ID
  );
  if (!row?.signing_secret) throw new Error("MCP 图片结果签名密钥尚未初始化");
  return row.signing_secret;
}

export function createMcpImageResultToken(
  input: ImageResultOwner,
  secret: string,
  expiresAtMs = Date.now() + MCP_IMAGE_RESULT_TTL_MS
) {
  return signImageResult({
    i: input.imageId,
    u: input.userId,
    g: input.grantId,
    v: input.grantVersion,
    e: Math.floor(expiresAtMs / 1000)
  }, secret, MCP_IMAGE_RESULT_TOKEN_VERSION);
}

function readSignedImageResult(token: string, secret: string, nowMs: number, version: string) {
  if (!token || token.length > 2_048) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== version) return null;
  const encodedPayload = parts[1] ?? "";
  const signature = parts[2] ?? "";
  if (!encodedPayload || !signature) return null;

  const actual = Buffer.from(signature, "base64url");
  const expected = createHmac("sha256", secret).update(`${MCP_IMAGE_RESULT_TOKEN_SCOPE}:${version}:${encodedPayload}`).digest();
  if (actual.toString("base64url") !== signature || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const decoded = Buffer.from(encodedPayload, "base64url");
    if (decoded.toString("base64url") !== encodedPayload) return null;
    const payload = JSON.parse(decoded.toString("utf8")) as Partial<McpImageResultTokenPayload>;
    const imageId = String(payload.i ?? "").trim();
    const userId = String(payload.u ?? "").trim();
    const grantId = String(payload.g ?? "").trim();
    const grantVersion = Number(payload.v);
    const expiresAt = Number(payload.e);
    if (
      !imageId || imageId.length > 200
      || !userId || userId.length > 200
      || !grantId || grantId.length > 200
      || !Number.isSafeInteger(grantVersion) || grantVersion <= 0
    ) return null;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(nowMs / 1000)) return null;
    return { imageId, userId, grantId, grantVersion, expiresAt, jobId: payload.j, challenge: payload.d };
  } catch {
    return null;
  }
}

export function mcpImageResultFromToken(token: string, secret: string, nowMs = Date.now()) {
  const result = readSignedImageResult(token, secret, nowMs, MCP_IMAGE_RESULT_TOKEN_VERSION);
  if (!result) return null;
  const { imageId, userId, grantId, grantVersion, expiresAt } = result;
  return { imageId, userId, grantId, grantVersion, expiresAt };
}

export function createWorkBuddyImageDelivery(
  input: ImageResultOwner & { jobId: string; challenge: string },
  secret = mcpImageResultSigningSecret(),
  nowMs = Date.now()
) {
  const expiresAt = nowMs + WORKBUDDY_RESULT_TTL_MS;
  const ticket = signImageResult({
    i: input.imageId, u: input.userId, g: input.grantId, v: input.grantVersion,
    e: Math.floor(expiresAt / 1000), j: input.jobId, d: input.challenge
  }, secret, WORKBUDDY_RESULT_TICKET_VERSION);
  return { imageId: input.imageId, ticket, expiresAt: new Date(expiresAt).toISOString() };
}

export function workBuddyImageResultFromTicket(ticket: string, proof: string, secret: string, nowMs = Date.now()) {
  if (!WORKBUDDY_DELIVERY_CHALLENGE_PATTERN.test(proof)) return null;
  const result = readSignedImageResult(ticket, secret, nowMs, WORKBUDDY_RESULT_TICKET_VERSION);
  if (!result?.jobId || typeof result.challenge !== "string" || !WORKBUDDY_DELIVERY_CHALLENGE_PATTERN.test(result.challenge)) return null;
  const expected = createHash("sha256").update(proof).digest("base64url");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(result.challenge)) ? result : null;
}

export function createMcpImageResultPresentation(input: {
  imageId: string;
  userId: string;
  grantId: string;
  grantVersion: number;
  publicBaseUrl: string;
  expiresAtMs?: number;
}) {
  return createMcpImageResultPresentationWithSecret(input, mcpImageResultSigningSecret());
}

export function createMcpImageResultPresentationWithSecret(input: {
  imageId: string;
  userId: string;
  grantId: string;
  grantVersion: number;
  publicBaseUrl: string;
  expiresAtMs?: number;
}, secret: string) {
  const expiresAtMs = input.expiresAtMs ?? Date.now() + MCP_IMAGE_RESULT_TTL_MS;
  const token = createMcpImageResultToken(
    { imageId: input.imageId, userId: input.userId, grantId: input.grantId, grantVersion: input.grantVersion },
    secret,
    expiresAtMs
  );
  const downloadUrl = `${input.publicBaseUrl.replace(/\/+$/, "")}/mcp/image-result/${encodeURIComponent(token)}`;
  return {
    imageId: input.imageId,
    downloadUrl,
    // Keep the old field during the plugin upgrade window. It now resolves to
    // the same original file as downloadUrl instead of a preview derivative.
    previewUrl: downloadUrl,
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

export async function readMcpImageResultOriginal(
  image: Pick<ImageRow, "path" | "mime_type">,
  readImage: (path: string) => Promise<Buffer> = readStoredFile
) {
  return {
    buffer: await readImage(image.path),
    mimeType: image.mime_type || mimeTypeFromPath(image.path) || "image/png"
  };
}

function resultHeaders(c: Context) {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Cache-Control", MCP_IMAGE_RESULT_CACHE_CONTROL);
  c.header("Cross-Origin-Resource-Policy", "cross-origin");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function missingResult(c: Context) {
  resultHeaders(c);
  return c.json({ error: "图片链接不存在或已失效" }, 404);
}

export function mcpImageResultGrantIsActive(db: Database, grantId: string, grantVersion: number, userId: string) {
  return Boolean(getOne<{ id: string }>(
    db,
    "select id from oauth_grants where id = ? and credential_version = ? and user_id = ? and revoked_at is null",
    grantId,
    grantVersion,
    userId
  ));
}

async function sendOriginalImage(c: Context, payload: ImageResultOwner, jobId?: string) {

    if (!mcpImageResultGrantIsActive(appDb, payload.grantId, payload.grantVersion, payload.userId)) return missingResult(c);

    const image = getOne<ImageRow>(
      appDb,
      "select * from images where id = ? and user_id = ?",
      payload.imageId,
      payload.userId
    );
    if (!image || (jobId && image.job_id !== jobId)) return missingResult(c);

    try {
      const { buffer, mimeType } = await readMcpImageResultOriginal(image);
      resultHeaders(c);
      c.header("Content-Type", mimeType);
      c.header("Content-Length", String(buffer.length));
      c.header("Content-Disposition", `inline; filename="${image.id}"`);
      c.header("ETag", `"${createHash("sha256").update(buffer).digest("base64url").slice(0, 24)}"`);
      return c.body(new Uint8Array(buffer));
    } catch {
      return missingResult(c);
    }
}

export function registerExternalMcpResultRoutes(app: Hono) {
  app.get("/mcp/image-result/:token", (c) => {
    try {
      const payload = mcpImageResultFromToken(c.req.param("token"), mcpImageResultSigningSecret());
      return payload ? sendOriginalImage(c, payload) : missingResult(c);
    } catch { return missingResult(c); }
  });
  app.post("/mcp/workbuddy-image-result/:jobId/:imageId", (c) => {
    const proof = c.req.header("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    const ticket = c.req.header("X-Maliang-Delivery-Ticket");
    if (!proof || !ticket) return missingResult(c);
    try {
      const payload = workBuddyImageResultFromTicket(ticket, proof, mcpImageResultSigningSecret());
      if (!payload || payload.jobId !== c.req.param("jobId") || payload.imageId !== c.req.param("imageId")) return missingResult(c);
      return sendOriginalImage(c, payload, payload.jobId);
    } catch { return missingResult(c); }
  });
}
