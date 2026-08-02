import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  DEFAULT_EXTERNAL_MCP_ACCESS_TOKEN_TTL_DAYS,
  DEFAULT_EXTERNAL_MCP_REFRESH_TOKEN_TTL_DAYS,
  externalMcpSettings,
  externalMcpTokenTtlSeconds,
  migrateExternalMcpSettingsStorage,
  normalizeExternalMcpSettings,
  saveExternalMcpSettings
} from "./externalMcpSettings";
import { registerExternalMcpSettingsRoutes } from "./externalMcpSettingsRoutes";

function externalMcpSettingsTestDb() {
  const db = new Database(":memory:");
  db.run(`
    create table external_mcp_settings (
      id text primary key,
      access_token_ttl_days integer not null default 7,
      refresh_token_ttl_days integer not null default 90,
      updated_at text not null
    )
  `);
  db.query(`
    insert into external_mcp_settings
      (id, access_token_ttl_days, refresh_token_ttl_days, updated_at)
    values ('default', 7, 90, '2026-08-01T00:00:00.000Z')
  `).run();
  return db;
}

describe("external MCP settings", () => {
  test("uses the agreed defaults and converts days to seconds", () => {
    const db = externalMcpSettingsTestDb();
    try {
      expect(externalMcpSettings(db)).toEqual({
        accessTokenTtlDays: DEFAULT_EXTERNAL_MCP_ACCESS_TOKEN_TTL_DAYS,
        refreshTokenTtlDays: DEFAULT_EXTERNAL_MCP_REFRESH_TOKEN_TTL_DAYS,
        updatedAt: "2026-08-01T00:00:00.000Z"
      });
      expect(externalMcpTokenTtlSeconds(db)).toEqual({
        accessTokenTtlSeconds: 7 * 24 * 60 * 60,
        refreshTokenTtlSeconds: 90 * 24 * 60 * 60
      });
    } finally {
      db.close();
    }
  });

  test("accepts integer values in range and rejects unsafe values", () => {
    expect(normalizeExternalMcpSettings({ accessTokenTtlDays: "365", refreshTokenTtlDays: 3650 }))
      .toEqual({ accessTokenTtlDays: 365, refreshTokenTtlDays: 3650 });
    expect(() => normalizeExternalMcpSettings({ accessTokenTtlDays: 0, refreshTokenTtlDays: 90 }))
      .toThrow("1～365");
    expect(() => normalizeExternalMcpSettings({ accessTokenTtlDays: 7.5, refreshTokenTtlDays: 90 }))
      .toThrow("整数");
    expect(() => normalizeExternalMcpSettings({ accessTokenTtlDays: 366, refreshTokenTtlDays: 90 }))
      .toThrow("1～365");
    expect(() => normalizeExternalMcpSettings({ accessTokenTtlDays: 7, refreshTokenTtlDays: 3651 }))
      .toThrow("30～3650");
  });

  test("falls back to safe defaults if an older database contains invalid values", () => {
    const db = externalMcpSettingsTestDb();
    try {
      db.query("update external_mcp_settings set access_token_ttl_days = 0, refresh_token_ttl_days = 99999 where id = 'default'").run();
      expect(externalMcpSettings(db)).toMatchObject({
        accessTokenTtlDays: DEFAULT_EXTERNAL_MCP_ACCESS_TOKEN_TTL_DAYS,
        refreshTokenTtlDays: DEFAULT_EXTERNAL_MCP_REFRESH_TOKEN_TTL_DAYS
      });
    } finally {
      db.close();
    }
  });

  test("persists values and exposes authenticated GET and PUT routes", async () => {
    const db = externalMcpSettingsTestDb();
    const audits: Array<{ action: string; detail: unknown }> = [];
    const app = new Hono();
    registerExternalMcpSettingsRoutes(app, {
      db,
      authorize: () => null,
      writeAudit: (action, detail = {}) => audits.push({ action, detail })
    });

    try {
      const initial = await app.request("http://localhost/config/external-mcp-settings");
      expect(initial.status).toBe(200);
      expect(await initial.json()).toMatchObject({
        settings: { accessTokenTtlDays: 7, refreshTokenTtlDays: 90 }
      });

      const savedResponse = await app.request("http://localhost/config/external-mcp-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessTokenTtlDays: 14, refreshTokenTtlDays: 120 })
      });
      expect(savedResponse.status).toBe(200);
      expect(await savedResponse.json()).toMatchObject({
        settings: { accessTokenTtlDays: 14, refreshTokenTtlDays: 120 }
      });
      expect(externalMcpSettings(db)).toMatchObject({ accessTokenTtlDays: 14, refreshTokenTtlDays: 120 });
      expect(audits).toEqual([{
        action: "external_mcp_settings.save",
        detail: { accessTokenTtlDays: 14, refreshTokenTtlDays: 120 }
      }]);
    } finally {
      db.close();
    }
  });

  test("rejects invalid writes without changing the stored settings", async () => {
    const db = externalMcpSettingsTestDb();
    const app = new Hono();
    registerExternalMcpSettingsRoutes(app, { db, authorize: () => null });
    try {
      const response = await app.request("http://localhost/config/external-mcp-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessTokenTtlDays: 366, refreshTokenTtlDays: 90 })
      });
      expect(response.status).toBe(400);
      expect(externalMcpSettings(db)).toMatchObject({ accessTokenTtlDays: 7, refreshTokenTtlDays: 90 });
      expect(() => saveExternalMcpSettings({ accessTokenTtlDays: 7, refreshTokenTtlDays: 29 }, db))
        .toThrow("30～3650");
    } finally {
      db.close();
    }
  });

  test("removes the old SQLite range checks before saving expanded values", () => {
    const db = new Database(":memory:");
    try {
      db.run(`
        create table external_mcp_settings (
          id text primary key,
          access_token_ttl_days integer not null check(access_token_ttl_days between 1 and 30),
          refresh_token_ttl_days integer not null check(refresh_token_ttl_days between 30 and 180),
          updated_at text not null
        )
      `);
      db.query(`insert into external_mcp_settings values ('default', 7, 90, 'before')`).run();

      expect(migrateExternalMcpSettingsStorage(db)).toBe(true);
      expect(migrateExternalMcpSettingsStorage(db)).toBe(false);
      expect(saveExternalMcpSettings({ accessTokenTtlDays: 365, refreshTokenTtlDays: 3650 }, db))
        .toMatchObject({ accessTokenTtlDays: 365, refreshTokenTtlDays: 3650 });
      expect(db.query("select access_token_ttl_days, refresh_token_ttl_days from external_mcp_settings where id = 'default'").get())
        .toEqual({ access_token_ttl_days: 365, refresh_token_ttl_days: 3650 });
    } finally {
      db.close();
    }
  });
});
