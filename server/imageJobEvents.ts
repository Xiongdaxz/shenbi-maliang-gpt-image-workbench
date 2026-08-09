import type { Database } from "bun:sqlite";

export type ImageJobEventStatus = "running" | "succeeded" | "failed" | "cancelled";

export type ImageJobEventPayload = {
  jobId: string;
  sessionId: string;
  status: ImageJobEventStatus;
  type?: "generation" | "edit" | string;
  resultImageId?: string | null;
  error?: string | null;
  requestedImageCount?: number;
  completedImageCount?: number;
  completedImageIndices?: number[];
  updatedAt: string;
};

type ImageJobEventClient = {
  send: (event: string, payload: unknown, id?: string) => void;
};

export type ImageJobEventReplayCursor = {
  updatedAt: string;
  jobId: string;
};

type ImageJobEventStreamOptions = {
  lastEventId?: string | null;
  replay?: (cursor: ImageJobEventReplayCursor) => ImageJobEventPayload[];
};

const encoder = new TextEncoder();
const clientsByUserId = new Map<string, Set<ImageJobEventClient>>();

function eventId(payload: ImageJobEventPayload) {
  return `${payload.updatedAt}|${payload.jobId}`;
}

export function imageJobEventReplayCursor(lastEventId: string | null | undefined) {
  const normalized = String(lastEventId ?? "").trim();
  const separatorIndex = normalized.indexOf("|");
  const updatedAt = (separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : normalized).trim();
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) return null;
  return {
    updatedAt,
    jobId: separatorIndex >= 0 ? normalized.slice(separatorIndex + 1).trim() : ""
  } satisfies ImageJobEventReplayCursor;
}

function frame(event: string, payload: unknown, id?: string) {
  const normalizedId = String(id ?? "").replace(/[\0\r\n]/g, "");
  return encoder.encode(`${normalizedId ? `id: ${normalizedId}\n` : ""}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function replayImageJobEventsFromDb(
  db: Database,
  userId: string,
  cursor: ImageJobEventReplayCursor,
  limit = 500
): ImageJobEventPayload[] {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  const rows = db.query<{
    id: string;
    session_id: string;
    status: "succeeded" | "failed" | "cancelled";
    type: string;
    result_image_id: string | null;
    error: string | null;
    updated_at: string;
  }, [string, string, string, string, number]>(
    `select id, session_id, status, type, result_image_id, error, updated_at
     from image_jobs
     where user_id = ?
       and (updated_at > ? or (updated_at = ? and id > ?))
       and status in ('succeeded', 'failed', 'cancelled')
     order by updated_at asc, id asc
     limit ?`
  ).all(userId, cursor.updatedAt, cursor.updatedAt, cursor.jobId, safeLimit);
  return rows.map((row) => ({
    jobId: row.id,
    sessionId: row.session_id,
    status: row.status,
    type: row.type,
    resultImageId: row.result_image_id,
    error: row.error,
    updatedAt: row.updated_at
  }));
}

export function streamImageJobEvents(userId: string, options: ImageJobEventStreamOptions = {}) {
  let client: ImageJobEventClient | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    if (!client) return;
    const clients = clientsByUserId.get(userId);
    clients?.delete(client);
    if (clients?.size === 0) clientsByUserId.delete(userId);
    client = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = {
        send: (event, payload, id) => {
          try {
            controller.enqueue(frame(event, payload, id));
          } catch {
            cleanup();
          }
        }
      };
      const clients = clientsByUserId.get(userId) ?? new Set<ImageJobEventClient>();
      clients.add(client);
      clientsByUserId.set(userId, clients);
      client.send("connected", { connectedAt: new Date().toISOString() });
      const replayCursor = imageJobEventReplayCursor(options.lastEventId);
      if (replayCursor && options.replay) {
        try {
          for (const payload of options.replay(replayCursor)) {
            client.send("job", payload, eventId(payload));
          }
        } catch (error) {
          console.warn("图片任务事件补发失败", error);
        }
      }
      heartbeat = setInterval(() => client?.send("ping", { at: Date.now() }), 25000);
    },
    cancel() {
      cleanup();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

export function emitImageJobEvent(userId: string, payload: ImageJobEventPayload) {
  const clients = clientsByUserId.get(userId);
  if (!clients || clients.size === 0) return;
  for (const client of Array.from(clients)) {
    client.send("job", payload, eventId(payload));
  }
}
