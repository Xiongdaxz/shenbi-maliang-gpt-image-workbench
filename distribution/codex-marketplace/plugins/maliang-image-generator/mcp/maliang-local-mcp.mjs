import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  saveMaliangImageResult,
  uploadMaliangLocalImage
} from "../skills/maliang-image-generator/scripts/maliang-helper.mjs";

const SERVER_NAME = "maliang-local-image-store";
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([DEFAULT_PROTOCOL_VERSION]);
const MAX_MESSAGE_BYTES = 64 * 1024;
const UPLOAD_TOOL_NAME = "upload_local_image";
const SAVE_TOOL_NAME = "save_image_result";

const UPLOAD_TOOL = {
  name: UPLOAD_TOOL_NAME,
  title: "上传本地图片到马良",
  description: "读取 Codex 当前消息中已提供绝对路径的 PNG、JPG 或 WebP 附件，通过一次性上传地址安全提交到神笔马良；成功后返回可用于改图的 uploadId，不打开浏览器。",
  inputSchema: {
    type: "object",
    properties: {
      uploadUrl: {
        type: "string",
        description: "maliang_create_image_upload 返回的一次性 uploadUrl"
      },
      uploadId: {
        type: "string",
        description: "maliang_create_image_upload 返回的 uploadId，用于校验上传响应"
      },
      filePath: {
        type: "string",
        description: "Codex 当前用户消息中提供的本地图片绝对路径"
      }
    },
    required: ["uploadUrl", "uploadId", "filePath"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      status: { type: "string", const: "uploaded" },
      uploadId: { type: "string" },
      assetId: { type: "string" },
      fileName: { type: "string" },
      mimeType: { type: "string" },
      bytes: { type: "integer" }
    },
    required: ["status", "uploadId", "fileName", "mimeType", "bytes"],
    additionalProperties: false
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  }
};

const SAVE_TOOL = {
  name: SAVE_TOOL_NAME,
  title: "保存马良生成图片",
  description: "把已成功生成的马良原图安全保存到 Codex generated_images 目录并返回绝对本地路径。此工具不会打开浏览器。",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "maliang_get_image_job 返回的同源签名 downloadUrl"
      },
      imageId: {
        type: "string",
        description: "maliang_get_image_job 返回的 imageId"
      }
    },
    required: ["url", "imageId"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      imageId: { type: "string" },
      mimeType: { type: "string" },
      bytes: { type: "integer" },
      sha256: { type: "string" }
    },
    required: ["path", "imageId", "mimeType", "bytes", "sha256"],
    additionalProperties: false
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
  }
};

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function safeToolError(error) {
  const message = error instanceof Error ? error.message : "马良本地图片操作失败";
  return message.replace(/https?:\/\/\S+/giu, "[redacted-url]").slice(0, 500);
}

function safeUploadId(value) {
  const uploadId = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(uploadId)) throw new Error("uploadId 格式不正确");
  return uploadId;
}

async function readPluginVersion() {
  try {
    const manifest = JSON.parse(await readFile(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"));
    const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
    return version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const pluginVersion = readPluginVersion();

function saveToCodexGeneratedImages(input) {
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  return saveMaliangImageResult(input, {
    outputRoots: [path.join(codexHome, "generated_images", "maliang")]
  });
}

export async function handleMaliangLocalMcpRequest(request, runtime = {}) {
  if (!isObject(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return jsonRpcError(request?.id ?? null, -32600, "Invalid Request");
  }

  const hasId = Object.prototype.hasOwnProperty.call(request, "id");
  const id = hasId ? request.id : null;
  if (request.method.startsWith("notifications/")) return null;

  if (request.method === "initialize") {
    const requestedProtocol = isObject(request.params) && typeof request.params.protocolVersion === "string"
      ? request.params.protocolVersion.trim()
      : "";
    return jsonRpcResult(id, {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requestedProtocol)
        ? requestedProtocol
        : DEFAULT_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: SERVER_NAME,
        title: "神笔马良本地图片工具",
        version: await pluginVersion
      },
      instructions: "本地改图附件使用 upload_local_image 安全上传，再由 maliang_get_image_upload 确认状态；maliang_get_image_job 返回 succeeded 后使用 save_image_result 保存原图。两个工具都不会打开浏览器。"
    });
  }

  if (request.method === "ping") return jsonRpcResult(id, {});
  if (request.method === "tools/list") return jsonRpcResult(id, { tools: [UPLOAD_TOOL, SAVE_TOOL] });

  if (request.method === "tools/call") {
    const params = isObject(request.params) ? request.params : {};
    if (params.name !== UPLOAD_TOOL_NAME && params.name !== SAVE_TOOL_NAME) {
      return jsonRpcError(id, -32602, `Unknown tool: ${String(params.name ?? "")}`);
    }
    const args = isObject(params.arguments) ? params.arguments : {};
    try {
      if (params.name === UPLOAD_TOOL_NAME) {
        const expectedUploadId = safeUploadId(args.uploadId);
        const uploadImage = runtime.uploadImage ?? uploadMaliangLocalImage;
        const result = await uploadImage({ uploadUrl: args.uploadUrl, filePath: args.filePath });
        if (!isObject(result) || result.status !== "uploaded") {
          throw new Error("本地图片上传未返回 uploaded 状态");
        }
        if (safeUploadId(result.uploadId) !== expectedUploadId) {
          throw new Error("本地图片上传结果与一次性 uploadId 不一致");
        }
        return jsonRpcResult(id, {
          content: [{ type: "text", text: `本地图片已安全上传：${String(result.fileName ?? "图片")}` }],
          structuredContent: { ...result, uploadId: expectedUploadId }
        });
      }
      const saveImage = runtime.saveImage ?? saveToCodexGeneratedImages;
      const result = await saveImage({ url: args.url, imageId: args.imageId });
      return jsonRpcResult(id, {
        content: [{ type: "text", text: `图片已保存到 Codex 生成图片目录：${result.path}` }],
        structuredContent: result
      });
    } catch (error) {
      return jsonRpcResult(id, {
        content: [{ type: "text", text: safeToolError(error) }],
        isError: true
      });
    }
  }

  return jsonRpcError(id, -32601, `Method not found: ${request.method}`);
}

export async function runMaliangLocalMcpServer(input = process.stdin, output = process.stdout) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, "utf8") > MAX_MESSAGE_BYTES) {
      output.write(`${JSON.stringify(jsonRpcError(null, -32700, "Message exceeds 64 KB limit"))}\n`);
      continue;
    }
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(jsonRpcError(null, -32700, "Parse error"))}\n`);
      continue;
    }
    const response = await handleMaliangLocalMcpRequest(request);
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}

const isMainModule = Boolean(
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
);

if (isMainModule) await runMaliangLocalMcpServer();
