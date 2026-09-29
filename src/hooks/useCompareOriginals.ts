import { useCallback, useEffect, useRef, useState } from "react";

export type CompareOriginal = { status: "loading" | "ready" | "error"; src?: string; width?: number; height?: number; fileSize?: number };
type Request = { id: string; url: string };

/** At most two original fetches/decodes; preview images remain independent. */
export function useCompareOriginals(requests: Request[]) {
  const [results, setResults] = useState<Record<string, CompareOriginal>>({});
  const records = useRef(new Map<string, CompareOriginal>());
  const active = useRef(new Map<string, AbortController>());
  const wanted = useRef<Request[]>([]);
  const alive = useRef(false);
  const pump = useRef<() => void>(() => {});
  const signature = JSON.stringify(requests);
  const publish = () => { if (alive.current) setResults(Object.fromEntries(records.current)); };

  pump.current = () => {
    if (!alive.current) return;
    for (const request of wanted.current) {
      if (active.current.size >= 2) break;
      if (active.current.has(request.id) || records.current.has(request.id)) continue;
      const controller = new AbortController();
      active.current.set(request.id, controller);
      records.current.set(request.id, { status: "loading" });
      publish();
      void (async () => {
        let src = "";
        try {
          const response = await fetch(request.url, { credentials: "same-origin", signal: controller.signal });
          if (!response.ok) throw new Error(String(response.status));
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          src = URL.createObjectURL(blob);
          const image = new Image();
          image.src = src;
          await image.decode();
          if (controller.signal.aborted || !alive.current) return;
          records.current.set(request.id, { status: "ready", src, width: image.naturalWidth, height: image.naturalHeight, fileSize: blob.size });
          src = ""; // Ownership transferred to the hook until release/unmount.
        } catch {
          if (!controller.signal.aborted && alive.current) records.current.set(request.id, { status: "error" });
        } finally {
          if (src) URL.revokeObjectURL(src);
          if (active.current.get(request.id) === controller) {
            active.current.delete(request.id);
            if (controller.signal.aborted) records.current.delete(request.id);
          }
          if (alive.current) { publish(); pump.current(); }
        }
      })();
    }
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const controller of active.current.values()) controller.abort();
      for (const record of records.current.values()) if (record.src) URL.revokeObjectURL(record.src);
      records.current.clear();
    };
  }, []);

  useEffect(() => {
    wanted.current = JSON.parse(signature) as Request[];
    const ids = new Set(wanted.current.map((item) => item.id));
    for (const [id, controller] of active.current) if (!ids.has(id)) controller.abort();
    // Keep at most the currently visible originals, especially on mobile.
    for (const [id, record] of records.current) {
      if (!ids.has(id) && !active.current.has(id)) {
        if (record.src) URL.revokeObjectURL(record.src);
        records.current.delete(id);
      }
    }
    publish();
    pump.current();
  }, [signature]);

  const retry = useCallback((id: string) => {
    if (records.current.get(id)?.status !== "error") return;
    records.current.delete(id);
    pump.current();
  }, []);
  return { results, retry };
}
