import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hono } from "hono";
import * as z from "zod";
import { appDb, getAll, getOne } from "./db";
import {
  externalMcpClientNeedsDeviceReport,
  type MaliangMcpScope,
  mcpUnauthorized,
  resolveMcpAccessToken,
  updateExternalMcpClientDevice
} from "./externalMcpAuth";
import {
  createMcpImageUpload,
  getMcpImageUpload,
  markMcpUploadUsed
} from "./externalMcpUploads";
import { createMcpImageResultPresentation } from "./externalMcpResults";
import { readCodexPluginVersion } from "./internalDistributionRoutes";
import { LimitedRequestBodyError, requestWithLimitedBody } from "./limitedRequestBody";
import type { ImageRow, UserRow } from "./types";

type McpToolExtra = {
  authInfo?: {
    clientId?: string;
    token?: string;
    scopes?: string[];
    resource?: URL;
    extra?: Record<string, unknown>;
  };
};

const MCP_PROTOCOL_REQUEST_MAX_BYTES = 1024 * 1024;

function toolError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

function toolJson(value: unknown, lead?: string) {
  const json = JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text: lead ? `${lead}\n\n${json}` : json }] };
}

function toolContext(extra: McpToolExtra, requiredScope: MaliangMcpScope) {
  const clientId = String(extra.authInfo?.clientId ?? "").trim();
  const grantId = String(extra.authInfo?.extra?.grantId ?? "").trim();
  const grantVersion = Number(extra.authInfo?.extra?.grantVersion);
  const userId = String(extra.authInfo?.extra?.userId ?? "").trim();
  const token = String(extra.authInfo?.token ?? "").trim();
  const scopes = Array.isArray(extra.authInfo?.scopes) ? extra.authInfo.scopes : [];
  const resource = String(extra.authInfo?.resource ?? "").trim();
  if (!clientId || !grantId || !Number.isSafeInteger(grantVersion) || grantVersion <= 0 || !userId || !token || !resource) return null;
  if (!scopes.includes(requiredScope)) return null;
  const user = getOne<UserRow>(appDb, "select * from users where id = ? and disabled = 0", userId);
  return user ? { clientId, grantId, grantVersion, user, token, resource } : null;
}

export const DEVICE_REPORT_REQUIRED_MESSAGE = "当前连接尚未上报真实设备信息。当前 AI 智能体必须立即读取本机真实主机名和操作系统，调用 maliang_report_device；不得等待用户下一条消息，也不得让用户手工填写设备名。maliang_report_device 返回 reported=true 后，重试刚才的工具。";

function requireReportedDevice(context: NonNullable<ReturnType<typeof toolContext>>) {
  return externalMcpClientNeedsDeviceReport(appDb, context.clientId)
    ? toolError(DEVICE_REPORT_REQUIRED_MESSAGE)
    : null;
}

export function externalMcpInternalApiUrl(resource: string, path: string) {
  return new URL(path, `${new URL(resource).origin}/`).toString();
}

async function internalImageRequest(
  api: Hono,
  path: string,
  token: string,
  resource: string,
  body?: Record<string, unknown>
) {
  const response = await api.request(externalMcpInternalApiUrl(resource, path), {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = String(payload.error ?? payload.error_description ?? `神笔马良接口请求失败（HTTP ${response.status}）`);
    throw new Error(message);
  }
  return payload;
}

function asyncJobSummary(payload: Record<string, unknown>) {
  const job = payload.job && typeof payload.job === "object" ? payload.job as Record<string, unknown> : {};
  return {
    sessionId: String(payload.sessionId ?? ""),
    jobId: String(job.id ?? ""),
    status: String(job.status ?? "running"),
    next: "使用 maliang_get_image_job 查询，直到状态变为 succeeded 或 failed"
  };
}

type MaliangJobImage = Pick<ImageRow, "id" | "path" | "mime_type">;
type MaliangJobContent =
  | { type: "text"; text: string }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      title: string;
      description: string;
      mimeType: string;
    };

type MaliangImagePresentation = {
  imageId: string;
  downloadUrl: string;
  previewUrl: string;
  expiresAt: string;
};

const chinaDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function formatChinaDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const parts = new Map(chinaDateTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")} ${parts.get("hour")}:${parts.get("minute")}:${parts.get("second")}`;
}

export async function buildMaliangImageJobResult(
  summary: Record<string, unknown>,
  images: MaliangJobImage[],
  presentations: MaliangImagePresentation[] = []
) {
  const deliveredImageIds = images.map((image) => image.id);
  const summaryImageIds = Array.isArray(summary.imageIds)
    ? summary.imageIds.map((imageId) => String(imageId)).filter(Boolean)
    : images.map((image) => image.id);
  const status = String(summary.status ?? "");
  const resultSummary = {
    jobId: String(summary.jobId ?? ""),
    status,
    imageIds: summaryImageIds,
    ...(summary.error ? { error: String(summary.error) } : {}),
    ...(summary.next ? { next: String(summary.next) } : {})
  };
  const deliveredIds = new Set(deliveredImageIds);
  const deliveredPresentations = presentations.filter((item) => deliveredIds.has(item.imageId));
  const imagesById = new Map(images.map((image) => [image.id, image]));
  const resourceLinkContent: Extract<MaliangJobContent, { type: "resource_link" }>[] = deliveredPresentations.map((item) => ({
    type: "resource_link",
    uri: item.downloadUrl,
    name: item.imageId,
    title: `神笔马良原图 ${item.imageId}`,
    description: `原图下载地址，有效期至 ${formatChinaDateTime(item.expiresAt)}（北京时间）`,
    mimeType: imagesById.get(item.imageId)?.mime_type || "image/png"
  }));
  const deliveryInstruction = deliveredImageIds.length > 0
    ? `图片任务已成功，${deliveredImageIds.length} 张原图已通过标准 resource_link 内容块返回，并保留在 structuredContent.imageResults 中。为避免超大工具响应被客户端截断，本工具不返回 base64 图片数据。客户端应交付资源链接；需要本地持久化时，使用 downloadUrl 保存原图并引用真实文件。下载链接短期有效，不要回显到对话正文、日志或长期存储。保存能力不可用或保存失败时应报告图片交付未完成。不要只回复 jobId、imageId 或任务状态，也不要把尚未完成的本地保存描述为成功。`
    : "";
  const content: MaliangJobContent[] = [
    {
      type: "text",
      text: [deliveryInstruction, JSON.stringify(resultSummary, null, 2)]
        .filter(Boolean)
        .join("\n\n")
    },
    ...resourceLinkContent
  ];
  return {
    content,
    structuredContent: {
      jobId: resultSummary.jobId,
      status,
      imageIds: summaryImageIds,
      imageResults: deliveredPresentations
    }
  };
}

async function createMaliangMcpServer(api: Hono) {
  const server = new McpServer({
    name: "maliang-image-generator",
    title: "神笔马良",
    version: await readCodexPluginVersion()
  }, {
    instructions: "神笔马良提供文生图、改图和异步任务查询。maliang_report_device 只在新 OAuth 安装完成后的同一安装流程中调用一次，或在其他工具明确返回“设备尚未上报”时调用；reported=true 后同一 OAuth 客户端不要在每次任务、生图或改图前重复上报。服务端已保存设备时，直接调用 maliang_account_status 或图片工具。生成或改图后，使用 maliang_get_image_job 轮询到 succeeded 或 failed；成功时通过 resource_link 和 structuredContent.imageResults.downloadUrl 交付原图，不返回 base64 图片数据。Codex 插件必须调用 bundled maliang_local.save_image_result 保存到 generated_images，再用绝对本地路径直接显示；保存失败时报告交付未完成，绝不为生成结果打开浏览器。不要只回复 jobId、imageId 或任务状态。编辑 Codex 本地附件时，先用 maliang_create_image_upload 获取一次性地址，再调用 bundled maliang_local.upload_local_image；只有宿主未提供可读附件路径或本地 MCP 未启动时才使用浏览器上传页。"
  });

  server.registerTool("maliang_account_status", {
    title: "查看马良账号状态",
    description: "确认当前 MCP 授权对应的神笔马良账号。可直接调用；只有服务端返回设备尚未上报时，才读取真实主机名和操作系统并调用一次 maliang_report_device。",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, async (_input, extra) => {
    const context = toolContext(extra as McpToolExtra, "profile:read");
    if (!context) return toolError("当前授权缺少 profile:read 权限，请重新连接神笔马良 MCP。");
    const deviceGate = requireReportedDevice(context);
    if (deviceGate) return deviceGate;
    return toolJson({
      authenticated: true,
      user: {
        id: context.user.id,
        username: context.user.username,
        account: context.user.account ?? ""
      },
      resource: context.resource
    });
  });

  server.registerTool("maliang_report_device", {
    title: "上报当前设备名称",
    description: "仅在新 OAuth 安装完成后或其他工具明确要求设备上报时调用一次。由当前 AI 智能体读取本机真实主机名和操作系统并上报；reported=true 后同一 OAuth 客户端不要在每次任务、生图或改图前重复调用。不得使用操作系统名称、客户端名称或占位符冒充主机名。",
    inputSchema: {
      deviceName: z.string().trim().min(1).max(120).describe("当前电脑的真实主机名，例如 DESKTOP-ABC123 或 studio-mac"),
      deviceType: z.enum(["Windows", "macOS", "Linux", "iOS", "Android"]).describe("当前客户端实际运行的操作系统")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ deviceName, deviceType }, extra) => {
    const context = toolContext(extra as McpToolExtra, "profile:read");
    if (!context) return toolError("当前授权缺少 profile:read 权限，请重新连接神笔马良 MCP。");
    const reported = updateExternalMcpClientDevice(appDb, {
      clientId: context.clientId,
      deviceName,
      deviceType
    });
    if (!reported) return toolError("设备名称无效；请读取当前电脑的真实主机名，不要填写 Windows、macOS、Linux、localhost、客户端名称或模板占位符。");
    return toolJson({ reported: true, ...reported }, "设备信息已更新。");
  });

  server.registerTool("maliang_generate_image", {
    title: "神笔马良文生图",
    description: "提交一个异步文生图任务，返回 jobId。随后调用 maliang_get_image_job 获取结果。",
    inputSchema: {
      prompt: z.string().trim().min(1).max(8000).describe("图片描述或绘图提示词"),
      size: z.string().trim().optional().describe("图片尺寸，例如 1024x1024、1024x1536 或 1536x1024"),
      quality: z.string().trim().optional().describe("生成质量，例如 low、medium、high 或 auto"),
      imageCount: z.number().int().min(1).max(4).optional().describe("生成数量，默认 1"),
      background: z.enum(["auto", "opaque", "transparent"]).optional(),
      outputFormat: z.enum(["png", "webp"]).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (input, extra) => {
    const context = toolContext(extra as McpToolExtra, "images:generate");
    if (!context) return toolError("当前授权缺少 images:generate 权限，请重新连接神笔马良 MCP。");
    const deviceGate = requireReportedDevice(context);
    if (deviceGate) return deviceGate;
    try {
      const payload = await internalImageRequest(api, "/images/generate", context.token, context.resource, {
        prompt: input.prompt,
        ...(input.size ? { size: input.size } : {}),
        ...(input.quality ? { quality: input.quality } : {}),
        ...(input.imageCount ? { n: input.imageCount } : {}),
        ...(input.background ? { background: input.background } : {}),
        ...(input.outputFormat ? { outputFormat: input.outputFormat } : {}),
        clientRequestId: `mcp-${randomUUID()}`
      });
      return toolJson(asyncJobSummary(payload), "文生图任务已提交。");
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "文生图任务提交失败");
    }
  });

  server.registerTool("maliang_create_image_upload", {
    title: "创建改图上传链接",
    description: "为本地图片创建一个 15 分钟有效、成功后即失效的安全上传地址。Codex 插件已有可读附件路径时应调用 bundled maliang_local.upload_local_image；其他客户端可直接以 POST multipart/form-data 上传。只有宿主没有提供可读路径或本地 MCP 未启动时才使用浏览器兜底。",
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (_input, extra) => {
    const context = toolContext(extra as McpToolExtra, "images:generate");
    if (!context) return toolError("当前授权缺少 images:generate 权限，请重新连接神笔马良 MCP。");
    const deviceGate = requireReportedDevice(context);
    if (deviceGate) return deviceGate;
    const publicBaseUrl = new URL(context.resource).origin;
    try {
      return toolJson(createMcpImageUpload(context.user.id, publicBaseUrl), "Codex 已有可读本地附件路径时，请调用 bundled maliang_local.upload_local_image，并传入本次 uploadUrl、uploadId 与附件绝对路径；不要让用户重复选择。其他客户端可直接向 uploadUrl 发送 POST multipart/form-data。随后用 uploadId 查询状态。宿主无法读取本地文件或本地 MCP 未启动时再打开一次性上传页。");
    } catch (error) {
      if (error instanceof Error && error.message === "mcp_upload_pending_limit") {
        return toolError("当前账号已有过多未完成的图片上传，请完成、等待链接过期或稍后重试。");
      }
      return toolError("创建图片上传链接失败，请稍后重试。");
    }
  });

  server.registerTool("maliang_get_image_upload", {
    title: "查询改图图片上传状态",
    description: "使用 uploadId 查询一次性图片是否已经上传完成。",
    inputSchema: {
      uploadId: z.string().trim().min(1).describe("maliang_create_image_upload 返回的 uploadId")
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ uploadId }, extra) => {
    const context = toolContext(extra as McpToolExtra, "images:generate");
    if (!context) return toolError("当前授权缺少 images:generate 权限，请重新连接神笔马良 MCP。");
    const deviceGate = requireReportedDevice(context);
    if (deviceGate) return deviceGate;
    const upload = getMcpImageUpload(context.user.id, uploadId);
    if (!upload) return toolError("上传记录不存在或不属于当前账号。");
    return toolJson({
      uploadId: upload.id,
      status: upload.status,
      assetId: upload.asset_id ?? "",
      fileName: upload.original_name,
      mimeType: upload.mime_type,
      size: upload.size,
      expiresAt: upload.expires_at,
      usedAt: upload.used_at ?? ""
    });
  });

  server.registerTool("maliang_edit_image", {
    title: "神笔马良改图",
    description: "使用马良历史图片 imageIds 或已完成的一次性上传 uploadIds 提交异步改图任务。返回 jobId 后调用 maliang_get_image_job。",
    inputSchema: {
      prompt: z.string().trim().min(1).max(8000).describe("希望如何修改图片"),
      imageIds: z.array(z.string().trim().min(1)).max(8).optional().describe("当前账号中的马良历史图片 ID"),
      uploadIds: z.array(z.string().trim().min(1)).max(8).optional().describe("已上传完成的 MCP uploadId"),
      size: z.string().trim().optional(),
      quality: z.string().trim().optional(),
      imageCount: z.number().int().min(1).max(4).optional(),
      inputFidelity: z.enum(["low", "high"]).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (input, extra) => {
    const context = toolContext(extra as McpToolExtra, "images:generate");
    if (!context) return toolError("当前授权缺少 images:generate 权限，请重新连接神笔马良 MCP。");
    const deviceGate = requireReportedDevice(context);
    if (deviceGate) return deviceGate;
    const imageIds = Array.from(new Set(input.imageIds ?? []));
    const uploadIds = Array.from(new Set(input.uploadIds ?? []));
    if (imageIds.length === 0 && uploadIds.length === 0) {
      return toolError("请至少提供一个 imageId 或已上传完成的 uploadId。");
    }
    const sourceAssetIds: string[] = [];
    for (const uploadId of uploadIds) {
      const upload = getMcpImageUpload(context.user.id, uploadId);
      if (!upload || upload.status !== "uploaded" || !upload.asset_id) {
        return toolError(`上传 ${uploadId} 尚未完成、已失效或不属于当前账号。`);
      }
      sourceAssetIds.push(upload.asset_id);
    }
    try {
      const payload = await internalImageRequest(api, "/images/edit", context.token, context.resource, {
        prompt: input.prompt,
        sourceImageIds: imageIds,
        sourceAssetIds,
        ...(input.size ? { size: input.size } : {}),
        ...(input.quality ? { quality: input.quality } : {}),
        ...(input.imageCount ? { n: input.imageCount } : {}),
        ...(input.inputFidelity ? { inputFidelity: input.inputFidelity } : {}),
        clientRequestId: `mcp-${randomUUID()}`
      });
      for (const assetId of sourceAssetIds) markMcpUploadUsed(context.user.id, assetId);
      return toolJson(asyncJobSummary(payload), "改图任务已提交。");
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "改图任务提交失败");
    }
  });

  server.registerTool("maliang_get_image_job", {
    title: "查询马良图片任务",
    description: "查询文生图或改图任务。成功时返回轻量 resource_link、可继续改图的 imageId 和结构化下载信息，不返回 base64 图片数据；Codex 插件应调用 bundled maliang_local.save_image_result 持久化原图，再用返回的绝对本地路径直接显示，禁止为生成结果打开浏览器。",
    inputSchema: {
      jobId: z.string().trim().min(1).describe("生图或改图工具返回的 jobId")
    },
    outputSchema: {
      jobId: z.string(),
      status: z.string(),
      imageIds: z.array(z.string()),
      imageResults: z.array(z.object({
        imageId: z.string(),
        downloadUrl: z.string(),
        previewUrl: z.string(),
        expiresAt: z.string()
      }))
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ jobId }, extra) => {
    const context = toolContext(extra as McpToolExtra, "images:generate");
    if (!context) return toolError("当前授权缺少 images:generate 权限，请重新连接神笔马良 MCP。");
    const deviceGate = requireReportedDevice(context);
    if (deviceGate) return deviceGate;
    try {
      await internalImageRequest(api, `/image-jobs/${encodeURIComponent(jobId)}`, context.token, context.resource);
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "图片任务查询失败");
    }
    const job = getOne<{
      id: string;
      type: string;
      status: string;
      prompt: string;
      error: string | null;
      result_image_id: string | null;
      created_at: string;
      updated_at: string;
    }>(appDb, "select * from image_jobs where id = ? and user_id = ?", jobId, context.user.id);
    if (!job) return toolError("图片任务不存在或不属于当前账号。");
    const images = job.status === "succeeded"
      ? getAll<ImageRow>(appDb, "select * from images where job_id = ? and user_id = ? order by created_at asc", job.id, context.user.id)
      : [];
    const summary = {
      jobId: job.id,
      type: job.type,
      status: job.status,
      prompt: job.prompt,
      error: job.error ?? "",
      imageIds: images.map((image) => image.id),
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      next: job.status === "running" ? "稍后再次调用 maliang_get_image_job" : ""
    };
    const publicBaseUrl = new URL(context.resource).origin;
    const presentations = images.map((image) => createMcpImageResultPresentation({
      imageId: image.id,
      userId: context.user.id,
      grantId: context.grantId,
      grantVersion: context.grantVersion,
      publicBaseUrl,
    }));
    const result = await buildMaliangImageJobResult(summary, images, presentations);
    return { ...result, ...(job.status === "failed" ? { isError: true as const } : {}) };
  });

  return server;
}

export function registerExternalMcpProtocolRoute(api: Hono) {
  api.all("/external-mcp/mcp", async (c) => {
    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      c.header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID, X-Maliang-Device-Name, X-Maliang-Device-Hostname, X-Maliang-Device-Os, X-Maliang-Device-Ostype"
      );
      c.header("Access-Control-Expose-Headers", "MCP-Protocol-Version, MCP-Session-Id");
      return c.body(null, 204);
    }
    const principal = resolveMcpAccessToken(c);
    if (!principal) return mcpUnauthorized(c);
    let request = c.req.raw;
    if (c.req.method === "POST") {
      try {
        request = await requestWithLimitedBody(request, MCP_PROTOCOL_REQUEST_MAX_BYTES);
      } catch (error) {
        const tooLarge = error instanceof LimitedRequestBodyError && error.code === "body_too_large";
        return c.json({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: tooLarge ? "MCP request body exceeds 1 MB" : "Invalid MCP request body"
          },
          id: null
        }, tooLarge ? 413 : 400);
      }
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    const server = await createMaliangMcpServer(api);
    await server.connect(transport);
    const response = await transport.handleRequest(request, {
      authInfo: {
        token: principal.token,
        clientId: principal.clientId,
        scopes: principal.scopes,
        expiresAt: Math.floor(new Date(principal.expiresAt).getTime() / 1000),
        resource: new URL(principal.resource),
        extra: { grantId: principal.grantId, grantVersion: principal.grantVersion, userId: principal.user.id }
      }
    });
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Expose-Headers", "MCP-Protocol-Version, MCP-Session-Id");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
}
