import { configDb, run } from "./db";
import type { RuntimeProviderRow } from "./types";
import { inferChannelFromType, makeId, normalizeProviderChannel, now } from "./utils";

export function audit(action: string, detail: unknown = {}) {
  run(
    configDb,
    "insert into config_audit_logs (id, action, detail, created_at) values (?, ?, ?, ?)",
    makeId("audit"),
    action,
    JSON.stringify(detail),
    now()
  );
}

export function logProviderRequest(input: {
  provider: RuntimeProviderRow;
  operation: "generation" | "edit";
  routeMode: string;
  endpoint: string;
  jobId?: string;
  attemptNo?: number;
  maxAttempts?: number;
  isRetry?: boolean;
  statusCode: number | null;
  durationMs: number;
  success: boolean;
  error?: string;
  sourceAccountId?: string;
  userId?: string;
}) {
  run(
    configDb,
    `insert into provider_request_logs (
      id, provider_id, provider_name, channel, route_mode, operation,
      job_id, attempt_no, max_attempts, is_retry,
      source_account_id, user_id, endpoint, status_code, duration_ms, success, error, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    makeId("req"),
    input.provider.id,
    input.provider.name,
    normalizeProviderChannel(input.provider.channel || inferChannelFromType(input.provider.type)),
    input.routeMode,
    input.operation,
    input.jobId ?? "",
    Math.max(1, Math.trunc(Number(input.attemptNo ?? 1)) || 1),
    Math.max(1, Math.trunc(Number(input.maxAttempts ?? 1)) || 1),
    input.isRetry ? 1 : 0,
    input.sourceAccountId ?? "",
    input.userId ?? "",
    input.endpoint,
    input.statusCode,
    Math.max(0, Math.round(input.durationMs)),
    input.success ? 1 : 0,
    input.error ?? null,
    now()
  );
}

export function markProviderRequestPostProcessFailure(input: {
  provider: RuntimeProviderRow;
  operation: "generation" | "edit";
  jobId?: string;
  attemptNo?: number;
  error: string;
  responseSnapshot?: string;
}) {
  const jobId = String(input.jobId ?? "").trim();
  if (!jobId) return;
  const attemptNo = Math.max(1, Math.trunc(Number(input.attemptNo ?? 1)) || 1);
  const row = configDb
    .query(
      `select id
       from provider_request_logs
       where job_id = ?
         and provider_id = ?
         and operation = ?
         and attempt_no = ?
         and success = 1
       order by created_at desc
       limit 1`
    )
    .get(jobId, input.provider.id, input.operation, attemptNo) as { id: string } | null;
  if (!row) return;
  const message = input.error.trim() || "图片请求后处理失败";
  run(
    configDb,
    "update provider_request_logs set success = 0, error = ?, response_snapshot = ? where id = ?",
    `HTTP 成功，但图片后处理失败：${message}`,
    input.responseSnapshot ?? "",
    row.id
  );
}

function modelRequestError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? "");
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 800) : null;
}

export function logModelRequest(input: {
  purpose: string;
  providerId: string;
  providerName: string;
  model: string;
  endpoint: string;
  method?: string;
  streamEnabled?: boolean;
  retryCount?: number;
  attemptCount?: number;
  statusCode?: number | null;
  durationMs: number;
  success: boolean;
  error?: unknown;
  userId?: string;
  jobId?: string;
  source?: string;
}) {
  run(
    configDb,
    `insert into model_request_logs (
      id, purpose, provider_id, provider_name, model, endpoint,
      method, stream_enabled, retry_count, attempt_count,
      status_code, duration_ms, success, error,
      user_id, job_id, source, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    makeId("modelreq"),
    String(input.purpose || "unknown").trim() || "unknown",
    input.providerId,
    input.providerName,
    input.model,
    input.endpoint,
    String(input.method || "POST").toUpperCase(),
    input.streamEnabled ? 1 : 0,
    Math.max(0, Math.trunc(Number(input.retryCount ?? 0)) || 0),
    Math.max(0, Math.trunc(Number(input.attemptCount ?? 0)) || 0),
    input.statusCode ?? null,
    Math.max(0, Math.round(input.durationMs)),
    input.success ? 1 : 0,
    modelRequestError(input.error),
    input.userId ?? "",
    input.jobId ?? "",
    input.source ?? "",
    now()
  );
}
