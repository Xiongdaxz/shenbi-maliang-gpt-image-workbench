import { providerFetch, providerHeaders, type ProviderFetchPolicy } from "./providerHttp";
import type { ProviderRow } from "./types";
import { normalizePath, normalizeProviderChannel, safeJson } from "./utils";
import { STUDIO_CODEX_CLIENT_VERSION } from "./constants";

const PROVIDER_MODEL_LIST_TIMEOUT_MS = 15 * 1000;

export function providerModelListPath(provider: Pick<ProviderRow, "channel" | "responses_path" | "generation_path">) {
  const channel = normalizeProviderChannel(provider.channel);
  if (channel === "chatgpt_web") return "/codex/models";

  const responsesPath = String(provider.responses_path ?? "").trim();
  if (/\/responses\/?$/i.test(responsesPath)) {
    return responsesPath.replace(/\/responses\/?$/i, "/models");
  }

  const generationPath = String(provider.generation_path ?? "").trim();
  if (/\/images\/generations\/?$/i.test(generationPath)) {
    return generationPath.replace(/\/images\/generations\/?$/i, "/models");
  }
  return "/v1/models";
}

export function providerModelListUrl(provider: Pick<ProviderRow, "base_url" | "channel" | "responses_path" | "generation_path">) {
  const baseUrl = String(provider.base_url ?? "").trim();
  if (!baseUrl) throw new Error("请先填写服务地址");
  let modelPath = providerModelListPath(provider);
  try {
    const basePath = new URL(baseUrl).pathname.replace(/\/+$/, "");
    if (basePath && basePath !== "/" && modelPath.startsWith(`${basePath}/`)) {
      modelPath = modelPath.slice(basePath.length);
    }
  } catch {
    // Let fetch surface malformed private gateway URLs with its normal error message.
  }
  const endpoint = normalizePath(baseUrl, modelPath);
  return normalizeProviderChannel(provider.channel) === "chatgpt_web"
    ? `${endpoint}?client_version=${encodeURIComponent(STUDIO_CODEX_CLIENT_VERSION)}`
    : endpoint;
}

function providerModelItems(value: unknown) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [record.data, record.models, record.items, record.result]
    .filter((candidate): candidate is unknown[] => Array.isArray(candidate))
    .flat();
}

function providerModelId(item: unknown) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  const record = item as Record<string, unknown>;
  return String(record.id ?? record.slug ?? record.model ?? record.name ?? "").trim();
}

function providerModelVisible(item: unknown) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return true;
  return String((item as Record<string, unknown>).visibility ?? "").trim().toLowerCase() !== "hide";
}

export function collectProviderModelIds(value: unknown) {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    const id = String(value ?? "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const item of providerModelItems(value)) {
    if (providerModelVisible(item)) add(providerModelId(item));
  }
  return ids;
}

export function collectChatGptResponsesModelIds(value: unknown) {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of providerModelItems(value)) {
    if (!providerModelVisible(item)) continue;
    const id = providerModelId(item);
    if (!id || seen.has(id) || !isResponsesLanguageModel(id)) continue;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      if (record.supported_in_api === false) continue;
      if (
        Array.isArray(record.input_modalities)
        && !record.input_modalities.some((modality) => String(modality).toLowerCase() === "image")
      ) continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function isImageGenerationModel(model: string) {
  const normalized = model.trim().toLowerCase();
  return (
    /(?:^|[\/_\-.])gpt[\/_\-.]?image(?:[\/_\-.]|$)/.test(normalized) ||
    /(?:^|[\/_\-.])chatgpt[\/_\-.]?image(?:[\/_\-.]|$)/.test(normalized) ||
    /(?:^|[\/_\-.])dall[\/_\-.]?e(?:[\/_\-.]|$)/.test(normalized) ||
    /(?:^|[\/_\-.])imagen(?:[\/_\-.]|$)/.test(normalized)
  );
}

export function isResponsesLanguageModel(model: string) {
  const normalized = model.trim().toLowerCase();
  if (!normalized || isImageGenerationModel(normalized)) return false;
  return !/(?:embedding|moderation|whisper|transcrib|realtime|audio|speech|tts|sora|video|auto-review)/.test(normalized);
}

function providerModelError(data: unknown, response: Response, text: string) {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
    const message = String(nested?.message ?? record.message ?? "").trim();
    if (message) return message;
  }
  return text.trim() || response.statusText || `模型列表获取失败（HTTP ${response.status}）`;
}

export async function fetchProviderModelCatalog(provider: ProviderRow, policy?: ProviderFetchPolicy) {
  const endpoint = providerModelListUrl(provider);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_MODEL_LIST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await providerFetch(provider, endpoint, {
      method: "GET",
      signal: controller.signal,
      headers: providerHeaders(provider, "", "application/json")
    }, policy);
    const text = await response.text();
    const data = safeJson<unknown>(text, null);
    if (!response.ok) throw new Error(providerModelError(data, response, text));
    const models = collectProviderModelIds(data).slice(0, 500);
    if (models.length === 0) throw new Error("渠道地址可访问，但没有返回可用模型");
    const imageModels = models.filter(isImageGenerationModel);
    const responsesModels = normalizeProviderChannel(provider.channel) === "chatgpt_web"
      ? collectChatGptResponsesModelIds(data)
      : models.filter(isResponsesLanguageModel);
    return {
      endpoint,
      durationMs: Date.now() - startedAt,
      models,
      imageModels,
      responsesModels
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("模型列表获取超时，请检查渠道地址或代理设置");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
