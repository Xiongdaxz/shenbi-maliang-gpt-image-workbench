import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { ProviderRow } from "./types";
import {
  providerModelCatalogConnectionSignature,
  readProviderModelCatalogCache,
  writeProviderModelCatalogCache
} from "./providerModelCache";

function provider(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: "provider-1",
    name: "Provider",
    type: "openai-compatible",
    channel: "cpa",
    enabled: 1,
    base_url: "http://127.0.0.1:8317",
    api_key_env: "GPT_IMAGE_API_KEY",
    api_key_value: "secret-key",
    route_mode: "auto",
    generation_path: "/v1/images/generations",
    edit_path: "/v1/images/edits",
    responses_path: "/v1/responses",
    model: "gpt-image-2.5-sunburst",
    responses_model: "gpt-5.6-luna",
    sizes: "[]",
    qualities: "[]",
    default_size: "auto",
    default_quality: "auto",
    response_image_path: "data[0].b64_json",
    proxy_enabled: 0,
    quota_mode: "codex_first",
    fallback_to_conversation: 0,
    web_account_id: "",
    web_account_ids: "[]",
    web_account_mode: "priority",
    web_cookies: "",
    created_at: "2026-09-21T00:00:00.000",
    updated_at: "2026-09-21T00:00:00.000",
    ...overrides
  };
}

describe("provider model catalog cache", () => {
  test("persists a catalog without exposing credentials and invalidates when the connection changes", () => {
    const db = new Database(":memory:");
    db.exec(`
      create table provider_model_catalogs (
        provider_id text primary key,
        connection_signature text not null,
        endpoint text not null,
        duration_ms integer not null,
        models_json text not null,
        image_models_json text not null,
        responses_models_json text not null,
        updated_at text not null
      )
    `);
    const current = provider();
    const signature = providerModelCatalogConnectionSignature(current);
    expect(signature).not.toContain("secret-key");

    writeProviderModelCatalogCache(db, current, {
      endpoint: "http://127.0.0.1:8317/v1/models",
      durationMs: 42,
      models: ["gpt-5.6-luna", "gpt-image-2.5-sunburst"],
      imageModels: ["gpt-image-2.5-sunburst"],
      responsesModels: ["gpt-5.6-luna"]
    });

    expect(readProviderModelCatalogCache(db, current)).toEqual(expect.objectContaining({
      durationMs: 42,
      imageModels: ["gpt-image-2.5-sunburst"],
      responsesModels: ["gpt-5.6-luna"]
    }));
    expect(readProviderModelCatalogCache(db, provider({ base_url: "http://127.0.0.1:9999" }))).toBeNull();
    db.close();
  });

  test("invalidates when the effective environment API key changes", () => {
    const envName = "PROVIDER_MODEL_CACHE_TEST_KEY";
    const previous = Bun.env[envName];
    try {
      Bun.env[envName] = "first-key";
      const fromEnvironment = provider({ api_key_env: envName, api_key_value: "" });
      const first = providerModelCatalogConnectionSignature(fromEnvironment);
      Bun.env[envName] = "second-key";
      expect(providerModelCatalogConnectionSignature(fromEnvironment)).not.toBe(first);
    } finally {
      if (previous === undefined) delete Bun.env[envName];
      else Bun.env[envName] = previous;
    }
  });
});
