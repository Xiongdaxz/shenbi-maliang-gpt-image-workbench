import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Heart, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { clampCompareView, compareImageContainsPoint, compareScale, compareViewIsAdjusted, IMAGE_COMPARE_DRAG_THRESHOLD, shouldToggleCompareOnRelease, type CompareGeometry, type CompareView } from "../../lib/imageCompare";
import { cx } from "../../lib/cx";
import { formatImageFileSize } from "../../lib/format";
import { compareDisplayedResource, type CompareDisplayedResource } from "../../lib/imageCompareResource";
import type { ImagePreviewWheelMode, WorkImage } from "../../types";
import type { CompareOriginal } from "../../hooks/useCompareOriginals";
import { CheckerboardImage } from "../CheckerboardImage";

type Props = {
  id: string; label: string; image?: WorkImage | null; thumbnail?: string;
  active: boolean; view: CompareView; loading: boolean; unavailable: boolean; error: boolean;
  firstRow: boolean; lastRow: boolean; firstColumn: boolean;
  favoritePending: boolean; original?: CompareOriginal; wantsOriginal: boolean; wheelMode: ImagePreviewWheelMode;
  onActivate: () => void; onReveal: () => void; onFavorite: () => void; onRetry: () => void; onOriginalRetry: () => void;
  onGeometry: (id: string, geometry: CompareGeometry | null) => void;
  onDisplayedResource: (id: string, resource: CompareDisplayedResource | null) => void;
  onZoomBy: (factor: number, point?: { x: number; y: number }) => void;
  onZoomStep: (direction: number) => void; onToggleView: () => void;
  onPan: (dx: number, dy: number) => void; onCommit: () => void;
  onDragChange: (id: string, active: boolean) => void;
  infoOpen: boolean; onInfoOpen: (anchor: HTMLButtonElement) => void; onInfoLeave: () => void;
};

export function ImageCompareViewport(props: Props) {
  const { id, image, view, original } = props;
  const { t } = useI18n();
  const stage = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [decodedPreview, setDecodedPreview] = useState({ src: "", width: 0, height: 0 });
  const [loadedSource, setLoadedSource] = useState("");
  const [failedSource, setFailedSource] = useState("");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; distance: number } | null>(null);
  const press = useRef<{ start: { x: number; y: number }; moved: boolean; multiple: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const current = useRef(props);
  current.current = props;
  const wheelTimer = useRef(0);
  const previewSrc = image?.previewUrl || image?.url || props.thumbnail;
  const previewSize = decodedPreview.src === previewSrc ? decodedPreview : { width: 0, height: 0 };
  // Keep the logical original dimensions when its decoded resource is released
  // on a preview switch. Geometry must not follow the selected bitmap variant.
  const originalSize = useRef<{ width: number; height: number } | null>(null);
  if (original?.width && original?.height) originalSize.current = { width: original.width, height: original.height };
  const width = originalSize.current?.width || image?.imageWidth || previewSize.width;
  const height = originalSize.current?.height || image?.imageHeight || previewSize.height;
  const geometry: CompareGeometry = { width: width || 1, height: height || 1, viewportWidth: viewport.width, viewportHeight: viewport.height };
  const center = clampCompareView(view, geometry), scale = compareScale(view, geometry);
  const adjusted = compareViewIsAdjusted(view);
  const canPan = width * scale > viewport.width + 1 || height * scale > viewport.height + 1;
  const originalReady = original?.status === "ready" && Boolean(original.src) && props.wantsOriginal;
  const src = originalReady ? original.src : previewSrc;
  const sourceKey = `${src}:${previewAttempt}`;
  const previewLoaded = loadedSource === sourceKey;
  const previewError = failedSource === sourceKey;
  const variants = useQuery({
    queryKey: ["image-download-options", "image", id, ""],
    queryFn: () => api.imageDownloadOptions(id),
    enabled: Boolean(image && !originalReady && !props.unavailable && !props.error),
    staleTime: 5 * 60 * 1000, retry: false, refetchOnWindowFocus: false
  });
  const displayed = compareDisplayedResource(image, props.wantsOriginal, original, decodedPreview, variants.data?.options);
  const fileSize = formatImageFileSize(displayed?.fileSize);
  const displayedSource = displayed?.source, displayedSrc = displayed?.src;
  const displayedWidth = displayed?.width, displayedHeight = displayed?.height, displayedBytes = displayed?.fileSize;
  useLayoutEffect(() => {
    props.onDisplayedResource(id, displayedSource && displayedSrc ? {
      source: displayedSource, src: displayedSrc, width: displayedWidth || 0, height: displayedHeight || 0, fileSize: displayedBytes || 0
    } : null);
  }, [id, displayedSource, displayedSrc, displayedWidth, displayedHeight, displayedBytes, props.onDisplayedResource]);
  useEffect(() => () => current.current.onDisplayedResource(id, null), [id]);

  useEffect(() => {
    const release = () => {
      pointers.current.clear();
      gesture.current = null;
      press.current = null;
      setDragging(false);
      current.current.onDragChange(id, false);
      current.current.onCommit();
    };
    const visibility = () => { if (document.hidden) release(); };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
      current.current.onDragChange(id, false);
    };
  }, [id]);

  // A cached resource may finish before a passive reset effect runs. Track the
  // actual source and inspect completed images rather than resetting a boolean.
  useLayoutEffect(() => {
    const element = stage.current?.querySelector<HTMLImageElement>(".image-compare-image");
    if (!element?.complete || !element.naturalWidth) return;
    setLoadedSource(sourceKey);
    if (!originalReady) setDecodedPreview({ src: previewSrc || "", width: element.naturalWidth, height: element.naturalHeight });
  }, [sourceKey, originalReady, previewSrc]);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (width > 0 && height > 0) props.onGeometry(id, { width, height, viewportWidth: viewport.width, viewportHeight: viewport.height });
    return () => props.onGeometry(id, null);
  }, [id, width, height, viewport.width, viewport.height, props.onGeometry]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const p = current.current;
      if (!p.image || p.unavailable) return;
      event.preventDefault();
      p.onActivate();
      const rect = element.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      if (p.wheelMode === "zoom" || event.ctrlKey || event.metaKey) {
        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        if (Math.abs(delta) < 1) return;
        p.onZoomStep(delta < 0 ? 1 : -1);
      } else if (event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) p.onPan(-event.deltaY * unit, 0);
      else p.onPan(-event.deltaX * unit, -event.deltaY * unit);
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => current.current.onCommit(), 160);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => { element.removeEventListener("wheel", wheel); window.clearTimeout(wheelTimer.current); };
  }, []);

  const sample = () => {
    const points = [...pointers.current.values()];
    if (!points.length) return null;
    const a = points[0], b = points[1] || a;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: points.length > 1 ? Math.hypot(a.x - b.x, a.y - b.y) : 0 };
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!image || props.unavailable || props.error || previewError || (!previewLoaded && !originalReady) || event.button !== 0 || (event.target as Element).closest("button")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!pointers.current.size && !compareImageContainsPoint(view, geometry, { x: event.clientX - rect.left, y: event.clientY - rect.top })) return;
    props.onActivate();
    props.onReveal();
    event.preventDefault();
    if (!pointers.current.size) press.current = { start: { x: event.clientX, y: event.clientY }, moved: false, multiple: false };
    else if (press.current) {
      press.current.multiple = true;
      press.current.moved = true;
      setDragging(true);
      props.onDragChange(id, true);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture.current = sample();
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const next = sample(), previous = gesture.current;
    const sequence = press.current;
    if (!sequence) return;
    if (!sequence.moved) {
      if (Math.hypot(event.clientX - sequence.start.x, event.clientY - sequence.start.y) < IMAGE_COMPARE_DRAG_THRESHOLD) return;
      sequence.moved = true;
      setDragging(true);
      props.onDragChange(id, true);
    }
    event.preventDefault();
    if (next && previous) {
      if (next.distance > 0 && previous.distance > 0) {
        const rect = event.currentTarget.getBoundingClientRect();
        props.onZoomBy(next.distance / previous.distance, { x: previous.x - rect.left, y: previous.y - rect.top });
      }
      if (canPan || sequence.multiple) props.onPan(next.x - previous.x, next.y - previous.y);
    }
    gesture.current = next;
  };
  const pointerEnd = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!pointers.current.has(event.pointerId)) return;
    const sequence = press.current;
    pointers.current.delete(event.pointerId);
    gesture.current = sample();
    const finished = pointers.current.size === 0;
    if (finished) {
      press.current = null;
      setDragging(false);
    }
    props.onDragChange(id, pointers.current.size > 0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (finished && sequence && shouldToggleCompareOnRelease({ ...sequence, end: { x: event.clientX, y: event.clientY }, cancelled })) props.onToggleView();
    props.onCommit();
  };
  return (
    <section className={cx("image-compare-pane", props.active && "active", props.firstRow && "first-row", props.lastRow && "last-row", props.firstColumn && "first-column")} aria-label={t("compare.image", { label: props.label })}>
      <header className="image-compare-pane-header">
        <button type="button" className="image-compare-select" aria-pressed={props.active} data-tooltip-disabled
          aria-haspopup={image ? "dialog" : undefined} aria-expanded={props.infoOpen} aria-controls={props.infoOpen ? "image-compare-info" : undefined}
          onPointerEnter={(event) => { if (image && event.pointerType !== "touch") props.onInfoOpen(event.currentTarget); }}
          onPointerLeave={(event) => { if (event.pointerType !== "touch") props.onInfoLeave(); }}
          onFocus={(event) => { if (image && event.currentTarget.matches(":focus-visible")) props.onInfoOpen(event.currentTarget); }} onBlur={props.onInfoLeave}
          onClick={(event) => { props.onActivate(); props.onReveal(); if (image) props.onInfoOpen(event.currentTarget); }}>
          <strong>{props.label}</strong><span>{displayed ? t(displayed.source === "original" ? "compare.original" : "compare.preview") : t("compare.image", { label: props.label })}{displayed?.width && displayed.height ? ` · ${displayed.width} × ${displayed.height}` : ""}{fileSize ? ` · ${fileSize}` : ""}</span>
          {props.active ? <small>{t("compare.current")}</small> : null}
        </button>
        <button type="button" className={cx("image-compare-favorite", image?.favorited && "active")} disabled={!image || props.unavailable || props.favoritePending}
          aria-label={t(image?.favorited ? "compare.unfavorite" : "compare.favorite", { label: props.label })} aria-pressed={Boolean(image?.favorited)} onClick={props.onFavorite}>
          <Heart size={16} fill={image?.favorited ? "currentColor" : "none"} /><span>{t(image?.favorited ? "compare.saved" : "compare.save")}</span>
        </button>
      </header>
      <div ref={stage} className={cx("image-compare-stage", adjusted && "is-view-adjusted", dragging && "is-panning")} onPointerDown={pointerDown} onPointerMove={pointerMove}
        onPointerUp={(event) => pointerEnd(event)} onPointerCancel={(event) => pointerEnd(event, true)} onLostPointerCapture={(event) => pointerEnd(event, true)}>
        {src && !props.unavailable && !props.error ? (
          <>
            {!previewLoaded && !originalReady && props.thumbnail ? <img className="image-compare-placeholder" src={props.thumbnail} alt="" draggable={false} /> : null}
            <CheckerboardImage key={`${src}:${previewAttempt}`} src={src} alt={t("compare.image", { label: props.label })} draggable={false} decoding="async"
              className="image-compare-image" style={{ width: geometry.width * scale, height: geometry.height * scale, left: viewport.width / 2 - center.u * geometry.width * scale, top: viewport.height / 2 - center.v * geometry.height * scale, opacity: previewLoaded || originalReady ? 1 : 0 }}
              onLoad={(event) => { setLoadedSource(sourceKey); setFailedSource(""); if (!originalReady) setDecodedPreview({ src: previewSrc || "", width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); }}
              onError={() => setFailedSource(sourceKey)} />
          </>
        ) : null}
        {props.loading || (!previewLoaded && !previewError && !originalReady && !props.error && !props.unavailable) ? <div className="image-compare-stage-message" role="status">{t("common.loading")}</div> : null}
        {props.unavailable || props.error || previewError ? <div className="image-compare-stage-message" role="status">
          <span>{t(props.unavailable ? "compare.unavailable" : "compare.loadFailed")}</span>
          {!props.unavailable ? <button className="secondary-btn" type="button" onClick={() => { setPreviewAttempt((n) => n + 1); props.onRetry(); }}><RefreshCw size={15} />{t("common.retry")}</button> : null}
        </div> : null}
      </div>
      {!originalReady && props.wantsOriginal && !props.unavailable && !props.error ? <div className="image-compare-quality" aria-live="polite">
        {original?.status !== "error" ? <span>{t("compare.originalLoading")}</span> : null}
        {original?.status === "error" && props.wantsOriginal ? <button type="button" onClick={props.onOriginalRetry}>{t("compare.retryOriginal")}</button> : null}
      </div> : null}
    </section>
  );
}
