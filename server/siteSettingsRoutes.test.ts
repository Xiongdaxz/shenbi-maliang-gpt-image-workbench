import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { siteSettings } from "./siteSettings";
import { normalizeSitePublicBaseUrl, registerSiteSettingsRoutes } from "./siteSettingsRoutes";

const originalAppPublicUrl = Bun.env.APP_PUBLIC_URL;
const originalMaliangPublicBaseUrl = Bun.env.MALIANG_PUBLIC_BASE_URL;

function restoreEnvironment(name: "APP_PUBLIC_URL" | "MALIANG_PUBLIC_BASE_URL", value: string | undefined) {
  if (value === undefined) delete Bun.env[name];
  else Bun.env[name] = value;
}

function siteSettingsTestDb(publicBaseUrl = "") {
  const db = new Database(":memory:");
  db.run(`
    create table site_settings (
      id text primary key,
      public_base_url text not null default '',
      updated_at text not null
    )
  `);
  db.query(
    "insert into site_settings (id, public_base_url, updated_at) values (?, ?, ?)"
  ).run(
    "default",
    publicBaseUrl,
    "2026-08-01T00:00:00.000Z"
  );
  return db;
}

afterEach(() => {
  restoreEnvironment("APP_PUBLIC_URL", originalAppPublicUrl);
  restoreEnvironment("MALIANG_PUBLIC_BASE_URL", originalMaliangPublicBaseUrl);
});

describe("site public URL validation", () => {
  test("keeps blank values in automatic mode and normalizes valid origins", () => {
    expect(normalizeSitePublicBaseUrl("  ")).toBe("");
    expect(normalizeSitePublicBaseUrl("https://IMAGE.example.com:443/")).toBe("https://image.example.com");
    expect(normalizeSitePublicBaseUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(normalizeSitePublicBaseUrl("http://192.168.0.87:8787/")).toBe("http://192.168.0.87:8787");
  });

  test("requires HTTPS for public hosts", () => {
    expect(() => normalizeSitePublicBaseUrl("http://image.example.com"))
      .toThrow("必须使用 HTTPS");
  });

  test("rejects paths, query parameters, fragments, and embedded credentials", () => {
    expect(() => normalizeSitePublicBaseUrl("https://image.example.com/install"))
      .toThrow("只能填写 origin");
    expect(() => normalizeSitePublicBaseUrl("https://image.example.com?source=admin"))
      .toThrow("只能填写 origin");
    expect(() => normalizeSitePublicBaseUrl("https://image.example.com#install"))
      .toThrow("只能填写 origin");
    expect(() => normalizeSitePublicBaseUrl("https://admin:secret@image.example.com"))
      .toThrow("不能包含账号或密码");
  });
});

describe("site settings routes", () => {
  test("GET and PUT persist the configured origin and write an audit event", async () => {
    Bun.env.APP_PUBLIC_URL = "";
    Bun.env.MALIANG_PUBLIC_BASE_URL = "";
    const db = siteSettingsTestDb();
    const audits: Array<{ action: string; detail: unknown }> = [];
    const app = new Hono();
    registerSiteSettingsRoutes(app, {
      db,
      authorize: () => null,
      writeAudit: (action, detail = {}) => audits.push({ action, detail })
    });

    try {
      const initialResponse = await app.request("https://request.example.com/config/site-settings");
      expect(initialResponse.status).toBe(200);
      const initial = await initialResponse.json() as {
        settings: { publicBaseUrl: string };
        effective: { publicBaseUrl: string; source: string; environmentOverride: boolean };
      };
      expect(initial.settings.publicBaseUrl).toBe("");
      expect(initial.effective).toMatchObject({
        publicBaseUrl: "https://request.example.com",
        source: "automatic",
        environmentOverride: false
      });

      const saveResponse = await app.request("https://request.example.com/config/site-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicBaseUrl: "https://IMAGE.example.com:443/" })
      });
      expect(saveResponse.status).toBe(200);
      const saved = await saveResponse.json() as {
        settings: { publicBaseUrl: string; updatedAt: string };
        effective: { publicBaseUrl: string; source: string; environmentOverride: boolean };
      };
      expect(saved.settings.publicBaseUrl).toBe("https://image.example.com");
      expect(saved.settings.updatedAt).not.toBe("");
      expect(saved.effective).toMatchObject({
        publicBaseUrl: "https://image.example.com",
        source: "site_settings",
        environmentOverride: false
      });
      expect(siteSettings(db).publicBaseUrl).toBe("https://image.example.com");
      expect(audits).toEqual([{
        action: "site_settings.save",
        detail: { publicBaseUrl: "https://image.example.com" }
      }]);
    } finally {
      db.close();
    }
  });

  test("rejects writes while an environment variable owns the public origin", async () => {
    Bun.env.APP_PUBLIC_URL = "https://deployment.example.com";
    Bun.env.MALIANG_PUBLIC_BASE_URL = "";
    const db = siteSettingsTestDb("https://stored.example.com");
    const audits: Array<{ action: string; detail: unknown }> = [];
    const app = new Hono();
    registerSiteSettingsRoutes(app, {
      db,
      authorize: () => null,
      writeAudit: (action, detail = {}) => audits.push({ action, detail })
    });

    try {
      const response = await app.request("https://request.example.com/config/site-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicBaseUrl: "https://new.example.com" })
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "当前由 APP_PUBLIC_URL 环境变量接管，请在部署配置中修改公开访问地址"
      });
      expect(siteSettings(db).publicBaseUrl).toBe("https://stored.example.com");
      expect(audits).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("does not turn a database read failure into automatic mode", () => {
    const db = new Database(":memory:");
    try {
      expect(() => siteSettings(db)).toThrow();
    } finally {
      db.close();
    }
  });
});
