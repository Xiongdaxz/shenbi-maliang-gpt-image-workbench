import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { saveMaliangImageResponse, trustedMaliangOrigin } from "./maliang-workbuddy-file-store.mjs";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const challenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const ttl = 5 * 60_000;
const deliveryLimit = 32;
const resultLimit = 10;

function textResult(value, lead, isError = false) {
  return { content: [{ type: "text", text: `${lead}\n\n${JSON.stringify(value)}` }], structuredContent: value, ...(isError ? { isError } : {}) };
}

function errorText(error) {
  return (error instanceof Error ? error.message : "图片交付失败").replace(/https?:\/\/\S+/giu, "[redacted-url]").slice(0, 250);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function taskWorkspace(workspacePath, roots) {
  if (!path.isAbsolute(workspacePath)) throw new Error("请传入当前 WorkBuddy 任务的工作目录绝对路径");
  const resolved = await realpath(workspacePath);
  const info = await lstat(resolved, { bigint: true });
  if (!info.isDirectory()) throw new Error("WorkBuddy 任务工作目录不存在");
  const allowed = await Promise.all(roots.map(root => realpath(root).catch(() => null)));
  if (!allowed.some(root => root && isWithin(root, resolved))) throw new Error("当前工作目录不在 WorkBuddy 已配置的保存范围内");
  return { path: resolved, dev: info.dev, ino: info.ino };
}

async function prepareGeneratedImagesDirectory(workspace, roots, dir) {
  const validateWorkspace = async () => {
    const current = await taskWorkspace(workspace.path, roots);
    if (path.relative(workspace.path, current.path) || workspace.dev !== current.dev || workspace.ino !== current.ino) {
      throw new Error("原任务目录已改变，请重新准备交付");
    }
  };
  await validateWorkspace();
  await mkdir(dir).catch(error => { if (error?.code !== "EEXIST") throw error; });
  const original = await lstat(dir, { bigint: true });
  const validateDirectory = async () => {
    await validateWorkspace();
    const current = await lstat(dir, { bigint: true });
    if (!current.isDirectory() || current.dev !== original.dev || current.ino !== original.ino || path.relative(dir, await realpath(dir))) {
      throw new Error("generated-images 必须是当前任务中未被替换的真实目录");
    }
  };
  await validateDirectory();
  return validateDirectory;
}

function configuredRoots() {
  const additional = JSON.parse(process.env.MALIANG_WORKBUDDY_WORKSPACE_ROOTS || "[]");
  if (!Array.isArray(additional) || additional.length > 32 || additional.some(root => typeof root !== "string" || !path.isAbsolute(root))) {
    throw new Error("MALIANG_WORKBUDDY_WORKSPACE_ROOTS 需要已授权的绝对目录数组");
  }
  return [path.join(os.homedir(), "WorkBuddy"), ...additional];
}

export function createWorkBuddyImageServer(runtime = {}) {
  const roots = runtime.workspaceRoots ?? configuredRoots();
  const { origin } = trustedMaliangOrigin({
    trustedOrigin: runtime.origin ?? process.env.MALIANG_WORKBUDDY_ORIGIN,
    // The exact deployment origin comes from the local MCP config, not a tool argument.
    allowInsecureLocal: runtime.allowInsecureLocal ?? process.env.MALIANG_WORKBUDDY_ALLOW_INSECURE_LOCAL === "true"
  });
  const pending = new Map();
  const server = new McpServer({ name: "maliang-workbuddy-image", version: "1.0.0" }, {
    instructions: "仅用于已生成的马良图片交付。用当前任务工作目录和已有 jobId 调用 prepare_image_delivery，将 deliveryChallenge 传给马良 maliang_get_image_job 的 workBuddyDeliveryChallenge。把 workBuddyDelivery 原样传给 save_image_results，成功后调用 WorkBuddy 原生 present_files(files: 返回的 files)，确认产物登记后再回复。任何交付问题都不要重新生图。"
  });

  server.registerTool("prepare_image_delivery", {
    description: "为当前 WorkBuddy 任务准备马良原图交付。已有 jobId 且查询到可交付图片后行此步骤。workspacePath 必须是当前任务被授权的工作目录，而不是安装目录。",
    inputSchema: { jobId: id, workspacePath: z.string().max(4096) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ jobId, workspacePath }) => {
    try {
      const workspace = await taskWorkspace(workspacePath, roots);
      const now = Date.now();
      for (const [key, value] of pending) if (value.expiresAt <= now) pending.delete(key);
      if (pending.size >= deliveryLimit) throw new Error("待交付任务太多，请稍后重新准备已有 jobId");
      const proof = randomBytes(32).toString("base64url");
      const deliveryChallenge = createHash("sha256").update(proof).digest("base64url");
      pending.set(deliveryChallenge, { proof, jobId, workspace, expiresAt: now + ttl });
      return textResult({ jobId, deliveryChallenge }, "用同一 jobId 查询 maliang_get_image_job，并传入 workBuddyDeliveryChallenge。");
    } catch (error) {
      return textResult({ status: "failed" }, errorText(error), true);
    }
  });

  server.registerTool("save_image_results", {
    description: "把同一任务的 workBuddyDelivery 原样作为参数，安全取回马良原图，保存到该任务的 generated-images。返回真实本地 images[].localPath 和 files；随后调用 WorkBuddy 内置 present_files(files: files) 展示产物。不要把票据发给用户。",
    inputSchema: {
      jobId: id, deliveryChallenge: challenge,
      images: z.array(z.object({ imageId: id, ticket: z.string().max(2048).regex(/^wb1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/), expiresAt: z.string().optional() }))
        .min(1).max(resultLimit)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ jobId, deliveryChallenge, images }) => {
    const delivery = pending.get(deliveryChallenge);
    if (!delivery || delivery.expiresAt <= Date.now() || delivery.jobId !== jobId) {
      return textResult({ status: "failed", files: [] }, "交付已过期、任务不符或本地工具已重启。请为同一个 jobId 重新准备交付，不要重新生图。", true);
    }
    if (new Set(images.map(image => image.imageId)).size !== images.length) {
      return textResult({ status: "failed", files: [] }, "交付结果包含重复图片，请使用马良原样返回的 workBuddyDelivery。", true);
    }
    const saved = [];
    const failures = [];
    const outputRoot = path.join(delivery.workspace.path, "generated-images");
    for (const image of images) {
      try {
        const url = new URL(`/mcp/workbuddy-image-result/${encodeURIComponent(jobId)}/${encodeURIComponent(image.imageId)}`, origin);
        const response = await (runtime.fetchImage ?? fetch)(url, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
          headers: { Authorization: `Bearer ${delivery.proof}`, "X-Maliang-Delivery-Ticket": image.ticket }
        });
        const { path: localPath, mimeType, bytes } = await saveMaliangImageResponse(image.imageId, response, {
          outputRoot,
          prepareOutputRoot: (dir) => prepareGeneratedImagesDirectory(delivery.workspace, roots, dir)
        });
        saved.push({ imageId: image.imageId, localPath, mimeType, bytes });
      } catch (error) { failures.push({ imageId: image.imageId, error: errorText(error) }); }
    }
    const files = saved.map(image => image.localPath);
    const status = !files.length ? "failed" : failures.length ? "partial" : "completed";
    return textResult({ status, jobId, images: saved, files, failures }, files.length
      ? "用 WorkBuddy 内置 present_files 展示 files 中已保存的图片；如果有失败项，请如实说明。"
      : "没有图片保存成功。只重试已有 jobId 的交付，不要重新生图。", !files.length);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await createWorkBuddyImageServer().connect(new StdioServerTransport());
}
