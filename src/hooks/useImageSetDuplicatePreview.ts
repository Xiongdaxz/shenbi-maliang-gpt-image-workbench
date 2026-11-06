import { useEffect, useState } from "react";
import type { WorkImage } from "../types";

const MAX_COMPARE_BYTES = 8 * 1024 * 1024;
async function previewBytes(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok || Number(response.headers.get("content-length")) > MAX_COMPARE_BYTES || !response.body) return null;
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length; if (length > MAX_COMPARE_BYTES) { await reader.cancel(); return null; } parts.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
export function useImageSetDuplicatePreview(preview?: WorkImage, selected?: WorkImage) {
  const [match, setMatch] = useState("");
  const key = preview && selected && preview.id !== selected.id ? `${preview.id}:${selected.id}` : "";
  useEffect(() => {
    if (!key || !preview || !selected) return;
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 10000);
    void Promise.all([previewBytes(preview.url, controller.signal), previewBytes(selected.url, controller.signal)]).then(([left, right]) => {
      if (!controller.signal.aborted && left?.length && right && left.length === right.length && left.every((byte, index) => byte === right[index])) setMatch(key);
    }).catch(() => { /* A failed comparison does not change preview or adoption. */ }).finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [key, preview?.url, selected?.url]);
  return Boolean(key && match === key);
}
