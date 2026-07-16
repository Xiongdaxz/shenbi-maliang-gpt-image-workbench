import { appDb, getOne, run } from "./db";
import { localTimestamp, now } from "./utils";

const CANCEL_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const activeControllers = new Map<string, AbortController>();

export function rememberImageJobCancelIntent(userId: string, clientRequestId: string) {
  if (!userId || !clientRequestId) return;
  run(
    appDb,
    "insert or replace into image_job_cancel_requests (user_id, client_request_id, created_at) values (?, ?, ?)",
    userId,
    clientRequestId,
    now()
  );
}

export function imageJobCancelRequested(userId: string, clientRequestId: string) {
  if (!userId || !clientRequestId) return false;
  return Boolean(
    getOne<{ client_request_id: string }>(
      appDb,
      "select client_request_id from image_job_cancel_requests where user_id = ? and client_request_id = ?",
      userId,
      clientRequestId
    )
  );
}

export function clearImageJobCancelIntent(userId: string, clientRequestId: string) {
  if (!userId || !clientRequestId) return;
  run(appDb, "delete from image_job_cancel_requests where user_id = ? and client_request_id = ?", userId, clientRequestId);
}

export function cleanupExpiredImageJobCancelIntents() {
  run(
    appDb,
    "delete from image_job_cancel_requests where created_at < ?",
    localTimestamp(new Date(Date.now() - CANCEL_INTENT_TTL_MS))
  );
}

export function beginImageJobExecution(jobId: string) {
  activeControllers.get(jobId)?.abort();
  const controller = new AbortController();
  activeControllers.set(jobId, controller);
  return controller;
}

export function finishImageJobExecution(jobId: string, controller: AbortController) {
  if (activeControllers.get(jobId) === controller) activeControllers.delete(jobId);
}

export function abortImageJobExecution(jobId: string) {
  const controller = activeControllers.get(jobId);
  if (!controller) return false;
  controller.abort();
  activeControllers.delete(jobId);
  return true;
}
