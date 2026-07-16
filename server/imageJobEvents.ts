export type ImageJobEventStatus = "running" | "succeeded" | "failed" | "cancelled";

export type ImageJobEventPayload = {
  jobId: string;
  sessionId: string;
  status: ImageJobEventStatus;
  type?: "generation" | "edit" | string;
  resultImageId?: string | null;
  error?: string | null;
  updatedAt: string;
};

type ImageJobEventClient = {
  send: (event: string, payload: unknown) => void;
};

const encoder = new TextEncoder();
const clientsByUserId = new Map<string, Set<ImageJobEventClient>>();

function frame(event: string, payload: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function streamImageJobEvents(userId: string) {
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
        send: (event, payload) => {
          try {
            controller.enqueue(frame(event, payload));
          } catch {
            cleanup();
          }
        }
      };
      const clients = clientsByUserId.get(userId) ?? new Set<ImageJobEventClient>();
      clients.add(client);
      clientsByUserId.set(userId, clients);
      client.send("connected", { connectedAt: new Date().toISOString() });
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
    client.send("job", payload);
  }
}
