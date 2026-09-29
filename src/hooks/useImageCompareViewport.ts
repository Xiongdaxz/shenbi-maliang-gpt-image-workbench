import { useCallback, useEffect, useRef, useState } from "react";
import { changeCompareMembers, clampCompareNumber, compareMaxZoom, compareOriginalView, compareScale, compareViewIsAdjusted, defaultCompareView, IMAGE_COMPARE_MAX_SCALE, IMAGE_COMPARE_MIN_SCALE, panCompareView, zoomCompareView, type CompareDraft, type CompareGeometry, type CompareView } from "../lib/imageCompare";

export function useImageCompareViewport(initial: CompareDraft, onSave: (draft: CompareDraft) => void) {
  const [draft, setDraft] = useState(initial);
  const latest = useRef(initial);
  const geometries = useRef<Record<string, CompareGeometry>>({});
  const visible = useRef(initial.imageIds);
  const frame = useRef(0);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const commit = useCallback(() => saveRef.current(latest.current), []);
  const update = useCallback((next: CompareDraft, persist = false) => {
    latest.current = next;
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; setDraft(latest.current); });
    if (persist) saveRef.current(next);
  }, []);
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    saveRef.current(latest.current);
  }, []);

  const limit = (id: string, view: CompareView) => {
    const ids = latest.current.synced ? visible.current : [id];
    const sizes = ids.map((key) => geometries.current[key]).filter((g): g is CompareGeometry => Boolean(g));
    return clampCompareNumber(view.zoom, view.mode === "fit" ? 1 : IMAGE_COMPARE_MIN_SCALE, compareMaxZoom(view.mode, sizes));
  };
  const applyView = (id: string, view: CompareView, persist = false) => {
    const next = { ...latest.current, activeId: id, views: { ...latest.current.views } };
    const bounded = { ...view, zoom: limit(id, view) };
    for (const key of next.synced ? next.imageIds : [id]) next.views[key] = bounded;
    update(next, persist);
  };
  return {
    draft, latest, geometries, visible, commit,
    toggleMember: (id: string) => {
      const result = changeCompareMembers(latest.current, id);
      if (!result.reason) update(result.draft, true);
      return result.reason;
    },
    register: useCallback((id: string, g: CompareGeometry | null) => {
      if (g) geometries.current[id] = g;
      else delete geometries.current[id];
      if (!g) return;
      const state = latest.current;
      const sourceId = state.synced ? state.activeId : id;
      const source = state.views[sourceId];
      if (!source) return;
      const ids = state.synced ? visible.current : [id];
      const maximum = compareMaxZoom(source.mode, ids.map((key) => geometries.current[key]).filter(Boolean));
      if (source.zoom <= maximum) return;
      const views = { ...state.views };
      for (const key of state.synced ? state.imageIds : [id]) views[key] = { ...source, zoom: maximum };
      update({ ...state, views });
    }, [update]),
    activate: (id: string) => { if (latest.current.activeId !== id) update({ ...latest.current, activeId: id }, true); },
    sync: () => {
      if (!latest.current.imageIds.length) return;
      const next = { ...latest.current, synced: !latest.current.synced, views: { ...latest.current.views } };
      if (next.synced) {
        const source = next.views[next.activeId];
        const zoom = clampCompareNumber(source.zoom, source.mode === "fit" ? 1 : IMAGE_COMPARE_MIN_SCALE, compareMaxZoom(source.mode, visible.current.map((id) => geometries.current[id]).filter(Boolean)));
        for (const id of next.imageIds) next.views[id] = { ...source, zoom };
      }
      update(next, true);
    },
    mode: (mode: CompareView["mode"]) => {
      const id = latest.current.activeId;
      if (!id || !latest.current.views[id]) return;
      applyView(id, mode === "fit" ? defaultCompareView() : { ...latest.current.views[id], mode, zoom: 1 }, true);
    },
    toggleView: (id: string) => {
      const state = latest.current;
      if (!state.imageIds.includes(id) || !geometries.current[id]) return;
      const reset = compareViewIsAdjusted(state.views[id]);
      const views = { ...state.views };
      for (const key of state.synced ? state.imageIds : [id]) {
        views[key] = reset ? defaultCompareView() : geometries.current[key] ? compareOriginalView(geometries.current[key]) : { mode: "actual", zoom: 1, u: 0.5, v: 0 };
      }
      update({ ...state, activeId: id, views }, true);
    },
    scale: (id: string, value: number, point?: { x: number; y: number }, persist = false) => {
      const g = geometries.current[id], view = latest.current.views[id];
      if (!g || !view) return;
      const current = { ...view, mode: "actual" as const, zoom: compareScale(view, g) };
      const nextScale = clampCompareNumber(value, IMAGE_COMPARE_MIN_SCALE, IMAGE_COMPARE_MAX_SCALE);
      // Preserve the fit image's center when it happens to be below the editor's
      // manual 10% floor; normal manual zoom uses a stable pointer anchor.
      const next = current.zoom < IMAGE_COMPARE_MIN_SCALE ? { ...current, zoom: nextScale } : zoomCompareView(current, g, nextScale, point);
      applyView(id, next, persist);
    },
    zoom: (id: string, value: number, point?: { x: number; y: number }, persist = false) => {
      const g = geometries.current[id], view = latest.current.views[id];
      if (!g) return;
      applyView(id, zoomCompareView(view, g, limit(id, { ...view, zoom: value }), point), persist);
    },
    pan: (id: string, dx: number, dy: number) => {
      const g = geometries.current[id];
      if (g) applyView(id, panCompareView(latest.current.views[id], g, dx, dy));
    },
    removeUnavailable: (ids: string[]) => {
      const next = { ...latest.current, imageIds: latest.current.imageIds.filter((id) => !ids.includes(id)) };
      if (!next.imageIds.includes(next.activeId)) next.activeId = next.imageIds[0] ?? "";
      update(next, true);
    }
  };
}
