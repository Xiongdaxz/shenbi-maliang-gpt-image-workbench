import { appDb, configDb } from "./db";
import { finishBackupJob, type BackupJobInput } from "./backupCore";

function parseJob(): BackupJobInput {
  const raw = process.env.GPT_IMAGE_BACKUP_JOB;
  if (!raw) throw new Error("缺少备份任务参数");
  const job = JSON.parse(raw) as Partial<BackupJobInput>;
  if (!job.runId || !job.source || !job.backupDirValue || !job.startedAt || !job.fileName) {
    throw new Error("备份任务参数不完整");
  }
  if (job.source !== "manual" && job.source !== "scheduled") {
    throw new Error("备份任务来源不正确");
  }
  return {
    runId: String(job.runId),
    source: job.source,
    backupDirValue: String(job.backupDirValue),
    retentionDays: Number(job.retentionDays),
    startedAt: String(job.startedAt),
    fileName: String(job.fileName)
  };
}

try {
  appDb.exec("pragma busy_timeout = 10000");
  configDb.exec("pragma busy_timeout = 10000");
  const result = await finishBackupJob(parseJob());
  if (result.status !== "succeeded") process.exitCode = 1;
} catch (error) {
  console.error("数据备份后台进程异常", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  appDb.close();
  configDb.close();
}
