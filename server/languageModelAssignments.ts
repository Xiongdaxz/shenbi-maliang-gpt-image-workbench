import type { Hono } from "hono";
import { audit } from "./auditLog";
import { requireConfig } from "./auth";
import { configDb, getAll, run } from "./db";
import type { PromptOptimizerProviderRow } from "./promptOptimizerRoutes";
import { now } from "./utils";

export const LANGUAGE_MODEL_USAGE_KEYS = [
  "prompt.optimize",
  "template.optimize",
  "template.translate",
  "image.edit_suggestions",
  "title.chat",
  "title.case",
  "title.asset",
  "identity.username",
  "classify.case_style",
  "classify.asset_tag",
  "starter.copy.generate",
  "starter.copy.translate",
  "safety.review"
] as const;

export const LANGUAGE_MODEL_GLOBAL_DEFAULT_KEY = "global.default";

export type LanguageModelUsageKey = (typeof LANGUAGE_MODEL_USAGE_KEYS)[number];

export type LanguageModelAssignmentRow = {
  usage_key: string;
  provider_id: string;
  model: string;
  updated_at: string;
};

type LanguageModelResolution = {
  provider: PromptOptimizerProviderRow | null;
  status: "inherited" | "configured" | "invalid";
};

const LANGUAGE_MODEL_USAGE_KEY_SET = new Set<string>(LANGUAGE_MODEL_USAGE_KEYS);

export function isLanguageModelUsageKey(value: unknown): value is LanguageModelUsageKey {
  return LANGUAGE_MODEL_USAGE_KEY_SET.has(String(value ?? "").trim());
}

function orderedLanguageModelProviders() {
  return getAll<PromptOptimizerProviderRow>(
    configDb,
    "select * from prompt_optimizer_providers order by sort_order asc, created_at asc"
  );
}

export function defaultLanguageModelProviderFromRows(providers: PromptOptimizerProviderRow[]) {
  return providers.find((provider) => Boolean(provider.enabled)) ?? null;
}

export function resolveGlobalLanguageModelFromRows(
  providers: PromptOptimizerProviderRow[],
  assignment?: LanguageModelAssignmentRow | null
): LanguageModelResolution {
  const fallback = defaultLanguageModelProviderFromRows(providers);
  if (!assignment) return { provider: fallback, status: "inherited" };

  const providerId = String(assignment.provider_id ?? "").trim();
  const model = String(assignment.model ?? "").trim();
  const assignedProvider = providers.find((provider) => provider.id === providerId);
  if (!assignedProvider || !assignedProvider.enabled || !model) {
    return { provider: fallback, status: "invalid" };
  }
  return {
    provider: { ...assignedProvider, model },
    status: "configured"
  };
}

export function resolveLanguageModelFromRows(
  providers: PromptOptimizerProviderRow[],
  assignment?: LanguageModelAssignmentRow | null,
  globalAssignment?: LanguageModelAssignmentRow | null
): LanguageModelResolution {
  const fallback = resolveGlobalLanguageModelFromRows(providers, globalAssignment).provider;
  if (!assignment) return { provider: fallback, status: "inherited" };

  const providerId = String(assignment.provider_id ?? "").trim();
  const model = String(assignment.model ?? "").trim();
  const assignedProvider = providers.find((provider) => provider.id === providerId);
  if (!assignedProvider || !assignedProvider.enabled || !model) {
    return { provider: fallback, status: "invalid" };
  }
  return {
    provider: { ...assignedProvider, model },
    status: "configured"
  };
}

function languageModelAssignmentRows() {
  return getAll<LanguageModelAssignmentRow>(
    configDb,
    "select usage_key, provider_id, model, updated_at from language_model_assignments"
  );
}

export function resolveLanguageModelProvider(usageKey: LanguageModelUsageKey) {
  const providers = orderedLanguageModelProviders();
  const assignments = languageModelAssignmentRows();
  const assignment = assignments.find((row) => row.usage_key === usageKey) ?? null;
  const globalAssignment = assignments.find((row) => row.usage_key === LANGUAGE_MODEL_GLOBAL_DEFAULT_KEY) ?? null;
  return resolveLanguageModelFromRows(providers, assignment, globalAssignment).provider;
}

function publicLanguageModelAssignments() {
  const providers = orderedLanguageModelProviders();
  const assignmentByUsageKey = new Map(languageModelAssignmentRows().map((row) => [row.usage_key, row]));
  const globalAssignment = assignmentByUsageKey.get(LANGUAGE_MODEL_GLOBAL_DEFAULT_KEY) ?? null;
  const globalResolution = resolveGlobalLanguageModelFromRows(providers, globalAssignment);
  const defaultProvider = globalResolution.provider;
  return {
    globalDefault: {
      providerId: globalAssignment?.provider_id ?? defaultProvider?.id ?? "",
      model: globalAssignment?.model ?? defaultProvider?.model ?? "",
      status: globalResolution.status,
      resolvedProviderId: defaultProvider?.id ?? "",
      resolvedProviderName: defaultProvider?.name ?? "",
      resolvedModel: defaultProvider?.model ?? "",
      updatedAt: globalAssignment?.updated_at ?? ""
    },
    defaultProvider: defaultProvider
      ? {
          providerId: defaultProvider.id,
          providerName: defaultProvider.name,
          model: defaultProvider.model
        }
      : null,
    assignments: LANGUAGE_MODEL_USAGE_KEYS.map((usageKey) => {
      const assignment = assignmentByUsageKey.get(usageKey) ?? null;
      const resolution = resolveLanguageModelFromRows(providers, assignment, globalAssignment);
      return {
        usageKey,
        providerId: assignment?.provider_id ?? "",
        model: assignment?.model ?? "",
        status: resolution.status,
        resolvedProviderId: resolution.provider?.id ?? "",
        resolvedProviderName: resolution.provider?.name ?? "",
        resolvedModel: resolution.provider?.model ?? "",
        updatedAt: assignment?.updated_at ?? ""
      };
    })
  };
}

function preservedLanguageModelSelection(
  assignment: LanguageModelAssignmentRow | null | undefined,
  providerId: string,
  model: string
) {
  return Boolean(
    assignment
    && assignment.provider_id === providerId
    && assignment.model === model
  );
}

export function normalizeLanguageModelDefaultFromRows(
  input: unknown,
  providers: PromptOptimizerProviderRow[],
  existingAssignment?: LanguageModelAssignmentRow | null
) {
  if (!input || typeof input !== "object") throw new Error("请选择全局默认模型");
  const record = input as Record<string, unknown>;
  const providerId = String(record.providerId ?? "").trim();
  const model = String(record.model ?? "").trim();
  if (!providerId || !model) throw new Error("请选择全局默认模型");
  const provider = providers.find((item) => item.id === providerId);
  if (!provider && !preservedLanguageModelSelection(existingAssignment, providerId, model)) {
    throw new Error("全局默认模型选择的供应商不存在");
  }
  if (provider && !provider.enabled && !preservedLanguageModelSelection(existingAssignment, providerId, model)) {
    throw new Error("全局默认模型选择的供应商未启用");
  }
  if (model.length > 256) throw new Error("全局默认模型名称过长");
  return { usageKey: LANGUAGE_MODEL_GLOBAL_DEFAULT_KEY, providerId, model };
}

export function normalizeLanguageModelAssignmentsFromRows(
  input: unknown,
  providers: PromptOptimizerProviderRow[],
  existingAssignments: LanguageModelAssignmentRow[] = []
) {
  if (!Array.isArray(input)) throw new Error("场景分配格式无效");
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const existingAssignmentByUsageKey = new Map(existingAssignments.map((assignment) => [assignment.usage_key, assignment]));
  const seen = new Set<LanguageModelUsageKey>();
  const assignments: Array<{ usageKey: LanguageModelUsageKey; providerId: string; model: string }> = [];

  for (const item of input) {
    if (!item || typeof item !== "object") throw new Error("场景分配格式无效");
    const record = item as Record<string, unknown>;
    const usageKey = String(record.usageKey ?? "").trim();
    if (!isLanguageModelUsageKey(usageKey)) throw new Error(`未知的模型使用场景：${usageKey || "空"}`);
    if (seen.has(usageKey)) throw new Error(`模型使用场景重复：${usageKey}`);
    seen.add(usageKey);

    const providerId = String(record.providerId ?? "").trim();
    const model = String(record.model ?? "").trim();
    if (!providerId && !model) continue;
    if (!providerId || !model) throw new Error(`场景「${usageKey}」必须同时选择供应商和模型`);
    const provider = providerById.get(providerId);
    const preservesExisting = preservedLanguageModelSelection(existingAssignmentByUsageKey.get(usageKey), providerId, model);
    if (!provider && !preservesExisting) throw new Error(`场景「${usageKey}」选择的供应商不存在`);
    if (provider && !provider.enabled && !preservesExisting) throw new Error(`场景「${usageKey}」选择的供应商未启用`);
    if (model.length > 256) throw new Error(`场景「${usageKey}」的模型名称过长`);
    assignments.push({ usageKey, providerId, model });
  }
  return assignments;
}

export function registerLanguageModelAssignmentRoutes(api: Hono) {
  api.get("/config/language-model-assignments", (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    return c.json(publicLanguageModelAssignments());
  });

  api.put("/config/language-model-assignments", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const body = await c.req.json().catch(() => ({}));
    try {
      const providers = orderedLanguageModelProviders();
      const existingAssignments = languageModelAssignmentRows();
      const globalDefault = normalizeLanguageModelDefaultFromRows(
        (body as Record<string, unknown>).globalDefault,
        providers,
        existingAssignments.find((assignment) => assignment.usage_key === LANGUAGE_MODEL_GLOBAL_DEFAULT_KEY)
      );
      const assignments = normalizeLanguageModelAssignmentsFromRows(
        (body as Record<string, unknown>).assignments,
        providers,
        existingAssignments
      );
      const timestamp = now();
      const save = configDb.transaction(() => {
        run(configDb, "delete from language_model_assignments");
        for (const assignment of [globalDefault, ...assignments]) {
          run(
            configDb,
            `insert into language_model_assignments (usage_key, provider_id, model, updated_at)
             values (?, ?, ?, ?)`,
            assignment.usageKey,
            assignment.providerId,
            assignment.model,
            timestamp
          );
        }
      });
      save();
      audit("language_model_assignments.save", {
        count: assignments.length,
        defaultProviderId: globalDefault.providerId,
        defaultModel: globalDefault.model
      });
      return c.json(publicLanguageModelAssignments());
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "场景分配保存失败" }, 400);
    }
  });
}
