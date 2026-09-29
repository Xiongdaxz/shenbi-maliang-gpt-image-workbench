export const IMAGE_COMPARE_LIMIT = 4;
export const IMAGE_COMPARE_MIN_SCALE = 0.1;
export const IMAGE_COMPARE_MAX_SCALE = 3;
export const IMAGE_COMPARE_SCALE_STEP = 0.1;
export const IMAGE_COMPARE_DRAG_THRESHOLD = 4;

export type CompareView = { mode: "fit" | "actual"; zoom: number; u: number; v: number };
export type CompareImageSource = "auto" | "preview" | "original";
export type CompareGeometry = { width: number; height: number; viewportWidth: number; viewportHeight: number };
export type CompareDraft = {
  version: 1;
  imageIds: string[];
  activeId: string;
  synced: boolean;
  views: Record<string, CompareView>;
};

export const defaultCompareView = (): CompareView => ({ mode: "fit", zoom: 1, u: 0.5, v: 0.5 });
export const clampCompareNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function createCompareDraft(ids: string[]): CompareDraft | null {
  const imageIds = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 200))];
  if ((ids.length > 0 && imageIds.length === 0) || imageIds.length > IMAGE_COMPARE_LIMIT) return null;
  return { version: 1, imageIds, activeId: imageIds[0] ?? "", synced: true, views: Object.fromEntries(imageIds.map((id) => [id, defaultCompareView()])) };
}

export function parseCompareDraft(value: unknown): CompareDraft | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<CompareDraft>;
  if (item.version !== 1 || !Array.isArray(item.imageIds) || item.imageIds.length > IMAGE_COMPARE_LIMIT) return null;
  const draft = createCompareDraft(item.imageIds);
  if (!draft) return null;
  draft.activeId = typeof item.activeId === "string" && draft.imageIds.includes(item.activeId) ? item.activeId : draft.activeId;
  draft.synced = item.synced !== false;
  for (const id of draft.imageIds) {
    const view = item.views && Object.hasOwn(item.views, id) ? item.views[id] : null;
    if (!view || ![view.zoom, view.u, view.v].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    draft.views[id] = {
      mode: view.mode === "actual" ? "actual" : "fit",
      zoom: clampCompareNumber(view.zoom, view.mode === "actual" ? IMAGE_COMPARE_MIN_SCALE : 1, view.mode === "actual" ? IMAGE_COMPARE_MAX_SCALE : 100_000),
      u: clampCompareNumber(view.u, 0, 1), v: clampCompareNumber(view.v, 0, 1)
    };
  }
  return draft;
}

export function initialCompareImageIds(activeId: string, groupIds: string[] = [], conversationResultIds: string[] = []) {
  return [...new Set([activeId, ...groupIds, ...conversationResultIds].filter(Boolean))].slice(0, IMAGE_COMPARE_LIMIT);
}

export async function galleryCompareImageIds(
  image: { id: string; sessionId: string | null },
  loadSessionResults: (sessionId: string, limit: number) => Promise<Array<{ id: string; sessionId: string | null }>>
) {
  const results = image.sessionId ? await loadSessionResults(image.sessionId, IMAGE_COMPARE_LIMIT) : [];
  return initialCompareImageIds(image.id, results.filter((item) => item.sessionId === image.sessionId).map((item) => item.id));
}

export function changeCompareMembers(draft: CompareDraft, id: string): { draft: CompareDraft; reason?: "limit" } {
  const selected = draft.imageIds.includes(id);
  if (!selected && draft.imageIds.length >= IMAGE_COMPARE_LIMIT) return { draft, reason: "limit" };
  const imageIds = selected ? draft.imageIds.filter((key) => key !== id) : [...draft.imageIds, id];
  const activeId = selected ? (draft.activeId === id ? imageIds[0] ?? "" : draft.activeId) : id;
  const views = Object.fromEntries(imageIds.map((key) => [key, draft.views[key] ?? (draft.synced && draft.views[draft.activeId] ? { ...draft.views[draft.activeId] } : defaultCompareView())]));
  return { draft: { ...draft, imageIds, activeId, views } };
}

export function compareFitScale(g: CompareGeometry) {
  return Math.min(IMAGE_COMPARE_MAX_SCALE, Math.max(1, g.viewportWidth - 24) / Math.max(1, g.width), Math.max(1, g.viewportHeight - 24) / Math.max(1, g.height));
}

export function compareScale(view: CompareView, g: CompareGeometry) {
  return Math.min(IMAGE_COMPARE_MAX_SCALE, view.mode === "fit" ? compareFitScale(g) * Math.max(1, view.zoom) : Math.max(IMAGE_COMPARE_MIN_SCALE, view.zoom));
}

export function compareViewIsAdjusted(view: CompareView) {
  return view.mode === "actual" || Math.abs(view.zoom - 1) > 0.001;
}

/** Like the editor: 100% is centered horizontally and starts at the image top. */
export function compareOriginalView(g: CompareGeometry): CompareView {
  return { mode: "actual", zoom: 1, u: 0.5, v: Math.min(0.5, g.viewportHeight / Math.max(1, g.height) / 2) };
}

export function compareImageContainsPoint(view: CompareView, g: CompareGeometry, point: { x: number; y: number }) {
  const center = clampCompareView(view, g), scale = compareScale(view, g);
  const left = g.viewportWidth / 2 - center.u * g.width * scale;
  const top = g.viewportHeight / 2 - center.v * g.height * scale;
  return point.x >= left && point.x <= left + g.width * scale && point.y >= top && point.y <= top + g.height * scale;
}

export function shouldToggleCompareOnRelease({ start, end, moved, multiple, cancelled }: {
  start: { x: number; y: number }; end: { x: number; y: number }; moved: boolean; multiple: boolean; cancelled: boolean;
}) {
  return !moved && !multiple && !cancelled && Math.hypot(end.x - start.x, end.y - start.y) < IMAGE_COMPARE_DRAG_THRESHOLD;
}

export function compareMaxZoom(mode: CompareView["mode"], geometries: CompareGeometry[]) {
  return mode === "actual" ? IMAGE_COMPARE_MAX_SCALE : Math.max(1, Math.min(...geometries.map((g) => IMAGE_COMPARE_MAX_SCALE / compareFitScale(g)), 100_000));
}

export function clampCompareView(view: CompareView, g: CompareGeometry): CompareView {
  const scale = compareScale(view, g);
  const clampCenter = (value: number, size: number, viewport: number) => {
    const margin = Math.min(0.5, viewport / Math.max(1, size * scale) / 2);
    return clampCompareNumber(value, margin, 1 - margin);
  };
  return { ...view, u: clampCenter(view.u, g.width, g.viewportWidth), v: clampCenter(view.v, g.height, g.viewportHeight) };
}

export function panCompareView(view: CompareView, g: CompareGeometry, dx: number, dy: number) {
  const center = clampCompareView(view, g);
  const scale = compareScale(view, g);
  return clampCompareView({ ...center, u: center.u - dx / (g.width * scale), v: center.v - dy / (g.height * scale) }, g);
}

export function zoomCompareView(view: CompareView, g: CompareGeometry, zoom: number, point = { x: g.viewportWidth / 2, y: g.viewportHeight / 2 }): CompareView {
  const center = clampCompareView(view, g);
  const next = { ...center, zoom };
  const before = compareScale(view, g), after = compareScale(next, g);
  return clampCompareView({ ...next,
    u: center.u + (point.x - g.viewportWidth / 2) / g.width * (1 / before - 1 / after),
    v: center.v + (point.y - g.viewportHeight / 2) / g.height * (1 / before - 1 / after)
  }, g);
}

export function compareNeedsOriginal(view: CompareView, geometry: CompareGeometry) {
  const previewScale = Math.min(1, 1600 / Math.max(geometry.width, geometry.height));
  return view.mode === "actual" || compareScale(view, geometry) > previewScale + 0.001;
}

/** Explicit preview/original selection never modifies the independent view. */
export function compareWantsOriginal(source: CompareImageSource, view: CompareView, geometry?: CompareGeometry, hasDimensions = true) {
  if (source !== "auto") return source === "original";
  return !hasDimensions || Boolean(geometry && compareNeedsOriginal(view, geometry));
}

export function compareLibraryScrollTop(index: number, cardWidth: number, viewportHeight: number, itemCount: number) {
  const height = Math.ceil(Math.max(1, Math.round(cardWidth)) * 1.2);
  const stride = height + 8;
  const total = Math.max(0, itemCount * stride - 8);
  return clampCompareNumber(index * stride + height / 2 - viewportHeight / 2, 0, Math.max(0, total - viewportHeight));
}

/** Preserve the active observation slot, swapping when the requested image is already visible. */
export function replaceCompareSlot(slots: string[], activeId: string, nextId: string): string[] {
  const target = Math.max(0, slots.indexOf(activeId));
  const previous = slots.indexOf(nextId);
  const next = [...slots];
  if (previous >= 0) next[previous] = slots[target];
  next[target] = nextId;
  return next;
}

/** Floating controls do not reduce the image canvas or affect its arrangement. */
export function compareLayoutColumns(images: Array<{ width: number; height: number }>, width: number, height: number, mobile = width < 768) {
  if (images.length < 2) return 1;
  if (mobile) return 1;
  const candidates = images.length === 2 ? [2, 1] : images.length === 3 ? [3, 2] : [4, 2];
  let best = candidates[0], bestArea = -1;
  for (const columns of candidates) {
    if (width / columns < 240) continue;
    const rows = Math.ceil(images.length / columns);
    const area = images.reduce((sum, image) => {
      const availableWidth = Math.max(1, width / columns - 24);
      const availableHeight = Math.max(1, height / rows - 24);
      const w = Math.max(1, image.width), h = Math.max(1, image.height);
      const scale = Math.min(3, availableWidth / w, availableHeight / h);
      return sum + w * h * scale * scale;
    }, 0);
    if (area > bestArea * 1.01) { bestArea = area; best = columns; }
  }
  return best;
}
