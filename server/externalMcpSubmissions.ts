import { createHash, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";

type SubmissionResult = { sessionId: string; jobId: string; status: string; requestKey?: string };

export function initMcpSubmissions(db: Database) {
  db.run(`create table if not exists mcp_image_submissions (
    user_id text not null,
    operation text not null,
    request_key text not null,
    input_hash text not null,
    client_request_id text not null,
    job_id text,
    created_at text not null,
    primary key (user_id, operation, request_key),
    foreign key (user_id) references users(id) on delete cascade
  )`);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** A definite pre-submission rejection can be retried. Unknown outcomes keep their reservation. */
export class McpSubmissionRejected extends Error {}

export async function submitMcpImageOnce(
  db: Database,
  input: { userId: string; operation: "generation" | "edit"; requestKey?: string; parameters: unknown },
  submit: (clientRequestId: string) => Promise<SubmissionResult>
): Promise<SubmissionResult> {
  if (!input.requestKey) return submit(`mcp-${randomUUID()}`);
  const inputHash = createHash("sha256").update(canonicalJson(input.parameters)).digest("hex");
  const clientRequestId = `mcp-${createHash("sha256")
    .update(JSON.stringify([input.userId, input.operation, input.requestKey])).digest("hex")}`;
  const reserved = db.query(`insert or ignore into mcp_image_submissions
    (user_id, operation, request_key, input_hash, client_request_id, created_at)
    values (?, ?, ?, ?, ?, ?)`).run(input.userId, input.operation, input.requestKey, inputHash, clientRequestId, new Date().toISOString());
  if (!reserved.changes) {
    const existing = db.query(`select input_hash, job_id from mcp_image_submissions
      where user_id = ? and operation = ? and request_key = ?`).get(input.userId, input.operation, input.requestKey) as { input_hash: string; job_id: string | null };
    if (existing.input_hash !== inputHash) throw new Error("requestKey 已用于不同的图片请求；重试必须保留原参数，新任务请使用新的 requestKey。");
    // Recover an accepted job even if the process lost the internal HTTP response or restarted.
    const job = db.query(`select id, session_id, status from image_jobs
      where user_id = ? and client_request_id = ? order by created_at limit 1`)
      .get(input.userId, clientRequestId) as { id: string; session_id: string; status: string } | null;
    if (job) return { jobId: job.id, sessionId: job.session_id ?? "", status: job.status, requestKey: input.requestKey };
    throw new Error(existing.job_id
      ? "此 requestKey 对应的任务已被删除，不能自动重新提交。"
      : "上次提交尚未确认。请稍后用相同 requestKey 和参数重试；不要更换请求标识重复生图。");
  }
  try {
    const result = await submit(clientRequestId);
    if (!result.jobId) throw new Error("任务提交结果尚未确认，请使用相同 requestKey 重试。");
    db.query(`update mcp_image_submissions set job_id = ? where user_id = ? and operation = ? and request_key = ?`)
      .run(result.jobId, input.userId, input.operation, input.requestKey);
    return { ...result, requestKey: input.requestKey };
  } catch (error) {
    if (error instanceof McpSubmissionRejected) {
      // Never release a key after a job was accepted, including partial submission failures.
      db.query(`delete from mcp_image_submissions where user_id = ? and operation = ? and request_key = ?
        and not exists (select 1 from image_jobs where user_id = ? and client_request_id = ?)`)
        .run(input.userId, input.operation, input.requestKey, input.userId, clientRequestId);
    }
    throw error;
  }
}
