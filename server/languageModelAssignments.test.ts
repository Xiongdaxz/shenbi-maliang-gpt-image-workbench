import { describe, expect, test } from "bun:test";
import {
  defaultLanguageModelProviderFromRows,
  normalizeLanguageModelDefaultFromRows,
  normalizeLanguageModelAssignmentsFromRows,
  resolveGlobalLanguageModelFromRows,
  resolveLanguageModelFromRows,
  type LanguageModelAssignmentRow
} from "./languageModelAssignments";
import type { PromptOptimizerProviderRow } from "./promptOptimizerRoutes";

function provider(input: Partial<PromptOptimizerProviderRow> & Pick<PromptOptimizerProviderRow, "id" | "name" | "model">): PromptOptimizerProviderRow {
  return {
    id: input.id,
    name: input.name,
    enabled: input.enabled ?? 1,
    base_url: input.base_url ?? "https://example.com",
    endpoint_path: input.endpoint_path ?? "/chat/completions",
    api_key_env: input.api_key_env ?? "TEST_KEY",
    api_key_value: input.api_key_value ?? "",
    model: input.model,
    models_json: input.models_json ?? "[]",
    availability_status: input.availability_status ?? "normal",
    availability_error: input.availability_error ?? "",
    availability_checked_at: input.availability_checked_at ?? "",
    stream_enabled: input.stream_enabled ?? 0,
    thinking_enabled: input.thinking_enabled ?? 1,
    temperature: input.temperature ?? null,
    max_tokens: input.max_tokens ?? 0,
    retry_count: input.retry_count ?? 2,
    sort_order: input.sort_order ?? 100,
    created_at: input.created_at ?? "2026-07-26T00:00:00.000",
    updated_at: input.updated_at ?? "2026-07-26T00:00:00.000"
  };
}

function assignment(input: Partial<LanguageModelAssignmentRow> = {}): LanguageModelAssignmentRow {
  return {
    usage_key: input.usage_key ?? "prompt.optimize",
    provider_id: input.provider_id ?? "deepseek",
    model: input.model ?? "deepseek-v4-pro",
    updated_at: input.updated_at ?? "2026-07-26T00:00:00.000"
  };
}

const providers = [
  provider({ id: "disabled", name: "Disabled", model: "disabled-model", enabled: 0, sort_order: 10 }),
  provider({ id: "deepseek", name: "DeepSeek", model: "deepseek-v4-flash", sort_order: 20 }),
  provider({ id: "other", name: "Other", model: "other-default", sort_order: 30 })
];

describe("language model assignment resolution", () => {
  test("uses the first enabled provider when no assignment exists", () => {
    expect(defaultLanguageModelProviderFromRows(providers)?.id).toBe("deepseek");
    const result = resolveLanguageModelFromRows(providers, null);
    expect(result.status).toBe("inherited");
    expect(result.provider?.id).toBe("deepseek");
    expect(result.provider?.model).toBe("deepseek-v4-flash");
  });

  test("overrides only the assigned provider model", () => {
    const result = resolveLanguageModelFromRows(
      providers,
      assignment(),
      assignment({ usage_key: "global.default", provider_id: "other", model: "other-global" })
    );
    expect(result.status).toBe("configured");
    expect(result.provider?.id).toBe("deepseek");
    expect(result.provider?.model).toBe("deepseek-v4-pro");
    expect(result.provider?.base_url).toBe("https://example.com");
  });

  test("uses the selected global model for inherited scenarios", () => {
    const globalAssignment = assignment({ usage_key: "global.default", provider_id: "other", model: "other-global" });
    const globalResult = resolveGlobalLanguageModelFromRows(providers, globalAssignment);
    expect(globalResult.status).toBe("configured");
    expect(globalResult.provider?.id).toBe("other");
    expect(globalResult.provider?.model).toBe("other-global");

    const inherited = resolveLanguageModelFromRows(providers, null, globalAssignment);
    expect(inherited.status).toBe("inherited");
    expect(inherited.provider?.id).toBe("other");
    expect(inherited.provider?.model).toBe("other-global");
  });

  test("falls back without rewriting invalid assignments", () => {
    const globalAssignment = assignment({ usage_key: "global.default", provider_id: "other", model: "other-global" });
    for (const invalid of [
      assignment({ provider_id: "missing" }),
      assignment({ provider_id: "disabled" }),
      assignment({ model: "" })
    ]) {
      const result = resolveLanguageModelFromRows(providers, invalid, globalAssignment);
      expect(result.status).toBe("invalid");
      expect(result.provider?.id).toBe("other");
      expect(result.provider?.model).toBe("other-global");
    }
  });

  test("falls back to the first enabled provider when the global selection is invalid", () => {
    const result = resolveGlobalLanguageModelFromRows(
      providers,
      assignment({ usage_key: "global.default", provider_id: "missing", model: "missing-model" })
    );
    expect(result.status).toBe("invalid");
    expect(result.provider?.id).toBe("deepseek");
    expect(result.provider?.model).toBe("deepseek-v4-flash");
  });

  test("returns no provider when neither assignment nor fallback is usable", () => {
    const result = resolveLanguageModelFromRows(
      [provider({ id: "disabled", name: "Disabled", model: "disabled-model", enabled: 0 })],
      assignment({ provider_id: "missing" })
    );
    expect(result.status).toBe("invalid");
    expect(result.provider).toBeNull();
  });
});

describe("language model assignment validation", () => {
  test("validates the selected global provider and keeps its model", () => {
    expect(normalizeLanguageModelDefaultFromRows(
      { providerId: "deepseek", model: "deepseek-v4-pro" },
      providers
    )).toEqual({ usageKey: "global.default", providerId: "deepseek", model: "deepseek-v4-pro" });
    expect(() => normalizeLanguageModelDefaultFromRows(null, providers)).toThrow("请选择全局默认模型");
    expect(() => normalizeLanguageModelDefaultFromRows(
      { providerId: "disabled", model: "disabled-model" },
      providers
    )).toThrow("供应商未启用");
  });

  test("keeps explicit manual models and removes inherited rows", () => {
    expect(normalizeLanguageModelAssignmentsFromRows([
      { usageKey: "prompt.optimize", providerId: "deepseek", model: "future-model" },
      { usageKey: "title.chat", providerId: "", model: "" }
    ], providers)).toEqual([
      { usageKey: "prompt.optimize", providerId: "deepseek", model: "future-model" }
    ]);
  });

  test("preserves an existing invalid selection but rejects a newly injected invalid selection", () => {
    const disabledAssignment = assignment({ usage_key: "prompt.optimize", provider_id: "disabled", model: "disabled-model" });
    expect(normalizeLanguageModelAssignmentsFromRows([
      { usageKey: "prompt.optimize", providerId: "disabled", model: "disabled-model" }
    ], providers, [disabledAssignment])).toEqual([
      { usageKey: "prompt.optimize", providerId: "disabled", model: "disabled-model" }
    ]);
    expect(normalizeLanguageModelDefaultFromRows(
      { providerId: "missing", model: "retired-model" },
      providers,
      assignment({ usage_key: "global.default", provider_id: "missing", model: "retired-model" })
    )).toEqual({ usageKey: "global.default", providerId: "missing", model: "retired-model" });
    expect(() => normalizeLanguageModelAssignmentsFromRows([
      { usageKey: "title.chat", providerId: "disabled", model: "disabled-model" }
    ], providers, [disabledAssignment])).toThrow("供应商未启用");
  });

  test("rejects unknown, incomplete, disabled, and duplicate assignments", () => {
    expect(() => normalizeLanguageModelAssignmentsFromRows([
      { usageKey: "unknown", providerId: "deepseek", model: "model" }
    ], providers)).toThrow("未知的模型使用场景");
    expect(() => normalizeLanguageModelAssignmentsFromRows([
      { usageKey: "prompt.optimize", providerId: "deepseek", model: "" }
    ], providers)).toThrow("必须同时选择供应商和模型");
    expect(() => normalizeLanguageModelAssignmentsFromRows([
      { usageKey: "prompt.optimize", providerId: "disabled", model: "model" }
    ], providers)).toThrow("供应商未启用");
    expect(() => normalizeLanguageModelAssignmentsFromRows([
      { usageKey: "prompt.optimize", providerId: "deepseek", model: "one" },
      { usageKey: "prompt.optimize", providerId: "deepseek", model: "two" }
    ], providers)).toThrow("模型使用场景重复");
  });
});
