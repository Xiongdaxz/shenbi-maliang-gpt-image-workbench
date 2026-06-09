import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { LOGIN_ASSET_EXTENSIONS } from "./constants";
import { audit } from "./auditLog";
import { requireConfig } from "./auth";
import { configDb, getAll, getOne, run } from "./db";
import { readImageDimensions } from "./imageDimensions";
import { imageExtensionFromMime, mimeTypeFromPath } from "./imageFiles";
import { buildLoginAssets, loginAssetFiles } from "./loginAssets";
import { deleteStoredFilesIfUnreferenced, readStoredFile, secureBrandingAssetPath, writeEncryptedFile } from "./secureFiles";
import type { BrandingAssetRow, BrandingAssetType, BrandingSettingsRow } from "./types";
import { makeId, normalizeIdList, now } from "./utils";

const DEFAULT_SITE_NAME = "神笔马良";
const DEFAULT_LOGO_ASSET_ID = "builtin-logo";
const DEFAULT_FAVICON_ASSET_ID = "builtin-favicon";
const DEFAULT_LOGIN_TITLE_LIGHT_ASSET_ID = "builtin-login-title-light";
const DEFAULT_LOGIN_TITLE_DARK_ASSET_ID = "builtin-login-title-dark";
const BRANDING_SETTINGS_ID = "default";
const BRANDING_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const BRANDING_UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);
const BRANDING_ASSET_TYPES: BrandingAssetType[] = [
  "logo",
  "favicon",
  "login_title",
  "login_background_light",
  "login_background_dark"
];

type BrandingDefaults = {
  activeLogoAssetId: string;
  activeFaviconAssetId: string;
  activeLoginTitleLightAssetId: string;
  activeLoginTitleDarkAssetId: string;
  loginBackgroundLightAssetIds: string[];
  loginBackgroundDarkAssetIds: string[];
};

type BrandingSettings = BrandingDefaults & {
  siteName: string;
  updatedAt: string;
};

function normalizeBrandingAssetType(value: unknown): BrandingAssetType | null {
  const type = String(value ?? "").trim();
  return BRANDING_ASSET_TYPES.includes(type as BrandingAssetType) ? (type as BrandingAssetType) : null;
}

function builtinAssetId(type: BrandingAssetType, url: string) {
  const hash = createHash("sha1").update(`${type}:${url}`).digest("hex").slice(0, 12);
  return `builtin-${type.replaceAll("_", "-")}-${hash}`;
}

function cleanAssetName(value: unknown, fallback: string) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  return name ? Array.from(name).slice(0, 48).join("") : fallback;
}

function cleanSiteName(value: unknown) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  return name ? Array.from(name).slice(0, 40).join("") : DEFAULT_SITE_NAME;
}

function assetUrl(row: BrandingAssetRow) {
  if (row.source === "uploaded") return `/api/files/branding/${encodeURIComponent(row.id)}`;
  return row.url || row.path || "";
}

function publicAsset(row: BrandingAssetRow) {
  return {
    id: row.id,
    type: normalizeBrandingAssetType(row.type) ?? "logo",
    source: row.source === "builtin" ? "builtin" : "uploaded",
    name: row.name,
    url: assetUrl(row),
    mimeType: row.mime_type || mimeTypeFromPath(row.url || row.path),
    size: row.size,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    enabled: Boolean(row.enabled),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function builtinDisplayName(url: string, fallback: string) {
  const file = url.split("/").pop() ?? fallback;
  try {
    return decodeURIComponent(file);
  } catch {
    return file || fallback;
  }
}

function upsertBuiltinAsset(input: {
  id: string;
  type: BrandingAssetType;
  name: string;
  url: string;
  sortOrder: number;
  mimeType?: string;
}) {
  const timestamp = now();
  run(
    configDb,
    `insert into branding_assets (
      id, type, source, name, path, url, mime_type, size, image_width, image_height, enabled, sort_order, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      type = excluded.type,
      source = excluded.source,
      path = '',
      url = excluded.url,
      mime_type = excluded.mime_type`,
    input.id,
    input.type,
    "builtin",
    input.name,
    "",
    input.url,
    input.mimeType ?? mimeTypeFromPath(input.url),
    0,
    0,
    0,
    1,
    input.sortOrder,
    timestamp,
    timestamp
  );
}

async function ensureBuiltinBrandingAssets() {
  const files = await loginAssetFiles();
  const loginAssets = buildLoginAssets(files);
  upsertBuiltinAsset({
    id: DEFAULT_LOGO_ASSET_ID,
    type: "logo",
    name: "默认 Logo",
    url: "/image/logo.png",
    sortOrder: 0,
    mimeType: "image/png"
  });
  upsertBuiltinAsset({
    id: DEFAULT_FAVICON_ASSET_ID,
    type: "favicon",
    name: "默认浏览器图标",
    url: "/image/logo.png",
    sortOrder: 0,
    mimeType: "image/png"
  });
  if (loginAssets.titles.light) {
    upsertBuiltinAsset({
      id: DEFAULT_LOGIN_TITLE_LIGHT_ASSET_ID,
      type: "login_title",
      name: "默认浅色标题图",
      url: loginAssets.titles.light,
      sortOrder: 10
    });
  }
  if (loginAssets.titles.dark) {
    upsertBuiltinAsset({
      id: DEFAULT_LOGIN_TITLE_DARK_ASSET_ID,
      type: "login_title",
      name: "默认暗色标题图",
      url: loginAssets.titles.dark,
      sortOrder: 20
    });
  }
  loginAssets.backgrounds.light.forEach((url, index) => {
    upsertBuiltinAsset({
      id: builtinAssetId("login_background_light", url),
      type: "login_background_light",
      name: builtinDisplayName(url, `浅色背景 ${index + 1}`),
      url,
      sortOrder: index + 1
    });
  });
  loginAssets.backgrounds.dark.forEach((url, index) => {
    upsertBuiltinAsset({
      id: builtinAssetId("login_background_dark", url),
      type: "login_background_dark",
      name: builtinDisplayName(url, `暗色背景 ${index + 1}`),
      url,
      sortOrder: index + 1
    });
  });
}

function brandingAssetRows() {
  return getAll<BrandingAssetRow>(
    configDb,
    "select * from branding_assets order by type asc, sort_order asc, created_at asc"
  );
}

function assetsById(rows: BrandingAssetRow[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function sortedAssetIds(rows: BrandingAssetRow[], type: BrandingAssetType, source?: "builtin" | "uploaded") {
  return rows
    .filter((row) => row.type === type && (!source || row.source === source) && row.enabled)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    .map((row) => row.id);
}

function defaultBrandingSettings(rows: BrandingAssetRow[]): BrandingSettings {
  const timestamp = now();
  return {
    siteName: DEFAULT_SITE_NAME,
    activeLogoAssetId: rows.some((row) => row.id === DEFAULT_LOGO_ASSET_ID) ? DEFAULT_LOGO_ASSET_ID : "",
    activeFaviconAssetId: rows.some((row) => row.id === DEFAULT_FAVICON_ASSET_ID) ? DEFAULT_FAVICON_ASSET_ID : "",
    activeLoginTitleLightAssetId: rows.some((row) => row.id === DEFAULT_LOGIN_TITLE_LIGHT_ASSET_ID) ? DEFAULT_LOGIN_TITLE_LIGHT_ASSET_ID : "",
    activeLoginTitleDarkAssetId: rows.some((row) => row.id === DEFAULT_LOGIN_TITLE_DARK_ASSET_ID)
      ? DEFAULT_LOGIN_TITLE_DARK_ASSET_ID
      : rows.some((row) => row.id === DEFAULT_LOGIN_TITLE_LIGHT_ASSET_ID)
        ? DEFAULT_LOGIN_TITLE_LIGHT_ASSET_ID
        : "",
    loginBackgroundLightAssetIds: sortedAssetIds(rows, "login_background_light", "builtin"),
    loginBackgroundDarkAssetIds: sortedAssetIds(rows, "login_background_dark", "builtin"),
    updatedAt: timestamp
  };
}

function jsonIdList(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]");
    return normalizeIdList(parsed);
  } catch {
    return [];
  }
}

function existingAssetId(
  rowsById: Map<string, BrandingAssetRow>,
  id: string,
  allowedTypes: BrandingAssetType[],
  fallback: string
) {
  const row = rowsById.get(id);
  return row && allowedTypes.includes(row.type as BrandingAssetType) ? row.id : fallback;
}

function existingAssetIds(
  rowsById: Map<string, BrandingAssetRow>,
  ids: string[],
  type: BrandingAssetType,
  fallback: string[]
) {
  const existing = ids.filter((id) => {
    const row = rowsById.get(id);
    return row?.type === type && row.enabled;
  });
  return existing.length > 0 ? Array.from(new Set(existing)) : fallback;
}

function normalizeSettingsRow(row: BrandingSettingsRow | null, rows: BrandingAssetRow[]) {
  const defaults = defaultBrandingSettings(rows);
  if (!row) return defaults;
  const byId = assetsById(rows);
  return {
    siteName: cleanSiteName(row.site_name),
    activeLogoAssetId: existingAssetId(byId, row.active_logo_asset_id, ["logo"], defaults.activeLogoAssetId),
    activeFaviconAssetId: existingAssetId(byId, row.active_favicon_asset_id, ["favicon", "logo"], defaults.activeFaviconAssetId),
    activeLoginTitleLightAssetId: existingAssetId(
      byId,
      row.active_login_title_light_asset_id,
      ["login_title"],
      defaults.activeLoginTitleLightAssetId
    ),
    activeLoginTitleDarkAssetId: existingAssetId(
      byId,
      row.active_login_title_dark_asset_id,
      ["login_title"],
      defaults.activeLoginTitleDarkAssetId
    ),
    loginBackgroundLightAssetIds: existingAssetIds(
      byId,
      jsonIdList(row.login_background_light_ids_json),
      "login_background_light",
      defaults.loginBackgroundLightAssetIds
    ),
    loginBackgroundDarkAssetIds: existingAssetIds(
      byId,
      jsonIdList(row.login_background_dark_ids_json),
      "login_background_dark",
      defaults.loginBackgroundDarkAssetIds
    ),
    updatedAt: row.updated_at
  };
}

function persistBrandingSettings(settings: BrandingSettings) {
  run(
    configDb,
    `insert into branding_settings (
      id, site_name, active_logo_asset_id, active_favicon_asset_id,
      active_login_title_light_asset_id, active_login_title_dark_asset_id,
      login_background_light_ids_json, login_background_dark_ids_json, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      site_name = excluded.site_name,
      active_logo_asset_id = excluded.active_logo_asset_id,
      active_favicon_asset_id = excluded.active_favicon_asset_id,
      active_login_title_light_asset_id = excluded.active_login_title_light_asset_id,
      active_login_title_dark_asset_id = excluded.active_login_title_dark_asset_id,
      login_background_light_ids_json = excluded.login_background_light_ids_json,
      login_background_dark_ids_json = excluded.login_background_dark_ids_json,
      updated_at = excluded.updated_at`,
    BRANDING_SETTINGS_ID,
    settings.siteName,
    settings.activeLogoAssetId,
    settings.activeFaviconAssetId,
    settings.activeLoginTitleLightAssetId,
    settings.activeLoginTitleDarkAssetId,
    JSON.stringify(settings.loginBackgroundLightAssetIds),
    JSON.stringify(settings.loginBackgroundDarkAssetIds),
    settings.updatedAt
  );
}

export async function brandingConfig() {
  await ensureBuiltinBrandingAssets();
  const rows = brandingAssetRows();
  const row = getOne<BrandingSettingsRow>(configDb, "select * from branding_settings where id = ? limit 1", BRANDING_SETTINGS_ID);
  const defaults = defaultBrandingSettings(rows);
  const settings = normalizeSettingsRow(row, rows);
  if (!row) persistBrandingSettings(settings);
  return {
    settings,
    assets: rows.map(publicAsset),
    defaults
  };
}

function loginBackgroundUrls(rowsById: Map<string, BrandingAssetRow>, ids: string[], fallbackType: BrandingAssetType) {
  const urls = ids
    .map((id) => rowsById.get(id))
    .filter((row): row is BrandingAssetRow => Boolean(row && row.enabled && row.type === fallbackType))
    .map(assetUrl)
    .filter(Boolean);
  if (urls.length > 0) return urls;
  return Array.from(rowsById.values())
    .filter((row) => row.enabled && row.type === fallbackType)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    .map(assetUrl)
    .filter(Boolean);
}

export async function publicBranding() {
  const config = await brandingConfig();
  const rows = brandingAssetRows();
  const byId = assetsById(rows);
  const logo = byId.get(config.settings.activeLogoAssetId) ?? byId.get(DEFAULT_LOGO_ASSET_ID);
  const favicon = byId.get(config.settings.activeFaviconAssetId) ?? logo ?? byId.get(DEFAULT_FAVICON_ASSET_ID);
  const lightTitle = byId.get(config.settings.activeLoginTitleLightAssetId) ?? byId.get(DEFAULT_LOGIN_TITLE_LIGHT_ASSET_ID);
  const darkTitle = byId.get(config.settings.activeLoginTitleDarkAssetId) ?? byId.get(DEFAULT_LOGIN_TITLE_DARK_ASSET_ID) ?? lightTitle;
  const titleFallbacks = Array.from(
    new Set(
      [
        lightTitle ? assetUrl(lightTitle) : "",
        darkTitle ? assetUrl(darkTitle) : "",
        ...Array.from(byId.values())
          .filter((row) => row.type === "login_title" && row.enabled)
          .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
          .map(assetUrl)
      ].filter(Boolean)
    )
  );
  return {
    siteName: config.settings.siteName,
    logoUrl: logo ? assetUrl(logo) : "/image/logo.png",
    faviconUrl: favicon ? assetUrl(favicon) : "/image/logo.png",
    loginAssets: {
      backgrounds: {
        light: loginBackgroundUrls(byId, config.settings.loginBackgroundLightAssetIds, "login_background_light"),
        dark: loginBackgroundUrls(byId, config.settings.loginBackgroundDarkAssetIds, "login_background_dark")
      },
      titles: {
        light: lightTitle ? assetUrl(lightTitle) : "",
        dark: darkTitle ? assetUrl(darkTitle) : lightTitle ? assetUrl(lightTitle) : ""
      },
      titleFallbacks
    }
  };
}

function normalizeIncomingSettings(raw: Record<string, unknown>, rows: BrandingAssetRow[]) {
  const defaults = defaultBrandingSettings(rows);
  const byId = assetsById(rows);
  const timestamp = now();
  return {
    siteName: cleanSiteName(raw.siteName),
    activeLogoAssetId: existingAssetId(byId, String(raw.activeLogoAssetId ?? ""), ["logo"], defaults.activeLogoAssetId),
    activeFaviconAssetId: existingAssetId(byId, String(raw.activeFaviconAssetId ?? ""), ["favicon", "logo"], defaults.activeFaviconAssetId),
    activeLoginTitleLightAssetId: existingAssetId(
      byId,
      String(raw.activeLoginTitleLightAssetId ?? ""),
      ["login_title"],
      defaults.activeLoginTitleLightAssetId
    ),
    activeLoginTitleDarkAssetId: existingAssetId(
      byId,
      String(raw.activeLoginTitleDarkAssetId ?? ""),
      ["login_title"],
      defaults.activeLoginTitleDarkAssetId
    ),
    loginBackgroundLightAssetIds: existingAssetIds(
      byId,
      normalizeIdList(raw.loginBackgroundLightAssetIds),
      "login_background_light",
      defaults.loginBackgroundLightAssetIds
    ),
    loginBackgroundDarkAssetIds: existingAssetIds(
      byId,
      normalizeIdList(raw.loginBackgroundDarkAssetIds),
      "login_background_dark",
      defaults.loginBackgroundDarkAssetIds
    ),
    updatedAt: timestamp
  };
}

function currentBrandingReferences() {
  const rows = brandingAssetRows();
  const row = getOne<BrandingSettingsRow>(configDb, "select * from branding_settings where id = ? limit 1", BRANDING_SETTINGS_ID);
  const settings = normalizeSettingsRow(row, rows);
  return new Set([
    settings.activeLogoAssetId,
    settings.activeFaviconAssetId,
    settings.activeLoginTitleLightAssetId,
    settings.activeLoginTitleDarkAssetId,
    ...settings.loginBackgroundLightAssetIds,
    ...settings.loginBackgroundDarkAssetIds
  ].filter(Boolean));
}

function imageResponse(buffer: Buffer, mimeType: string) {
  const etag = `"${createHash("sha1").update(buffer).digest("base64url").slice(0, 20)}"`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mimeType || "image/png",
      "Content-Length": String(buffer.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "ETag": etag
    }
  });
}

export function registerBrandingRoutes(api: Hono) {
  api.get("/branding", async (c) => c.json(await publicBranding()));

  api.get("/config/branding", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    return c.json(await brandingConfig());
  });

  api.put("/config/branding", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    await ensureBuiltinBrandingAssets();
    const body = await c.req.json().catch(() => ({}));
    const settings = normalizeIncomingSettings(body as Record<string, unknown>, brandingAssetRows());
    persistBrandingSettings(settings);
    audit("branding.save", { siteName: settings.siteName });
    return c.json(await brandingConfig());
  });

  api.post("/config/branding/reset", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    await ensureBuiltinBrandingAssets();
    const settings = defaultBrandingSettings(brandingAssetRows());
    persistBrandingSettings(settings);
    audit("branding.reset", { siteName: settings.siteName });
    return c.json(await brandingConfig());
  });

  api.post("/config/branding/assets", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const form = await c.req.formData();
    const type = normalizeBrandingAssetType(form.get("type"));
    if (!type) return c.json({ error: "品牌资源类型不正确" }, 400);
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "请选择要上传的图片" }, 400);
    const mimeType = String(file.type || "").toLowerCase();
    const extension = mimeType ? `.${imageExtensionFromMime(mimeType)}`.toLowerCase() : file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!BRANDING_UPLOAD_MIME_TYPES.has(mimeType) && !LOGIN_ASSET_EXTENSIONS.has(extension)) {
      return c.json({ error: "仅支持 PNG、JPG、WebP 或 AVIF 图片" }, 400);
    }
    if (file.size > BRANDING_UPLOAD_MAX_BYTES) return c.json({ error: "品牌图片不能超过 10MB" }, 400);
    const id = makeId("brand");
    const buffer = Buffer.from(await file.arrayBuffer());
    const dimensions = readImageDimensions(buffer);
    const path = secureBrandingAssetPath(id);
    await writeEncryptedFile(path, buffer);
    const timestamp = now();
    const sortOrder =
      (getOne<{ max_sort: number | null }>(configDb, "select max(sort_order) as max_sort from branding_assets where type = ?", type)
        ?.max_sort ?? 100) + 10;
    const name = cleanAssetName(form.get("name"), file.name || "自定义品牌图片");
    run(
      configDb,
      `insert into branding_assets (
        id, type, source, name, path, url, mime_type, size, image_width, image_height, enabled, sort_order, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      type,
      "uploaded",
      name,
      path,
      "",
      mimeType || mimeTypeFromPath(file.name),
      buffer.length,
      dimensions.width,
      dimensions.height,
      1,
      sortOrder,
      timestamp,
      timestamp
    );
    audit("branding.asset.upload", { assetId: id, type, name });
    return c.json(await brandingConfig());
  });

  api.patch("/config/branding/assets/:id", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const id = c.req.param("id");
    const row = getOne<BrandingAssetRow>(configDb, "select * from branding_assets where id = ? limit 1", id);
    if (!row) return c.json({ error: "品牌资源不存在" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const name = Object.prototype.hasOwnProperty.call(body, "name") ? cleanAssetName((body as Record<string, unknown>).name, row.name) : row.name;
    const enabled = Object.prototype.hasOwnProperty.call(body, "enabled") ? Boolean((body as Record<string, unknown>).enabled) : Boolean(row.enabled);
    const sortOrder = Object.prototype.hasOwnProperty.call(body, "sortOrder")
      ? Math.trunc(Number((body as Record<string, unknown>).sortOrder))
      : row.sort_order;
    run(
      configDb,
      "update branding_assets set name = ?, enabled = ?, sort_order = ?, updated_at = ? where id = ?",
      name,
      enabled ? 1 : 0,
      Number.isFinite(sortOrder) ? sortOrder : row.sort_order,
      now(),
      id
    );
    audit("branding.asset.update", { assetId: id, source: row.source, type: row.type, name, enabled });
    return c.json(await brandingConfig());
  });

  api.delete("/config/branding/assets/:id", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const id = c.req.param("id");
    const row = getOne<BrandingAssetRow>(configDb, "select * from branding_assets where id = ? limit 1", id);
    if (!row) return c.json({ error: "品牌资源不存在" }, 404);
    if (row.source === "builtin") return c.json({ error: "系统默认资源不能删除" }, 400);
    if (currentBrandingReferences().has(id)) return c.json({ error: "该资源正在使用，请先切换到其他资源" }, 400);
    run(configDb, "delete from branding_assets where id = ?", id);
    if (row.path) await deleteStoredFilesIfUnreferenced([row.path]);
    audit("branding.asset.delete", { assetId: id, type: row.type, name: row.name });
    return c.json(await brandingConfig());
  });

  api.get("/files/branding/:id", async (c) => {
    const row = getOne<BrandingAssetRow>(configDb, "select * from branding_assets where id = ? limit 1", c.req.param("id"));
    if (!row || row.source !== "uploaded" || !row.path) return c.json({ error: "品牌资源不存在" }, 404);
    try {
      return imageResponse(await readStoredFile(row.path), row.mime_type || "image/png");
    } catch (error) {
      console.warn("品牌资源读取失败", row.id, error);
      return c.json({ error: "品牌资源文件不存在" }, 404);
    }
  });
}
