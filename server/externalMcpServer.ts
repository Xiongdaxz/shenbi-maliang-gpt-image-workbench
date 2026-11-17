import { createMcpHandler, McpServer, type ServerContext } from "@modelcontextprotocol/server";
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
import { MAX_IMAGE_COUNT, MIN_IMAGE_COUNT } from "../src/lib/imagePromptCount";
import { McpSubmissionRejected, submitMcpImageOnce } from "./externalMcpSubmissions";
import { preferredDefaultImageModel } from "./providerRuntime";
import {
  DEFAULT_EDIT_IMAGE_MODEL,
  DEFAULT_GENERATION_IMAGE_MODEL,
  DEFAULT_IMAGE_QUALITY,
  GPT_IMAGE_EXTENDED_QUALITIES,
  GPT_IMAGE_26_COMPLEXITIES,
  imageModelDisplayName,
  IMAGE_MODEL_IDS
} from "../src/lib/imageModels";

type McpToolExtra = ServerContext;

const MCP_PROTOCOL_REQUEST_MAX_BYTES = 1024 * 1024;

export const EXTERNAL_MCP_IMAGE_COUNT_SCHEMA = z.number()
  .int()
  .min(MIN_IMAGE_COUNT)
  .max(MAX_IMAGE_COUNT);
export const EXTERNAL_MCP_IMAGE_BACKGROUND_SCHEMA = z.enum(["auto", "opaque", "transparent"]);
export const EXTERNAL_MCP_IMAGE_OUTPUT_FORMAT_SCHEMA = z.enum(["png", "webp"]);
export const EXTERNAL_MCP_IMAGE_MODEL_SCHEMA = z.enum(IMAGE_MODEL_IDS);
export const EXTERNAL_MCP_IMAGE_QUALITY_SCHEMA = z.enum([DEFAULT_IMAGE_QUALITY, ...GPT_IMAGE_EXTENDED_QUALITIES]);
export const EXTERNAL_MCP_IMAGE_COMPLEXITY_SCHEMA = z.enum(GPT_IMAGE_26_COMPLEXITIES);
const REQUEST_KEY_SCHEMA = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/).optional()
  .describe("一次用户图片请求的唯一标识（例如 UUID）。首次生成一次，超时或重试时必须复用；新任务使用新值。旧客户端可省略。");
const SUBMISSION_OUTPUT_SCHEMA = z.object({
  sessionId: z.string(), jobId: z.string(), status: z.string(), requestKey: z.string().optional(), next: z.string()
});

function toolError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

function toolJson(value: Record<string, unknown>, lead?: string) {
  const json = JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text: lead ? `${lead}\n\n${json}` : json }], structuredContent: value };
}

function toolContext(extra: McpToolExtra, requiredScope: MaliangMcpScope) {
  const auth = extra.http?.authInfo;
  const clientId = String(auth?.clientId ?? "").trim();
  const grantId = String(auth?.extra?.grantId ?? "").trim();
  const grantVersion = Number(auth?.extra?.grantVersion);
  const userId = String(auth?.extra?.userId ?? "").trim();
  const token = String(auth?.token ?? "").trim();
  const scopes = Array.isArray(auth?.scopes) ? auth.scopes : [];
  const resource = String(auth?.resource ?? "").trim();
  if (!clientId || !grantId || !Number.isSafeInteger(grantVersion) || grantVersion <= 0 || !userId || !token || !resource) return null;
  if (!scopes.includes(requiredScope)) return null;
  const user = getOne<UserRow>(appDb, "select * from users where id = ? and disabled = 0", userId);
  return user ? { clientId, grantId, grantVersion, user, token, resource } : null;
}

export const DEVICE_REPORT_REQUIRED_MESSAGE = "当前连接尚未上报真实设备信息。当前 AI 智能体必须立即读取本机真实主机名和操作系统，调用 maliang_report_device；不得等待用户下一条消息，也不得让用户手工填写设备名。maliang_report_device 返回 reported=true 后，重试刚才的工具。";

function requireReportedDevice(context: NonNullable<ReturnType<typeof toolContext>>) {
  return externalMcpClientNeedsDeviceReport(appDb, context.clientId, context.grantId)
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
    if (response.status >= 400 && response.status < 500) throw new McpSubmissionRejected(message);
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
  const deliveredResultCount = deliveredPresentations.length;
  const imagesById = new Map(images.map((image) => [image.id, image]));
  const resourceLinkContent: Extract<MaliangJobContent, { type: "resource_link" }>[] = deliveredPresentations.map((item) => ({
    type: "resource_link",
    uri: item.downloadUrl,
    name: item.imageId,
    title: `神笔马良原图 ${item.imageId}`,
    description: `原图下载地址，有效期至 ${formatChinaDateTime(item.expiresAt)}（北京时间）`,
    mimeType: imagesById.get(item.imageId)?.mime_type || "image/png"
  }));
  const deliveryInstruction = deliveredResultCount > 0
    ? status === "failed"
      ? `图片任务未能全部完成，但已有 ${deliveredResultCount} 张原图通过标准 resource_link 内容块返回，并保留在 structuredContent.imageResults 中。客户端应先交付这些部分结果，同时明确报告任务错误，不要把部分结果描述为整个任务成功。`
      : `图片任务已成功，${deliveredResultCount} 张原图已通过标准 resource_link 内容块返回，并保留在 structuredContent.imageResults 中。为避免超大工具响应被客户端截断，本工具不返回 base64 图片数据。`
    : "";
  const content: MaliangJobContent[] = [
    {
      type: "text",
      text: [deliveryInstruction,
        deliveredResultCount ? "按当前客户端实际能力交付：支持原生图片预览时优先直接展示 resource_link；需要本地持久化或无法预览资源链接时，使用宿主已有的下载或文件工具读取 imageResults[].downloadUrl，将二进制原图保存到当前任务已授权目录。只转发文本的客户端可从下方 JSON 读取同一 imageResults。WorkBuddy 只需远程 maliang：使用自带的下载工具，或已有 Bash/PowerShell 的下载能力保存原图，再调用 present_files，files 参数传已核实存在的绝对本地路径数组；确认产物登记后再报告展示成功。不能把远程 URL 直接传给 present_files，也不要用文本文件内容代替图片。无需安装额外 MCP，不得臆造客户端工具。下载链接短期有效，仅用于交付工具调用，不要回显到对话正文、日志或长期存储，也不要为展示结果打开浏览器。图片交付未完成时如实报告；不要只回复 jobId、imageId 或任务状态，不要把尚未完成的本地保存描述为成功，也不要为交付问题重新生图。" : "",
        JSON.stringify({ ...resultSummary, imageResults: deliveredPresentations }, null, 2)]
        .filter(Boolean)
        .join("\n\n")
    },
    ...resourceLinkContent
  ];
  return {
    content,
    structuredContent: {
      ...resultSummary,
      imageResults: deliveredPresentations
    },
    ...(status === "failed" && deliveredResultCount === 0 ? { isError: true as const } : {})
  };
}

async function createMaliangMcpServer(api: Hono) {
  const server = new McpServer({
    name: "maliang-image-generator",
    title: "神笔马良",
    version: await readCodexPluginVersion()
  }, {
    maxToolInputElements: 256,
    cacheHints: { "tools/list": { ttlMs: 300_000, cacheScope: "private" } },
    instructions: "神笔马良提供文生图、改图和异步任务查询。每次新的生图或改图请求生成一次 requestKey；超时或重试时复用原 key 和参数，已有 jobId 时只查询任务，避免重复消耗额度。maliang_report_device 只在新 OAuth 安装完成后的同一安装流程中调用一次，或在其他工具明确返回“设备尚未上报”时调用；reported=true 后同一 OAuth 客户端不要在每次任务、生图或改图前重复上报。服务端已保存设备时，直接调用 maliang_account_status 或图片工具。生成或改图后，使用 maliang_get_image_job 轮询到 succeeded 或 failed；通过 resource_link 和 imageResults.downloadUrl 交付原图，不返回 base64 图片数据，imageResults 同时保留在文本 JSON 和 structuredContent 中。Codex 插件必须调用 bundled maliang_local.save_image_result 保存到 generated_images，再用绝对本地路径直接显示。其他客户端优先使用实际支持的原生预览；需要落盘或不能预览资源链接时，使用宿主已有的下载或文件工具保存二进制原图。WorkBuddy 只需远程 maliang：读取 imageResults[].downloadUrl，用自带下载工具或已有 Bash/PowerShell 保存到当前任务已授权目录，再调用 present_files 展示真实存在的绝对本地路径数组，确认产物登记后再回复。不能把远程 URL 直接当作本地文件，无需安装额外 MCP，不得臆造工具。临时链接仅用于工具调用，不要回显到正文或自行写入日志。保存失败时报告交付未完成，不为交付问题重新生图，绝不为生成结果打开浏览器。不要只回复 jobId、imageId 或任务状态。编辑 Codex 本地附件时，先用 maliang_create_image_upload 获取一次性地址，再调用 bundled maliang_local.upload_local_image；只有宿主未提供可读附件路径或本地 MCP 未启动时才使用浏览器上传页。"
  });

  server.registerTool("maliang_account_status", {
    title: "查看马良账号状态",
    description: "确认当前 MCP 授权对应的神笔马良账号。可直接调用；只有服务端返回设备尚未上报时，才读取真实主机名和操作系统并调用一次 maliang_report_device。",
    inputSchema: {},
    outputSchema: z.object({ authenticated: z.boolean(), user: z.object({ id: z.string(), username: z.string(), account: z.string() }), resource: z.string() }),
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
    outputSchema: z.object({ reported: z.boolean(), deviceName: z.string(), deviceType: z.string(), updatedAt: z.string() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ deviceName, deviceType }, extra) => {
    const context = toolContext(extra as McpToolExtra, "profile:read");
    if (!context) return toolError("当前授权缺少 profile:read 权限，请重新连接神笔马良 MCP。");
    const reported = updateExternalMcpClientDevice(appDb, {
      clientId: context.clientId,
      grantId: context.grantId,
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
      requestKey: REQUEST_KEY_SCHEMA,
      prompt: z.string().trim().min(1).max(8000).describe("图片描述或绘图提示词"),
      model: EXTERNAL_MCP_IMAGE_MODEL_SCHEMA.optional().describe(`图片模型：GPT Image 2.6、2.5 的 Flare/Sunburst，或 GPT Image 2；省略时优先 ${imageModelDisplayName(DEFAULT_GENERATION_IMAGE_MODEL)}，没有兼容渠道时使用当前渠道的默认模型`),
      size: z.string().trim().optional().describe("图片尺寸，例如 1024x1024、1024x1536 或 1536x1024"),
      quality: EXTERNAL_MCP_IMAGE_QUALITY_SCHEMA.optional().describe("生成质量：auto、low、medium、high、xhigh 或 max"),
      complexity: EXTERNAL_MCP_IMAGE_COMPLEXITY_SCHEMA.optional().describe("仅 GPT Image 2.6 支持的图片复杂度；省略使用模型默认值"),
      imageCount: EXTERNAL_MCP_IMAGE_COUNT_SCHEMA.optional()
        .describe(`生成数量，范围 ${MIN_IMAGE_COUNT}-${MAX_IMAGE_COUNT}，默认 ${MIN_IMAGE_COUNT}；提示词中明确指定的数量优先`),
      background: EXTERNAL_MCP_IMAGE_BACKGROUND_SCHEMA.optional()
        .describe("背景模式；transparent 会输出带 Alpha 通道的 PNG 或 WebP"),
      outputFormat: EXTERNAL_MCP_IMAGE_OUTPUT_FORMAT_SCHEMA.optional()
        .describe("透明背景输出格式；省略时使用 PNG")
    },
    outputSchema: SUBMISSION_OUTPUT_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (input, extra) => {
    const context = toolContext(extra as McpToolExtra, "images:generate");
    if (!context) return toolError("当前授权缺少 images:generate 权限，请重新连接神笔马良 MCP。");
    const deviceGate = requireReportedDevice(context);
    if (deviceGate) return deviceGate;
    try {
      const result = await submitMcpImageOnce(appDb, {
        userId: context.user.id, operation: "generation", requestKey: input.requestKey, parameters: input
      }, async (clientRequestId) => asyncJobSummary(await internalImageRequest(api, "/images/generate", context.token, context.resource, {
        prompt: input.prompt,
        model: input.model ?? preferredDefaultImageModel(DEFAULT_GENERATION_IMAGE_MODEL),
        ...(input.size ? { size: input.size } : {}),
        quality: input.quality ?? DEFAULT_IMAGE_QUALITY,
        ...(input.complexity ? { complexity: input.complexity } : {}),
        ...(input.imageCount ? { n: input.imageCount } : {}),
        ...(input.background ? { background: input.background } : {}),
        ...(input.outputFormat ? { outputFormat: input.outputFormat } : {}),
        clientRequestId
      })));
      return toolJson({ ...result, next: "使用 maliang_get_image_job 查询，直到状态变为 succeeded、failed 或 cancelled" }, "文生图任务已提交。");
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "文生图任务提交失败");
    }
  });

  server.registerTool("maliang_create_image_upload", {
    title: "创建改图上传链接",
    description: "为本地图片创建一个 15 分钟有效、成功后即失效的安全上传地址。Codex 插件已有可读附件路径时应调用 bundled maliang_local.upload_local_image；其他客户端可直接以 POST multipart/form-data 上传。只有宿主没有提供可读路径或本地 MCP 未启动时才使用浏览器兜底。",
    inputSchema: {},
    outputSchema: z.object({
      uploadId: z.string(), uploadUrl: z.string(), expiresAt: z.string(), maxBytes: z.number(), acceptedMimeTypes: z.array(z.string()),
      uploadRequest: z.object({ method: z.string(), encoding: z.string(), fieldName: z.string() })
    }),
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
    outputSchema: z.object({ uploadId: z.string(), status: z.string(), assetId: z.string(), fileName: z.string(), mimeType: z.string(), size: z.number(), expiresAt: z.string(), usedAt: z.string() }),
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
      requestKey: REQUEST_KEY_SCHEMA,
      prompt: z.string().trim().min(1).max(8000).describe("希望如何修改图片"),
      model: EXTERNAL_MCP_IMAGE_MODEL_SCHEMA.optional().describe(`图片模型；省略时优先 ${imageModelDisplayName(DEFAULT_EDIT_IMAGE_MODEL)}，没有兼容渠道时使用当前渠道的默认模型`),
      imageIds: z.array(z.string().trim().min(1)).max(8).optional().describe("当前账号中的马良历史图片 ID"),
      uploadIds: z.array(z.string().trim().min(1)).max(8).optional().describe("已上传完成的 MCP uploadId"),
      size: z.string().trim().optional(),
      quality: EXTERNAL_MCP_IMAGE_QUALITY_SCHEMA.optional(),
      complexity: EXTERNAL_MCP_IMAGE_COMPLEXITY_SCHEMA.optional().describe("仅 GPT Image 2.6 支持的图片复杂度"),
      imageCount: EXTERNAL_MCP_IMAGE_COUNT_SCHEMA.optional()
        .describe(`生成数量，范围 ${MIN_IMAGE_COUNT}-${MAX_IMAGE_COUNT}，默认 ${MIN_IMAGE_COUNT}；提示词中明确指定的数量优先`),
      background: EXTERNAL_MCP_IMAGE_BACKGROUND_SCHEMA.optional()
        .describe("背景模式；transparent 会在每次编辑中保留透明 Alpha 背景"),
      outputFormat: EXTERNAL_MCP_IMAGE_OUTPUT_FORMAT_SCHEMA.optional()
        .describe("透明背景输出格式；省略时使用 PNG"),
      inputFidelity: z.enum(["low", "high"]).optional()
    },
    outputSchema: SUBMISSION_OUTPUT_SCHEMA,
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
    try {
      const result = await submitMcpImageOnce(appDb, {
        userId: context.user.id, operation: "edit", requestKey: input.requestKey, parameters: input
      }, async (clientRequestId) => {
        const sourceAssetIds: string[] = [];
        for (const uploadId of uploadIds) {
          const upload = getMcpImageUpload(context.user.id, uploadId);
          if (!upload || upload.status !== "uploaded" || !upload.asset_id) {
            throw new McpSubmissionRejected(`上传 ${uploadId} 尚未完成、已失效或不属于当前账号。`);
          }
          sourceAssetIds.push(upload.asset_id);
        }
        const payload = await internalImageRequest(api, "/images/edit", context.token, context.resource, {
          prompt: input.prompt,
          model: input.model ?? preferredDefaultImageModel(DEFAULT_EDIT_IMAGE_MODEL),
          sourceImageIds: imageIds,
          sourceAssetIds,
          ...(input.size ? { size: input.size } : {}),
          quality: input.quality ?? DEFAULT_IMAGE_QUALITY,
          ...(input.complexity ? { complexity: input.complexity } : {}),
          ...(input.imageCount ? { n: input.imageCount } : {}),
          ...(input.background ? { background: input.background } : {}),
          ...(input.outputFormat ? { outputFormat: input.outputFormat } : {}),
          ...(input.inputFidelity ? { inputFidelity: input.inputFidelity } : {}),
          clientRequestId
        });
        for (const assetId of sourceAssetIds) markMcpUploadUsed(context.user.id, assetId);
        return asyncJobSummary(payload);
      });
      return toolJson({ ...result, next: "使用 maliang_get_image_job 查询，直到状态变为 succeeded、failed 或 cancelled" }, "改图任务已提交。");
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "改图任务提交失败");
    }
  });

  server.registerTool("maliang_get_image_job", {
    title: "查询马良图片任务",
    description: "查询已有文生图或改图任务。返回原图 resource_link，文本 JSON 和 structuredContent 均包含 imageResults[].downloadUrl。优先原生预览；需要落盘或不能预览时用宿主已有的下载或文件工具保存二进制原图。WorkBuddy 使用自带下载工具或已有 Bash/PowerShell 保存到当前任务目录，再调用 present_files 展示真实绝对本地路径数组，无需额外 MCP。Codex 插件沿用 maliang_local.save_image_result。交付失败时重查同一 jobId 获取新链接，不重新生图。",
    inputSchema: {
      jobId: z.string().trim().min(1).describe("生图或改图工具返回的 jobId")
    },
    outputSchema: {
      jobId: z.string(),
      status: z.string(),
      error: z.string().optional(),
      next: z.string().optional(),
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
    const images = job.status === "succeeded" || job.status === "failed"
      ? getAll<ImageRow>(
          appDb,
          "select * from images where job_id = ? and user_id = ? order by coalesce(job_image_index, 2147483647) asc, created_at asc, rowid asc",
          job.id,
          context.user.id
        )
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
    return buildMaliangImageJobResult(summary, images, presentations);
  });

  return server;
}

export function registerExternalMcpProtocolRoute(api: Hono) {
  const handler = createMcpHandler(() => createMaliangMcpServer(api), {
    legacy: "stateless",
    responseMode: "auto",
    maxRequestBodySize: MCP_PROTOCOL_REQUEST_MAX_BYTES
  });
  api.all("/external-mcp/mcp", async (c) => {
    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      c.header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name, MCP-Session-Id, Last-Event-ID, X-Maliang-Device-Name, X-Maliang-Device-Hostname, X-Maliang-Device-Os, X-Maliang-Device-Ostype"
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
    const response = await handler.fetch(request, {
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
