import type { Hono } from "hono";
import { audit, logModelRequest } from "./auditLog";
import { configDb, getAll, getOne, run } from "./db";
import { requireConfig } from "./auth";
import { makeId, maskSecret, normalizePath, now, safeJson } from "./utils";

const DEFAULT_PROMPT_OPTIMIZER_RETRY_COUNT = 2;
const MAX_PROMPT_OPTIMIZER_RETRY_COUNT = 10;
const MODEL_LIST_TIMEOUT_MS = 15 * 1000;

export type PromptOptimizerProviderRow = {
  id: string;
  name: string;
  enabled: number;
  base_url: string;
  endpoint_path: string;
  api_key_env: string;
  api_key_value: string;
  model: string;
  models_json: string;
  availability_status: string;
  availability_error: string;
  availability_checked_at: string;
  stream_enabled: number;
  thinking_enabled: number;
  temperature: number | null;
  max_tokens: number;
  retry_count: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export function normalizePromptOptimizerRetryCount(value: unknown) {
  const count = Number(value);
  if (!Number.isFinite(count)) return DEFAULT_PROMPT_OPTIMIZER_RETRY_COUNT;
  return Math.max(0, Math.min(MAX_PROMPT_OPTIMIZER_RETRY_COUNT, Math.trunc(count)));
}

function normalizePromptOptimizerModelList(value: unknown) {
  const raw = typeof value === "string" ? safeJson<unknown[]>(value, []) : value;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of raw) {
    const model = String(item ?? "").trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
    if (models.length >= 500) break;
  }
  return models;
}

function normalizePromptOptimizerAvailabilityStatus(value: unknown) {
  const status = String(value ?? "").trim();
  if (status === "normal" || status === "abnormal") return status;
  return "unknown";
}

export function promptOptimizerApiKey(provider: PromptOptimizerProviderRow) {
  const apiKeyValue = String(provider.api_key_value ?? "").trim();
  const envKey = String(provider.api_key_env ?? "").trim();
  return apiKeyValue || (envKey ? String(Bun.env[envKey] ?? "").trim() : "");
}

export function promptOptimizerHeaders(provider: PromptOptimizerProviderRow, accept = "application/json") {
  const apiKey = promptOptimizerApiKey(provider);
  const headers: Record<string, string> = {
    Accept: accept
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function retryablePromptOptimizerStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function promptOptimizerRetryDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.min(2000, 350 * (attempt + 1))));
}

export async function fetchPromptOptimizerWithRetry(
  provider: PromptOptimizerProviderRow,
  input: RequestInfo | URL,
  init: RequestInit,
  options: { onAttempt?: (attemptNo: number) => void } = {}
) {
  const retryCount = normalizePromptOptimizerRetryCount(provider.retry_count);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    options.onAttempt?.(attempt + 1);
    try {
      const response = await fetch(input, init);
      if (response.ok || !retryablePromptOptimizerStatus(response.status) || attempt >= retryCount) return response;
      await promptOptimizerRetryDelay(attempt);
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted || attempt >= retryCount) throw error;
      await promptOptimizerRetryDelay(attempt);
    }
  }
  throw lastError;
}

export function publicPromptOptimizerProvider(row: PromptOptimizerProviderRow, includeSecret = false) {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    baseUrl: row.base_url,
    endpointPath: row.endpoint_path,
    apiKeyEnv: row.api_key_env,
    apiKeyValue: includeSecret ? row.api_key_value : maskSecret(row.api_key_value),
    model: row.model,
    availableModels: normalizePromptOptimizerModelList(row.models_json),
    availabilityStatus: normalizePromptOptimizerAvailabilityStatus(row.availability_status),
    availabilityError: row.availability_error,
    availabilityCheckedAt: row.availability_checked_at,
    streamEnabled: Boolean(row.stream_enabled),
    thinkingEnabled: (row.thinking_enabled ?? 1) !== 0,
    temperature: row.temperature == null ? null : Number(row.temperature),
    maxTokens: Number(row.max_tokens),
    retryCount: normalizePromptOptimizerRetryCount(row.retry_count),
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeProviderInput(raw: Record<string, unknown>, existing?: PromptOptimizerProviderRow | null) {
  const apiKeyValue = String(raw.apiKeyValue ?? "");
  const hasAvailableModels = Object.prototype.hasOwnProperty.call(raw, "availableModels");
  const availableModels = normalizePromptOptimizerModelList(raw.availableModels);
  const existingModels = normalizePromptOptimizerModelList(existing?.models_json);
  const availabilityStatus = normalizePromptOptimizerAvailabilityStatus(raw.availabilityStatus ?? existing?.availability_status);
  const maxTokens = Number(raw.maxTokens ?? existing?.max_tokens ?? 0);
  const temperatureValue = raw.temperature === undefined ? existing?.temperature : raw.temperature;
  const temperature = temperatureValue === null || temperatureValue === undefined || String(temperatureValue).trim() === ""
    ? null
    : Number(temperatureValue);
  const normalizedTemperature = temperature !== null && Number.isFinite(temperature)
    ? Math.max(0, Math.min(2, temperature))
    : null;
  return {
    id: String(raw.id ?? "").trim() || makeId("promptopt"),
    name: String(raw.name ?? "提示词优化模型").trim() || "提示词优化模型",
    enabled: Boolean(raw.enabled) ? 1 : 0,
    baseUrl: String(raw.baseUrl ?? "https://api.deepseek.com").trim() || "https://api.deepseek.com",
    endpointPath: String(raw.endpointPath ?? "/chat/completions").trim() || "/chat/completions",
    apiKeyEnv: String(raw.apiKeyEnv ?? "DEEPSEEK_API_KEY").trim(),
    apiKeyValue: apiKeyValue.includes("****") && existing ? existing.api_key_value : apiKeyValue,
    model: String(raw.model ?? "deepseek-chat").trim() || "deepseek-chat",
    availableModels: hasAvailableModels ? availableModels : existingModels,
    availabilityStatus,
    availabilityError: String(raw.availabilityError ?? existing?.availability_error ?? "").trim(),
    availabilityCheckedAt: String(raw.availabilityCheckedAt ?? existing?.availability_checked_at ?? "").trim(),
    streamEnabled: Boolean(raw.streamEnabled ?? existing?.stream_enabled),
    thinkingEnabled: raw.thinkingEnabled === undefined ? (existing?.thinking_enabled ?? 1) !== 0 : Boolean(raw.thinkingEnabled),
    temperature: normalizedTemperature,
    maxTokens: Math.max(0, Math.min(16000, Math.trunc(Number.isFinite(maxTokens) ? maxTokens : 0))),
    retryCount: normalizePromptOptimizerRetryCount(raw.retryCount ?? existing?.retry_count),
    sortOrder: Math.max(0, Math.trunc(Number(raw.sortOrder ?? 100) || 100))
  };
}

function rowFromProviderInput(
  input: ReturnType<typeof normalizeProviderInput>,
  existing?: PromptOptimizerProviderRow | null
): PromptOptimizerProviderRow {
  const timestamp = now();
  return {
    id: input.id,
    name: input.name,
    enabled: input.enabled,
    base_url: input.baseUrl,
    endpoint_path: input.endpointPath,
    api_key_env: input.apiKeyEnv,
    api_key_value: input.apiKeyValue,
    model: input.model,
    models_json: JSON.stringify(input.availableModels),
    availability_status: input.availabilityStatus,
    availability_error: input.availabilityError,
    availability_checked_at: input.availabilityCheckedAt,
    stream_enabled: input.streamEnabled ? 1 : 0,
    thinking_enabled: input.thinkingEnabled ? 1 : 0,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    retry_count: input.retryCount,
    sort_order: input.sortOrder,
    created_at: existing?.created_at ?? timestamp,
    updated_at: existing?.updated_at ?? timestamp
  };
}

function existingPromptOptimizerProvider(raw: Record<string, unknown>) {
  const id = String(raw.id ?? "").trim();
  return id ? getOne<PromptOptimizerProviderRow>(configDb, "select * from prompt_optimizer_providers where id = ?", id) : null;
}

function updatePromptOptimizerAvailability(
  providerId: string,
  input: {
    status: "normal" | "abnormal";
    models?: string[];
    error?: string;
    checkedAt?: string;
  }
) {
  const id = providerId.trim();
  if (!id) return;
  const existing = getOne<PromptOptimizerProviderRow>(configDb, "select * from prompt_optimizer_providers where id = ?", id);
  if (!existing) return;
  const timestamp = input.checkedAt || now();
  const models = input.models ? normalizePromptOptimizerModelList(input.models) : normalizePromptOptimizerModelList(existing.models_json);
  run(
    configDb,
    `update prompt_optimizer_providers
     set models_json = ?,
         availability_status = ?,
         availability_error = ?,
         availability_checked_at = ?,
         updated_at = ?
     where id = ?`,
    JSON.stringify(models),
    input.status,
    String(input.error ?? "").trim(),
    timestamp,
    timestamp,
    id
  );
}

function modelPathFromEndpoint(endpointPath: string) {
  const normalized = `/${String(endpointPath || "/chat/completions").trim().replace(/^\/+/, "")}`;
  const marker = "/chat/completions";
  if (normalized.endsWith(marker)) {
    const prefix = normalized.slice(0, -marker.length);
    return `${prefix || ""}/models`;
  }
  return "/models";
}

function collectModelIds(value: unknown) {
  const ids: string[] = [];
  const seen = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === "string") {
      const model = item.trim();
      if (model && !seen.has(model)) {
        seen.add(model);
        ids.push(model);
      }
      return;
    }
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const model = String(record.id ?? record.name ?? record.model ?? "").trim();
    if (model && !seen.has(model)) {
      seen.add(model);
      ids.push(model);
    }
  };
  if (Array.isArray(value)) {
    value.forEach(visit);
    return ids;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidates = [record.data, record.models, record.items, record.result];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) candidate.forEach(visit);
    }
  }
  return ids;
}

function explicitDefaultModel(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  return String(record.default_model ?? record.defaultModel ?? record.default ?? record.model ?? "").trim();
}

function preferredDefaultModel(models: string[], currentModel: string, data: unknown) {
  const preferred = [explicitDefaultModel(data), currentModel.trim()].filter(Boolean);
  for (const model of preferred) {
    if (models.includes(model)) return model;
  }
  return models[0] ?? currentModel.trim();
}

async function fetchPromptOptimizerModels(provider: PromptOptimizerProviderRow, purpose: "config.models" | "config.test") {
  const endpoint = normalizePath(provider.base_url, modelPathFromEndpoint(provider.endpoint_path));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
  const startedAt = Date.now();
  let attemptCount = 0;
  let statusCode: number | null = null;
  try {
    if (!promptOptimizerApiKey(provider)) throw new Error(`供应商「${provider.name}」缺少 API Key`);
    const response = await fetchPromptOptimizerWithRetry(provider, endpoint, {
      method: "GET",
      signal: controller.signal,
      headers: promptOptimizerHeaders(provider)
    }, {
      onAttempt: (attemptNo) => {
        attemptCount = attemptNo;
      }
    });
    statusCode = response.status;
    const text = await response.text();
    const data = safeJson<unknown>(text, null);
    if (!response.ok) {
      const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
      const nestedError = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
      throw new Error(String(nestedError?.message ?? record.message ?? text ?? response.statusText).trim() || "模型列表获取失败");
    }
    const models = normalizePromptOptimizerModelList(collectModelIds(data));
    if (models.length === 0) throw new Error("供应商地址可访问，但没有返回可用模型");
    logModelRequest({
      purpose,
      providerId: provider.id,
      providerName: provider.name,
      model: provider.model,
      endpoint,
      method: "GET",
      streamEnabled: false,
      retryCount: normalizePromptOptimizerRetryCount(provider.retry_count),
      attemptCount,
      statusCode,
      durationMs: Date.now() - startedAt,
      success: true,
      source: "config"
    });
    return {
      endpoint,
      durationMs: Date.now() - startedAt,
      models,
      defaultModel: preferredDefaultModel(models, provider.model, data)
    };
  } catch (error) {
    logModelRequest({
      purpose,
      providerId: provider.id,
      providerName: provider.name,
      model: provider.model,
      endpoint,
      method: "GET",
      streamEnabled: false,
      retryCount: normalizePromptOptimizerRetryCount(provider.retry_count),
      attemptCount,
      statusCode,
      durationMs: Date.now() - startedAt,
      success: false,
      error,
      source: "config"
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function registerPromptOptimizerRoutes(api: Hono) {
  api.get("/config/prompt-optimizer-providers", (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const rows = getAll<PromptOptimizerProviderRow>(
      configDb,
      "select * from prompt_optimizer_providers order by sort_order asc, created_at asc"
    );
    return c.json({ providers: rows.map((row) => publicPromptOptimizerProvider(row, false)) });
  });

  api.put("/config/prompt-optimizer-providers", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const body = await c.req.json().catch(() => ({}));
    const providers = Array.isArray(body.providers) ? body.providers : [];
    const timestamp = now();
    const savedIds: string[] = [];
    for (const item of providers) {
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      const requestedId = String(raw.id ?? "").trim();
      const existing = requestedId
        ? getOne<PromptOptimizerProviderRow>(configDb, "select * from prompt_optimizer_providers where id = ?", requestedId)
        : null;
      const normalized = normalizeProviderInput(raw, existing);
      savedIds.push(normalized.id);
      run(
        configDb,
        `insert into prompt_optimizer_providers (
          id, name, enabled, base_url, endpoint_path, api_key_env, api_key_value,
          model, models_json, availability_status, availability_error, availability_checked_at,
          stream_enabled, thinking_enabled, temperature, max_tokens, retry_count, sort_order, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          name = excluded.name,
          enabled = excluded.enabled,
          base_url = excluded.base_url,
          endpoint_path = excluded.endpoint_path,
          api_key_env = excluded.api_key_env,
          api_key_value = excluded.api_key_value,
          model = excluded.model,
          models_json = excluded.models_json,
          availability_status = excluded.availability_status,
          availability_error = excluded.availability_error,
          availability_checked_at = excluded.availability_checked_at,
          stream_enabled = excluded.stream_enabled,
          thinking_enabled = excluded.thinking_enabled,
          temperature = excluded.temperature,
          max_tokens = excluded.max_tokens,
          retry_count = excluded.retry_count,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at`,
        normalized.id,
        normalized.name,
        normalized.enabled,
        normalized.baseUrl,
        normalized.endpointPath,
        normalized.apiKeyEnv,
        normalized.apiKeyValue,
        normalized.model,
        JSON.stringify(normalized.availableModels),
        normalized.availabilityStatus,
        normalized.availabilityError,
        normalized.availabilityCheckedAt,
        normalized.streamEnabled ? 1 : 0,
        normalized.thinkingEnabled ? 1 : 0,
        normalized.temperature,
        normalized.maxTokens,
        normalized.retryCount,
        normalized.sortOrder,
        existing?.created_at ?? timestamp,
        timestamp
      );
    }
    if (savedIds.length > 0) {
      run(configDb, `delete from prompt_optimizer_providers where id not in (${savedIds.map(() => "?").join(",")})`, ...savedIds);
    } else {
      run(configDb, "delete from prompt_optimizer_providers");
    }
    audit("prompt_optimizer.save", { count: providers.length });
    return c.json({ ok: true });
  });

  api.post("/config/prompt-optimizer-providers/models", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const raw = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    try {
      const existing = existingPromptOptimizerProvider(raw);
      const provider = rowFromProviderInput(normalizeProviderInput(raw, existing), existing);
      const result = await fetchPromptOptimizerModels(provider, "config.models");
      const checkedAt = now();
      updatePromptOptimizerAvailability(provider.id, { status: "normal", models: result.models, checkedAt });
      audit("prompt_optimizer.models", { id: provider.id, name: provider.name, count: result.models.length });
      return c.json({ ...result, availabilityStatus: "normal", availabilityError: "", availabilityCheckedAt: checkedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型列表获取失败";
      const id = String(raw.id ?? "").trim();
      const checkedAt = now();
      updatePromptOptimizerAvailability(id, { status: "abnormal", error: message, checkedAt });
      return c.json({ error: message, availabilityStatus: "abnormal", availabilityError: message, availabilityCheckedAt: checkedAt }, 400);
    }
  });

  api.post("/config/prompt-optimizer-providers/test", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const raw = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    try {
      const existing = existingPromptOptimizerProvider(raw);
      const provider = rowFromProviderInput(normalizeProviderInput(raw, existing), existing);
      const result = await fetchPromptOptimizerModels(provider, "config.test");
      const checkedAt = now();
      updatePromptOptimizerAvailability(provider.id, { status: "normal", models: result.models, checkedAt });
      audit("prompt_optimizer.test", { id: provider.id, name: provider.name, ok: true, count: result.models.length, durationMs: result.durationMs });
      return c.json({
        ok: true,
        message: `供应商地址可用，获取到 ${result.models.length} 个模型`,
        availabilityStatus: "normal",
        availabilityError: "",
        availabilityCheckedAt: checkedAt,
        ...result
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "供应商测试失败";
      const id = String(raw.id ?? "").trim();
      const checkedAt = now();
      updatePromptOptimizerAvailability(id, { status: "abnormal", error: message, checkedAt });
      audit("prompt_optimizer.test", { ok: false, error: message });
      return c.json({ ok: false, error: message, availabilityStatus: "abnormal", availabilityError: message, availabilityCheckedAt: checkedAt }, 400);
    }
  });
}
