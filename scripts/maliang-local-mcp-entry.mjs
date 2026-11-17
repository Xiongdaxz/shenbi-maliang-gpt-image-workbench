import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { saveMaliangImageResult, uploadMaliangLocalImage } from '../skills/maliang-image-generator/scripts/maliang-helper.mjs';
const SERVER_NAME = 'maliang-local-image-store';
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


export async function createMaliangLocalServer(runtime = {}) {
  const server = new McpServer({name: SERVER_NAME, title: '神笔马良本地图片工具', version: await pluginVersion}, {
    maxToolInputElements: 32,
    cacheHints: {'tools/list': {ttlMs: 300000, cacheScope: 'private'}},
    instructions: '本地改图附件使用 upload_local_image 安全上传，再由 maliang_get_image_upload 确认状态；任务结束后用 save_image_result 保存已有原图。两个工具均不会打开浏览器。'
  });
  for (const definition of [UPLOAD_TOOL, SAVE_TOOL]) {
    const {name, inputSchema, outputSchema, ...metadata} = definition;
    server.registerTool(name, {...metadata, inputSchema: z.fromJSONSchema(inputSchema), outputSchema: z.fromJSONSchema(outputSchema)}, async (args) => {
      try {
        if(name === UPLOAD_TOOL_NAME) {
          const expectedUploadId = safeUploadId(args.uploadId);
          const result = await (runtime.uploadImage ?? uploadMaliangLocalImage)({uploadUrl: args.uploadUrl, filePath: args.filePath});
          if(!result || result.status !== 'uploaded' || safeUploadId(result.uploadId) !== expectedUploadId) throw new Error('本地图片上传结果与一次性 uploadId 不一致');
          return {content: [{type: 'text', text: '本地图片已安全上传'}], structuredContent: {...result, uploadId: expectedUploadId}};
        }
        const result = await (runtime.saveImage ?? saveToCodexGeneratedImages)({url: args.url, imageId: args.imageId});
        return {content: [{type: 'text', text: '图片已保存到 Codex 生成图片目录：' + result.path}], structuredContent: result};
      } catch(error) {
        return {content: [{type: 'text', text: safeToolError(error)}], isError: true};
      }
    });
  }
  return server;
}

// In-memory wire seam for contract tests; production stdio uses the SDK's era negotiation.
export async function handleMaliangLocalMcpRequest(request, runtime = {}) {
  const [client, transport] = InMemoryTransport.createLinkedPair();
  const response = new Promise((resolve, reject) => {
    client.onmessage = resolve;
    client.onerror = reject;
  });
  const handle = serveStdio(() => createMaliangLocalServer(runtime), {transport});
  await client.start();
  if(request.method === 'initialize') request = {...request, params: {capabilities: {}, clientInfo: {name: 'contract-test', version: '1'}, ...request.params}};
  await client.send(request);
  try { return await response; } finally { await handle.close(); await client.close(); }
}

export async function runMaliangLocalMcpServer(input = process.stdin, output = process.stdout) {
  return serveStdio(() => createMaliangLocalServer(), {transport: new StdioServerTransport(input, output, {maxBufferSize: 64 * 1024})});
}
const isMainModule = Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if(isMainModule) await runMaliangLocalMcpServer();
