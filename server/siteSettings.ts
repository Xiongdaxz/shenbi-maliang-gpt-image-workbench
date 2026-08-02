import type { Database } from "bun:sqlite";
import { configDb, getOne, run } from "./db";
import type { SiteSettingsRow } from "./types";
import { now } from "./utils";

const SITE_SETTINGS_ID = "default";

function siteSettingsRow(db: Database) {
  return getOne<SiteSettingsRow>(
    db,
    "select id, public_base_url, updated_at from site_settings where id = ? limit 1",
    SITE_SETTINGS_ID
  );
}

export function siteSettings(db: Database = configDb) {
  const row = siteSettingsRow(db);
  return {
    publicBaseUrl: String(row?.public_base_url ?? "").trim(),
    updatedAt: row?.updated_at ?? ""
  };
}

export function storedSitePublicBaseUrl(db: Database = configDb) {
  return siteSettings(db).publicBaseUrl;
}

export function saveSiteSettings(publicBaseUrl: string, db: Database = configDb) {
  const timestamp = now();
  run(
    db,
    `insert into site_settings (id, public_base_url, updated_at)
     values (?, ?, ?)
     on conflict(id) do update set
       public_base_url = excluded.public_base_url,
       updated_at = excluded.updated_at`,
    SITE_SETTINGS_ID,
    publicBaseUrl,
    timestamp
  );
  return { publicBaseUrl, updatedAt: timestamp };
}
