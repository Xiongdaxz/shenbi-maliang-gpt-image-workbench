import { useEffect } from "react";

export type ImageJobEventPayload = {
  jobId: string;
  sessionId: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  type?: "generation" | "edit" | string;
  resultImageId?: string | null;
  error?: string | null;
  updatedAt: string;
};

type ImageJobEventsOptions = {
  onConnected?: () => void;
  onJob: (payload: ImageJobEventPayload) => void;
};

export type StreamEvent = {
  id?: string;
  event: string;
  data: unknown;
};

const IMAGE_JOB_EVENTS_URL = "/api/image-jobs/events";

export function parseStreamFrame(frame: string): StreamEvent | null {
  let id: string | undefined;
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of frame.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("id:")) id = line.slice(3).trimStart();
    else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  const dataText = dataLines.join("\n").trim();
  if (!dataText) return { id, event, data: {} };
  try {
    return { id, event, data: JSON.parse(dataText) };
  } catch {
    return null;
  }
}

export function nextImageJobEventCursor(current: string, event: StreamEvent) {
  return event.id === undefined ? current : event.id;
}

export function imageJobEventStreamHeaders(lastEventId: string) {
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (lastEventId) headers["Last-Event-ID"] = lastEventId;
  return headers;
}

function isImageJobEventPayload(value: unknown): value is ImageJobEventPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.jobId === "string"
    && typeof record.sessionId === "string"
    && (record.status === "running" || record.status === "succeeded" || record.status === "failed" || record.status === "cancelled")
    && typeof record.updatedAt === "string"
  );
}

export function useImageJobEvents({ onConnected, onJob }: ImageJobEventsOptions) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleEvent = (event: string, data: unknown) => {
      if (event === "connected") {
        onConnected?.();
        return;
      }
      if (event === "job" && isImageJobEventPayload(data)) {
        onJob(data);
      }
    };

    if (typeof window.EventSource === "function") {
      const source = new window.EventSource(IMAGE_JOB_EVENTS_URL);
      const handleConnected = () => onConnected?.();
      const handleJob = (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(event.data) as unknown;
          if (isImageJobEventPayload(payload)) onJob(payload);
        } catch {
          // Ignore malformed event frames.
        }
      };
      source.addEventListener("connected", handleConnected);
      source.addEventListener("job", handleJob);
      return () => {
        source.removeEventListener("connected", handleConnected);
        source.removeEventListener("job", handleJob);
        source.close();
      };
    }

    let stopped = false;
    let reconnectTimer = 0;
    let activeController: AbortController | null = null;
    let lastEventId = "";

    const connect = () => {
      const controller = new AbortController();
      activeController = controller;

      const readStream = async () => {
        const response = await fetch(IMAGE_JOB_EVENTS_URL, {
          credentials: "include",
          headers: imageJobEventStreamHeaders(lastEventId),
          signal: controller.signal
        });
        if (!response.ok || !response.body) throw new Error(`SSE stream unavailable: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const parsed = parseStreamFrame(frame);
            if (parsed) {
              lastEventId = nextImageJobEventCursor(lastEventId, parsed);
              handleEvent(parsed.event, parsed.data);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      };

      void readStream()
        .catch((error) => {
          if (!controller.signal.aborted) console.warn("图片任务事件流连接失败", error);
        })
        .finally(() => {
          if (!stopped) reconnectTimer = window.setTimeout(connect, 3000);
        });
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      activeController?.abort();
    };
  }, [onConnected, onJob]);
}
