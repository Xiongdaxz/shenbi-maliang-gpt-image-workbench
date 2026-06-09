import path from "node:path";

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, "data");
export const FILES_DIR = path.join(DATA_DIR, "files");
export const IMAGE_DIR = path.join(FILES_DIR, "images");
export const ASSET_DIR = path.join(FILES_DIR, "assets");
export const IMAGE_REFERENCE_DIR = path.join(FILES_DIR, "image-references");
export const IMAGE_MASK_DIR = path.join(FILES_DIR, "image-masks");
export const SECURE_FILES_DIR = path.join(FILES_DIR, "secure");
export const SECURE_IMAGE_DIR = path.join(SECURE_FILES_DIR, "images");
export const SECURE_ASSET_DIR = path.join(SECURE_FILES_DIR, "assets");
export const SECURE_IMAGE_REFERENCE_DIR = path.join(SECURE_FILES_DIR, "image-references");
export const PUBLIC_LOGIN_DIR = path.join(ROOT, "public", "login");
export const DIST_LOGIN_DIR = path.join(ROOT, "dist", "login");
export const CONFIG_FILE = path.join(DATA_DIR, "config.toml");
export const DEBUG_DIR = path.join(DATA_DIR, "debug");
export const IMAGE_EDIT_DEBUG_DIR = path.join(DEBUG_DIR, "image-edits");
export const APP_DB_PATH = path.join(DATA_DIR, "app.db");
export const CONFIG_DB_PATH = path.join(DATA_DIR, "config.db");

export function absoluteDataPath(relativePath: string) {
  return path.join(DATA_DIR, relativePath.replace(/^\/+/, ""));
}
