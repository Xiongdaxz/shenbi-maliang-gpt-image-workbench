import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { appDb, getOne, run } from "./db";
import { warmImageDerivatives } from "./imageDerivatives";
import { detectImageTransparency } from "./imageTransparency";
import {
  InvalidUploadedImageError,
  SAFE_UPLOAD_IMAGE_MIME_TYPES,
  validateUploadedImage
} from "./imageValidation";
import { LimitedRequestBodyError, requestWithLimitedBody } from "./limitedRequestBody";
import { deleteStoredFilesIfUnreferenced, secureAssetPath, writeEncryptedFile } from "./secureFiles";
import type { AssetRow } from "./types";
import { localTimestamp, makeId, now, utcNow } from "./utils";
import { oauthTokenHash } from "./externalMcpAuth";

const MCP_UPLOAD_TTL_SECONDS = 15 * 60;
const MCP_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const MCP_UPLOAD_REQUEST_MAX_BYTES = MCP_UPLOAD_MAX_BYTES + 1024 * 1024;
const MCP_UPLOAD_PENDING_LIMIT = 8;
const MCP_UPLOAD_GLOBAL_CONCURRENCY = 4;
const MCP_UPLOAD_CLEANUP_BATCH_SIZE = 250;
const MCP_UPLOAD_EXPIRED_RETENTION_MS = 24 * 60 * 60 * 1000;
const MCP_UPLOAD_COMPLETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
let activeMcpUploadParsers = 0;

function acquireMcpUploadParserSlot() {
  if (activeMcpUploadParsers >= MCP_UPLOAD_GLOBAL_CONCURRENCY) return null;
  activeMcpUploadParsers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeMcpUploadParsers = Math.max(0, activeMcpUploadParsers - 1);
  };
}

export type McpImageUploadRow = {
  id: string;
  user_id: string;
  asset_id: string | null;
  original_name: string;
  mime_type: string;
  size: number;
  status: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  updated_at: string;
};

function uploadExpiry() {
  return new Date(Date.now() + MCP_UPLOAD_TTL_SECONDS * 1000).toISOString();
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uploadHeaders(c: Context) {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
}

function wantsUploadJson(c: Context) {
  return String(c.req.header("accept") ?? "").toLowerCase().includes("application/json");
}

function uploadPage(input: { title: string; message: string; token?: string; error?: boolean }) {
  const form = input.token
    ? `<form method="post" enctype="multipart/form-data" action="/mcp/upload/${encodeURIComponent(input.token)}">
        <label class="picker"><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required><span>选择 PNG、JPG 或 WebP 图片</span><small>最大 20 MB，此链接只能成功上传一次</small></label>
        <button type="submit">安全上传给神笔马良</button>
      </form>`
    : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title><style>
  :root{font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;color:#172033;background:#f5f6fa}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 10% 10%,#ffedd5 0,transparent 35%),radial-gradient(circle at 90% 90%,#e0e7ff 0,transparent 40%),#f5f6fa}.card{width:min(520px,100%);padding:30px;background:rgba(255,255,255,.95);border:1px solid #e5e7eb;border-radius:24px;box-shadow:0 24px 70px #1f29371f}.brand{font-weight:850;color:#6d28d9}.icon{display:grid;place-items:center;width:58px;height:58px;margin:22px 0 16px;border-radius:18px;background:${input.error ? "#fee2e2;color:#b91c1c" : "linear-gradient(135deg,#f59e0b,#7c3aed);color:white"};font-size:28px}h1{font-size:25px;margin:0 0 8px}.message{color:#667085;line-height:1.7;margin:0 0 22px}.picker{display:block;padding:24px;border:1.5px dashed #c6cad3;border-radius:16px;text-align:center;background:#fafbfc;cursor:pointer}.picker input{display:block;width:100%;margin-bottom:13px}.picker span{display:block;font-weight:750}.picker small{display:block;margin-top:6px;color:#8a94a6}button{width:100%;border:0;border-radius:13px;margin-top:14px;padding:14px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font:inherit;font-weight:800;cursor:pointer}.hint{font-size:12px;color:#98a2b3;text-align:center;margin:18px 0 0;line-height:1.6}</style></head><body><main class="card"><div class="brand">神笔马良 · 图片上传</div><div class="icon">${input.error ? "!" : "马"}</div><h1>${escapeHtml(input.title)}</h1><p class="message">${escapeHtml(input.message)}</p>${form}<p class="hint">图片会加密保存到你的私有素材库，账号密码不会交给智能体。</p></main></body></html>`;
}

export function createMcpImageUpload(userId: string, publicBaseUrl: string) {
  cleanupMcpImageUploads();
  const active = getOne<{ count: number }>(
    appDb,
    `select count(*) as count from mcp_image_uploads
     where user_id = ? and status in ('pending', 'uploading') and expires_at > ?`,
    userId,
    utcNow()
  );
  if (Number(active?.count ?? 0) >= MCP_UPLOAD_PENDING_LIMIT) {
    throw new Error("mcp_upload_pending_limit");
  }
  const token = randomBytes(32).toString("base64url");
  const uploadId = makeId("mcpupload");
  const expiresAt = uploadExpiry();
  const timestamp = now();
  run(
    appDb,
    `insert into mcp_image_uploads
      (id, user_id, upload_token_hash, status, expires_at, created_at, updated_at)
     values (?, ?, ?, 'pending', ?, ?, ?)`,
    uploadId,
    userId,
    oauthTokenHash(token),
    expiresAt,
    timestamp,
    timestamp
  );
  return {
    uploadId,
    uploadUrl: `${publicBaseUrl.replace(/\/+$/, "")}/mcp/upload/${encodeURIComponent(token)}`,
    uploadRequest: {
      method: "POST",
      encoding: "multipart/form-data",
      fieldName: "file"
    },
    expiresAt,
    maxBytes: MCP_UPLOAD_MAX_BYTES,
    acceptedMimeTypes: [...SAFE_UPLOAD_IMAGE_MIME_TYPES]
  };
}

export function cleanupMcpImageUploads(db = appDb, timestamp = utcNow()) {
  const timestampMs = new Date(timestamp).getTime();
  if (!Number.isFinite(timestampMs)) throw new Error("invalid_cleanup_timestamp");
  const expiredBefore = new Date(timestampMs - MCP_UPLOAD_EXPIRED_RETENTION_MS).toISOString();
  const completedBefore = localTimestamp(new Date(timestampMs - MCP_UPLOAD_COMPLETED_RETENTION_MS));
  const result = run(
    db,
    `delete from mcp_image_uploads
     where id in (
       select id from mcp_image_uploads
       where (
         (status in ('pending', 'uploading') and expires_at <= ?)
         or (status = 'uploaded' and coalesce(used_at, updated_at) <= ?)
       )
       order by updated_at, id
       limit ?
     )`,
    expiredBefore,
    completedBefore,
    MCP_UPLOAD_CLEANUP_BATCH_SIZE
  );
  return Number(result.changes ?? 0);
}

export function getMcpImageUpload(userId: string, uploadId: string) {
  const upload = getOne<McpImageUploadRow>(
    appDb,
    `select id, user_id, asset_id, original_name, mime_type, size, status, expires_at, used_at, created_at, updated_at
     from mcp_image_uploads where id = ? and user_id = ?`,
    uploadId,
    userId
  );
  if (upload?.status === "pending" && upload.expires_at <= utcNow()) return { ...upload, status: "expired" };
  return upload;
}

export function markMcpUploadUsed(userId: string, assetId: string) {
  run(
    appDb,
    "update mcp_image_uploads set used_at = coalesce(used_at, ?), updated_at = ? where user_id = ? and asset_id = ? and status = 'uploaded'",
    now(),
    now(),
    userId,
    assetId
  );
}

async function transparencyFromBuffer(buffer: Buffer) {
  try {
    return await detectImageTransparency(buffer);
  } catch {
    return null;
  }
}

export function registerExternalMcpUploadRoutes(app: Hono) {
  app.get("/mcp/upload/:token", (c) => {
    uploadHeaders(c);
    const token = c.req.param("token");
    const upload = getOne<McpImageUploadRow>(
      appDb,
      `select id, user_id, asset_id, original_name, mime_type, size, status, expires_at, used_at, created_at, updated_at
       from mcp_image_uploads where upload_token_hash = ?`,
      oauthTokenHash(token)
    );
    if (!upload || upload.expires_at <= utcNow()) {
      return c.html(uploadPage({ title: "上传链接已失效", message: "请回到智能体，让它重新创建一个图片上传链接。", error: true }), 410);
    }
    if (upload.status === "uploaded") {
      return c.html(uploadPage({ title: "图片已上传", message: "可以关闭此页面并回到智能体继续改图。" }));
    }
    if (upload.status !== "pending") {
      return c.html(uploadPage({ title: "图片正在处理", message: "请稍候回到智能体查询上传状态。" }));
    }
      return c.html(uploadPage({ title: "上传一张要修改的图片", message: "上传完成后，智能体会通过上传编号继续执行改图。", token }));
  });

  app.post("/mcp/upload/:token", async (c) => {
    uploadHeaders(c);
    const token = c.req.param("token");
    const upload = getOne<McpImageUploadRow>(
      appDb,
      `select id, user_id, asset_id, original_name, mime_type, size, status, expires_at, used_at, created_at, updated_at
       from mcp_image_uploads where upload_token_hash = ?`,
      oauthTokenHash(token)
    );
    if (!upload || upload.expires_at <= utcNow() || upload.status !== "pending") {
      return c.html(uploadPage({ title: "上传链接已失效", message: "此链接不存在、已过期或已经使用。请让 AI 重新创建。", error: true }), 410);
    }
    const claimed = run(
      appDb,
      "update mcp_image_uploads set status = 'uploading', updated_at = ? where id = ? and status = 'pending' and expires_at > ?",
      now(),
      upload.id,
      utcNow()
    );
    if (Number(claimed.changes ?? 0) !== 1) {
      return c.html(uploadPage({ title: "上传正在处理", message: "请勿重复提交，稍后回到智能体查询状态。" }), 409);
    }
    const releaseUploadSlot = acquireMcpUploadParserSlot();
    if (!releaseUploadSlot) {
      run(appDb, "update mcp_image_uploads set status = 'pending', updated_at = ? where id = ? and status = 'uploading'", now(), upload.id);
      c.header("Retry-After", "3");
      return c.html(uploadPage({ title: "上传服务繁忙", message: "当前正在处理其他图片，请稍后重试。", token, error: true }), 503);
    }

    let relativePath = "";
    try {
      const limitedRequest = await requestWithLimitedBody(c.req.raw, MCP_UPLOAD_REQUEST_MAX_BYTES);
      const form = await limitedRequest.formData();
      const file = form.get("file");
      if (!(file instanceof File) || !SAFE_UPLOAD_IMAGE_MIME_TYPES.has(file.type)) {
        throw new InvalidUploadedImageError("unsupported_declared_type");
      }
      if (file.size <= 0 || file.size > MCP_UPLOAD_MAX_BYTES) {
        throw new LimitedRequestBodyError("body_too_large");
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const validated = await validateUploadedImage(buffer, file.type);
      const contentHash = createHash("sha256").update(buffer).digest("hex");
      const existing = getOne<AssetRow>(
        appDb,
        "select * from assets where user_id = ? and content_hash = ? order by created_at desc, rowid desc limit 1",
        upload.user_id,
        contentHash
      );
      let assetId = existing?.id ?? "";
      if (!existing) {
        assetId = makeId("asset");
        relativePath = secureAssetPath(upload.user_id, assetId);
        const hasTransparency = await transparencyFromBuffer(buffer);
        await writeEncryptedFile(relativePath, buffer);
        const createdAt = now();
        run(
          appDb,
          `insert into assets
            (id, user_id, space, shared, share_status, share_reviewed_by, share_reject_reason, name, path, mime_type,
             size, content_hash, image_width, image_height, has_transparency, created_at)
           values (?, ?, 'private', 0, 'none', '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          assetId,
          upload.user_id,
          file.name || "AI 改图上传",
          relativePath,
          validated.mimeType,
          buffer.length,
          contentHash,
          validated.width,
          validated.height,
          hasTransparency == null ? null : Number(hasTransparency),
          createdAt
        );
        void warmImageDerivatives("asset", assetId, relativePath);
      }
      run(
        appDb,
        `update mcp_image_uploads
         set asset_id = ?, original_name = ?, mime_type = ?, size = ?, status = 'uploaded', updated_at = ?
         where id = ?`,
        assetId,
        file.name || "AI 改图上传",
        validated.mimeType,
        file.size,
        now(),
        upload.id
      );
      if (wantsUploadJson(c)) {
        return c.json({
          uploadId: upload.id,
          status: "uploaded",
          assetId,
          fileName: file.name || "AI 改图上传",
          mimeType: validated.mimeType,
          size: file.size
        });
      }
      return c.html(uploadPage({ title: "上传成功", message: "图片已安全保存。现在关闭此页面，回到智能体继续改图。" }));
    } catch (error) {
      run(appDb, "update mcp_image_uploads set status = 'pending', updated_at = ? where id = ? and status = 'uploading'", now(), upload.id);
      if (relativePath) await deleteStoredFilesIfUnreferenced([relativePath]);
      if (error instanceof LimitedRequestBodyError) {
        return c.html(uploadPage({ title: "图片太大", message: "请选择不超过 20 MB 的 PNG、JPG 或 WebP 图片。", token, error: true }), 413);
      }
      if (error instanceof InvalidUploadedImageError) {
        return c.html(uploadPage({ title: "图片格式不支持", message: "请选择内容有效且格式匹配的 PNG、JPG 或 WebP 图片。", token, error: true }), 400);
      }
      console.warn("MCP 图片上传失败", error);
      return c.html(uploadPage({ title: "上传失败", message: "图片处理失败，请重试；如果仍然失败，请让智能体创建新的上传链接。", token, error: true }), 500);
    } finally {
      releaseUploadSlot();
    }
  });
}
