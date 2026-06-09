import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import {
  APP_DB_PATH,
  ASSET_DIR,
  CONFIG_DB_PATH,
  DATA_DIR,
  IMAGE_DIR,
  IMAGE_MASK_DIR,
  IMAGE_REFERENCE_DIR,
  SECURE_ASSET_DIR,
  SECURE_IMAGE_DIR,
  SECURE_IMAGE_REFERENCE_DIR
} from "./paths";

await Promise.all([
  mkdir(DATA_DIR, { recursive: true }),
  mkdir(IMAGE_DIR, { recursive: true }),
  mkdir(ASSET_DIR, { recursive: true }),
  mkdir(IMAGE_REFERENCE_DIR, { recursive: true }),
  mkdir(IMAGE_MASK_DIR, { recursive: true }),
  mkdir(SECURE_IMAGE_DIR, { recursive: true }),
  mkdir(SECURE_ASSET_DIR, { recursive: true }),
  mkdir(SECURE_IMAGE_REFERENCE_DIR, { recursive: true })
]);

async function removeFailedEmptyDb(dbPath: string) {
  const journalPath = `${dbPath}-journal`;
  if (!existsSync(dbPath) || !existsSync(journalPath)) return;
  const info = await stat(dbPath).catch(() => null);
  if (!info || info.size !== 0) return;
  await unlink(journalPath).catch(() => undefined);
  await unlink(dbPath).catch(() => undefined);
}

await Promise.all([removeFailedEmptyDb(APP_DB_PATH), removeFailedEmptyDb(CONFIG_DB_PATH)]);

export const appDb = new Database(APP_DB_PATH, { create: true });
export const configDb = new Database(CONFIG_DB_PATH, { create: true });

export function run(db: Database, sql: string, ...params: any[]) {
  return db.query(sql).run(...params);
}

export function getOne<T>(db: Database, sql: string, ...params: any[]) {
  return db.query(sql).get(...params) as T | null;
}

export function getAll<T>(db: Database, sql: string, ...params: any[]) {
  return db.query(sql).all(...params) as T[];
}

export function tableColumnExists(db: Database, table: string, column: string) {
  const rows = db.query(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}
