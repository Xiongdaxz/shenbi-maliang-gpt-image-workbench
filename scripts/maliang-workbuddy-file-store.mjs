import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

function privateHttpHost(value) {
  const host = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIP(host) === 6) return host === "::1" || /^(?:fc|fd|fe[89ab])/.test(host);
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split(".").map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
    || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

export function trustedMaliangOrigin({ trustedOrigin, allowInsecureLocal = false }) {
  const url = new URL(trustedOrigin);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("WorkBuddy 交付工具必须配置马良的站点地址");
  }
  // HTTPS uses the configured origin and keeps Node's TLS certificate verification.
  if (url.protocol !== "https:" && (url.protocol !== "http:" || !allowInsecureLocal || !privateHttpHost(url.hostname))) {
    throw new Error("可信服务地址必须使用 HTTPS");
  }
  return { origin: url.origin };
}

function detectImageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "image/gif";
  return "";
}

async function originalBytes(response) {
  if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`);
  const mimeType = String(response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  const extension = extensions[mimeType];
  if (typeof extension !== "string") throw new Error("不支持的图片类型");
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new Error("图片超过 50 MB 上限");
  if (!response.body) throw new Error("图片内容为空");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("图片超过 50 MB 上限");
    }
    chunks.push(Buffer.from(value));
  }
  const bytes = Buffer.concat(chunks);
  if (detectImageType(bytes) !== mimeType) throw new Error("图片响应类型与实际内容不一致");
  return { bytes, mimeType, extension };
}

async function assertImageHandle(filePath, file, verifyDirectory) {
  await verifyDirectory();
  const [entry, handle] = await Promise.all([lstat(filePath, { bigint: true }), file.stat({ bigint: true })]);
  if (!entry.isFile() || !handle.isFile() || entry.dev !== handle.dev || entry.ino !== handle.ino) {
    throw new Error("保存路径已改变，无法确认图片仍在已获授权的任务目录中");
  }
  return handle;
}

async function verifyExistingImage(filePath, expectedSize, sha256, verifyDirectory) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await verifyDirectory();
    const entry = await lstat(filePath);
    if (!entry.isFile()) throw new Error("已有图片不是普通文件");
    if (entry.size > expectedSize) break;
    if (entry.size === expectedSize) {
      const file = await open(filePath, "r");
      try {
        const handle = await assertImageHandle(filePath, file, verifyDirectory);
        if (handle.size !== BigInt(expectedSize)) break;
        const content = Buffer.allocUnsafe(expectedSize);
        const { bytesRead } = await file.read(content, 0, expectedSize, 0);
        if (bytesRead === expectedSize && createHash("sha256").update(content).digest("hex") === sha256) return;
      } finally { await file.close(); }
    }
    if (attempt < 19) await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("已有图片内容与原图不一致");
}

export async function saveMaliangImageResponse(imageId, response, { outputRoot, prepareOutputRoot }) {
  if (typeof imageId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(imageId)) throw new Error("imageId 格式不正确");
  const { bytes, mimeType, extension } = await originalBytes(response);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filePath = path.join(outputRoot, `${imageId}-${sha256.slice(0, 12)}.${extension}`);
  // Validate only after the complete download, then pin the checked file for writing.
  const verifyDirectory = await prepareOutputRoot(outputRoot);
  let file;
  try { file = await open(filePath, "wx"); }
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    await verifyExistingImage(filePath, bytes.length, sha256, verifyDirectory);
  }
  if (file) {
    try {
      await assertImageHandle(filePath, file, verifyDirectory);
      await file.writeFile(bytes);
      await assertImageHandle(filePath, file, verifyDirectory);
    } finally { await file.close(); }
  }
  return { path: filePath, imageId, mimeType, bytes: bytes.length, sha256 };
}
