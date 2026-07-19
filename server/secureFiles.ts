import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { appDb, configDb, getAll, getOne, run } from "./db";
import { absoluteDataPath } from "./paths";
import { now } from "./utils";

const MAGIC = Buffer.from("GIMG1");
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_ID = "default";

function ensureFileSecurityTable() {
  configDb.run(`
    create table if not exists file_security_settings (
      id text primary key,
      encryption_key text not null,
      created_at text not null,
      updated_at text not null
    )
  `);
}

function encryptionKey() {
  ensureFileSecurityTable();
  const row = getOne<{ encryption_key: string }>(
    configDb,
    "select encryption_key from file_security_settings where id = ?",
    KEY_ID
  );
  if (row?.encryption_key) return Buffer.from(row.encryption_key, "base64");
  const key = randomBytes(32);
  const timestamp = now();
  run(
    configDb,
    "insert into file_security_settings (id, encryption_key, created_at, updated_at) values (?, ?, ?, ?)",
    KEY_ID,
    key.toString("base64"),
    timestamp,
    timestamp
  );
  return key;
}

function sanitizeSegment(value: string | null | undefined, fallback: string) {
  const normalized = String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return normalized || fallback;
}

export function secureImagePath(userId: string, sessionId: string | null | undefined, imageId: string) {
  return [
    "files",
    "secure",
    "images",
    sanitizeSegment(userId, "user"),
    sanitizeSegment(sessionId, "no-session"),
    `${sanitizeSegment(imageId, "image")}.gimg`
  ].join("/");
}

export function secureAssetPath(userId: string, assetId: string) {
  return [
    "files",
    "secure",
    "assets",
    sanitizeSegment(userId, "user"),
    "manual",
    `${sanitizeSegment(assetId, "asset")}.gimg`
  ].join("/");
}

export function secureBrandingAssetPath(assetId: string) {
  return [
    "files",
    "secure",
    "branding",
    `${sanitizeSegment(assetId, "branding")}.gimg`
  ].join("/");
}

export function secureUserAvatarPath(userId: string) {
  return [
    "files",
    "secure",
    "user-avatars",
    sanitizeSegment(userId, "user"),
    "avatar.gimg"
  ].join("/");
}

export function secureUserAvatarHistoryPath(userId: string, historyId: string) {
  return [
    "files",
    "secure",
    "user-avatars",
    sanitizeSegment(userId, "user"),
    "history",
    `${sanitizeSegment(historyId, "avatar")}.gimg`
  ].join("/");
}

export function secureImageReferencePath(userId: string, sessionId: string | null | undefined, imageId: string, referenceId: string) {
  return [
    "files",
    "secure",
    "image-references",
    sanitizeSegment(userId, "user"),
    sanitizeSegment(sessionId, "no-session"),
    sanitizeSegment(imageId, "image"),
    `${sanitizeSegment(referenceId, "imgref")}.gimg`
  ].join("/");
}

export function isSecurePath(filePath: string | null | undefined) {
  return String(filePath ?? "").replaceAll("\\", "/").startsWith("files/secure/");
}

function isEncryptedBuffer(buffer: Buffer) {
  return buffer.length > MAGIC.length + IV_LENGTH + TAG_LENGTH && buffer.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptBuffer(buffer: Buffer) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ciphertext]);
}

export function decryptBuffer(buffer: Buffer) {
  if (!isEncryptedBuffer(buffer)) return buffer;
  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_LENGTH;
  const ciphertextStart = tagStart + TAG_LENGTH;
  const iv = buffer.subarray(ivStart, tagStart);
  const tag = buffer.subarray(tagStart, ciphertextStart);
  const ciphertext = buffer.subarray(ciphertextStart);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export async function readStoredFile(relativePath: string) {
  const cleanPath = relativePath.replace(/^\/+/, "").replaceAll("\\", "/");
  const buffer = await readFile(absoluteDataPath(cleanPath));
  return decryptBuffer(buffer);
}

export async function writeEncryptedFile(relativePath: string, buffer: Buffer) {
  const absolutePath = absoluteDataPath(relativePath.replace(/^\/+/, "").replaceAll("\\", "/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, encryptBuffer(buffer));
}

async function fileExists(relativePath: string) {
  return Boolean(await stat(absoluteDataPath(relativePath.replace(/^\/+/, "").replaceAll("\\", "/"))).catch(() => null));
}

export async function migratePlainFileToEncrypted(oldPath: string, newPath: string) {
  if (oldPath === newPath) return true;
  if (await fileExists(newPath)) return true;
  if (!(await fileExists(oldPath))) return false;
  await writeEncryptedFile(newPath, await readStoredFile(oldPath));
  return true;
}

export function isStoredPathReferenced(filePath: string) {
  const normalized = filePath.replaceAll("\\", "/");
  const publicPath = `/${normalized}`;
  const row = getOne<{ count: number }>(
    appDb,
    `select
       (select count(*) from images where path = ?) +
       (select count(*) from assets where path = ?) +
       (select count(*) from image_asset_references where path = ?) +
       (select count(*) from message_source_references where path = ?) +
       (select count(*) from image_derivatives where path = ?) +
       (select count(*) from users where avatar_path = ?) +
       (select count(*) from user_avatar_history where path = ?) +
       (select count(*) from case_items where image_url = ? or image_url = ?) +
       (select count(*) from case_group_images where image_url = ? or image_url = ?) as count`,
    normalized,
    normalized,
    normalized,
    normalized,
    normalized,
    normalized,
    normalized,
    normalized,
    publicPath,
    normalized,
    publicPath
  );
  return Number(row?.count ?? 0) > 0;
}

export async function deleteStoredFilesIfUnreferenced(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.map((item) => String(item ?? "").trim().replaceAll("\\", "/")).filter(Boolean)));
  for (const filePath of uniquePaths) {
    if (isStoredPathReferenced(filePath)) continue;
    await unlink(absoluteDataPath(filePath)).catch((error) => {
      if (existsSync(absoluteDataPath(filePath))) console.warn(`文件删除失败: ${filePath}`, error);
    });
  }
}

async function legacyStoredFiles(relativeRoot: string) {
  const files: string[] = [];
  async function walk(relativeDir: string) {
    const entries = await readdir(absoluteDataPath(relativeDir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relativePath = `${relativeDir}/${entry.name}`.replaceAll("\\", "/");
      if (entry.isDirectory()) {
        await walk(relativePath);
        continue;
      }
      if (entry.isFile() && !isSecurePath(relativePath)) files.push(relativePath);
    }
  }
  await walk(relativeRoot);
  return files;
}

function mimeTypeFromLegacyPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".avif") return "image/avif";
  return "image/png";
}

export async function migrateExistingFilesToSecureStorage() {
  ensureFileSecurityTable();
  encryptionKey();
  const migratedPaths = new Map<string, string>();
  const oldPaths = new Set<string>();

  const imageRows = getAll<{
    id: string;
    user_id: string;
    session_id: string | null;
    path: string;
    mime_type: string | null;
  }>(appDb, "select id, user_id, session_id, path, mime_type from images where path not like 'files/secure/%'");
  for (const row of imageRows) {
    const oldPath = row.path.replaceAll("\\", "/");
    const nextPath = migratedPaths.get(oldPath) ?? secureImagePath(row.user_id, row.session_id, row.id);
    const migrated = migratedPaths.has(oldPath) || await migratePlainFileToEncrypted(oldPath, nextPath);
    if (!migrated) {
      console.warn(`图片文件迁移跳过，文件不存在: ${oldPath}`);
      continue;
    }
    migratedPaths.set(oldPath, nextPath);
    oldPaths.add(oldPath);
    const nextMimeType = row.mime_type && row.mime_type !== "image/png" ? row.mime_type : mimeTypeFromLegacyPath(oldPath);
    run(appDb, "update images set path = ?, mime_type = ? where id = ?", nextPath, nextMimeType, row.id);
  }

  const assetRows = getAll<{
    id: string;
    user_id: string;
    path: string;
  }>(appDb, "select id, user_id, path from assets where path not like 'files/secure/%'");
  for (const row of assetRows) {
    const oldPath = row.path.replaceAll("\\", "/");
    const nextPath = migratedPaths.get(oldPath) ?? secureAssetPath(row.user_id, row.id);
    const migrated = migratedPaths.has(oldPath) || await migratePlainFileToEncrypted(oldPath, nextPath);
    if (!migrated) {
      console.warn(`素材文件迁移跳过，文件不存在: ${oldPath}`);
      continue;
    }
    migratedPaths.set(oldPath, nextPath);
    oldPaths.add(oldPath);
    run(appDb, "update assets set path = ? where id = ?", nextPath, row.id);
  }

  const referenceRows = getAll<{
    id: string;
    image_id: string;
    user_id: string;
    path: string;
    session_id: string | null;
  }>(
    appDb,
    `select image_asset_references.id, image_asset_references.image_id, image_asset_references.user_id,
            image_asset_references.path, images.session_id
     from image_asset_references
     left join images on images.id = image_asset_references.image_id
     where image_asset_references.path not like 'files/secure/%'`
  );
  for (const row of referenceRows) {
    const oldPath = row.path.replaceAll("\\", "/");
    const nextPath = migratedPaths.get(oldPath) ?? secureImageReferencePath(row.user_id, row.session_id, row.image_id, row.id);
    const migrated = migratedPaths.has(oldPath) || await migratePlainFileToEncrypted(oldPath, nextPath);
    if (!migrated) {
      console.warn(`引用图片文件迁移跳过，文件不存在: ${oldPath}`);
      continue;
    }
    migratedPaths.set(oldPath, nextPath);
    oldPaths.add(oldPath);
    run(appDb, "update image_asset_references set path = ? where id = ?", nextPath, row.id);
  }

  run(appDb, "update case_items set image_url = '/api/files/images/' || image_id where image_id is not null");
  run(appDb, "update case_items set image_url = '/api/files/assets/' || asset_id where image_id is null and asset_id is not null");
  run(appDb, "update case_group_images set image_url = '/api/files/images/' || image_id where image_id is not null");
  run(appDb, "update case_group_images set image_url = '/api/files/assets/' || asset_id where image_id is null and asset_id is not null");
  await deleteStoredFilesIfUnreferenced([...oldPaths]);

  const remainingLegacyFiles = [
    ...(await legacyStoredFiles("files/images")),
    ...(await legacyStoredFiles("files/assets")),
    ...(await legacyStoredFiles("files/image-references"))
  ];
  await deleteStoredFilesIfUnreferenced(remainingLegacyFiles);

  const remainingPublicFiles = [...oldPaths].filter((item) => existsSync(absoluteDataPath(item)) && !isStoredPathReferenced(item));
  if (remainingPublicFiles.length > 0) await deleteStoredFilesIfUnreferenced(remainingPublicFiles);
}
