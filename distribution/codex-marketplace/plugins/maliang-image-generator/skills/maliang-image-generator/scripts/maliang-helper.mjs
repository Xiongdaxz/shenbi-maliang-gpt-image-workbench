import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;
const UPLOAD_RESPONSE_MAX_BYTES = 32 * 1024;
const PACKAGED_MALIANG_BASE_URL = "__MALIANG_PUBLIC_BASE_URL__";
const PACKAGED_ALLOW_INSECURE_LOCAL = "__MALIANG_ALLOW_INSECURE_LOCAL__" === "true";
const UPLOAD_EXTENSIONS = {
  "image/png": new Set([".png"]),
  "image/jpeg": new Set([".jpg", ".jpeg"]),
  "image/webp": new Set([".webp"])
};
const DOWNLOAD_EXTENSIONS = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/gif": "gif"
};

function safeHttpUrl(value, label) {
  const url = new URL(String(value ?? ""));
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`只允许 HTTP(S) ${label}`);
  if (url.username || url.password) throw new Error(`${label}不能包含用户名或密码`);
  return url;
}

function privateOrLoopbackHostname(hostname) {
  const normalized = String(hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  const ipVersion = isIP(normalized);
  if (ipVersion === 6) {
    return normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || normalized.startsWith("fe80:")
      || normalized.startsWith("::ffff:");
  }
  if (ipVersion !== 4) return false;
  const parts = normalized.split(".");
  const numbers = parts.map(Number);
  return numbers[0] === 0
    || numbers[0] === 10
    || numbers[0] === 127
    || (numbers[0] === 169 && numbers[1] === 254)
    || (numbers[0] === 172 && numbers[1] >= 16 && numbers[1] <= 31)
    || (numbers[0] === 192 && numbers[1] === 168)
    || (numbers[0] === 198 && (numbers[1] === 18 || numbers[1] === 19))
    || numbers[0] >= 224
    || (numbers[0] === 100 && numbers[1] >= 64 && numbers[1] <= 127);
}

function trustedMaliangOrigin(runtime = {}) {
  const configured = runtime.trustedOrigin ?? PACKAGED_MALIANG_BASE_URL;
  if (!configured || configured.includes("__MALIANG_")) throw new Error("马良帮助器尚未绑定可信服务地址");
  const url = safeHttpUrl(configured, "可信服务地址");
  const allowInsecureLocal = runtime.allowInsecureLocal ?? PACKAGED_ALLOW_INSECURE_LOCAL;
  if (url.protocol !== "https:") {
    if (!allowInsecureLocal || !privateOrLoopbackHostname(url.hostname)) {
      throw new Error("可信服务地址必须使用 HTTPS");
    }
  } else if (privateOrLoopbackHostname(url.hostname) && !allowInsecureLocal) {
    throw new Error("生产帮助器拒绝私网或 loopback 服务地址");
  }
  return { origin: url.origin, allowInsecureLocal };
}

function safeMaliangEndpoint(value, label, endpoint, runtime) {
  const url = safeHttpUrl(value, label);
  const trusted = trustedMaliangOrigin(runtime);
  if (url.origin !== trusted.origin || url.search || url.hash) throw new Error(`${label}不属于已配置的神笔马良服务`);
  const pattern = endpoint === "upload"
    ? /^\/mcp\/upload\/[A-Za-z0-9_-]{20,512}$/
    : /^\/mcp\/image-result\/v\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  if (!pattern.test(url.pathname)) throw new Error(`${label}路径不符合神笔马良安全接口`);
  return url;
}

function detectedMimeType(buffer) {
  if (buffer.length >= 8
    && buffer[0] === 0x89
    && buffer.subarray(1, 4).toString("ascii") === "PNG"
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "image/gif";
  return "";
}

function safeServerResult(value) {
  if (!value || typeof value !== "object" || value.status !== "uploaded") return null;
  const uploadId = typeof value.uploadId === "string" ? value.uploadId.trim() : "";
  if (!uploadId) return null;
  return {
    uploadId,
    ...(typeof value.assetId === "string" ? { assetId: value.assetId } : {})
  };
}

function boundedPositiveInteger(value, fallback, maximum = fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) throw new Error("文件大小限制不正确");
  return parsed;
}

export async function uploadMaliangLocalImage(input, runtime = {}) {
  const url = safeMaliangEndpoint(input.uploadUrl, "上传地址", "upload", runtime);
  const filePath = path.resolve(String(input.file ?? input.filePath ?? ""));
  const fileInfo = await lstat(filePath).catch(() => null);
  if (!fileInfo?.isFile()) throw new Error("本地图片不存在、不是普通文件或不可读取");

  const maxBytes = boundedPositiveInteger(runtime.maxUploadBytes, DEFAULT_UPLOAD_MAX_BYTES);
  if (fileInfo.size <= 0) throw new Error("本地图片内容为空");
  if (fileInfo.size > maxBytes) throw new Error(`本地图片超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 上限`);

  const buffer = await readFile(filePath);
  if (buffer.length <= 0) throw new Error("本地图片内容为空");
  if (buffer.length > maxBytes) throw new Error(`本地图片超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 上限`);
  const mimeType = detectedMimeType(buffer);
  if (!UPLOAD_EXTENSIONS[mimeType]) throw new Error("只支持有效的 PNG、JPG 或 WebP 图片");
  const extension = path.extname(filePath).toLowerCase();
  if (!UPLOAD_EXTENSIONS[mimeType].has(extension)) throw new Error("图片扩展名与实际格式不一致");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), path.basename(filePath));
  const response = await (runtime.fetchUpload ?? fetch)(url, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
    redirect: "error"
  });
  if (!response.ok) throw new Error(`图片自动上传失败（HTTP ${response.status}）`);

  const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) throw new Error("图片自动上传返回了非 JSON 响应，无法确认上传状态");
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > UPLOAD_RESPONSE_MAX_BYTES) {
    throw new Error("图片自动上传响应超过 32 KB 上限");
  }
  const responseBytes = await readResponseWithLimit(response, UPLOAD_RESPONSE_MAX_BYTES, "图片自动上传响应超过 32 KB 上限");
  let responseValue = null;
  try {
    responseValue = JSON.parse(responseBytes.toString("utf8"));
  } catch {
    throw new Error("图片自动上传返回了无效 JSON，无法确认上传状态");
  }
  const serverResult = safeServerResult(responseValue);
  if (!serverResult) throw new Error("图片自动上传响应缺少 uploaded 状态或 uploadId");
  return {
    status: "uploaded",
    fileName: path.basename(filePath),
    mimeType,
    bytes: buffer.length,
    ...serverResult
  };
}

function safeImageId(value) {
  const imageId = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(imageId)) throw new Error("imageId 格式不正确");
  return imageId;
}

function defaultOutputRoots(runtime) {
  if (Array.isArray(runtime.outputRoots) && runtime.outputRoots.length > 0) {
    return runtime.outputRoots.map((root) => path.resolve(String(root)));
  }
  const workingDirectory = path.resolve(String(runtime.workingDirectory ?? process.cwd()));
  const codexHome = path.resolve(String(runtime.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex")));
  return [
    path.join(codexHome, "generated_images", "maliang"),
    path.join(workingDirectory, ".maliang-generated")
  ];
}

function recoverableWriteError(error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return ["EACCES", "EPERM", "EROFS"].includes(code);
}

async function verifyExistingImage(filePath, sha256) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const existing = await readFile(filePath);
      const existingHash = createHash("sha256").update(existing).digest("hex");
      if (existingHash === sha256) return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "ENOENT") throw error;
    }
    if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`现有图片校验失败：${filePath}`);
}

async function readResponseWithLimit(response, maximumBytes, limitMessage = "图片超过 50 MB 上限") {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(limitMessage);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function saveMaliangImageResult(input, runtime = {}) {
  const imageId = safeImageId(input.imageId);
  const url = safeMaliangEndpoint(input.url ?? input.downloadUrl, "图片地址", "result", runtime);
  const maxBytes = boundedPositiveInteger(runtime.maxDownloadBytes, DEFAULT_DOWNLOAD_MAX_BYTES);
  const response = await (runtime.fetchImage ?? fetch)(url, { redirect: "error" });
  if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`);

  const mimeType = String(response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase();
  const extension = DOWNLOAD_EXTENSIONS[mimeType];
  if (!extension) throw new Error(`不支持的图片类型：${mimeType || "未提供"}`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("图片超过 50 MB 上限");

  const buffer = await readResponseWithLimit(response, maxBytes);
  if (buffer.length === 0) throw new Error("图片内容为空");
  if (buffer.length > maxBytes) throw new Error("图片超过 50 MB 上限");
  if (detectedMimeType(buffer) !== mimeType) throw new Error("图片响应类型与实际内容不一致");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const fileName = `${imageId}-${sha256.slice(0, 12)}.${extension}`;

  let lastError;
  for (const outputRoot of defaultOutputRoots(runtime)) {
    try {
      await mkdir(outputRoot, { recursive: true });
      const filePath = path.join(outputRoot, fileName);
      try {
        await writeFile(filePath, buffer, { flag: "wx" });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (code !== "EEXIST") throw error;
        await verifyExistingImage(filePath, sha256);
      }
      return { path: path.resolve(filePath), imageId, mimeType, bytes: buffer.length, sha256 };
    } catch (error) {
      lastError = error;
      if (!recoverableWriteError(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("无法保存图片到本地");
}

export function probeMaliangLocalHelper() {
  return {
    status: "ready",
    runtime: typeof Bun === "undefined" ? "node" : "bun",
    runtimeVersion: typeof Bun === "undefined" ? process.versions.node : Bun.version,
    deviceName: os.hostname(),
    deviceType: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
    capabilities: ["upload", "save"]
  };
}

async function commandInput(operation) {
  if (operation === "probe") return {};
  if (!process.argv.includes("--stdin")) throw new Error("upload 和 save 必须使用 --stdin 传入 JSON，不能把签名地址放进命令行参数");
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 32 * 1024) throw new Error("标准输入超过 32 KB 上限");
    chunks.push(bytes);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("标准输入必须是 JSON 对象");
  return value;
}

async function main() {
  const operation = String(process.argv[2] ?? "").trim().toLowerCase();
  const input = await commandInput(operation);
  if (operation === "probe") return probeMaliangLocalHelper();
  if (operation === "upload") return await uploadMaliangLocalImage(input);
  if (operation === "save") return await saveMaliangImageResult(input);
  throw new Error("操作必须是 probe、upload 或 save");
}

const isMainModule = import.meta.main === true
  || Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));

if (isMainModule) {
  try {
    console.log(JSON.stringify(await main()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "马良本地帮助器执行失败");
    process.exitCode = 1;
  }
}
