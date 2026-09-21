import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ProviderRow } from "./types";
import { normalizeIdList, now, safeJson } from "./utils";

export type ProviderModelCatalog = {
  endpoint: string;
  durationMs: number;
  models: string[];
  imageModels: string[];
  responsesModels: string[];
};

type ProviderModelCatalogCacheRow = {
  provider_id: string;
  connection_signature: string;
  endpoint: string;
  duration_ms: number;
  models_json: string;
  image_models_json: string;
  responses_models_json: string;
  updated_at: string;
};

export function providerModelCatalogConnectionSignature(provider: ProviderRow) {
  const apiKeyEnv = provider.api_key_env ?? "";
  const effectiveApiKey = provider.api_key_value || (apiKeyEnv ? Bun.env[apiKeyEnv] ?? "" : "");
  return createHash("sha256")
    .update(JSON.stringify({
      channel: provider.channel,
      baseUrl: provider.base_url,
      apiKeyEnv,
      apiKeyValue: effectiveApiKey,
      generationPath: provider.generation_path,
      editPath: provider.edit_path,
      responsesPath: provider.responses_path,
      proxyEnabled: provider.proxy_enabled,
      webAccountId: provider.web_account_id,
      webAccountIds: normalizeIdList(provider.web_account_ids),
      webCookies: provider.web_cookies ?? ""
    }))
    .digest("hex");
}

export function readProviderModelCatalogCache(db: Database, provider: ProviderRow) {
  const row = db
    .query("select * from provider_model_catalogs where provider_id = ?")
    .get(provider.id) as ProviderModelCatalogCacheRow | null;
  if (!row || row.connection_signature !== providerModelCatalogConnectionSignature(provider)) return null;
  return {
    endpoint: row.endpoint,
    durationMs: row.duration_ms,
    models: normalizeIdList(safeJson<unknown>(row.models_json, [])),
    imageModels: normalizeIdList(safeJson<unknown>(row.image_models_json, [])),
    responsesModels: normalizeIdList(safeJson<unknown>(row.responses_models_json, [])),
    cachedAt: row.updated_at
  };
}

export function writeProviderModelCatalogCache(
  db: Database,
  provider: ProviderRow,
  catalog: ProviderModelCatalog
) {
  const timestamp = now();
  db.query(
    `insert into provider_model_catalogs (
      provider_id, connection_signature, endpoint, duration_ms,
      models_json, image_models_json, responses_models_json, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(provider_id) do update set
      connection_signature = excluded.connection_signature,
      endpoint = excluded.endpoint,
      duration_ms = excluded.duration_ms,
      models_json = excluded.models_json,
      image_models_json = excluded.image_models_json,
      responses_models_json = excluded.responses_models_json,
      updated_at = excluded.updated_at`
  ).run(
    provider.id,
    providerModelCatalogConnectionSignature(provider),
    catalog.endpoint,
    catalog.durationMs,
    JSON.stringify(catalog.models),
    JSON.stringify(catalog.imageModels),
    JSON.stringify(catalog.responsesModels),
    timestamp
  );
  return { ...catalog, cachedAt: timestamp };
}
