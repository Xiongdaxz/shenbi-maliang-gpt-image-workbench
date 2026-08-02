import type { Database } from "bun:sqlite";
import type { Context, Hono } from "hono";
import { audit } from "./auditLog";
import { requireConfig } from "./auth";
import {
  configuredMaliangPublicBaseUrl,
  maliangPublicBaseUrl,
  validateMaliangPublicOrigin
} from "./externalMcpAuth";
import { saveSiteSettings, siteSettings } from "./siteSettings";

export function normalizeSitePublicBaseUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("公开访问地址格式不正确");
  const trimmed = value.trim();
  if (!trimmed) return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("公开访问地址必须是有效的 HTTP(S) origin");
  }
  if (url.username || url.password) throw new Error("公开访问地址不能包含账号或密码");
  if (url.pathname !== "/" || trimmed.includes("?") || trimmed.includes("#")) {
    throw new Error("公开访问地址只能填写 origin，不能包含路径、查询参数或锚点");
  }
  return validateMaliangPublicOrigin(url.origin);
}

type SiteSettingsRouteOptions = {
  db?: Database;
  authorize?: typeof requireConfig;
  writeAudit?: typeof audit;
};

function siteSettingsConfig(c: Context, db?: Database) {
  const settings = siteSettings(db);
  const configured = configuredMaliangPublicBaseUrl({ sitePublicBaseUrl: settings.publicBaseUrl });
  let publicBaseUrl = "";
  let error = "";
  try {
    publicBaseUrl = maliangPublicBaseUrl(c, configured.publicBaseUrl);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "无法识别当前公开访问地址";
  }
  return {
    settings,
    effective: {
      publicBaseUrl,
      source: configured.source,
      environmentOverride: configured.environmentOverride,
      error
    }
  };
}

export function registerSiteSettingsRoutes(api: Hono, options: SiteSettingsRouteOptions = {}) {
  const authorize = options.authorize ?? requireConfig;
  const writeAudit = options.writeAudit ?? audit;

  api.get("/config/site-settings", (c) => {
    const blocked = authorize(c);
    if (blocked) return blocked;
    return c.json(siteSettingsConfig(c, options.db));
  });

  api.put("/config/site-settings", async (c) => {
    const blocked = authorize(c);
    if (blocked) return blocked;
    const configured = configuredMaliangPublicBaseUrl({ sitePublicBaseUrl: "" });
    if (configured.environmentOverride) {
      return c.json({ error: `当前由 ${configured.source} 环境变量接管，请在部署配置中修改公开访问地址` }, 409);
    }
    const body = await c.req.json().catch(() => ({}));
    let publicBaseUrl = "";
    try {
      publicBaseUrl = normalizeSitePublicBaseUrl((body as Record<string, unknown>).publicBaseUrl);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "公开访问地址格式不正确" }, 400);
    }
    const settings = saveSiteSettings(publicBaseUrl, options.db);
    writeAudit("site_settings.save", { publicBaseUrl: settings.publicBaseUrl || "automatic" });
    return c.json(siteSettingsConfig(c, options.db));
  });
}
