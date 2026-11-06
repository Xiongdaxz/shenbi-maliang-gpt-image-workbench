import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useI18n } from "../i18n";
import { clamp, DEFAULT_IMAGE_SET_LAYOUT, IMAGE_SET_LAYOUT_KEY, imageSetLayoutGeometry, parseImageSetLayout, type ImageSetLayoutPreferences } from "../lib/imageSetLayout";

type Divider = "left" | "right" | "candidates";
export function useImageSetLayout(ready: boolean) {
  const { t } = useI18n(), id = useId(), workspaceRef = useRef<HTMLDivElement>(null), previewRef = useRef<HTMLElement>(null);
  const [preferences, setPreferences] = useState(() => { try { return parseImageSetLayout(localStorage.getItem(IMAGE_SET_LAYOUT_KEY)); } catch { return { ...DEFAULT_IMAGE_SET_LAYOUT }; } });
  const current = useRef(preferences), [dimensions, setDimensions] = useState({ width: 0, height: 640 }), [dragging, setDragging] = useState<Divider | null>(null);
  const geometry = imageSetLayoutGeometry(dimensions.width, dimensions.height, preferences);
  const drag = useRef<null | { axis: Divider; start: number; value: number; initial: ImageSetLayoutPreferences; usable: number; max: number; direction: number; restore: () => void }>(null);
  const update = (next: ImageSetLayoutPreferences, persist = false) => {
    current.current = next; setPreferences(next);
    if (persist) try { localStorage.setItem(IMAGE_SET_LAYOUT_KEY, JSON.stringify(next)); } catch { /* Layout remains usable if storage is unavailable. */ }
  };
  const finish = (cancel: boolean) => {
    const active = drag.current; if (!active) return;
    drag.current = null; active.restore(); setDragging(null); update(cancel ? active.initial : current.current, !cancel);
  };
  useLayoutEffect(() => {
    const element = workspaceRef.current, preview = previewRef.current; if (!ready || !element || !preview) return;
    const measure = () => setDimensions({ width: element.clientWidth, height: preview.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); observer.observe(preview);
    return () => observer.disconnect();
  }, [ready]);
  useEffect(() => { const cancel = () => finish(true); window.addEventListener("blur", cancel); return () => { window.removeEventListener("blur", cancel); drag.current?.restore(); drag.current = null; }; }, []);
  useEffect(() => { if (geometry.mode !== "wide" && drag.current?.axis !== "candidates") finish(true); }, [geometry.mode]);
  const reset = (axis: Divider) => update({ ...current.current, [axis]: DEFAULT_IMAGE_SET_LAYOUT[axis] }, true);
  const change = (axis: Divider, pixels: number, max?: number, usable = geometry.usable) => {
    const limit = max ?? (axis === "left" ? Math.min(300, usable - geometry.right - 420) : axis === "right" ? Math.min(440, usable - geometry.left - 420) : geometry.candidateMax);
    const value = clamp(pixels, axis === "left" ? 160 : axis === "right" ? 280 : 110, limit);
    update({ ...current.current, [axis]: axis === "candidates" ? value : value / Math.max(1, usable) });
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>, axis: Divider) => {
    if (event.button !== 0 || axis !== "candidates" && geometry.mode !== "wide") return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    const cursor = document.body.style.cursor, userSelect = document.body.style.userSelect;
    const direction = getComputedStyle(workspaceRef.current!).direction === "rtl" ? -1 : 1;
    document.body.style.cursor = axis === "candidates" ? "row-resize" : "col-resize"; document.body.style.userSelect = "none";
    drag.current = { axis, start: axis === "candidates" ? event.clientY : event.clientX, value: geometry[axis], initial: { ...current.current }, usable: geometry.usable,
      max: axis === "left" ? Math.min(300, geometry.usable - geometry.right - 420) : axis === "right" ? Math.min(440, geometry.usable - geometry.left - 420) : geometry.candidateMax,
      direction, restore: () => { document.body.style.cursor = cursor; document.body.style.userSelect = userSelect; } };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(axis);
  };
  const separator = (axis: Divider) => {
    const horizontal = axis === "candidates", enabled = horizontal || geometry.mode === "wide";
    return <div className={`sets-divider sets-divider-${axis}${dragging === axis ? " is-dragging" : ""}`} role="separator" tabIndex={enabled ? 0 : -1}
      aria-label={t(`sets.resize.${axis}`)} aria-orientation={horizontal ? "horizontal" : "vertical"} aria-controls={`${id}-${horizontal ? "preview" : "workspace"}`}
      aria-valuemin={horizontal ? 110 : axis === "left" ? 160 : 280} aria-valuemax={horizontal ? geometry.candidateMax : axis === "left" ? Math.min(300, geometry.usable - geometry.right - 420) : Math.min(440, geometry.usable - geometry.left - 420)} aria-valuenow={Math.round(geometry[axis])}
      onPointerDown={event => down(event, axis)} onPointerMove={event => { const active = drag.current; if (!active || active.axis !== axis) return; const delta = (horizontal ? active.start - event.clientY : (event.clientX - active.start) * active.direction * (axis === "right" ? -1 : 1)); change(axis, active.value + delta, active.max, active.usable); }}
      onPointerUp={() => finish(false)} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)} onDoubleClick={() => reset(axis)}
      onKeyDown={event => { if (event.key === "Home" || event.key === "Enter") { event.preventDefault(); reset(axis); return; } const direction = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1; const delta = horizontal ? event.key === "ArrowUp" ? 16 : event.key === "ArrowDown" ? -16 : 0 : event.key === "ArrowRight" ? 16 * direction * (axis === "right" ? -1 : 1) : event.key === "ArrowLeft" ? -16 * direction * (axis === "right" ? -1 : 1) : 0; if (delta) { event.preventDefault(); change(axis, geometry[axis] + delta); update(current.current, true); } }}>
      <span className="sets-divider-grip"/><span className="sets-divider-tip">{dragging === axis ? horizontal ? t("sets.resizeHeight", { value: Math.round(geometry.candidates) }) : t("sets.canvasShare", { value: Math.round(geometry.canvas / Math.max(1, geometry.usable) * 100) }) : t("sets.resizeHint")}</span>
    </div>;
  };
  return { workspaceRef, previewRef, workspaceId: `${id}-workspace`, previewId: `${id}-preview`, mode: geometry.mode, separator,
    style: { "--sets-left-width": `${geometry.left}px`, "--sets-right-width": `${geometry.right}px`, "--sets-candidates-height": `${geometry.candidates}px` } as CSSProperties };
}
