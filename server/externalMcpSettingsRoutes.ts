import type { Database } from "bun:sqlite";
import type { Hono } from "hono";
import { audit } from "./auditLog";
import { requireConfig } from "./auth";
import {
  externalMcpSettings,
  normalizeExternalMcpSettings,
  saveExternalMcpSettings
} from "./externalMcpSettings";

type ExternalMcpSettingsRouteOptions = {
  db?: Database;
  authorize?: typeof requireConfig;
  writeAudit?: typeof audit;
};

export function registerExternalMcpSettingsRoutes(api: Hono, options: ExternalMcpSettingsRouteOptions = {}) {
  const authorize = options.authorize ?? requireConfig;
  const writeAudit = options.writeAudit ?? audit;

  api.get("/config/external-mcp-settings", (c) => {
    const blocked = authorize(c);
    if (blocked) return blocked;
    return c.json({ settings: externalMcpSettings(options.db) });
  });

  api.put("/config/external-mcp-settings", async (c) => {
    const blocked = authorize(c);
    if (blocked) return blocked;
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    let normalized: ReturnType<typeof normalizeExternalMcpSettings>;
    try {
      normalized = normalizeExternalMcpSettings({
        accessTokenTtlDays: body.accessTokenTtlDays,
        refreshTokenTtlDays: body.refreshTokenTtlDays
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Remote MCP 授权设置格式不正确" }, 400);
    }
    const settings = saveExternalMcpSettings(normalized, options.db);
    writeAudit("external_mcp_settings.save", {
      accessTokenTtlDays: settings.accessTokenTtlDays,
      refreshTokenTtlDays: settings.refreshTokenTtlDays
    });
    return c.json({ settings });
  });
}
