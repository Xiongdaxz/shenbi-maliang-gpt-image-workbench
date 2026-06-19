import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { audit } from "./auditLog";
import { requireConfig } from "./auth";
import {
  backupFileName,
  backupSettingsRow,
  ensureBackupDirectory,
  nextRunDelay,
  nextRunTimestamp,
  normalizeBackupDir,
  normalizeRetentionDays,
  publicBackupRun,
  publicBackupSettings,
  resolveBackupDir,
  validateRunTime,
  type BackupJobInput,
  type BackupRunRow,
  type BackupSource
} from "./backupCore";
import { configDb, getAll, getOne, run } from "./db";
import { ROOT } from "./paths";
import { makeId, now } from "./utils";

let backupTimer: ReturnType<typeof setTimeout> | null = null;
let backupNextRunAt = "";
let backupInFlight: { runId: string } | null = null;
const BACKUP_WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "backupWorker.ts");

async function runDirectoryPicker(currentDir: string) {
  if (process.platform !== "win32") {
    throw new Error("当前系统不支持从资源管理器选择目录，请手动输入备份目录");
  }
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择数据备份目录'
$dialog.ShowNewFolderButton = $true
$current = [Environment]::GetEnvironmentVariable('GPT_IMAGE_BACKUP_CURRENT_DIR')
if ($current -and (Test-Path -LiteralPath $current)) {
  $dialog.SelectedPath = $current
}
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = 'CenterScreen'
$owner.Width = 1
$owner.Height = 1
$owner.Opacity = 0
$owner.Show()
$owner.Activate()
$result = $dialog.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.WriteLine($dialog.SelectedPath)
}
`;
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const candidates = [
    path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    "powershell.exe",
    "pwsh.exe"
  ];
  let lastError = "";
  for (const command of candidates) {
    try {
      const proc = Bun.spawn({
        cmd: [command, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          GPT_IMAGE_BACKUP_CURRENT_DIR: resolveBackupDir(currentDir)
        },
        windowsHide: false
      });
      const timeout = setTimeout(() => proc.kill(), 5 * 60 * 1000);
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited
      ]).finally(() => clearTimeout(timeout));
      if (exitCode !== 0) {
        lastError = stderr.trim() || `目录选择器退出码 ${exitCode}`;
        continue;
      }
      return stdout.trim().split(/\r?\n/).pop()?.trim() ?? "";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error ?? "");
    }
  }
  throw new Error(lastError || "目录选择器打开失败");
}

function markBackupFailed(runId: string, source: BackupSource, error: string) {
  const row = getOne<BackupRunRow>(configDb, "select * from backup_runs where id = ?", runId);
  if (!row || row.status !== "running") return;
  run(configDb, "update backup_runs set status = ?, error = ?, finished_at = ? where id = ?", "failed", error, now(), runId);
  audit("backup.run", { source, status: "failed", error });
}

function spawnBackupWorker(job: BackupJobInput) {
  const proc = Bun.spawn({
    cmd: [process.execPath || "bun", BACKUP_WORKER_PATH],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      GPT_IMAGE_BACKUP_JOB: JSON.stringify(job)
    },
    windowsHide: true
  });
  backupInFlight = { runId: job.runId };
  void proc.exited
    .then((exitCode) => {
      if (exitCode !== 0) {
        markBackupFailed(job.runId, job.source, `备份后台进程退出码 ${exitCode}`);
      }
    })
    .catch((error) => {
      markBackupFailed(job.runId, job.source, error instanceof Error ? error.message : "备份后台进程异常");
    })
    .finally(() => {
      if (backupInFlight?.runId === job.runId) backupInFlight = null;
    });
}

async function startBackup(source: BackupSource) {
  if (backupInFlight) {
    if (source === "manual") throw new Error("已有备份任务正在运行");
    const running = getOne<BackupRunRow>(
      configDb,
      "select * from backup_runs where id = ? and status = ?",
      backupInFlight.runId,
      "running"
    );
    if (running) return running;
    throw new Error("已有备份任务正在运行");
  }

  const settings = publicBackupSettings(backupSettingsRow());
  await ensureBackupDirectory(settings.backupDir);
  const backupDirValue = normalizeBackupDir(settings.backupDir);
  const runId = makeId("backup");
  const startedAt = now();
  const fileName = backupFileName();
  run(
    configDb,
    `insert into backup_runs (
      id, source, status, backup_dir, file_name, file_size, file_count, error, started_at, finished_at, deleted_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    runId,
    source,
    "running",
    backupDirValue,
    "",
    0,
    0,
    "",
    startedAt,
    "",
    ""
  );
  const running = getOne<BackupRunRow>(configDb, "select * from backup_runs where id = ?", runId);
  if (!running) throw new Error("备份记录写入失败");

  try {
    spawnBackupWorker({
      runId,
      source,
      backupDirValue,
      retentionDays: normalizeRetentionDays(settings.retentionDays),
      startedAt,
      fileName
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "备份后台进程启动失败";
    markBackupFailed(runId, source, message);
    throw new Error(message);
  }

  return running;
}

function scheduleBackup() {
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = null;
  backupNextRunAt = "";

  const settings = publicBackupSettings(backupSettingsRow());
  if (!settings.enabled) return;

  const delayMs = nextRunDelay(settings.runTime);
  backupNextRunAt = nextRunTimestamp(delayMs);
  backupTimer = setTimeout(async () => {
    try {
      await startBackup("scheduled");
    } catch (error) {
      console.error("定时数据备份失败", error instanceof Error ? error.message : error);
    } finally {
      scheduleBackup();
    }
  }, delayMs);
}

export function startBackupScheduler() {
  scheduleBackup();
}

export function registerBackupRoutes(api: Hono) {
  api.get("/config/backups", (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const runs = getAll<BackupRunRow>(configDb, "select * from backup_runs order by started_at desc limit 50");
    return c.json({
      settings: publicBackupSettings(backupSettingsRow()),
      nextAutoBackupAt: backupNextRunAt,
      running: Boolean(backupInFlight),
      runs: runs.map(publicBackupRun)
    });
  });

  api.post("/config/backups/select-directory", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const body = await c.req.json().catch(() => ({}));
    const selected = await runDirectoryPicker(normalizeBackupDir(body.currentDir));
    if (!selected) return c.json({ directory: "" });
    const backupDir = await ensureBackupDirectory(selected);
    return c.json({ directory: backupDir });
  });

  api.put("/config/backups/settings", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const body = await c.req.json().catch(() => ({}));
    const enabled = Boolean(body.enabled);
    const runTime = validateRunTime(body.runTime);
    const retentionDays = normalizeRetentionDays(body.retentionDays);
    const backupDir = normalizeBackupDir(body.backupDir);
    await ensureBackupDirectory(backupDir);
    const timestamp = now();
    run(
      configDb,
      `insert into backup_settings (
        id, enabled, run_time, retention_days, backup_dir, updated_at
      ) values (?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        enabled = excluded.enabled,
        run_time = excluded.run_time,
        retention_days = excluded.retention_days,
        backup_dir = excluded.backup_dir,
        updated_at = excluded.updated_at`,
      "default",
      enabled ? 1 : 0,
      runTime,
      retentionDays,
      backupDir,
      timestamp
    );
    audit("backup.settings.save", { enabled, runTime, retentionDays, backupDir });
    scheduleBackup();
    return c.json({
      settings: publicBackupSettings(backupSettingsRow()),
      nextAutoBackupAt: backupNextRunAt
    });
  });

  api.post("/config/backups/run", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const row = await startBackup("manual");
    scheduleBackup();
    return c.json({ run: publicBackupRun(row), nextAutoBackupAt: backupNextRunAt }, 202);
  });

  api.get("/config/backups/:id/download", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const row = getOne<BackupRunRow>(configDb, "select * from backup_runs where id = ?", c.req.param("id"));
    if (!row || row.status !== "succeeded" || !row.file_name) return c.json({ error: "备份文件不存在" }, 404);
    const filePath = path.join(resolveBackupDir(row.backup_dir), row.file_name);
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) return c.json({ error: "备份文件不存在" }, 404);
    const contentType = row.file_name.endsWith(".tar") ? "application/x-tar" : "application/gzip";
    return new Response(Bun.file(filePath), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(info.size),
        "Content-Disposition": `attachment; filename="${row.file_name.replace(/"/g, "")}"`
      }
    });
  });

  api.delete("/config/backups/:id", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const row = getOne<BackupRunRow>(configDb, "select * from backup_runs where id = ?", c.req.param("id"));
    if (!row) return c.json({ error: "备份记录不存在" }, 404);
    if (row.status === "running") return c.json({ error: "备份任务运行中，暂不能删除" }, 400);
    if (row.file_name) {
      await unlink(path.join(resolveBackupDir(row.backup_dir), row.file_name)).catch(() => undefined);
    }
    const deletedAt = now();
    run(configDb, "update backup_runs set status = ?, deleted_at = ? where id = ?", "deleted", deletedAt, row.id);
    audit("backup.delete", { backupId: row.id, fileName: row.file_name });
    return c.json({ ok: true });
  });
}
