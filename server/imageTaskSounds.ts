import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "bun:sqlite";
import type { Hono } from "hono";
import { audit } from "./auditLog";
import { currentUser, isConfigAuthed, requireConfig } from "./auth";
import { configDb, getAll, getOne, run } from "./db";
import { absoluteDataPath, LEGACY_SOUND_BACKUP_DIR, ROOT } from "./paths";
import { readStoredFile } from "./secureFiles";
import type { ImageTaskSoundRow } from "./types";
import { makeId, now } from "./utils";

export const IMAGE_TASK_SOUND_MAX_BYTES = 5 * 1024 * 1024;
export const MIXKIT_SOUND_EFFECTS_URL = "https://mixkit.co/free-sound-effects/";

const LEGACY_IMAGE_TASK_SOUNDS = [
  ["maliang-001", "正确提示"],
  ["maliang-002", "错误提示"],
  ["maliang-003", "悠长气泡"],
  ["maliang-004", "音乐提醒"],
  ["maliang-005", "卡通玩具哨声"],
  ["maliang-006", "卡通啪嗒"],
  ["maliang-007", "幽默鼓点"],
  ["maliang-008", "搞怪童声"],
  ["maliang-009", "小丑吱吱玩具"],
  ["maliang-010", "可爱卡通喷嚏"],
  ["maliang-011", "狗狗叫两声"],
  ["maliang-012", "甜甜猫咪叫"],
  ["maliang-013", "谷仓牛叫"],
  ["maliang-014", "清晨公鸡打鸣"],
  ["maliang-015", "马戏团小丑喇叭"],
  ["maliang-017", "铃声通知"],
  ["maliang-018", "气泡弹出提醒"],
  ["maliang-019", "移除提示"],
  ["maliang-020", "门铃"],
  ["maliang-021", "魔法通知铃"]
] as const;

type AudioInspection = {
  mimeType: "audio/mpeg" | "audio/wav" | "audio/ogg";
};

type LegacySoundMigrationOptions = {
  db?: Database;
  publicLegacyDir?: string;
  distLegacyDir?: string;
  backupDir?: string;
  writeSoundFile?: (relativePath: string, buffer: Buffer) => Promise<void>;
  dataPath?: (relativePath: string) => string;
  recordAudit?: boolean;
};

type EncryptedSoundMigrationOptions = {
  db?: Database;
  readSoundFile?: (relativePath: string) => Promise<Buffer>;
  writeSoundFile?: (relativePath: string, buffer: Buffer) => Promise<void>;
  dataPath?: (relativePath: string) => string;
  recordAudit?: boolean;
};

type ImageTaskSoundRouteOptions = {
  db?: Database;
  getCurrentUser?: typeof currentUser;
  configAuthed?: typeof isConfigAuthed;
  configGuard?: typeof requireConfig;
  readSoundFile?: typeof readStoredFile;
  writeSoundFile?: (relativePath: string, buffer: Buffer) => Promise<void>;
  dataPath?: typeof absoluteDataPath;
  recordAudit?: typeof audit;
};

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function plainSoundPath(value: string) {
  return /^files\/image-task-sounds\/[a-zA-Z0-9_-]+\.(mp3|wav|ogg)$/.test(value.replaceAll("\\", "/"));
}

function encryptedSoundPath(value: string) {
  return /^files\/secure\/image-task-sounds\/[a-zA-Z0-9_-]+\.gaud$/.test(value.replaceAll("\\", "/"));
}

function managedSoundPath(value: string) {
  return plainSoundPath(value) || encryptedSoundPath(value);
}

function validMpegAudioFrame(buffer: Buffer, offset: number) {
  if (offset < 0 || offset + 4 > buffer.length || buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) {
    return false;
  }
  const version = (buffer[offset + 1] >> 3) & 0x03;
  const layer = (buffer[offset + 1] >> 1) & 0x03;
  const bitrate = (buffer[offset + 2] >> 4) & 0x0f;
  const sampleRate = (buffer[offset + 2] >> 2) & 0x03;
  return version !== 0x01 && layer !== 0x00 && bitrate !== 0x00 && bitrate !== 0x0f && sampleRate !== 0x03;
}

function mp3FrameOffset(buffer: Buffer) {
  let start = 0;
  if (buffer.length >= 10 && buffer.subarray(0, 3).toString("ascii") === "ID3") {
    const version = buffer[3];
    if (version < 2 || version > 4 || [buffer[6], buffer[7], buffer[8], buffer[9]].some((value) => value > 0x7f)) {
      return -1;
    }
    const tagSize = (buffer[6] << 21) | (buffer[7] << 14) | (buffer[8] << 7) | buffer[9];
    start = 10 + tagSize;
    if ((buffer[5] & 0x10) !== 0) start += 10;
  }
  const end = Math.min(buffer.length - 4, start + 64 * 1024);
  for (let offset = start; offset <= end; offset += 1) {
    if (validMpegAudioFrame(buffer, offset)) return offset;
  }
  return -1;
}

function validWaveAudio(buffer: Buffer) {
  if (
    buffer.length < 44
    || buffer.subarray(0, 4).toString("ascii") !== "RIFF"
    || buffer.subarray(8, 12).toString("ascii") !== "WAVE"
  ) return false;
  let hasFormat = false;
  let hasAudioData = false;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkId = buffer.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) return false;
    if (chunkId === "fmt " && chunkSize >= 16) {
      hasFormat = buffer.readUInt16LE(chunkStart) > 0
        && buffer.readUInt16LE(chunkStart + 2) > 0
        && buffer.readUInt32LE(chunkStart + 4) > 0;
    }
    if (chunkId === "data" && chunkSize > 0) hasAudioData = true;
    offset = chunkEnd + (chunkSize & 1);
  }
  return hasFormat && hasAudioData;
}

function validOggAudio(buffer: Buffer) {
  if (
    buffer.length < 28
    || buffer.subarray(0, 4).toString("ascii") !== "OggS"
    || buffer[4] !== 0
  ) return false;
  const pageSegments = buffer[26];
  if (pageSegments <= 0 || 27 + pageSegments > buffer.length) return false;
  const firstPacketSize = buffer.subarray(27, 27 + pageSegments).reduce((total, value) => total + value, 0);
  const packetStart = 27 + pageSegments;
  if (firstPacketSize <= 0 || packetStart + firstPacketSize > buffer.length) return false;
  const packet = buffer.subarray(packetStart, packetStart + firstPacketSize);
  return packet.subarray(0, 8).toString("ascii") === "OpusHead"
    || (packet[0] === 0x01 && packet.subarray(1, 7).toString("ascii") === "vorbis");
}

export function inspectImageTaskSound(buffer: Buffer): AudioInspection | null {
  if (validWaveAudio(buffer)) return { mimeType: "audio/wav" };
  if (validOggAudio(buffer)) return { mimeType: "audio/ogg" };
  if (mp3FrameOffset(buffer) >= 0) return { mimeType: "audio/mpeg" };
  return null;
}

function extensionForMimeType(mimeType: AudioInspection["mimeType"]) {
  if (mimeType === "audio/wav") return "wav";
  if (mimeType === "audio/ogg") return "ogg";
  return "mp3";
}

function imageTaskSoundPath(soundId: string, mimeType: AudioInspection["mimeType"]) {
  const safeId = String(soundId).trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "sound";
  return `files/image-task-sounds/${safeId}.${extensionForMimeType(mimeType)}`;
}

function cleanSoundName(value: unknown, fallback: string) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim() || fallback;
  return Array.from(text).slice(0, 60).join("");
}

function fallbackNameFromFile(fileName: string) {
  return cleanSoundName(path.basename(fileName, path.extname(fileName)), "未命名提示音");
}

function soundFileUrl(row: ImageTaskSoundRow) {
  return `/api/image-task-sounds/${encodeURIComponent(row.id)}/file?v=${encodeURIComponent(row.updated_at)}`;
}

function publicSound(row: ImageTaskSoundRow) {
  return {
    id: row.id,
    name: row.name,
    url: soundFileUrl(row),
    mimeType: row.mime_type,
    size: row.size
  };
}

function configSound(row: ImageTaskSoundRow) {
  return {
    ...publicSound(row),
    originalFileName: row.original_file_name,
    sha256: row.sha256,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function soundRows(db: Database = configDb) {
  return getAll<ImageTaskSoundRow>(db, "select * from image_task_sounds order by created_at asc, id asc");
}

export function enabledImageTaskSoundIds(db: Database = configDb) {
  return getAll<{ id: string }>(
    db,
    "select id from image_task_sounds where enabled = 1 order by created_at asc, id asc"
  ).map((row) => row.id);
}

function configSoundResult(db: Database = configDb) {
  return { sounds: soundRows(db).map(configSound), sourceUrl: MIXKIT_SOUND_EFFECTS_URL };
}

async function writePlainSoundFile(relativePath: string, buffer: Buffer) {
  const absolutePath = absoluteDataPath(relativePath.replace(/^\/+/, "").replaceAll("\\", "/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);
}

async function writeSoundAtomically(
  relativePath: string,
  buffer: Buffer,
  writeSound: (relativePath: string, buffer: Buffer) => Promise<void>,
  dataPath: (relativePath: string) => string
) {
  const temporaryPath = `${relativePath}.${randomUUID()}.tmp`;
  const absoluteTarget = dataPath(relativePath);
  try {
    await writeSound(temporaryPath, buffer);
    await mkdir(path.dirname(absoluteTarget), { recursive: true });
    await rename(dataPath(temporaryPath), absoluteTarget);
  } catch (error) {
    await unlink(dataPath(temporaryPath)).catch(() => undefined);
    throw error;
  }
}

async function storedSoundExists(row: ImageTaskSoundRow, dataPath: (relativePath: string) => string) {
  if (!managedSoundPath(row.path)) return false;
  const info = await stat(dataPath(row.path)).catch(() => null);
  return Boolean(info?.isFile() && info.size > 0);
}

async function moveToBackup(sourcePath: string, targetPath: string) {
  if (!existsSync(sourcePath)) return;
  await mkdir(path.dirname(targetPath), { recursive: true });
  let destination = targetPath;
  if (existsSync(destination)) {
    const [sourceBuffer, targetBuffer] = await Promise.all([readFile(sourcePath), readFile(destination)]);
    if (sha256(sourceBuffer) === sha256(targetBuffer)) {
      await unlink(sourcePath);
      return;
    }
    destination = `${targetPath}.${Date.now()}`;
  }
  try {
    await rename(sourcePath, destination);
  } catch {
    await copyFile(sourcePath, destination);
    await unlink(sourcePath);
  }
}

async function removeDirectoryIfEmpty(directory: string) {
  await rmdir(directory).catch(() => undefined);
}

async function cleanupUnusedEncryptedImageTaskSounds(options: {
  db: Database;
  dataPath: (relativePath: string) => string;
  recordAudit: boolean;
}) {
  const relativeDirectory = "files/secure/image-task-sounds";
  const referencedPaths = new Set(
    soundRows(options.db)
      .map((row) => row.path.replaceAll("\\", "/"))
      .filter(encryptedSoundPath)
  );
  const deletedPaths: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  const directory = options.dataPath(relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (!encryptedSoundPath(relativePath) || referencedPaths.has(relativePath)) continue;
    try {
      await unlink(options.dataPath(relativePath));
      deletedPaths.push(relativePath);
    } catch (error) {
      failed.push({ path: relativePath, error: error instanceof Error ? error.message : "清理失败" });
    }
  }
  await removeDirectoryIfEmpty(directory);
  if (options.recordAudit && (deletedPaths.length > 0 || failed.length > 0)) {
    audit("image_task_sound.storage_cleanup", { deletedPaths, failed, storage: "encrypted" });
  }
  return { deletedPaths, failed };
}

export async function migrateEncryptedImageTaskSounds(options: EncryptedSoundMigrationOptions = {}) {
  const db = options.db ?? configDb;
  const readSoundFile = options.readSoundFile ?? readStoredFile;
  const writeSoundFile = options.writeSoundFile ?? writePlainSoundFile;
  const dataPath = options.dataPath ?? absoluteDataPath;
  const migratedIds: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const rows = soundRows(db).filter((row) => encryptedSoundPath(row.path));

  for (const row of rows) {
    let writtenPath = "";
    try {
      const buffer = await readSoundFile(row.path);
      if (buffer.length <= 0 || buffer.length > IMAGE_TASK_SOUND_MAX_BYTES) throw new Error("音频大小无效");
      const inspection = inspectImageTaskSound(buffer);
      if (!inspection) throw new Error("音频格式无效");
      const relativePath = imageTaskSoundPath(row.id, inspection.mimeType);
      const existingTarget = await readFile(dataPath(relativePath)).catch(() => null);
      if (existingTarget && !existingTarget.equals(buffer)) throw new Error("明文目标文件已存在且内容不同");
      if (!existingTarget) await writeSoundAtomically(relativePath, buffer, writeSoundFile, dataPath);
      writtenPath = relativePath;
      try {
        run(
          db,
          "update image_task_sounds set path = ?, mime_type = ?, size = ?, sha256 = ? where id = ? and path = ?",
          relativePath,
          inspection.mimeType,
          buffer.length,
          sha256(buffer),
          row.id,
          row.path
        );
      } catch (error) {
        await unlink(dataPath(relativePath)).catch(() => undefined);
        writtenPath = "";
        throw error;
      }
      await unlink(dataPath(row.path)).catch((error) => {
        console.warn(`旧提示音加密文件清理失败: ${row.path}`, error);
      });
      migratedIds.push(row.id);
    } catch (error) {
      if (writtenPath) await unlink(dataPath(writtenPath)).catch(() => undefined);
      failed.push({ id: row.id, error: error instanceof Error ? error.message : "迁移失败" });
    }
  }

  await cleanupUnusedEncryptedImageTaskSounds({
    db,
    dataPath,
    recordAudit: options.recordAudit ?? db === configDb
  });

  if (options.recordAudit ?? db === configDb) {
    if (migratedIds.length > 0 || failed.length > 0) {
      audit("image_task_sound.storage_migrate", { migratedIds, failed, storage: "plain" });
    }
  }
  return { migratedIds, failed };
}

export async function migrateLegacyImageTaskSounds(options: LegacySoundMigrationOptions = {}) {
  const db = options.db ?? configDb;
  const publicLegacyDir = options.publicLegacyDir ?? path.join(ROOT, "public", "sounds", "image-task");
  const distLegacyDir = options.distLegacyDir ?? path.join(ROOT, "dist", "sounds", "image-task");
  const backupDir = options.backupDir ?? LEGACY_SOUND_BACKUP_DIR;
  const writeSoundFile = options.writeSoundFile ?? writePlainSoundFile;
  const dataPath = options.dataPath ?? absoluteDataPath;
  const migratedIds: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const [id, defaultName] of LEGACY_IMAGE_TASK_SOUNDS) {
    const fileName = `${id}.mp3`;
    const publicPath = path.join(publicLegacyDir, fileName);
    const distPath = path.join(distLegacyDir, fileName);
    const sourcePath = existsSync(publicPath) ? publicPath : existsSync(distPath) ? distPath : "";
    if (!sourcePath) continue;
    let writtenPath = "";
    try {
      const existing = getOne<ImageTaskSoundRow>(db, "select * from image_task_sounds where id = ?", id);
      if (existing && await storedSoundExists(existing, dataPath)) {
        await moveToBackup(publicPath, path.join(backupDir, "public", fileName));
        await moveToBackup(distPath, path.join(backupDir, "dist", fileName));
        migratedIds.push(id);
        continue;
      }
      const buffer = await readFile(sourcePath);
      if (buffer.length <= 0 || buffer.length > IMAGE_TASK_SOUND_MAX_BYTES) throw new Error("音频大小无效");
      const inspection = inspectImageTaskSound(buffer);
      if (!inspection) throw new Error("音频格式无效");
      const relativePath = imageTaskSoundPath(id, inspection.mimeType);
      await writeSoundAtomically(relativePath, buffer, writeSoundFile, dataPath);
      writtenPath = relativePath;
      const timestamp = now();
      run(
        db,
        `insert into image_task_sounds (
          id, name, path, original_file_name, mime_type, size, sha256, enabled, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        on conflict(id) do update set
          path = excluded.path,
          original_file_name = excluded.original_file_name,
          mime_type = excluded.mime_type,
          size = excluded.size,
          sha256 = excluded.sha256,
          updated_at = excluded.updated_at`,
        id,
        defaultName,
        relativePath,
        fileName,
        inspection.mimeType,
        buffer.length,
        sha256(buffer),
        timestamp,
        timestamp
      );
      await moveToBackup(publicPath, path.join(backupDir, "public", fileName));
      await moveToBackup(distPath, path.join(backupDir, "dist", fileName));
      migratedIds.push(id);
    } catch (error) {
      if (writtenPath) await unlink(dataPath(writtenPath)).catch(() => undefined);
      failed.push({ id, error: error instanceof Error ? error.message : "迁移失败" });
    }
  }

  await Promise.all([
    removeDirectoryIfEmpty(publicLegacyDir),
    removeDirectoryIfEmpty(path.dirname(publicLegacyDir)),
    removeDirectoryIfEmpty(distLegacyDir),
    removeDirectoryIfEmpty(path.dirname(distLegacyDir))
  ]);
  if (options.recordAudit ?? db === configDb) {
    if (migratedIds.length > 0 || failed.length > 0) {
      audit("image_task_sound.migrate", { migratedIds, failed });
    }
  }
  return { migratedIds, failed };
}

function parseByteRange(value: string | null, total: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return false;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, total - suffixLength);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : total - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= total) return false;
    end = Math.min(end, total - 1);
  }
  return { start, end };
}

function audioResponse(buffer: Buffer, row: ImageTaskSoundRow, rangeHeader: string | null) {
  const range = parseByteRange(rangeHeader, buffer.length);
  if (range === false) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${buffer.length}`, "Accept-Ranges": "bytes" }
    });
  }
  const body = range ? buffer.subarray(range.start, range.end + 1) : buffer;
  const headers: Record<string, string> = {
    "Content-Type": row.mime_type,
    "Content-Length": String(body.length),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "ETag": `"${row.sha256}"`,
    "X-Content-Type-Options": "nosniff"
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${buffer.length}`;
  return new Response(new Uint8Array(body), { status: range ? 206 : 200, headers });
}

export function registerImageTaskSoundRoutes(api: Hono, options: ImageTaskSoundRouteOptions = {}) {
  const db = options.db ?? configDb;
  const getCurrentUser = options.getCurrentUser ?? currentUser;
  const configAuthed = options.configAuthed ?? isConfigAuthed;
  const configGuard = options.configGuard ?? requireConfig;
  const readSoundFile = options.readSoundFile ?? readStoredFile;
  const writeSoundFile = options.writeSoundFile ?? writePlainSoundFile;
  const dataPath = options.dataPath ?? absoluteDataPath;
  const recordAudit = options.recordAudit ?? audit;

  api.get("/image-task-sounds", async (c) => {
    const user = await getCurrentUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const sounds = getAll<ImageTaskSoundRow>(
      db,
      "select * from image_task_sounds where enabled = 1 order by created_at asc, id asc"
    ).map(publicSound);
    return c.json({ sounds });
  });

  api.get("/image-task-sounds/:id/file", async (c) => {
    const isAdmin = configAuthed(c);
    const user = isAdmin ? null : await getCurrentUser(c);
    if (!isAdmin && !user) return c.json({ error: "未登录" }, 401);
    const row = getOne<ImageTaskSoundRow>(db, "select * from image_task_sounds where id = ?", c.req.param("id"));
    if (!row || (!isAdmin && !row.enabled)) return c.json({ error: "提示音不存在" }, 404);
    if (!managedSoundPath(row.path)) return c.json({ error: "提示音文件路径无效" }, 404);
    try {
      return audioResponse(await readSoundFile(row.path), row, c.req.header("range") ?? null);
    } catch {
      return c.json({ error: "提示音文件不存在" }, 404);
    }
  });

  api.get("/config/image-task-sounds", (c) => {
    const blocked = configGuard(c);
    if (blocked) return blocked;
    return c.json(configSoundResult(db));
  });

  api.post("/config/image-task-sounds", async (c) => {
    const blocked = configGuard(c);
    if (blocked) return blocked;
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "请选择要上传的音频" }, 400);
    if (file.size <= 0) return c.json({ error: "音频文件为空" }, 400);
    if (file.size > IMAGE_TASK_SOUND_MAX_BYTES) return c.json({ error: "提示音不能超过 5MB" }, 400);
    const buffer = Buffer.from(await file.arrayBuffer());
    const inspection = inspectImageTaskSound(buffer);
    if (!inspection) return c.json({ error: "仅支持 MP3、WAV 或 OGG 音频" }, 400);
    const digest = sha256(buffer);
    const duplicate = getOne<ImageTaskSoundRow>(db, "select * from image_task_sounds where sha256 = ? limit 1", digest);
    if (duplicate) return c.json({ error: `该音频已存在：${duplicate.name}` }, 409);
    const id = makeId("sound");
    const relativePath = imageTaskSoundPath(id, inspection.mimeType);
    try {
      await writeSoundAtomically(relativePath, buffer, writeSoundFile, dataPath);
      const timestamp = now();
      const name = cleanSoundName(form.get("name"), fallbackNameFromFile(file.name));
      run(
        db,
        `insert into image_task_sounds (
          id, name, path, original_file_name, mime_type, size, sha256, enabled, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        id,
        name,
        relativePath,
        file.name,
        inspection.mimeType,
        buffer.length,
        digest,
        timestamp,
        timestamp
      );
      recordAudit("image_task_sound.upload", { soundId: id, name, mimeType: inspection.mimeType, size: buffer.length });
      return c.json(configSoundResult(db), 201);
    } catch (error) {
      await unlink(dataPath(relativePath)).catch(() => undefined);
      throw error;
    }
  });

  api.patch("/config/image-task-sounds/:id", async (c) => {
    const blocked = configGuard(c);
    if (blocked) return blocked;
    const row = getOne<ImageTaskSoundRow>(db, "select * from image_task_sounds where id = ?", c.req.param("id"));
    if (!row) return c.json({ error: "提示音不存在" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const name = Object.prototype.hasOwnProperty.call(body, "name") ? cleanSoundName(body.name, row.name) : row.name;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : Boolean(row.enabled);
    run(
      db,
      "update image_task_sounds set name = ?, enabled = ?, updated_at = ? where id = ?",
      name,
      enabled ? 1 : 0,
      now(),
      row.id
    );
    recordAudit("image_task_sound.update", { soundId: row.id, name, enabled });
    return c.json(configSoundResult(db));
  });

  api.delete("/config/image-task-sounds/:id", async (c) => {
    const blocked = configGuard(c);
    if (blocked) return blocked;
    const row = getOne<ImageTaskSoundRow>(db, "select * from image_task_sounds where id = ?", c.req.param("id"));
    if (!row) return c.json({ error: "提示音不存在" }, 404);
    run(db, "delete from image_task_sounds where id = ?", row.id);
    if (managedSoundPath(row.path)) await unlink(dataPath(row.path)).catch(() => undefined);
    recordAudit("image_task_sound.delete", { soundId: row.id, name: row.name });
    return c.json(configSoundResult(db));
  });
}
