import { randomUUID } from "node:crypto";
import { STUDIO_CODEX_USER_AGENT } from "./constants";
import { normalizeImageComplexity } from "../src/lib/imageModels";

// Compared with the installed CPA 8.0.55, e6e5708e: codex_openai_images.go.
// Its native JSON route preserves image options, including masks, formats and 2.5 quality levels.
export function useCodexNativeImages(routeMode: string | null | undefined, _payload: Record<string, unknown>) {
  return String(routeMode || "auto").trim() !== "responses";
}

function imageReferences(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Array<{ image_url: string } | { file_id: string }> => {
    if (typeof item === "string" && item.trim()) return [{ image_url: item }];
    if (!item || typeof item !== "object") return [];
    const ref = item as Record<string, unknown>;
    if (typeof ref.image_url === "string" && ref.image_url.trim()) return [{ image_url: ref.image_url }];
    if (typeof ref.file_id === "string" && ref.file_id.trim()) return [{ file_id: ref.file_id }];
    return [];
  });
}

export function buildCodexNativeImageRequest(mode: "generation" | "edit", payload: Record<string, unknown>, fallbackModel: string) {
  const references = imageReferences(payload.images);
  const hasMask = payload.mask !== undefined && payload.mask !== null && payload.mask !== "";
  const mask = hasMask ? imageReferences([payload.mask])[0] : undefined;
  if (hasMask && !mask) throw new Error("蒙版图像引用无效");
  const editing = mode === "edit" || references.length > 0 || hasMask;
  if (editing && references.length === 0) throw new Error("图片编辑缺少参考图片");
  const quality = String(payload.quality || "auto").trim().toLowerCase();
  const body: Record<string, unknown> = {
    prompt: String(payload.prompt ?? "").trim(),
    model: String(payload.model || fallbackModel).trim(),
    quality
  };
  const complexity = normalizeImageComplexity(body.model, payload.complexity);
  if (complexity) body.complexity = complexity;
  for (const field of ["size", "background", "output_format", "moderation", "input_fidelity"]) {
    if (typeof payload[field] === "string" && payload[field]) body[field] = payload[field];
  }
  for (const field of ["output_compression", "partial_images"]) {
    if (typeof payload[field] === "number" && Number.isFinite(payload[field])) body[field] = payload[field];
  }
  if (typeof payload.n === "number" && Number.isInteger(payload.n) && payload.n > 0) body.n = payload.n;
  if (editing) body.images = references;
  if (mask) body.mask = mask;
  return { path: editing ? "/codex/images/edits" : "/codex/images/generations", body };
}

export function codexNativeImageHeaders(options: { accessToken: string; accountId?: string; sessionId?: string; requestId?: string }) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`, "Content-Type": "application/json", Accept: "application/json",
    "User-Agent": STUDIO_CODEX_USER_AGENT, Originator: "codex-tui", "Session-Id": options.sessionId || randomUUID(),
    Connection: "Keep-Alive"
  };
  if (options.accountId) headers["Chatgpt-Account-Id"] = options.accountId;
  if (options.requestId) headers["X-Client-Request-Id"] = options.requestId;
  return headers;
}

export function codexNativeImageResult(response: unknown) {
  const result = response && typeof response === "object" && !Array.isArray(response) ? response as Record<string, unknown> : {};
  const model = typeof result.image_model === "string" ? result.image_model : typeof result.model === "string" ? result.model : "";
  const normalized = { ...result };
  if (Array.isArray(result.data)) normalized.data = result.data.map(item => {
    if (!item || typeof item !== "object") return item;
    const image = item as Record<string, unknown>;
    return typeof image.generation_id === "string" && !image.gen_id ? { ...image, gen_id: image.generation_id } : image;
  });
  return { response: normalized, actualModel: model || "chatgpt-codex-auto",
    actualQuality: typeof result.quality === "string" ? result.quality : "auto",
    modelFallbackReason: model ? "" : "账号图片接口未提供实际模型标识，具体模型由上游决定" };
}
