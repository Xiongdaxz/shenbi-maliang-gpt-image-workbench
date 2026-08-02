import type { Database } from "bun:sqlite";
import { configDb, getOne, run } from "./db";
import type { ExternalMcpSettingsRow } from "./types";
import { now } from "./utils";

const EXTERNAL_MCP_SETTINGS_ID = "default";
const SECONDS_PER_DAY = 24 * 60 * 60;

export const DEFAULT_EXTERNAL_MCP_ACCESS_TOKEN_TTL_DAYS = 7;
export const MIN_EXTERNAL_MCP_ACCESS_TOKEN_TTL_DAYS = 1;
export const MAX_EXTERNAL_MCP_ACCESS_TOKEN_TTL_DAYS = 365;
export const DEFAULT_EXTERNAL_MCP_REFRESH_TOKEN_TTL_DAYS = 90;
export const MIN_EXTERNAL_MCP_REFRESH_TOKEN_TTL_DAYS = 30;
export const MAX_EXTERNAL_MCP_REFRESH_TOKEN_TTL_DAYS = 3650;

export function migrateExternalMcpSettingsStorage(db: Database = configDb) {
  const table = getOne<{ sql: string | null }>(
    db,
    "select sql from sqlite_master where type = 'table' and name = 'external_mcp_settings'"
  );
  if (!table?.sql || !/\bcheck\s*\(/i.test(table.sql)) return false;

  db.transaction(() => {
    db.run("drop table if exists external_mcp_settings_next");
    db.run(`
      create table external_mcp_settings_next (
        id text primary key,
        access_token_ttl_days integer not null default ${DEFAULT_EXTERNAL_MCP_ACCESS_TOKEN_TTL_DAYS},
        refresh_token_ttl_days integer not null default ${DEFAULT_EXTERNAL_MCP_REFRESH_TOKEN_TTL_DAYS},
        updated_at text not null
      )
    `);
    db.run(`
      insert into external_mcp_settings_next
        (id, access_token_ttl_days, refresh_token_ttl_days, updated_at)
      select id, access_token_ttl_days, refresh_token_ttl_days, updated_at
      from external_mcp_settings
    `);
    db.run("drop table external_mcp_settings");
    db.run("alter table external_mcp_settings_next rename to external_mcp_settings");
  })();
  return true;
}

function externalMcpSettingsRow(db: Database) {
  return getOne<ExternalMcpSettingsRow>(
    db,
    `select id, access_token_ttl_days, refresh_token_ttl_days, updated_at
     from external_mcp_settings
     where id = ?
     limit 1`,
    EXTERNAL_MCP_SETTINGS_ID
  );
}

function integerInRange(value: unknown, label: string, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label}必须是 ${minimum}～${maximum} 天的整数`);
  }
  return parsed;
}

function storedIntegerOrDefault(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function normalizeExternalMcpSettings(input: {
  accessTokenTtlDays: unknown;
  refreshTokenTtlDays: unknown;
}) {
  return {
    accessTokenTtlDays: integerInRange(
      input.accessTokenTtlDays,
      "Access Token 有效期",
      MIN_EXTERNAL_MCP_ACCESS_TOKEN_TTL_DAYS,
      MAX_EXTERNAL_MCP_ACCESS_TOKEN_TTL_DAYS
    ),
    refreshTokenTtlDays: integerInRange(
      input.refreshTokenTtlDays,
      "Refresh Token 有效期",
      MIN_EXTERNAL_MCP_REFRESH_TOKEN_TTL_DAYS,
      MAX_EXTERNAL_MCP_REFRESH_TOKEN_TTL_DAYS
    )
  };
}

export function externalMcpSettings(db: Database = configDb) {
  const row = externalMcpSettingsRow(db);
  return {
    accessTokenTtlDays: storedIntegerOrDefault(
      row?.access_token_ttl_days,
      DEFAULT_EXTERNAL_MCP_ACCESS_TOKEN_TTL_DAYS,
      MIN_EXTERNAL_MCP_ACCESS_TOKEN_TTL_DAYS,
      MAX_EXTERNAL_MCP_ACCESS_TOKEN_TTL_DAYS
    ),
    refreshTokenTtlDays: storedIntegerOrDefault(
      row?.refresh_token_ttl_days,
      DEFAULT_EXTERNAL_MCP_REFRESH_TOKEN_TTL_DAYS,
      MIN_EXTERNAL_MCP_REFRESH_TOKEN_TTL_DAYS,
      MAX_EXTERNAL_MCP_REFRESH_TOKEN_TTL_DAYS
    ),
    updatedAt: row?.updated_at ?? ""
  };
}

export function externalMcpTokenTtlSeconds(db: Database = configDb) {
  const settings = externalMcpSettings(db);
  return {
    accessTokenTtlSeconds: settings.accessTokenTtlDays * SECONDS_PER_DAY,
    refreshTokenTtlSeconds: settings.refreshTokenTtlDays * SECONDS_PER_DAY
  };
}

export function saveExternalMcpSettings(input: {
  accessTokenTtlDays: unknown;
  refreshTokenTtlDays: unknown;
}, db: Database = configDb) {
  const settings = normalizeExternalMcpSettings(input);
  const timestamp = now();
  run(
    db,
    `insert into external_mcp_settings (id, access_token_ttl_days, refresh_token_ttl_days, updated_at)
     values (?, ?, ?, ?)
     on conflict(id) do update set
       access_token_ttl_days = excluded.access_token_ttl_days,
       refresh_token_ttl_days = excluded.refresh_token_ttl_days,
       updated_at = excluded.updated_at`,
    EXTERNAL_MCP_SETTINGS_ID,
    settings.accessTokenTtlDays,
    settings.refreshTokenTtlDays,
    timestamp
  );
  return { ...settings, updatedAt: timestamp };
}
