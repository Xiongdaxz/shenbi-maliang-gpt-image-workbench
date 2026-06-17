import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_QUALITIES,
  DEFAULT_IMAGE_SIZES,
  DEFAULT_REQUEST_SIZE,
  DEFAULT_RESPONSES_MODEL,
  STUDIO_BACKEND_BASE_URL
} from "./constants";
import {
  UNCATEGORIZED_CASE_CATEGORY_ID,
  UNCATEGORIZED_CASE_CATEGORY_NAME,
  UNCATEGORIZED_CASE_CATEGORY_SLUG,
  defaultTeamId,
  makeCategorySlug
} from "./categories";
import { imageEditMaskDebugEnabled } from "./configFile";
import { appDb, configDb, getAll, getOne, run, tableColumnExists } from "./db";
import { DEFAULT_GLOBAL_SWITCH_ENABLED, GLOBAL_SWITCH_TYPES, type GlobalSwitchType } from "./globalSwitches";
import { readImageDimensions } from "./imageDimensions";
import { absoluteDataPath } from "./paths";
import { decryptBuffer } from "./secureFiles";
import type { ProviderRow } from "./types";
import { makeId, makeProviderConfigId, normalizeProviderChannel, now } from "./utils";

function tableExists(db: Database, table: string) {
  return Boolean(getOne<{ name: string }>(db, "select name from sqlite_master where type = 'table' and name = ?", table));
}

function globalSwitchDefaultFromLegacy(type: GlobalSwitchType) {
  if (type === "self_registration" && tableExists(configDb, "registration_settings")) {
    return getOne<{ enabled: number }>(configDb, "select enabled from registration_settings where id = ? limit 1", "default")?.enabled ?? 0;
  }
  if (type === "asset_review" || type === "case_review") return DEFAULT_GLOBAL_SWITCH_ENABLED[type] ? 1 : 0;
  if (type === "starter_copy_generation" && tableExists(configDb, "starter_copy_settings")) {
    return getOne<{ enabled: number }>(configDb, "select enabled from starter_copy_settings where id = ? limit 1", "default")?.enabled ?? 1;
  }
  if (type === "prompt_safety_review" && tableExists(configDb, "safety_review_settings")) {
    return getOne<{ enabled: number }>(configDb, "select enabled from safety_review_settings where id = ? limit 1", "default")?.enabled ?? 0;
  }
  if (type === "smtp_service" && tableExists(configDb, "smtp_settings")) {
    return getOne<{ enabled: number }>(configDb, "select enabled from smtp_settings where id = ? limit 1", "default")?.enabled ?? 0;
  }
  if (type === "sms_service" && tableExists(configDb, "sms_settings")) {
    return getOne<{ enabled: number }>(configDb, "select enabled from sms_settings where id = ? limit 1", "default")?.enabled ?? 0;
  }
  if (type === "proxy_service" && tableExists(configDb, "proxy_settings")) {
    return getOne<{ enabled: number }>(configDb, "select enabled from proxy_settings where id = ? limit 1", "default")?.enabled ?? 0;
  }
  if (type === "cpa_sync" && tableExists(configDb, "cpa_accounts")) {
    return getOne<{ enabled: number }>(configDb, "select enabled from cpa_accounts order by updated_at desc limit 1")?.enabled ?? 0;
  }
  if (type === "debug_image_edit_mask" && tableExists(configDb, "debug_settings")) {
    return getOne<{ image_edit_mask: number }>(configDb, "select image_edit_mask from debug_settings where id = ? limit 1", "default")?.image_edit_mask ?? 0;
  }
  return DEFAULT_GLOBAL_SWITCH_ENABLED[type] ? 1 : 0;
}

function initGlobalSwitchSettings() {
  configDb.run(`
    create table if not exists global_switch_settings (
      type text primary key,
      enabled integer not null default 1,
      updated_at text not null
    )
  `);

  const timestamp = now();
  for (const type of GLOBAL_SWITCH_TYPES) {
    run(
      configDb,
      "insert or ignore into global_switch_settings (type, enabled, updated_at) values (?, ?, ?)",
      type,
      globalSwitchDefaultFromLegacy(type),
      timestamp
    );
  }
  configDb.run("drop table if exists registration_settings");
}

function migratePromptOptimizerTemperatureNullable() {
  if (!tableExists(configDb, "prompt_optimizer_providers")) return;
  const columns = getAll<{ name: string; notnull: number; dflt_value: string | null }>(
    configDb,
    "pragma table_info(prompt_optimizer_providers)"
  );
  const temperature = columns.find((column) => column.name === "temperature");
  if (!temperature || (Number(temperature.notnull) === 0 && !String(temperature.dflt_value ?? "").includes("0.7"))) return;

  configDb.run("drop table if exists prompt_optimizer_providers_next");
  configDb.run(`
    create table prompt_optimizer_providers_next (
      id text primary key,
      name text not null,
      enabled integer not null default 0,
      base_url text not null default 'https://api.deepseek.com',
      endpoint_path text not null default '/chat/completions',
      api_key_env text not null default 'DEEPSEEK_API_KEY',
      api_key_value text not null default '',
      model text not null default 'deepseek-chat',
      models_json text not null default '[]',
      availability_status text not null default 'unknown',
      availability_error text not null default '',
      availability_checked_at text not null default '',
      stream_enabled integer not null default 0,
      thinking_enabled integer not null default 1,
      temperature real,
      max_tokens integer not null default 0,
      retry_count integer not null default 2,
      sort_order integer not null default 100,
      created_at text not null,
      updated_at text not null
    )
  `);
  run(
    configDb,
    `insert into prompt_optimizer_providers_next (
      id, name, enabled, base_url, endpoint_path, api_key_env, api_key_value,
      model, models_json, availability_status, availability_error, availability_checked_at,
      stream_enabled, thinking_enabled, temperature, max_tokens, retry_count, sort_order, created_at, updated_at
    )
    select
      id, name, enabled, base_url, endpoint_path, api_key_env, api_key_value,
      model, models_json, availability_status, availability_error, availability_checked_at,
      stream_enabled, thinking_enabled,
      case when temperature = 0.7 then null else temperature end,
      max_tokens, retry_count, sort_order, created_at, updated_at
    from prompt_optimizer_providers`
  );
  configDb.run("drop table prompt_optimizer_providers");
  configDb.run("alter table prompt_optimizer_providers_next rename to prompt_optimizer_providers");
}

function migrateStudioSettingsToChatGptProvider() {
  if (!tableExists(configDb, "studio_settings")) return;
  const row = getOne<{
    enabled: number;
    base_url: string;
    access_token: string;
    cookies: string;
    account_id: string;
    image_model: string;
    sizes: string;
    qualities: string;
    default_size: string;
    default_quality: string;
    updated_at: string;
  }>(configDb, "select * from studio_settings where id = ? limit 1", "default");
  if (!row) {
    configDb.run("drop table if exists studio_settings");
    return;
  }

  const timestamp = row.updated_at || now();
  const existing =
    getOne<ProviderRow>(configDb, "select * from provider_configs where id = ?", "default-chatgpt-web") ??
    getOne<ProviderRow>(configDb, "select * from provider_configs where channel = ? order by created_at asc limit 1", "chatgpt_web");
  if (!existing) {
    run(
      configDb,
      `insert into provider_configs (
        id, name, type, channel, enabled, base_url, api_key_env, api_key_value,
        route_mode, generation_path, edit_path, responses_path, model, responses_model,
        sizes, qualities, default_size, default_quality, response_image_path,
        proxy_enabled, quota_mode, fallback_to_conversation, web_account_id, web_account_ids, web_account_mode, web_cookies,
        created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "default-chatgpt-web",
      "ChatGPT 官网",
      "chatgpt-web",
      "chatgpt_web",
      row.enabled ? 1 : 0,
      row.base_url || STUDIO_BACKEND_BASE_URL,
      "",
      row.access_token || "",
      "images_api",
      "/f/conversation",
      "/f/conversation",
      "/codex/responses",
      row.image_model || DEFAULT_IMAGE_MODEL,
      DEFAULT_RESPONSES_MODEL,
      row.sizes || JSON.stringify(DEFAULT_IMAGE_SIZES),
      row.qualities || JSON.stringify(DEFAULT_IMAGE_QUALITIES),
      row.default_size || DEFAULT_REQUEST_SIZE,
      row.default_quality || "high",
      "data[0].b64_json",
      1,
      "codex_first",
      1,
      row.account_id || "",
      "[]",
      "priority",
      row.cookies || "",
      timestamp,
      timestamp
    );
    configDb.run("drop table if exists studio_settings");
    return;
  }

  if (!existing.api_key_value && !existing.web_cookies && !existing.web_account_id) {
    run(
      configDb,
      `update provider_configs set
        enabled = ?, base_url = ?, api_key_value = ?, web_account_id = ?, web_cookies = ?,
        sizes = ?, qualities = ?, default_size = ?, default_quality = ?, updated_at = ?
       where id = ?`,
      row.enabled ? 1 : existing.enabled,
      row.base_url || existing.base_url || STUDIO_BACKEND_BASE_URL,
      row.access_token || existing.api_key_value || "",
      row.account_id || existing.web_account_id || "",
      row.cookies || existing.web_cookies || "",
      row.sizes || existing.sizes,
      row.qualities || existing.qualities,
      row.default_size || existing.default_size,
      row.default_quality || existing.default_quality,
      timestamp,
      existing.id
    );
  }
  configDb.run("drop table if exists studio_settings");
}

const LEGACY_PROVIDER_NAMES = new Set([
  "新的图片接口",
  "新的官网渠道",
  "新的 CPA 渠道",
  "新的 API 渠道",
  "本地图像接口",
  "CPA 额度代理",
  "ChatGPT 官网",
  "API 直连",
  "default-cpa",
  "default-chatgpt-web",
  "default-api"
]);

function providerDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function isLegacyProviderId(id: string) {
  const normalized = id.trim();
  return (
    normalized === "local-gpt-image" ||
    /^default-(cpa|chatgpt-web|api)$/.test(normalized) ||
    /^provider(?:-id)?[-_]/.test(normalized)
  );
}

function isLegacyProviderName(name: string) {
  const normalized = name.trim();
  return LEGACY_PROVIDER_NAMES.has(normalized) || /^(CPA|API|CHATGPT-WEB)-\d{12}$/.test(normalized);
}

function uniqueProviderConfigId(channel: string, createdAt: string, currentId = "") {
  const usedIds = new Set(
    getAll<{ id: string }>(configDb, "select id from provider_configs")
      .map((row) => row.id)
      .filter((id) => id !== currentId)
  );
  const date = providerDate(createdAt);
  for (let index = 0; index < 1440; index += 1) {
    const id = makeProviderConfigId(channel, date);
    if (!usedIds.has(id)) return id;
    date.setMinutes(date.getMinutes() + 1);
  }
  return makeProviderConfigId(channel);
}

function moveProviderReferences(fromId: string, toId: string) {
  if (fromId === toId) return;
  if (tableExists(configDb, "image_accounts")) {
    run(configDb, "update image_accounts set channel_id = ? where channel_id = ?", toId, fromId);
  }
  if (tableExists(configDb, "provider_request_logs")) {
    run(configDb, "update provider_request_logs set provider_id = ? where provider_id = ?", toId, fromId);
  }
  if (tableExists(appDb, "image_jobs")) {
    run(appDb, "update image_jobs set provider_id = ? where provider_id = ?", toId, fromId);
  }
  if (tableExists(appDb, "images")) {
    run(appDb, "update images set provider_id = ? where provider_id = ?", toId, fromId);
  }
}

function isSeedCpaProvider(provider: ProviderRow) {
  return (
    provider.id === "default-cpa" &&
    provider.name === "CPA 额度代理" &&
    normalizeProviderChannel(provider.channel) === "cpa" &&
    provider.base_url === "http://127.0.0.1:8317" &&
    provider.api_key_env === "GPT_IMAGE_API_KEY" &&
    !provider.api_key_value
  );
}

function mergeLegacyCpaSeed() {
  const localProvider = getOne<ProviderRow>(configDb, "select * from provider_configs where id = ?", "local-gpt-image");
  const seededProvider = getOne<ProviderRow>(configDb, "select * from provider_configs where id = ?", "default-cpa");
  if (!localProvider || !seededProvider || !isSeedCpaProvider(seededProvider)) return;
  moveProviderReferences(seededProvider.id, localProvider.id);
  run(configDb, "delete from provider_configs where id = ?", seededProvider.id);
}

function migrateReadableProviderIds() {
  mergeLegacyCpaSeed();
  const providers = getAll<ProviderRow>(configDb, "select * from provider_configs order by created_at asc");
  for (const provider of providers) {
    if (!isLegacyProviderId(provider.id)) continue;
    const channel = normalizeProviderChannel(provider.channel);
    const nextId = uniqueProviderConfigId(channel, provider.created_at, provider.id);
    const nextName = isLegacyProviderName(provider.name) ? nextId : provider.name;
    if (nextId !== provider.id) {
      moveProviderReferences(provider.id, nextId);
      run(
        configDb,
        "update provider_configs set id = ?, name = ?, updated_at = ? where id = ?",
        nextId,
        nextName,
        now(),
        provider.id
      );
      continue;
    }
    if (nextName !== provider.name) {
      run(configDb, "update provider_configs set name = ?, updated_at = ? where id = ?", nextName, now(), provider.id);
    }
  }
}

function backfillImageDimensions() {
  const rows = getAll<{ id: string; path: string }>(
    appDb,
    "select id, path from images where (image_width <= 0 or image_height <= 0 or image_file_size <= 0) and path not like 'files/secure/%'"
  );
  for (const row of rows) {
    try {
      const buffer = readFileSync(absoluteDataPath(row.path));
      const dimensions = readImageDimensions(buffer);
      run(appDb, "update images set image_width = ?, image_height = ?, image_file_size = ? where id = ?", dimensions.width, dimensions.height, buffer.length, row.id);
    } catch {
      // Keep old records readable even when the local file has been removed.
    }
  }
}

function backfillAssetDimensions() {
  const rows = getAll<{ id: string; path: string }>(
    appDb,
    "select id, path from assets where (image_width <= 0 or image_height <= 0) and path not like 'files/secure/%'"
  );
  for (const row of rows) {
    try {
      const buffer = readFileSync(absoluteDataPath(row.path));
      const dimensions = readImageDimensions(buffer);
      run(appDb, "update assets set image_width = ?, image_height = ?, size = ? where id = ?", dimensions.width, dimensions.height, buffer.length, row.id);
    } catch {
      // Keep old asset records readable even when the local file has been removed.
    }
  }
}

function backfillAssetContentHashes() {
  const rows = getAll<{ id: string; path: string }>(
    appDb,
    "select id, path from assets where coalesce(content_hash, '') = ''"
  );
  for (const row of rows) {
    try {
      const buffer = decryptBuffer(readFileSync(absoluteDataPath(row.path)));
      const contentHash = createHash("sha256").update(buffer).digest("hex");
      run(appDb, "update assets set content_hash = ? where id = ?", contentHash, row.id);
    } catch {
      // Keep old records readable even when the local file has been removed.
    }
  }
}

function migrateAssetCategoryType() {
  const referencedCaseCategories = getAll<{ id: string; name: string; sort_order: number }>(
    appDb,
    `select distinct case_categories.id, case_categories.name, case_categories.sort_order
     from asset_categories
     join case_categories on case_categories.id = asset_categories.category_id
     where coalesce(case_categories.type, 'case') <> 'asset'`
  );
  for (const category of referencedCaseCategories) {
    let assetCategory = getOne<{ id: string }>(
      appDb,
      "select id from case_categories where type = 'asset' and lower(name) = lower(?)",
      category.name
    );
    if (!assetCategory) {
      const id = makeId("assetcat");
      run(
        appDb,
        "insert into case_categories (id, type, name, slug, sort_order) values (?, ?, ?, ?, ?)",
        id,
        "asset",
        category.name,
        makeCategorySlug(category.name, "asset"),
        category.sort_order
      );
      assetCategory = { id };
    }
    run(
      appDb,
      `insert or ignore into asset_categories (asset_id, category_id, created_at)
       select asset_id, ?, created_at from asset_categories where category_id = ?`,
      assetCategory.id,
      category.id
    );
    run(appDb, "delete from asset_categories where category_id = ?", category.id);
  }
}

export function initAppDb() {
  appDb.run("PRAGMA journal_mode = MEMORY");
  appDb.run("PRAGMA foreign_keys = ON");

  appDb.run(`
    create table if not exists teams (
      id text primary key,
      name text not null,
      description text not null default '',
      created_at text not null,
      updated_at text not null
    )
  `);

  appDb.run(`
    create table if not exists users (
      id text primary key,
      team_id text,
      account text not null default '',
      username text not null unique,
      email text not null default '',
      phone text not null default '',
      password_hash text not null,
      avatar_path text not null default '',
      avatar_mime_type text not null default '',
      appearance_mode text not null default 'system',
      disabled integer not null default 0,
      has_config_access integer not null default 0,
      email_verified_at text,
      phone_verified_at text,
      last_login_at text,
      created_at text not null,
      updated_at text not null,
      foreign key (team_id) references teams(id)
    )
  `);

  if (!tableColumnExists(appDb, "users", "team_id")) {
    appDb.run("alter table users add column team_id text");
  }
  if (!tableColumnExists(appDb, "users", "account")) {
    appDb.run("alter table users add column account text not null default ''");
  }
  if (!tableColumnExists(appDb, "users", "email")) {
    appDb.run("alter table users add column email text not null default ''");
  }
  if (!tableColumnExists(appDb, "users", "phone")) {
    appDb.run("alter table users add column phone text not null default ''");
  }
  if (!tableColumnExists(appDb, "users", "email_verified_at")) {
    appDb.run("alter table users add column email_verified_at text");
  }
  if (!tableColumnExists(appDb, "users", "phone_verified_at")) {
    appDb.run("alter table users add column phone_verified_at text");
  }
  if (!tableColumnExists(appDb, "users", "last_login_at")) {
    appDb.run("alter table users add column last_login_at text");
  }
  if (!tableColumnExists(appDb, "users", "has_config_access")) {
    appDb.run("alter table users add column has_config_access integer not null default 0");
  }
  if (!tableColumnExists(appDb, "users", "avatar_path")) {
    appDb.run("alter table users add column avatar_path text not null default ''");
  }
  if (!tableColumnExists(appDb, "users", "avatar_mime_type")) {
    appDb.run("alter table users add column avatar_mime_type text not null default ''");
  }
  if (!tableColumnExists(appDb, "users", "appearance_mode")) {
    appDb.run("alter table users add column appearance_mode text not null default 'system'");
  }
  run(
    appDb,
    "update users set appearance_mode = 'system' where appearance_mode not in ('system', 'dark', 'light', 'maliang')"
  );

  appDb.run(`
    create table if not exists user_preferences (
      user_id text primary key,
      edit_suggestions_enabled integer not null default 1,
      edit_suggestion_tone text not null default 'default',
      auto_upload_pasted_assets integer not null default 1,
      prompt_optimize_styles_json text not null default '',
      prompt_optimize_custom_instruction text not null default '',
      updated_at text not null,
      foreign key (user_id) references users(id)
    )
  `);
  if (!tableColumnExists(appDb, "user_preferences", "edit_suggestions_enabled")) {
    appDb.run("alter table user_preferences add column edit_suggestions_enabled integer not null default 1");
  }
  if (!tableColumnExists(appDb, "user_preferences", "edit_suggestion_tone")) {
    appDb.run("alter table user_preferences add column edit_suggestion_tone text not null default 'default'");
  }
  if (!tableColumnExists(appDb, "user_preferences", "auto_upload_pasted_assets")) {
    appDb.run("alter table user_preferences add column auto_upload_pasted_assets integer not null default 1");
  }
  if (!tableColumnExists(appDb, "user_preferences", "prompt_optimize_styles_json")) {
    appDb.run("alter table user_preferences add column prompt_optimize_styles_json text not null default ''");
  }
  if (!tableColumnExists(appDb, "user_preferences", "prompt_optimize_custom_instruction")) {
    appDb.run("alter table user_preferences add column prompt_optimize_custom_instruction text not null default ''");
  }
  run(
    appDb,
    "update user_preferences set edit_suggestion_tone = 'default' where edit_suggestion_tone not in ('default', 'practical', 'creative', 'detail')"
  );

  appDb.run(`
    create table if not exists user_auth_sessions (
      id text primary key,
      user_id text not null,
      expires_at text not null,
      created_at text not null,
      foreign key (user_id) references users(id)
    )
  `);

  appDb.run(`
    create table if not exists auth_verification_codes (
      id text primary key,
      purpose text not null,
      target_type text not null default 'email',
      target text not null,
      code_hash text not null,
      expires_at text not null,
      cooldown_until text not null default '',
      attempts integer not null default 0,
      send_count integer not null default 1,
      consumed_at text,
      created_at text not null,
      updated_at text not null
    )
  `);
  appDb.run("create index if not exists auth_verification_target_idx on auth_verification_codes(purpose, target_type, target, created_at desc)");
  run(
    appDb,
    `update users
     set last_login_at = (
       select max(created_at) from user_auth_sessions s where s.user_id = users.id
     )
     where (last_login_at is null or last_login_at = '')
       and exists (select 1 from user_auth_sessions s where s.user_id = users.id)`
  );

  appDb.run(`
    create table if not exists search_history (
      id text primary key,
      user_id text not null,
      scope text not null,
      keyword text not null,
      normalized_keyword text not null,
      searched_at text not null,
      created_at text not null,
      foreign key (user_id) references users(id)
    )
  `);
  appDb.run("create unique index if not exists search_history_user_scope_keyword_idx on search_history(user_id, scope, normalized_keyword)");
  appDb.run("create index if not exists search_history_user_scope_time_idx on search_history(user_id, scope, searched_at desc)");

  appDb.run(`
    create table if not exists starter_daily_copies (
      date text primary key,
      copies_json text not null default '[]',
      source text not null default 'ai',
      provider_name text not null default '',
      model text not null default '',
      status text not null default 'pending',
      error text not null default '',
      generated_at text not null default '',
      created_at text not null,
      updated_at text not null
    )
  `);
  appDb.run("create index if not exists starter_daily_copies_status_idx on starter_daily_copies(status, generated_at desc)");

  appDb.run(`
    create table if not exists sessions (
      id text primary key,
      user_id text not null,
      title text not null,
      title_status text not null default 'ready',
      pinned_at text,
      archived_at text,
      deleted_at text,
      created_at text not null,
      updated_at text not null,
      foreign key (user_id) references users(id)
    )
  `);
  if (!tableColumnExists(appDb, "sessions", "archived_at")) {
    appDb.run("alter table sessions add column archived_at text");
  }
  if (!tableColumnExists(appDb, "sessions", "title_status")) {
    appDb.run("alter table sessions add column title_status text not null default 'ready'");
  }
  if (!tableColumnExists(appDb, "sessions", "pinned_at")) {
    appDb.run("alter table sessions add column pinned_at text");
  }
  if (!tableColumnExists(appDb, "sessions", "deleted_at")) {
    appDb.run("alter table sessions add column deleted_at text");
  }
  appDb.run("create index if not exists sessions_user_archive_time_idx on sessions(user_id, archived_at, updated_at desc)");
  appDb.run("create index if not exists sessions_user_visible_time_idx on sessions(user_id, deleted_at, archived_at, updated_at desc)");
  appDb.run("drop index if exists sessions_user_active_pin_time_idx");
  appDb.run("create index if not exists sessions_user_active_pin_asc_time_idx on sessions(user_id, deleted_at, archived_at, pinned_at asc, updated_at desc)");

  appDb.run(`
    create table if not exists messages (
      id text primary key,
      session_id text not null,
      user_id text not null,
      role text not null,
      content text not null,
      image_id text,
      metadata text,
      created_at text not null,
      foreign key (session_id) references sessions(id),
      foreign key (user_id) references users(id)
    )
  `);
  appDb.run("create index if not exists messages_session_user_time_idx on messages(session_id, user_id, created_at)");
  appDb.run("create index if not exists messages_session_user_role_idx on messages(session_id, user_id, role)");

  appDb.run(`
    create table if not exists image_jobs (
      id text primary key,
      user_id text not null,
      session_id text,
      type text not null,
      status text not null,
      prompt text not null,
      source_image_ids text,
      provider_id text not null,
      error text,
      result_image_id text,
      request_json text,
      response_json text,
      auto_retry_count integer not null default 0,
      manual_retry_count integer not null default 0,
      max_auto_retries integer not null default 0,
      succeeded_on_retry integer not null default 0,
      created_at text not null,
      updated_at text not null,
      foreign key (user_id) references users(id)
    )
  `);
  appDb.run("create index if not exists image_jobs_session_user_status_time_idx on image_jobs(session_id, user_id, status, created_at)");
  for (const [column, definition] of [
    ["auto_retry_count", "integer not null default 0"],
    ["manual_retry_count", "integer not null default 0"],
    ["max_auto_retries", "integer not null default 0"],
    ["succeeded_on_retry", "integer not null default 0"]
  ] as const) {
    if (!tableColumnExists(appDb, "image_jobs", column)) {
      appDb.run(`alter table image_jobs add column ${column} ${definition}`);
    }
  }

  appDb.run(`
    create table if not exists images (
      id text primary key,
      user_id text not null,
      session_id text,
      job_id text,
      path text not null,
      prompt text not null,
      suggested_case_title text not null default '',
      suggested_case_category_ids_json text not null default '[]',
      suggested_asset_category_ids_json text not null default '[]',
      kind text not null,
      size text not null,
      quality text not null,
      provider_id text not null,
      mime_type text not null default 'image/png',
      parent_image_id text,
      provider_file_id text not null default '',
      provider_gen_id text not null default '',
      provider_conversation_id text not null default '',
      provider_parent_message_id text not null default '',
      provider_source_account_id text not null default '',
      image_width integer not null default 0,
      image_height integer not null default 0,
      image_file_size integer not null default 0,
      generated_attempt_no integer not null default 1,
      generated_by_retry integer not null default 0,
      created_at text not null,
      foreign key (user_id) references users(id)
    )
  `);

  if (!tableColumnExists(appDb, "images", "image_width")) {
    appDb.run("alter table images add column image_width integer not null default 0");
  }
  if (!tableColumnExists(appDb, "images", "image_height")) {
    appDb.run("alter table images add column image_height integer not null default 0");
  }
  if (!tableColumnExists(appDb, "images", "image_file_size")) {
    appDb.run("alter table images add column image_file_size integer not null default 0");
  }
  if (!tableColumnExists(appDb, "images", "generated_attempt_no")) {
    appDb.run("alter table images add column generated_attempt_no integer not null default 1");
  }
  if (!tableColumnExists(appDb, "images", "generated_by_retry")) {
    appDb.run("alter table images add column generated_by_retry integer not null default 0");
  }
  if (!tableColumnExists(appDb, "images", "mime_type")) {
    appDb.run("alter table images add column mime_type text not null default 'image/png'");
  }
  for (const [column, definition] of [
    ["suggested_case_title", "text not null default ''"],
    ["suggested_case_category_ids_json", "text not null default '[]'"],
    ["suggested_asset_category_ids_json", "text not null default '[]'"],
    ["provider_file_id", "text not null default ''"],
    ["provider_gen_id", "text not null default ''"],
    ["provider_conversation_id", "text not null default ''"],
    ["provider_parent_message_id", "text not null default ''"],
    ["provider_source_account_id", "text not null default ''"]
  ] as const) {
    if (!tableColumnExists(appDb, "images", column)) {
      appDb.run(`alter table images add column ${column} ${definition}`);
    }
  }
  backfillImageDimensions();

  appDb.run(`
    create table if not exists image_edit_suggestions (
      image_id text primary key,
      user_id text not null,
      suggestions_json text not null default '[]',
      preference_key text not null default 'default',
      created_at text not null,
      updated_at text not null,
      foreign key (image_id) references images(id),
      foreign key (user_id) references users(id)
    )
  `);
  if (!tableColumnExists(appDb, "image_edit_suggestions", "preference_key")) {
    appDb.run("alter table image_edit_suggestions add column preference_key text not null default 'default'");
  }
  appDb.run("create index if not exists idx_image_edit_suggestions_user on image_edit_suggestions(user_id)");

  appDb.run(`
    create table if not exists image_favorites (
      id text primary key,
      user_id text not null,
      image_id text not null,
      created_at text not null,
      foreign key (user_id) references users(id),
      foreign key (image_id) references images(id)
    )
  `);
  appDb.run("create unique index if not exists image_favorites_user_image_idx on image_favorites(user_id, image_id)");
  appDb.run("create index if not exists image_favorites_image_idx on image_favorites(image_id)");

  appDb.run(`
    create table if not exists image_asset_references (
      id text primary key,
      image_id text not null,
      user_id text not null,
      source_type text not null default '',
      source_id text,
      source_asset_id text,
      source_case_item_id text,
      source_name text not null,
      path text not null,
      mime_type text not null,
      size integer not null default 0,
      image_width integer not null default 0,
      image_height integer not null default 0,
      sort_order integer not null default 0,
      created_at text not null,
      foreign key (image_id) references images(id),
      foreign key (user_id) references users(id)
    )
  `);
  for (const [column, definition] of [
    ["source_type", "text not null default ''"],
    ["source_id", "text"],
    ["source_case_item_id", "text"]
  ] as const) {
    if (!tableColumnExists(appDb, "image_asset_references", column)) {
      appDb.run(`alter table image_asset_references add column ${column} ${definition}`);
    }
  }
  appDb.run(
    "update image_asset_references set source_type = 'asset', source_id = source_asset_id where source_type = '' and source_asset_id is not null"
  );
  appDb.run("create index if not exists image_asset_references_image_idx on image_asset_references(image_id)");
  appDb.run("create index if not exists image_asset_references_user_idx on image_asset_references(user_id)");

  appDb.run(`
    create table if not exists message_source_references (
      id text primary key,
      message_id text not null,
      job_id text,
      user_id text not null,
      source_type text not null,
      source_id text,
      source_case_item_id text,
      source_name text not null,
      path text not null,
      mime_type text not null,
      size integer not null default 0,
      image_width integer not null default 0,
      image_height integer not null default 0,
      sort_order integer not null default 0,
      created_at text not null,
      foreign key (message_id) references messages(id),
      foreign key (user_id) references users(id)
    )
  `);
  appDb.run("create index if not exists message_source_references_message_idx on message_source_references(message_id)");
  appDb.run("create index if not exists message_source_references_user_idx on message_source_references(user_id)");

  appDb.run(`
    create table if not exists image_derivatives (
      source_type text not null,
      source_id text not null,
      variant text not null,
      path text not null,
      mime_type text not null,
      size integer not null default 0,
      image_width integer not null default 0,
      image_height integer not null default 0,
      created_at text not null,
      updated_at text not null,
      primary key (source_type, source_id, variant)
    )
  `);
  appDb.run("create index if not exists image_derivatives_source_idx on image_derivatives(source_type, source_id)");

  appDb.run("drop table if exists asset_groups");

  appDb.run(`
    create table if not exists assets (
      id text primary key,
      user_id text not null,
      space text not null default 'private',
      shared integer not null default 0,
      share_status text not null default 'none',
      share_requested_at text,
      share_reviewed_at text,
      share_reviewed_by text not null default '',
      share_reject_reason text not null default '',
      name text not null,
      path text not null,
      mime_type text not null,
      size integer not null,
      content_hash text not null default '',
      image_width integer not null default 0,
      image_height integer not null default 0,
      created_at text not null,
      foreign key (user_id) references users(id)
    )
  `);

  if (!tableColumnExists(appDb, "assets", "space")) {
    appDb.run("alter table assets add column space text not null default 'private'");
  }
  if (!tableColumnExists(appDb, "assets", "shared")) {
    appDb.run("alter table assets add column shared integer not null default 0");
  }
  if (!tableColumnExists(appDb, "assets", "share_status")) {
    appDb.run("alter table assets add column share_status text not null default 'none'");
  }
  if (!tableColumnExists(appDb, "assets", "share_requested_at")) {
    appDb.run("alter table assets add column share_requested_at text");
  }
  if (!tableColumnExists(appDb, "assets", "share_reviewed_at")) {
    appDb.run("alter table assets add column share_reviewed_at text");
  }
  if (!tableColumnExists(appDb, "assets", "share_reviewed_by")) {
    appDb.run("alter table assets add column share_reviewed_by text not null default ''");
  }
  if (!tableColumnExists(appDb, "assets", "share_reject_reason")) {
    appDb.run("alter table assets add column share_reject_reason text not null default ''");
  }
  if (!tableColumnExists(appDb, "assets", "content_hash")) {
    appDb.run("alter table assets add column content_hash text not null default ''");
  }
  run(appDb, "update assets set shared = 0 where space = 'shared' and coalesce(shared, 0) <> 0");
  run(
    appDb,
    `update assets
     set share_status = 'approved',
         share_requested_at = coalesce(share_requested_at, created_at),
         share_reviewed_at = coalesce(share_reviewed_at, created_at)
     where (space = 'shared' or shared = 1)
       and coalesce(share_status, 'none') = 'none'`
  );
  run(appDb, "update assets set shared = 0 where coalesce(share_status, 'none') <> 'approved' and coalesce(shared, 0) <> 0");
  if (!tableColumnExists(appDb, "assets", "image_width")) {
    appDb.run("alter table assets add column image_width integer not null default 0");
  }
  if (!tableColumnExists(appDb, "assets", "image_height")) {
    appDb.run("alter table assets add column image_height integer not null default 0");
  }
  backfillAssetDimensions();
  backfillAssetContentHashes();

  appDb.run(`
    create table if not exists case_categories (
      id text primary key,
      type text not null default 'case',
      name text not null,
      slug text not null unique,
      sort_order integer not null default 0
    )
  `);

  if (!tableColumnExists(appDb, "case_categories", "type")) {
    appDb.run("alter table case_categories add column type text not null default 'case'");
  }

  appDb.run(`
    create table if not exists case_items (
      id text primary key,
      group_id text not null default '',
      category_id text not null,
      user_id text,
      image_id text,
      asset_id text,
      include_references integer not null default 1,
      review_status text not null default 'approved',
      review_requested_at text,
      reviewed_at text,
      reviewed_by text not null default '',
      reject_reason text not null default '',
      title text not null,
      prompt text not null,
      image_url text not null,
      created_at text not null,
      foreign key (category_id) references case_categories(id),
      foreign key (user_id) references users(id),
      foreign key (image_id) references images(id),
      foreign key (asset_id) references assets(id)
    )
  `);

  appDb.run(`
    create table if not exists case_group_images (
      id text primary key,
      group_id text not null,
      user_id text,
      image_id text,
      asset_id text,
      image_url text not null default '',
      sort_order integer not null default 0,
      is_cover integer not null default 0,
      created_at text not null,
      foreign key (user_id) references users(id),
      foreign key (image_id) references images(id),
      foreign key (asset_id) references assets(id)
    )
  `);
  appDb.run("create index if not exists case_group_images_group_idx on case_group_images(group_id, sort_order)");
  appDb.run("create unique index if not exists case_group_images_group_image_idx on case_group_images(group_id, image_id) where image_id is not null");
  appDb.run("create unique index if not exists case_group_images_group_asset_idx on case_group_images(group_id, asset_id) where asset_id is not null");

  appDb.run(`
    create table if not exists case_prompt_usage_events (
      id text primary key,
      case_item_id text not null,
      source_user_id text,
      source_type text not null,
      source_id text not null,
      original_prompt_snapshot text not null,
      submitted_prompt text not null,
      used_by_user_id text not null,
      job_id text not null,
      request_type text not null,
      created_at text not null,
      foreign key (used_by_user_id) references users(id)
    )
  `);
  appDb.run("create unique index if not exists case_prompt_usage_events_job_idx on case_prompt_usage_events(job_id)");
  appDb.run(
    "create index if not exists case_prompt_usage_events_source_idx on case_prompt_usage_events(source_user_id, source_type, source_id)"
  );

  appDb.run(`
    create table if not exists case_favorites (
      id text primary key,
      user_id text not null,
      source_user_id text,
      source_type text not null,
      source_id text not null,
      created_at text not null,
      foreign key (user_id) references users(id)
    )
  `);
  appDb.run("create unique index if not exists case_favorites_user_source_idx on case_favorites(user_id, source_user_id, source_type, source_id)");
  appDb.run("create index if not exists case_favorites_source_idx on case_favorites(source_user_id, source_type, source_id)");

  appDb.run(`
    create table if not exists prompt_reference_links (
      id text primary key,
      title text not null,
      url text not null,
      thumbnail_url text not null default '',
      metadata_title text not null default '',
      metadata_image_url text not null default '',
      metadata_icon_url text not null default '',
      metadata_fetched_at text not null default '',
      created_at text not null,
      updated_at text not null
    )
  `);
  for (const [column, definition] of [
    ["metadata_title", "text not null default ''"],
    ["metadata_image_url", "text not null default ''"],
    ["metadata_icon_url", "text not null default ''"],
    ["metadata_fetched_at", "text not null default ''"]
  ] as Array<[string, string]>) {
    if (!tableColumnExists(appDb, "prompt_reference_links", column)) {
      appDb.run(`alter table prompt_reference_links add column ${column} ${definition}`);
    }
  }
  appDb.run("create index if not exists prompt_reference_links_updated_idx on prompt_reference_links(updated_at desc)");

  appDb.run(`
    create table if not exists prompt_templates (
      id text primary key,
      user_id text,
      visibility text not null default 'private',
      name text not null,
      description text not null default '',
      category text not null default '',
      icon text not null default 'Sparkles',
      optimize_style text not null default 'standard',
      components_json text not null,
      rules_json text not null,
      output_json text not null,
      created_at text not null,
      updated_at text not null,
      foreign key (user_id) references users(id)
    )
  `);
  appDb.run("create index if not exists prompt_templates_visibility_idx on prompt_templates(visibility, updated_at desc)");
  appDb.run("create index if not exists prompt_templates_user_idx on prompt_templates(user_id, updated_at desc)");
  if (!tableColumnExists(appDb, "prompt_templates", "optimize_style")) {
    appDb.run("alter table prompt_templates add column optimize_style text not null default 'standard'");
  }
  const promptOptimizeStyleValues = [
    "standard",
    "realistic",
    "realistic:portrait-photography",
    "realistic:commercial-product",
    "realistic:documentary-street",
    "realistic:landscape-blockbuster",
    "realistic:macro-closeup",
    "realistic:fashion-editorial",
    "cinematic",
    "cinematic:hollywood-blockbuster",
    "cinematic:cyberpunk",
    "cinematic:film-noir",
    "cinematic:european-art-house",
    "cinematic:horror-thriller",
    "cinematic:historical-epic",
    "cinematic:sci-fi-space",
    "anime",
    "anime:ghibli",
    "anime:shonen-action",
    "anime:shinkai",
    "anime:cel-animation",
    "anime:mecha-battle",
    "anime:shojo-dreamy",
    "anime:dark-gothic",
    "artistic",
    "artistic:classical-oil",
    "artistic:watercolor-illustration",
    "artistic:concept-art",
    "artistic:pop-art",
    "artistic:minimalism",
    "artistic:surrealism",
    "artistic:pixel-art",
    "commercial",
    "commercial:ecommerce-product",
    "commercial:brand-advertising",
    "commercial:social-media",
    "commercial:corporate-promo",
    "series",
    "series:marketing-campaign",
    "series:ecommerce-detail",
    "series:social-content",
    "series:brand-visual",
    "series:storyboard",
    "series:logo-design",
    "composition",
    "composition:rule-of-thirds",
    "composition:center-symmetry",
    "composition:leading-lines",
    "composition:frame-within-frame",
    "composition:diagonal-dynamic",
    "composition:negative-space",
    "composition:foreground-depth",
    "composition:golden-spiral",
    "composition:close-crop",
    "composition:flat-lay",
    "detailed",
    "detailed:material-texture",
    "detailed:lighting-enhancement",
    "detailed:environment-atmosphere",
    "creative",
    "creative:surreal-collage",
    "creative:double-exposure",
    "creative:glitch-art",
    "creative:fantasy-world"
  ];
  run(
    appDb,
    `update prompt_templates set optimize_style = 'standard' where optimize_style not in (${promptOptimizeStyleValues.map(() => "?").join(",")})`,
    ...promptOptimizeStyleValues
  );

  appDb.run(`
    create table if not exists prompt_template_default_seeds (
      user_id text not null,
      seed_key text not null,
      created_at text not null,
      primary key (user_id, seed_key),
      foreign key (user_id) references users(id)
    )
  `);

  appDb.run(`
    create table if not exists prompt_template_results (
      id text primary key,
      template_id text,
      user_id text not null,
      template_snapshot_json text not null,
      form_snapshot_json text not null,
      language text not null,
      base_prompt text not null,
      base_prompt_en text not null default '',
      optimized_prompt text not null,
      optimized_prompt_en text not null default '',
      sections_json text not null,
      negative_prompt text not null default '',
      negative_prompt_en text not null default '',
      provider_name text not null default '',
      model text not null default '',
      created_at text not null,
      foreign key (user_id) references users(id)
    )
  `);
  for (const [column, definition] of [
    ["base_prompt_en", "text not null default ''"],
    ["optimized_prompt_en", "text not null default ''"],
    ["negative_prompt_en", "text not null default ''"]
  ] as const) {
    if (!tableColumnExists(appDb, "prompt_template_results", column)) {
      appDb.run(`alter table prompt_template_results add column ${column} ${definition}`);
    }
  }
  appDb.run("create index if not exists prompt_template_results_user_idx on prompt_template_results(user_id, created_at desc)");
  appDb.run("create index if not exists prompt_template_results_template_idx on prompt_template_results(template_id, created_at desc)");

  appDb.run(`
    create table if not exists prompt_template_form_drafts (
      template_id text not null,
      user_id text not null,
      form_values_json text not null default '{}',
      created_at text not null,
      updated_at text not null,
      primary key (template_id, user_id),
      foreign key (template_id) references prompt_templates(id),
      foreign key (user_id) references users(id)
    )
  `);
  appDb.run("create index if not exists prompt_template_form_drafts_user_idx on prompt_template_form_drafts(user_id, updated_at desc)");

  appDb.run(`
    create table if not exists prompt_template_base_translations (
      template_id text not null,
      user_id text not null,
      signature text not null,
      base_prompt text not null,
      base_prompt_en text not null,
      negative_prompt text not null default '',
      negative_prompt_en text not null default '',
      provider_name text not null default '',
      model text not null default '',
      updated_at text not null,
      primary key (template_id, user_id),
      foreign key (user_id) references users(id)
    )
  `);
  for (const [column, definition] of [
    ["negative_prompt", "text not null default ''"],
    ["negative_prompt_en", "text not null default ''"]
  ] as const) {
    if (!tableColumnExists(appDb, "prompt_template_base_translations", column)) {
      appDb.run(`alter table prompt_template_base_translations add column ${column} ${definition}`);
    }
  }

  appDb.run(`
    create table if not exists prompt_template_export_downloads (
      id text primary key,
      template_id text not null,
      user_id text not null,
      variant text not null default 'ai',
      status text not null default 'active',
      issued_at integer not null,
      expires_at integer,
      revoked_at integer,
      last_used_at integer,
      use_count integer not null default 0,
      created_at text not null,
      updated_at text not null,
      foreign key (user_id) references users(id)
    )
  `);
  appDb.run("create index if not exists prompt_template_export_downloads_template_idx on prompt_template_export_downloads(template_id, user_id, created_at desc)");
  appDb.run("create index if not exists prompt_template_export_downloads_status_idx on prompt_template_export_downloads(template_id, user_id, variant, status)");

  appDb.run(`
    create table if not exists prompt_template_export_revocations (
      template_id text not null,
      user_id text not null,
      revoked_after integer not null,
      updated_at text not null,
      primary key (template_id, user_id),
      foreign key (user_id) references users(id)
    )
  `);

  appDb.run(`
    create table if not exists asset_categories (
      asset_id text not null,
      category_id text not null,
      created_at text not null,
      primary key (asset_id, category_id),
      foreign key (asset_id) references assets(id),
      foreign key (category_id) references case_categories(id)
    )
  `);
  migrateAssetCategoryType();

  if (!tableColumnExists(appDb, "case_items", "user_id")) {
    appDb.run("alter table case_items add column user_id text");
  }
  if (!tableColumnExists(appDb, "case_items", "image_id")) {
    appDb.run("alter table case_items add column image_id text");
  }
  if (!tableColumnExists(appDb, "case_items", "asset_id")) {
    appDb.run("alter table case_items add column asset_id text");
  }
  if (!tableColumnExists(appDb, "case_items", "include_references")) {
    appDb.run("alter table case_items add column include_references integer not null default 1");
  }
  if (!tableColumnExists(appDb, "case_items", "review_status")) {
    appDb.run("alter table case_items add column review_status text not null default 'approved'");
  }
  if (!tableColumnExists(appDb, "case_items", "review_requested_at")) {
    appDb.run("alter table case_items add column review_requested_at text");
  }
  if (!tableColumnExists(appDb, "case_items", "reviewed_at")) {
    appDb.run("alter table case_items add column reviewed_at text");
  }
  if (!tableColumnExists(appDb, "case_items", "reviewed_by")) {
    appDb.run("alter table case_items add column reviewed_by text not null default ''");
  }
  if (!tableColumnExists(appDb, "case_items", "reject_reason")) {
    appDb.run("alter table case_items add column reject_reason text not null default ''");
  }
  if (!tableColumnExists(appDb, "case_items", "group_id")) {
    appDb.run("alter table case_items add column group_id text not null default ''");
  }
  appDb.run("create index if not exists case_items_review_status_idx on case_items(review_status, review_requested_at)");
  appDb.run("create index if not exists case_items_user_review_idx on case_items(user_id, review_status)");
  run(
    appDb,
    `update case_items
     set
       user_id = coalesce(user_id, (
         select images.user_id
         from images
         where case_items.image_url = '/' || images.path
            or case_items.image_url = '/' || replace(images.path, '\\', '/')
         limit 1
       ), (
         select assets.user_id
         from assets
         where case_items.image_url = '/' || assets.path
            or case_items.image_url = '/' || replace(assets.path, '\\', '/')
         limit 1
       )),
       image_id = coalesce(image_id, (
         select images.id
         from images
         where case_items.image_url = '/' || images.path
            or case_items.image_url = '/' || replace(images.path, '\\', '/')
         limit 1
       )),
       asset_id = coalesce(asset_id, (
         select assets.id
         from assets
         where case_items.image_url = '/' || assets.path
            or case_items.image_url = '/' || replace(assets.path, '\\', '/')
         limit 1
       ))
     where user_id is null or (image_id is null and asset_id is null)`
  );
  run(appDb, "delete from case_items where user_id is null or (image_id is null and asset_id is null)");
  const legacyCaseRows = getAll<{
    id: string;
    user_id: string | null;
    image_id: string | null;
    asset_id: string | null;
    title: string;
    prompt: string;
    image_url: string;
    created_at: string;
    group_id: string | null;
  }>(
    appDb,
    `select id, user_id, image_id, asset_id, title, prompt, image_url, created_at, group_id
     from case_items
     order by created_at asc, rowid asc`
  );
  const legacyGroupIds = new Map<string, string>();
  for (const row of legacyCaseRows) {
    if (row.group_id) {
      const source = row.image_id ? `image:${row.image_id}` : row.asset_id ? `asset:${row.asset_id}` : `url:${row.image_url}`;
      legacyGroupIds.set([row.user_id ?? "", source, row.title, row.prompt].join("\u001f"), row.group_id);
    }
  }
  for (const row of legacyCaseRows) {
    if (row.group_id) continue;
    const source = row.image_id ? `image:${row.image_id}` : row.asset_id ? `asset:${row.asset_id}` : `url:${row.image_url}`;
    const key = [row.user_id ?? "", source, row.title, row.prompt].join("\u001f");
    const groupId = legacyGroupIds.get(key) ?? makeId("casegrp");
    legacyGroupIds.set(key, groupId);
    run(appDb, "update case_items set group_id = ? where id = ?", groupId, row.id);
  }
  const caseGroupCoverRows = getAll<{
    group_id: string;
    user_id: string | null;
    image_id: string | null;
    asset_id: string | null;
    image_url: string;
    created_at: string;
  }>(
    appDb,
    `select group_id, user_id, image_id, asset_id, image_url, min(created_at) as created_at
     from case_items
     where group_id <> ''
     group by group_id`
  );
  for (const row of caseGroupCoverRows) {
    const exists = getOne<{ id: string }>(appDb, "select id from case_group_images where group_id = ? limit 1", row.group_id);
    if (exists) continue;
    run(
      appDb,
      `insert into case_group_images (
        id, group_id, user_id, image_id, asset_id, image_url, sort_order, is_cover, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      makeId("caseimg"),
      row.group_id,
      row.user_id,
      row.image_id,
      row.asset_id,
      row.image_url,
      0,
      1,
      row.created_at || now()
    );
  }

  const timestamp = now();
  run(
    appDb,
    "insert or ignore into teams (id, name, description, created_at, updated_at) values (?, ?, ?, ?, ?)",
    defaultTeamId(),
    "默认团队",
    "自动注册账号默认归属",
    timestamp,
    timestamp
  );
  run(appDb, "update users set team_id = ? where team_id is null or team_id = ''", defaultTeamId());
  run(appDb, "update users set account = username where account is null or account = ''");
  appDb.run("create unique index if not exists users_account_unique on users(account)");
  appDb.run("create unique index if not exists users_email_unique on users(email) where email <> ''");
  appDb.run("create unique index if not exists users_phone_unique on users(phone) where phone <> ''");
}

export function initConfigDb() {
  configDb.run("PRAGMA journal_mode = MEMORY");
  configDb.run(`
    create table if not exists config_admin (
      id text primary key,
      password_hash text not null,
      created_at text not null,
      updated_at text not null
    )
  `);

  configDb.run(`
    create table if not exists config_auth_sessions (
      id text primary key,
      expires_at text not null,
      created_at text not null
    )
  `);

  configDb.run(`
    create table if not exists branding_assets (
      id text primary key,
      type text not null,
      source text not null default 'uploaded',
      name text not null,
      path text not null default '',
      url text not null default '',
      mime_type text not null default '',
      size integer not null default 0,
      image_width integer not null default 0,
      image_height integer not null default 0,
      enabled integer not null default 1,
      sort_order integer not null default 100,
      created_at text not null,
      updated_at text not null
    )
  `);
  configDb.run("create index if not exists branding_assets_type_idx on branding_assets(type, source, sort_order)");

  configDb.run(`
    create table if not exists branding_settings (
      id text primary key,
      site_name text not null default '神笔马良',
      active_logo_asset_id text not null default '',
      active_favicon_asset_id text not null default '',
      active_login_title_light_asset_id text not null default '',
      active_login_title_dark_asset_id text not null default '',
      login_background_light_ids_json text not null default '[]',
      login_background_dark_ids_json text not null default '[]',
      updated_at text not null
    )
  `);

  configDb.run(`
    create table if not exists smtp_settings (
      id text primary key,
      enabled integer not null default 0,
      use_proxy integer not null default 0,
      host text not null default '',
      port integer not null default 465,
      secure integer not null default 1,
      username text not null default '',
      password_secret text not null default '',
      from_name text not null default '神笔马良',
      from_email text not null default '',
      test_recipient_email text not null default '',
      updated_at text not null
    )
  `);
  if (!tableColumnExists(configDb, "smtp_settings", "use_proxy")) {
    configDb.run("alter table smtp_settings add column use_proxy integer not null default 0");
  }
  if (!tableColumnExists(configDb, "smtp_settings", "test_recipient_email")) {
    configDb.run("alter table smtp_settings add column test_recipient_email text not null default ''");
  }

  configDb.run(`
    create table if not exists sms_settings (
      id text primary key,
      enabled integer not null default 0,
      provider text not null default 'tencent',
      secret_id text not null default '',
      secret_key_secret text not null default '',
      region text not null default 'ap-guangzhou',
      sms_sdk_app_id text not null default '',
      sign_name text not null default '',
      register_template_id text not null default '',
      password_reset_template_id text not null default '',
      template_param_order text not null default 'code',
      test_phone text not null default '',
      updated_at text not null
    )
  `);

  configDb.run(`
    create table if not exists provider_configs (
      id text primary key,
      name text not null,
      type text not null,
      channel text not null default 'api',
      enabled integer not null default 1,
      base_url text not null,
      api_key_env text,
      api_key_value text,
      route_mode text not null default 'images_api',
      generation_path text not null,
      edit_path text not null,
      responses_path text not null default '/v1/responses',
      model text not null,
      responses_model text not null default 'gpt-5.5',
      sizes text not null,
      qualities text not null,
      default_size text not null,
      default_quality text not null,
      response_image_path text not null,
      proxy_enabled integer not null default 0,
      quota_mode text not null default 'codex_first',
      fallback_to_conversation integer not null default 1,
      web_account_id text not null default '',
      web_account_ids text not null default '[]',
      web_account_mode text not null default 'priority',
      web_cookies text,
      created_at text not null,
      updated_at text not null
    )
  `);

  configDb.run(`
    create table if not exists image_generation_settings (
      id text primary key,
      mode text not null default 'auto',
      result_retry_count integer default 1,
      updated_at text not null
    )
  `);
  if (!tableColumnExists(configDb, "image_generation_settings", "result_retry_count")) {
    configDb.run("alter table image_generation_settings add column result_retry_count integer default 1");
  }

  configDb.run(`
    create table if not exists prompt_optimizer_providers (
      id text primary key,
      name text not null,
      enabled integer not null default 0,
      base_url text not null default 'https://api.deepseek.com',
      endpoint_path text not null default '/chat/completions',
      api_key_env text not null default 'DEEPSEEK_API_KEY',
      api_key_value text not null default '',
      model text not null default 'deepseek-chat',
      models_json text not null default '[]',
      availability_status text not null default 'unknown',
      availability_error text not null default '',
      availability_checked_at text not null default '',
      stream_enabled integer not null default 0,
      thinking_enabled integer not null default 1,
      temperature real,
      max_tokens integer not null default 0,
      retry_count integer not null default 2,
      sort_order integer not null default 100,
      created_at text not null,
      updated_at text not null
    )
  `);
  if (!tableColumnExists(configDb, "prompt_optimizer_providers", "stream_enabled")) {
    configDb.run("alter table prompt_optimizer_providers add column stream_enabled integer not null default 0");
  }
  if (!tableColumnExists(configDb, "prompt_optimizer_providers", "thinking_enabled")) {
    configDb.run("alter table prompt_optimizer_providers add column thinking_enabled integer not null default 1");
  }
  if (!tableColumnExists(configDb, "prompt_optimizer_providers", "models_json")) {
    configDb.run("alter table prompt_optimizer_providers add column models_json text not null default '[]'");
  }
  if (!tableColumnExists(configDb, "prompt_optimizer_providers", "availability_status")) {
    configDb.run("alter table prompt_optimizer_providers add column availability_status text not null default 'unknown'");
  }
  if (!tableColumnExists(configDb, "prompt_optimizer_providers", "availability_error")) {
    configDb.run("alter table prompt_optimizer_providers add column availability_error text not null default ''");
  }
  if (!tableColumnExists(configDb, "prompt_optimizer_providers", "availability_checked_at")) {
    configDb.run("alter table prompt_optimizer_providers add column availability_checked_at text not null default ''");
  }
  if (!tableColumnExists(configDb, "prompt_optimizer_providers", "retry_count")) {
    configDb.run("alter table prompt_optimizer_providers add column retry_count integer not null default 2");
  }
  migratePromptOptimizerTemperatureNullable();
  configDb.run(`
    create table if not exists config_migrations (
      id text primary key,
      created_at text not null
    )
  `);
  const promptOptimizerTimestamp = now();
  const maxTokensDefaultMigration = "prompt_optimizer_max_tokens_zero_default_20260518";
  if (!getOne<{ id: string }>(configDb, "select id from config_migrations where id = ?", maxTokensDefaultMigration)) {
    run(configDb, "update prompt_optimizer_providers set max_tokens = 0 where max_tokens = 6000");
    run(configDb, "insert into config_migrations (id, created_at) values (?, ?)", maxTokensDefaultMigration, promptOptimizerTimestamp);
  }
  run(
    configDb,
    `insert or ignore into prompt_optimizer_providers (
      id, name, enabled, base_url, endpoint_path, api_key_env, api_key_value,
      model, models_json, availability_status, availability_error, availability_checked_at,
      stream_enabled, thinking_enabled, temperature, max_tokens, retry_count, sort_order, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "promptopt-deepseek-example",
    "DeepSeek 示例",
    0,
    "https://api.deepseek.com",
    "/chat/completions",
    "DEEPSEEK_API_KEY",
    "",
    "deepseek-chat",
    "[]",
    "unknown",
    "",
    "",
    0,
    1,
    null,
    0,
    2,
    100,
    promptOptimizerTimestamp,
    promptOptimizerTimestamp
  );

  configDb.run(`
    create table if not exists safety_review_settings (
      id text primary key,
      enabled integer not null default 0,
      failure_policy text not null default 'allow',
      block_message text not null default '当前提示词可能存在安全风险，请调整后再试。',
      updated_at text not null
    )
  `);
  run(
    configDb,
    `insert or ignore into safety_review_settings (
      id, enabled, failure_policy, block_message, updated_at
    ) values (?, ?, ?, ?, ?)`,
    "default",
    0,
    "allow",
    "当前提示词可能存在安全风险，请调整后再试。",
    promptOptimizerTimestamp
  );
  configDb.run(`
    create table if not exists safety_review_logs (
      id text primary key,
      user_id text not null default '',
      session_id text not null default '',
      job_id text not null default '',
      scene text not null default '',
      prompt_excerpt text not null default '',
      decision text not null default '',
      risk_level text not null default '',
      categories_json text not null default '[]',
      confidence real,
      reason text not null default '',
      matched_text_json text not null default '[]',
      suggested_action text not null default '',
      action text not null default '',
      provider_id text not null default '',
      provider_name text not null default '',
      duration_ms integer not null default 0,
      error text,
      created_at text not null
    )
  `);
  configDb.run("create index if not exists safety_review_logs_created_idx on safety_review_logs(created_at desc)");
  configDb.run("create index if not exists safety_review_logs_user_idx on safety_review_logs(user_id, created_at desc)");
  configDb.run("create index if not exists safety_review_logs_job_idx on safety_review_logs(job_id, created_at desc)");

  configDb.run(`
    create table if not exists starter_copy_settings (
      id text primary key,
      enabled integer not null default 1,
      copy_count integer not null default 50,
      updated_at text not null
    )
  `);
  if (!tableColumnExists(configDb, "starter_copy_settings", "copy_count")) {
    configDb.run("alter table starter_copy_settings add column copy_count integer not null default 50");
  }
  run(configDb, "update starter_copy_settings set copy_count = 50 where id = ? and copy_count = 20", "default");
  run(
    configDb,
    "insert or ignore into starter_copy_settings (id, enabled, copy_count, updated_at) values (?, ?, ?, ?)",
    "default",
    1,
    50,
    promptOptimizerTimestamp
  );

  configDb.run(`
    create table if not exists file_security_settings (
      id text primary key,
      encryption_key text not null,
      created_at text not null,
      updated_at text not null
    )
  `);

  for (const [column, definition] of [
    ["channel", "text not null default 'api'"],
    ["route_mode", "text not null default 'images_api'"],
    ["responses_path", "text not null default '/v1/responses'"],
    ["responses_model", "text not null default 'gpt-5.5'"],
    ["proxy_enabled", "integer not null default 0"],
    ["quota_mode", "text not null default 'codex_first'"],
    ["fallback_to_conversation", "integer not null default 1"],
    ["web_account_id", "text not null default ''"],
    ["web_account_ids", "text not null default '[]'"],
    ["web_account_mode", "text not null default 'priority'"],
    ["web_cookies", "text"]
  ] as Array<[string, string]>) {
    if (!tableColumnExists(configDb, "provider_configs", column)) {
      configDb.run(`alter table provider_configs add column ${column} ${definition}`);
    }
  }
  run(
    configDb,
    "update provider_configs set responses_model = ? where trim(coalesce(responses_model, '')) = ''",
    DEFAULT_RESPONSES_MODEL
  );
  run(
    configDb,
    "update provider_configs set channel = ? where id = ? and channel in (?, ?) and base_url like ?",
    "cpa",
    "local-gpt-image",
    "custom",
    "api",
    "%:8317%"
  );
  run(configDb, "update provider_configs set channel = ? where channel in (?, ?)", "chatgpt_web", "studio", "official");
  run(configDb, "update provider_configs set channel = ? where channel = ?", "api", "custom");
  run(
    configDb,
    `update provider_configs
     set responses_path = ?
     where channel = ?
       and (
        responses_path = ''
        or responses_path = ?
        or responses_path = ?
        or responses_path = ?
        or responses_path like ?
       )`,
    "/codex/responses",
    "chatgpt_web",
    "/v1/responses",
    "/f/conversation",
    "/codex/images/generations",
    "%/codex/images/generations"
  );
  run(
    configDb,
    `update provider_configs
     set generation_path = ?
     where channel = ?
       and (
        generation_path = ''
        or generation_path = ?
        or generation_path = ?
        or generation_path like ?
       )`,
    "/f/conversation",
    "chatgpt_web",
    "/v1/images/generations",
    "/images/generations",
    "%/images/generations"
  );
  run(
    configDb,
    `update provider_configs
     set edit_path = ?
     where channel = ?
       and (
        edit_path = ''
        or edit_path = ?
        or edit_path = ?
        or edit_path like ?
       )`,
    "/f/conversation",
    "chatgpt_web",
    "/v1/images/edits",
    "/images/edits",
    "%/images/edits"
  );
  run(
    configDb,
    "update image_generation_settings set mode = ? where mode in (?, ?, ?, ?, ?)",
    "chatgpt_web",
    "studio",
    "official",
    "studio_legacy",
    "studio_responses",
    "responses"
  );
  run(configDb, "update image_generation_settings set mode = ? where mode = ?", "api", "custom");
  run(
    configDb,
    "insert or ignore into image_generation_settings (id, mode, result_retry_count, updated_at) values (?, ?, ?, ?)",
    "default",
    "auto",
    1,
    now()
  );

  configDb.run(`
    create table if not exists debug_settings (
      id text primary key,
      image_edit_mask integer not null default 0,
      image_edit_response integer not null default 0,
      updated_at text not null
    )
  `);
  run(
    configDb,
    "insert or ignore into debug_settings (id, image_edit_mask, image_edit_response, updated_at) values (?, ?, ?, ?)",
    "default",
    imageEditMaskDebugEnabled() ? 1 : 0,
    0,
    now()
  );

  migrateStudioSettingsToChatGptProvider();

  configDb.run(`
    create table if not exists proxy_settings (
      id text primary key,
      enabled integer not null default 0,
      url text not null default '',
      retry_count integer not null default 2,
      apply_chatgpt_web integer not null default 1,
      apply_cpa integer not null default 0,
      apply_api integer not null default 0,
      updated_at text not null
    )
  `);
  for (const [column, definition] of [
    ["retry_count", "integer not null default 2"],
    ["apply_chatgpt_web", "integer not null default 1"],
    ["apply_cpa", "integer not null default 1"],
    ["apply_api", "integer not null default 0"]
  ] as Array<[string, string]>) {
    if (!tableColumnExists(configDb, "proxy_settings", column)) {
      configDb.run(`alter table proxy_settings add column ${column} ${definition}`);
    }
  }
  if (tableColumnExists(configDb, "proxy_settings", "apply_official")) {
    run(configDb, "update proxy_settings set apply_chatgpt_web = apply_official");
  }
  if (tableColumnExists(configDb, "proxy_settings", "apply_custom")) {
    run(configDb, "update proxy_settings set apply_api = apply_custom");
  }

  configDb.run(`
    create table if not exists image_accounts (
      id text primary key,
      name text not null,
      remote_name text,
      channel_id text,
      email text not null default '',
      account_type text not null default '',
      status text not null default 'normal',
      quota integer not null default 0,
      used_quota integer not null default 0,
      usage_success_count integer not null default 0,
      usage_failure_count integer not null default 0,
      usage_recent_requests text not null default '[]',
      codex_5h_used_percent real,
      codex_5h_reset_at text,
      codex_week_used_percent real,
      codex_week_reset_at text,
      codex_credits_balance text,
      codex_credits_unlimited integer not null default 0,
      codex_usage_windows text not null default '[]',
      codex_usage_updated_at text,
      codex_usage_error text not null default '',
      priority integer not null default 0,
      access_token text,
      auth_json text,
      auth_info_json text,
      note text not null default '',
      sync_status text not null default 'local',
      last_refreshed_at text,
      created_at text not null,
      updated_at text not null
    )
  `);

  for (const [column, definition] of [
    ["remote_name", "text"],
    ["usage_success_count", "integer not null default 0"],
    ["usage_failure_count", "integer not null default 0"],
    ["usage_recent_requests", "text not null default '[]'"],
    ["codex_5h_used_percent", "real"],
    ["codex_5h_reset_at", "text"],
    ["codex_week_used_percent", "real"],
    ["codex_week_reset_at", "text"],
    ["codex_credits_balance", "text"],
    ["codex_credits_unlimited", "integer not null default 0"],
    ["codex_usage_windows", "text not null default '[]'"],
    ["codex_usage_updated_at", "text"],
    ["codex_usage_error", "text not null default ''"],
    ["auth_info_json", "text"]
  ] as Array<[string, string]>) {
    if (!tableColumnExists(configDb, "image_accounts", column)) {
      configDb.run(`alter table image_accounts add column ${column} ${definition}`);
    }
  }
  if (tableColumnExists(configDb, "image_accounts", "codex_usage_plan_type")) {
    run(
      configDb,
      "update image_accounts set account_type = codex_usage_plan_type where account_type = '' and codex_usage_plan_type <> ''"
    );
    try {
      configDb.run("alter table image_accounts drop column codex_usage_plan_type");
    } catch (error) {
      console.warn("codex_usage_plan_type 旧字段清理失败，将继续忽略该字段", error);
    }
  }
  run(
    configDb,
    `update image_accounts
     set status = 'normal', updated_at = ?
     where status = 'limited'
       and (
         codex_credits_unlimited = 1
         or (codex_5h_used_percent is not null and codex_5h_used_percent < 100)
         or (codex_week_used_percent is not null and codex_week_used_percent < 100)
       )`,
    now()
  );

  run(
    configDb,
    `insert or ignore into proxy_settings (
      id, enabled, url, retry_count, apply_chatgpt_web, apply_cpa, apply_api, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
    "default",
    0,
    "",
    2,
    1,
    0,
    0,
    now()
  );

  configDb.run(`
    create table if not exists cpa_accounts (
      id text primary key,
      enabled integer not null default 0,
      account_name text not null,
      sync_url text not null,
      username text not null,
      password_secret text not null,
      token_secret text not null,
      frequency_minutes integer not null default 60,
      last_status text,
      updated_at text not null
    )
  `);

  configDb.run(`
    create table if not exists cpa_sync_runs (
      id text primary key,
      status text not null,
      message text not null,
      started_at text not null,
      finished_at text not null
    )
  `);

  configDb.run(`
    create table if not exists changelog_entries (
      id text primary key,
      version text not null unique,
      release_date text not null,
      content text not null,
      created_at text not null,
      updated_at text not null
    )
  `);

  configDb.run(`
    create table if not exists config_audit_logs (
      id text primary key,
      action text not null,
      detail text not null,
      created_at text not null
    )
  `);

  configDb.run(`
    create table if not exists provider_request_logs (
      id text primary key,
      provider_id text not null,
      provider_name text not null,
      channel text not null,
      route_mode text not null,
      operation text not null,
      job_id text not null default '',
      attempt_no integer not null default 1,
      max_attempts integer not null default 1,
      is_retry integer not null default 0,
      source_account_id text not null default '',
      user_id text not null default '',
      endpoint text not null,
      status_code integer,
      duration_ms integer not null,
      success integer not null,
      error text,
      response_snapshot text not null default '',
      created_at text not null
    )
  `);
  if (!tableColumnExists(configDb, "provider_request_logs", "source_account_id")) {
    configDb.run("alter table provider_request_logs add column source_account_id text not null default ''");
  }
  if (!tableColumnExists(configDb, "provider_request_logs", "user_id")) {
    configDb.run("alter table provider_request_logs add column user_id text not null default ''");
  }
  for (const [column, definition] of [
    ["job_id", "text not null default ''"],
    ["attempt_no", "integer not null default 1"],
    ["max_attempts", "integer not null default 1"],
    ["is_retry", "integer not null default 0"],
    ["response_snapshot", "text not null default ''"]
  ] as const) {
    if (!tableColumnExists(configDb, "provider_request_logs", column)) {
      configDb.run(`alter table provider_request_logs add column ${column} ${definition}`);
    }
  }
  configDb.run("create index if not exists provider_request_logs_source_account_idx on provider_request_logs(source_account_id, created_at desc)");
  configDb.run("create index if not exists provider_request_logs_user_idx on provider_request_logs(user_id, created_at desc)");
  configDb.run("create index if not exists provider_request_logs_job_idx on provider_request_logs(job_id, created_at desc)");

  configDb.run(`
    create table if not exists model_request_logs (
      id text primary key,
      purpose text not null,
      provider_id text not null,
      provider_name text not null,
      model text not null,
      endpoint text not null,
      method text not null,
      stream_enabled integer not null default 0,
      retry_count integer not null default 0,
      attempt_count integer not null default 1,
      status_code integer,
      duration_ms integer not null,
      success integer not null,
      error text,
      user_id text not null default '',
      job_id text not null default '',
      source text not null default '',
      created_at text not null
    )
  `);
  configDb.run("create index if not exists model_request_logs_created_idx on model_request_logs(created_at desc)");
  configDb.run("create index if not exists model_request_logs_purpose_idx on model_request_logs(purpose, created_at desc)");
  configDb.run("create index if not exists model_request_logs_provider_idx on model_request_logs(provider_id, created_at desc)");
  configDb.run("create index if not exists model_request_logs_user_idx on model_request_logs(user_id, created_at desc)");
  initGlobalSwitchSettings();
  migrateReadableProviderIds();
}

export function seedCases() {
  const categories = [
    { slug: UNCATEGORIZED_CASE_CATEGORY_SLUG, name: UNCATEGORIZED_CASE_CATEGORY_NAME, sort: 0, id: UNCATEGORIZED_CASE_CATEGORY_ID },
    { slug: "poster", name: "海报", sort: 10 },
    { slug: "rednote", name: "小红书攻略", sort: 20 },
    { slug: "portrait", name: "人物肖像", sort: 30 },
    { slug: "ecommerce", name: "电商图", sort: 40 },
    { slug: "interior", name: "室内设计", sort: 50 }
  ];

  for (const category of categories) {
    const id = category.id ?? `casecat_${category.slug}`;
    run(
      appDb,
      "insert or ignore into case_categories (id, type, name, slug, sort_order) values (?, ?, ?, ?, ?)",
      id,
      "case",
      category.name,
      category.slug,
      category.sort
    );
  }
  run(
    appDb,
    "update case_categories set name = ?, sort_order = ? where id = ?",
    UNCATEGORIZED_CASE_CATEGORY_NAME,
    0,
    UNCATEGORIZED_CASE_CATEGORY_ID
  );
}

export function seedPromptTemplates() {
  // Default prompt templates are now copied into each user's own library on first use.
}

export function seedProvider() {
  const timestamp = now();
  const cpaId = makeProviderConfigId("cpa", providerDate(timestamp));
  if (!getOne<ProviderRow>(configDb, "select * from provider_configs where channel = ? limit 1", "cpa")) {
    run(
      configDb,
      `insert or ignore into provider_configs (
      id, name, type, channel, enabled, base_url, api_key_env, api_key_value,
      route_mode, generation_path, edit_path, responses_path, model, responses_model,
      sizes, qualities, default_size, default_quality, response_image_path,
      proxy_enabled, quota_mode, fallback_to_conversation, web_account_id, web_account_ids, web_account_mode, web_cookies,
      created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cpaId,
      cpaId,
      "openai-compatible",
      "cpa",
      1,
      "http://127.0.0.1:8317",
      "GPT_IMAGE_API_KEY",
      "",
      "images_api",
      "/v1/images/generations",
      "/v1/images/edits",
      "/v1/responses",
      "gpt-image-2",
      DEFAULT_RESPONSES_MODEL,
      JSON.stringify(DEFAULT_IMAGE_SIZES),
      JSON.stringify(["low", "medium", "high"]),
      DEFAULT_REQUEST_SIZE,
      "high",
      "data[0].b64_json",
      0,
      "codex_first",
      1,
      "",
      "[]",
      "priority",
      "",
      timestamp,
      timestamp
    );
  }

  const chatgptWebId = makeProviderConfigId("chatgpt_web", providerDate(timestamp));
  if (!getOne<ProviderRow>(configDb, "select * from provider_configs where channel = ? limit 1", "chatgpt_web")) {
    run(
      configDb,
      `insert or ignore into provider_configs (
      id, name, type, channel, enabled, base_url, api_key_env, api_key_value,
      route_mode, generation_path, edit_path, responses_path, model, responses_model,
      sizes, qualities, default_size, default_quality, response_image_path,
      proxy_enabled, quota_mode, fallback_to_conversation, web_account_id, web_account_ids, web_account_mode, web_cookies,
      created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      chatgptWebId,
      chatgptWebId,
      "chatgpt-web",
      "chatgpt_web",
      0,
      STUDIO_BACKEND_BASE_URL,
      "",
      "",
      "images_api",
      "/f/conversation",
      "/f/conversation",
      "/codex/responses",
      DEFAULT_IMAGE_MODEL,
      DEFAULT_RESPONSES_MODEL,
      JSON.stringify(DEFAULT_IMAGE_SIZES),
      JSON.stringify(DEFAULT_IMAGE_QUALITIES),
      DEFAULT_REQUEST_SIZE,
      "high",
      "data[0].b64_json",
      1,
      "codex_first",
      1,
      "",
      "[]",
      "priority",
      "",
      timestamp,
      timestamp
    );
  }

  const apiId = makeProviderConfigId("api", providerDate(timestamp));
  if (!getOne<ProviderRow>(configDb, "select * from provider_configs where channel = ? limit 1", "api")) {
    run(
      configDb,
      `insert or ignore into provider_configs (
      id, name, type, channel, enabled, base_url, api_key_env, api_key_value,
      route_mode, generation_path, edit_path, responses_path, model, responses_model,
      sizes, qualities, default_size, default_quality, response_image_path,
      proxy_enabled, quota_mode, fallback_to_conversation, web_account_id, web_account_ids, web_account_mode, web_cookies,
      created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      apiId,
      apiId,
      "openai-compatible",
      "api",
      0,
      "https://api.openai.com",
      "OPENAI_API_KEY",
      "",
      "images_api",
      "/v1/images/generations",
      "/v1/images/edits",
      "/v1/responses",
      DEFAULT_IMAGE_MODEL,
      DEFAULT_RESPONSES_MODEL,
      JSON.stringify(DEFAULT_IMAGE_SIZES),
      JSON.stringify(DEFAULT_IMAGE_QUALITIES),
      DEFAULT_REQUEST_SIZE,
      "high",
      "data[0].b64_json",
      0,
      "codex_first",
      1,
      "",
      "[]",
      "priority",
      "",
      timestamp,
      timestamp
    );
  }
}
