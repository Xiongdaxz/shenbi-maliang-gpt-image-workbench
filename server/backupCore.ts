import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import type { Writable } from "node:stream";
import { audit } from "./auditLog";
import { appDb, configDb, getAll, getOne, run } from "./db";
import { APP_DB_PATH, CONFIG_DB_PATH, DATA_DIR, IMAGE_MASK_DIR, ROOT, SECURE_FILES_DIR } from "./paths";
import { localTimestamp, now } from "./utils";

export const BACKUP_SETTINGS_ID = "default";
export const DEFAULT_BACKUP_DIR = "backups";
export const DEFAULT_BACKUP_RUN_TIME = "03:00";
export const DEFAULT_BACKUP_RETENTION_DAYS = 30;
export const MIN_BACKUP_RETENTION_DAYS = 1;
export const MAX_BACKUP_RETENTION_DAYS = 3650;

const DAY_MS = 24 * 60 * 60 * 1000;

export type BackupSettingsRow = {
  id: string;
  enabled: number;
  run_time: string;
  retention_days: number;
  backup_dir: string;
  updated_at: string;
};

export type BackupRunRow = {
  id: string;
  source: string;
  status: string;
  backup_dir: string;
  file_name: string;
  file_size: number;
  file_count: number;
  error: string;
  started_at: string;
  finished_at: string;
  deleted_at: string;
};

export type BackupSource = "manual" | "scheduled";

export type BackupJobInput = {
  runId: string;
  source: BackupSource;
  backupDirValue: string;
  retentionDays: number;
  startedAt: string;
  fileName: string;
};

type TarFileEntry = {
  sourcePath: string;
  archivePath: string;
};

export function normalizeBackupDir(value: unknown) {
  const text = String(value ?? "").trim();
  return text || DEFAULT_BACKUP_DIR;
}

export function normalizeRetentionDays(value: unknown) {
  const days = Number(value);
  if (!Number.isFinite(days)) return DEFAULT_BACKUP_RETENTION_DAYS;
  return Math.max(MIN_BACKUP_RETENTION_DAYS, Math.min(MAX_BACKUP_RETENTION_DAYS, Math.trunc(days)));
}

export function normalizeRunTime(value: unknown, fallback = DEFAULT_BACKUP_RUN_TIME) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function validateRunTime(value: unknown) {
  const text = String(value ?? "").trim();
  const normalized = normalizeRunTime(text, "");
  if (!normalized) throw new Error("备份时间格式不正确");
  return normalized;
}

export function backupSettingsRow() {
  return getOne<BackupSettingsRow>(
    configDb,
    "select id, enabled, run_time, retention_days, backup_dir, updated_at from backup_settings where id = ?",
    BACKUP_SETTINGS_ID
  );
}

export function resolveBackupDir(backupDir: string) {
  return path.resolve(path.isAbsolute(backupDir) ? backupDir : path.join(ROOT, backupDir));
}

function comparablePath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function sameOrInside(parent: string, child: string) {
  const relative = path.relative(comparablePath(parent), comparablePath(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function ensureBackupDirectory(backupDirValue: string) {
  const backupDir = resolveBackupDir(backupDirValue);
  if (sameOrInside(DATA_DIR, backupDir)) {
    throw new Error("备份目录不能放在 data 目录下");
  }
  const existing = await stat(backupDir).catch(() => null);
  if (existing) {
    if (!existing.isDirectory()) throw new Error("备份目录不是文件夹");
    return backupDir;
  }
  await mkdir(backupDir, { recursive: true });
  const info = await stat(backupDir);
  if (!info.isDirectory()) throw new Error("备份目录不是文件夹");
  return backupDir;
}

export function publicBackupSettings(row: BackupSettingsRow | null) {
  const backupDir = normalizeBackupDir(row?.backup_dir);
  return {
    enabled: Boolean(row?.enabled ?? 0),
    runTime: normalizeRunTime(row?.run_time),
    retentionDays: normalizeRetentionDays(row?.retention_days),
    backupDir,
    resolvedBackupDir: resolveBackupDir(backupDir),
    updatedAt: row?.updated_at ?? ""
  };
}

function backupDurationMs(row: BackupRunRow) {
  const startedAt = Date.parse(row.started_at);
  const finishedAt = Date.parse(row.finished_at);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) return 0;
  return finishedAt - startedAt;
}

export function publicBackupRun(row: BackupRunRow) {
  return {
    id: row.id,
    source: row.source === "scheduled" ? "scheduled" : "manual",
    status: ["running", "succeeded", "failed", "deleted"].includes(row.status) ? row.status : "failed",
    backupDir: row.backup_dir,
    resolvedBackupDir: resolveBackupDir(row.backup_dir || DEFAULT_BACKUP_DIR),
    fileName: row.file_name,
    fileSize: Number(row.file_size ?? 0),
    fileCount: Number(row.file_count ?? 0),
    durationMs: backupDurationMs(row),
    error: row.error ?? "",
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    deletedAt: row.deleted_at
  };
}

export function backupFileName(date = new Date()) {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ].join("");
  return `gpt-image-backup-${stamp}.tar`;
}

export function nextRunDelay(runTime: string) {
  const [hour, minute] = normalizeRunTime(runTime).split(":").map(Number);
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= Date.now() + 1000) target.setDate(target.getDate() + 1);
  return Math.max(1000, target.getTime() - Date.now());
}

export function nextRunTimestamp(delayMs: number) {
  return localTimestamp(new Date(Date.now() + delayMs));
}

function fileDateBefore(value: string, cutoffMs: number) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time < cutoffMs;
}

function isBackupArtifact(filePath: string) {
  const name = path.basename(filePath).toLowerCase();
  const backupLike = name.includes("backup") || name.includes("备份");
  const archiveLike =
    name.endsWith(".tar.gz") ||
    name.endsWith(".tar.gz.tmp") ||
    name.endsWith(".tar") ||
    name.endsWith(".tar.tmp") ||
    name.endsWith(".tgz") ||
    name.endsWith(".zip") ||
    name.endsWith(".7z") ||
    name.endsWith(".rar");
  return (
    name.startsWith(".gpt-image-backup-") ||
    /^gpt-image-backup-\d{8}-\d{6}\.tar(?:\.gz)?(?:\.tmp)?$/.test(name) ||
    (backupLike && archiveLike)
  );
}

async function writeToStream(stream: Writable, chunk: Buffer) {
  if (!stream.write(chunk)) await once(stream, "drain");
}

function splitTarPath(filePath: string) {
  if (Buffer.byteLength(filePath) <= 100) return { name: filePath, prefix: "" };
  const parts = filePath.split("/");
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const name = parts.slice(index).join("/");
    const prefix = parts.slice(0, index).join("/");
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) {
      return { name, prefix };
    }
  }
  throw new Error(`备份文件路径过长：${filePath}`);
}

function writeTarText(buffer: Buffer, value: string, offset: number, length: number) {
  Buffer.from(value).copy(buffer, offset, 0, Math.min(Buffer.byteLength(value), length));
}

function writeTarOctal(buffer: Buffer, value: number, offset: number, length: number) {
  const text = Math.max(0, Math.trunc(value)).toString(8).padStart(length - 1, "0").slice(-(length - 1));
  writeTarText(buffer, `${text}\0`, offset, length);
}

function tarHeader(filePath: string, size: number, mtimeMs: number) {
  const header = Buffer.alloc(512);
  const { name, prefix } = splitTarPath(filePath);
  writeTarText(header, name, 0, 100);
  writeTarOctal(header, 0o644, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, size, 124, 12);
  writeTarOctal(header, Math.floor(mtimeMs / 1000), 136, 12);
  header.fill(0x20, 148, 156);
  writeTarText(header, "0", 156, 1);
  writeTarText(header, "ustar\0", 257, 6);
  writeTarText(header, "00", 263, 2);
  writeTarText(header, "gpt-image", 265, 32);
  writeTarText(header, "gpt-image", 297, 32);
  writeTarText(header, prefix, 345, 155);

  let checksum = 0;
  for (const value of header) checksum += value;
  writeTarText(header, `${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return header;
}

async function addTarFile(stream: Writable, sourcePath: string, archivePath: string) {
  const info = await stat(sourcePath);
  await writeToStream(stream, tarHeader(archivePath.replaceAll("\\", "/"), info.size, info.mtimeMs));
  for await (const chunk of createReadStream(sourcePath)) {
    await writeToStream(stream, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const padding = (512 - (info.size % 512)) % 512;
  if (padding) await writeToStream(stream, Buffer.alloc(padding));
}

async function listBackupFileEntries(
  sourceDir: string,
  archiveRoot: string,
  excludedDir: string,
  options: { skipDirectoryNames?: Set<string> } = {}
) {
  const files: TarFileEntry[] = [];
  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const relativePath = path.relative(sourceDir, entryPath).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (options.skipDirectoryNames?.has(entry.name)) continue;
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isBackupArtifact(entryPath)) continue;
      if (sameOrInside(excludedDir, entryPath)) continue;
      files.push({
        sourcePath: entryPath,
        archivePath: path.posix.join(archiveRoot, relativePath)
      });
    }
  }
  await walk(sourceDir);
  return files;
}

async function createTarArchive(entries: TarFileEntry[], targetPath: string) {
  const output = createWriteStream(targetPath);

  const streamError = once(output, "error").then(([error]) => Promise.reject(error));
  const finished = once(output, "finish");

  for (const entry of entries) {
    await addTarFile(output, entry.sourcePath, entry.archivePath);
  }
  await writeToStream(output, Buffer.alloc(1024));
  output.end();
  await Promise.race([finished, streamError]);
}

function cleanDataRelativeFilePath(value: string | null | undefined) {
  const cleanPath = String(value ?? "").trim().replace(/^\/+/, "").replaceAll("\\", "/");
  if (!cleanPath || cleanPath.includes("..") || !cleanPath.startsWith("files/")) return "";
  return cleanPath;
}

function referencedLegacyFilePaths() {
  const paths = new Set<string>();
  const appQueries = [
    "select path from images where path not like 'files/secure/%'",
    "select path from assets where path not like 'files/secure/%'",
    "select path from image_asset_references where path not like 'files/secure/%'",
    "select path from message_source_references where path not like 'files/secure/%'",
    "select avatar_path as path from users where avatar_path <> '' and avatar_path not like 'files/secure/%'"
  ];
  for (const sql of appQueries) {
    for (const row of getAll<{ path: string }>(appDb, sql)) {
      const cleanPath = cleanDataRelativeFilePath(row.path);
      if (cleanPath) paths.add(cleanPath);
    }
  }
  for (const row of getAll<{ path: string }>(
    configDb,
    "select path from branding_assets where path <> '' and path not like 'files/secure/%'"
  )) {
    const cleanPath = cleanDataRelativeFilePath(row.path);
    if (cleanPath) paths.add(cleanPath);
  }
  return Array.from(paths).sort();
}

async function referencedLegacyFileEntries(backupDir: string) {
  const entries: TarFileEntry[] = [];
  for (const relativePath of referencedLegacyFilePaths()) {
    const sourcePath = path.join(DATA_DIR, relativePath);
    if (sameOrInside(backupDir, sourcePath)) continue;
    const info = await stat(sourcePath).catch(() => null);
    if (!info?.isFile()) continue;
    if (isBackupArtifact(sourcePath)) continue;
    entries.push({
      sourcePath,
      archivePath: relativePath.replaceAll("\\", "/")
    });
  }
  return entries;
}

async function prepareBackupStaging(
  runId: string,
  backupDir: string,
  source: BackupSource,
  startedAt: string,
  snapshots: { app: Buffer; config: Buffer }
) {
  const stagingDir = path.join(backupDir, `.gpt-image-backup-${runId}`);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  const appSnapshotPath = path.join(stagingDir, "app.db");
  const configSnapshotPath = path.join(stagingDir, "config.db");
  const manifestPath = path.join(stagingDir, "manifest.json");
  const secureEntries = await listBackupFileEntries(SECURE_FILES_DIR, "files/secure", backupDir);
  const maskEntries = await listBackupFileEntries(IMAGE_MASK_DIR, "files/image-masks", backupDir);
  const legacyEntries = await referencedLegacyFileEntries(backupDir);
  const fileEntries = [...secureEntries, ...maskEntries, ...legacyEntries];
  const fileCount = fileEntries.length + 3;
  const manifest = {
    app: "gpt-image-workbench",
    version: 1,
    source,
    createdAt: startedAt,
    databases: [
      { name: "app.db", source: path.relative(ROOT, APP_DB_PATH).replaceAll("\\", "/") },
      { name: "config.db", source: path.relative(ROOT, CONFIG_DB_PATH).replaceAll("\\", "/") }
    ],
    filesRoot: "files",
    fileRoots: ["files/secure", "files/image-masks"],
    fileCount,
    excludes: [
      "data/config.toml",
      "data/debug",
      "unreferenced legacy files",
      "backup directory"
    ]
  };
  await writeFile(appSnapshotPath, snapshots.app);
  await writeFile(configSnapshotPath, snapshots.config);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return {
    stagingDir,
    fileCount,
    entries: [
      { sourcePath: appSnapshotPath, archivePath: "app.db" },
      { sourcePath: configSnapshotPath, archivePath: "config.db" },
      { sourcePath: manifestPath, archivePath: "manifest.json" },
      ...fileEntries
    ]
  };
}

export async function applyRetention(backupDirValue: string, retentionDays: number) {
  const backupDir = normalizeBackupDir(backupDirValue);
  const cutoffMs = Date.now() - normalizeRetentionDays(retentionDays) * DAY_MS;
  const rows = getAll<BackupRunRow>(
    configDb,
    "select * from backup_runs where status = ? and backup_dir = ? order by started_at asc",
    "succeeded",
    backupDir
  );
  for (const row of rows) {
    if (!fileDateBefore(row.finished_at || row.started_at, cutoffMs)) continue;
    await unlink(path.join(resolveBackupDir(row.backup_dir), row.file_name)).catch(() => undefined);
    run(configDb, "update backup_runs set status = ?, deleted_at = ? where id = ?", "deleted", now(), row.id);
  }
}

export async function finishBackupJob(input: BackupJobInput) {
  const backupDirValue = normalizeBackupDir(input.backupDirValue);
  const backupDir = await ensureBackupDirectory(backupDirValue);
  const targetPath = path.join(backupDir, input.fileName);
  const tempTargetPath = `${targetPath}.tmp`;
  let stagingDir = "";
  try {
    const snapshots = {
      app: Buffer.from(appDb.serialize()),
      config: Buffer.from(configDb.serialize())
    };
    const prepared = await prepareBackupStaging(input.runId, backupDir, input.source, input.startedAt, snapshots);
    stagingDir = prepared.stagingDir;
    await createTarArchive(prepared.entries, tempTargetPath);
    await rename(tempTargetPath, targetPath);
    const fileSize = (await stat(targetPath)).size;
    const finishedAt = now();
    run(
      configDb,
      `update backup_runs
       set status = ?, backup_dir = ?, file_name = ?, file_size = ?, file_count = ?, error = ?, finished_at = ?
       where id = ?`,
      "succeeded",
      backupDirValue,
      input.fileName,
      fileSize,
      prepared.fileCount,
      "",
      finishedAt,
      input.runId
    );
    audit("backup.run", {
      source: input.source,
      status: "succeeded",
      backupDir: backupDirValue,
      fileName: input.fileName,
      fileSize
    });
    await applyRetention(backupDirValue, input.retentionDays);
  } catch (error) {
    const message = error instanceof Error ? error.message : "备份失败";
    run(
      configDb,
      "update backup_runs set status = ?, error = ?, finished_at = ? where id = ?",
      "failed",
      message,
      now(),
      input.runId
    );
    audit("backup.run", { source: input.source, status: "failed", error: message });
    await unlink(tempTargetPath).catch(() => undefined);
    console.error("数据备份失败", message);
  } finally {
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }

  const updated = getOne<BackupRunRow>(configDb, "select * from backup_runs where id = ?", input.runId);
  if (!updated) throw new Error("备份记录写入失败");
  return updated;
}
