import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useQueries, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ArrowLeft, Eye, Heart, Image as ImageIcon, ImageMinus, LoaderCircle, Maximize, Maximize2, Minimize, Minimize2, Pencil, ScanEye } from "lucide-react";
import { api, ApiError } from "../../api";
import { useI18n } from "../../i18n";
import { useCompareOriginals } from "../../hooks/useCompareOriginals";
import { useImageCompareViewport } from "../../hooks/useImageCompareViewport";
import { compareLayoutColumns, compareWantsOriginal, compareScale, compareViewIsAdjusted, defaultCompareView, IMAGE_COMPARE_MAX_SCALE, IMAGE_COMPARE_MIN_SCALE, IMAGE_COMPARE_SCALE_STEP, replaceCompareSlot, type CompareDraft, type CompareGeometry, type CompareImageSource } from "../../lib/imageCompare";
import { cx } from "../../lib/cx";
import { compareInfoHasKeyboardFocus } from "../../lib/imageCompareFocus";
import type { CompareDisplayedResource } from "../../lib/imageCompareResource";
import { readCompareLibraryCollapsed } from "../../lib/imageCompareLibraryVisibility";
import { useImageCompare } from "../../store/imageCompare";
import { useToast } from "../../ui";
import type { ImagePreviewWheelMode, LibraryImageCard, LibraryPage, WorkImage } from "../../types";
import { ImageDownloadMenu } from "../ImageDownloadMenu";
import { ImageCompareViewport } from "./ImageCompareViewport";
import { ImageCompareLibrary } from "./ImageCompareLibrary";
import { ImageZoomSlider } from "../ImageZoomSlider";
import { ImageCompareTooltip } from "./ImageCompareTooltip";
import { ImageCompareInfoCard } from "./ImageCompareInfoCard";
import { ImageCompareSelection } from "./ImageCompareSelection";
import "../../styles/images-comparison.css";

const CONTROL_ICON_SIZE = 18;

export function ImageCompareWorkspace({ initial, ownerId, thumbnails, wheelMode, onClose, onEdit }: {
  initial: CompareDraft; ownerId: string; thumbnails: Record<string, string>; wheelMode: ImagePreviewWheelMode;
  onClose: (unavailableIds: string[]) => void; onEdit: (image: WorkImage, images: WorkImage[]) => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const save = useCallback((draft: CompareDraft) => {
    if (useImageCompare.getState().ownerId === ownerId) useImageCompare.getState().save(draft);
  }, [ownerId]);
  const viewport = useImageCompareViewport(initial, save);
  const { draft } = viewport;
  const [screen, setScreen] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const mobile = screen.width < 768;
  const [slots, setSlots] = useState(() => initial.imageIds.slice(0, 2).includes(initial.activeId) ? initial.imageIds.slice(0, 2) : [initial.activeId, initial.imageIds[0]]);
  const [infoTarget, setInfoTarget] = useState<{ id: string; anchor: HTMLButtonElement } | null>(null);
  const infoTargetRef = useRef(infoTarget);
  infoTargetRef.current = infoTarget;
  const restoringInfoFocus = useRef(false);
  const infoCloseTimer = useRef(0);
  const keepInfoOpen = useCallback(() => window.clearTimeout(infoCloseTimer.current), []);
  const closeInfo = useCallback(() => { window.clearTimeout(infoCloseTimer.current); setInfoTarget(null); }, []);
  const dismissInfo = useCallback(() => {
    const anchor = infoTargetRef.current?.anchor;
    closeInfo();
    if (!anchor?.isConnected) return;
    restoringInfoFocus.current = true;
    anchor.focus({ preventScroll: true });
    restoringInfoFocus.current = false;
  }, [closeInfo]);
  const dismissInfoSoon = useCallback(() => {
    window.clearTimeout(infoCloseTimer.current);
    infoCloseTimer.current = window.setTimeout(() => {
      if (compareInfoHasKeyboardFocus(infoTargetRef.current?.anchor ?? null, document.getElementById("image-compare-info"), document.activeElement)) return;
      setInfoTarget(null);
    }, 180);
  }, []);
  const [cleanView, setCleanView] = useState(false);
  const [recoveryControls, setRecoveryControls] = useState<HTMLDivElement | null>(null);
  const [libraryCollapsed, setLibraryCollapsed] = useState(readCompareLibraryCollapsed);
  const [imageSource, setImageSource] = useState<CompareImageSource>("original");
  const [libraryRevealVersion, setLibraryRevealVersion] = useState(0);
  const revealActiveImage = useCallback(() => setLibraryRevealVersion((value) => value + 1), []);
  const [content, setContent] = useState<HTMLElement | null>(null);
  const [pendingFavorites, setPendingFavorites] = useState<Set<string>>(() => new Set());
  const pendingRef = useRef(new Set<string>());
  const [editing, setEditing] = useState(false);
  const mounted = useRef(true);
  const favoritesChanged = useRef(false);
  const removedUnavailable = useRef(new Set<string>());
  const closeButton = useRef<HTMLButtonElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const [controlsHeight, setControlsHeight] = useState(80);
  const [canvasSize, setCanvasSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const canvas = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<Record<string, CompareGeometry>>({});
  const [displayedResources, setDisplayedResources] = useState<Record<string, CompareDisplayedResource>>({});
  const onDisplayedResource = useCallback((id: string, resource: CompareDisplayedResource | null) => {
    setDisplayedResources((previous) => {
      const old = previous[id];
      if (!resource) {
        if (!old) return previous;
        const next = { ...previous }; delete next[id]; return next;
      }
      if (old && old.source === resource.source && old.src === resource.src && old.width === resource.width && old.height === resource.height && old.fileSize === resource.fileSize) return previous;
      return { ...previous, [id]: resource };
    });
  }, []);
  const [draggingIds, setDraggingIds] = useState<Set<string>>(() => new Set());
  const dragging = draggingIds.size > 0;
  const chromeHidden = dragging || cleanView;
  useEffect(() => { if (chromeHidden) closeInfo(); }, [chromeHidden, closeInfo]);
  useEffect(() => () => window.clearTimeout(infoCloseTimer.current), []);
  const onDragChange = useCallback((id: string, active: boolean) => {
    setDraggingIds((previous) => {
      if (previous.has(id) === active) return previous;
      const next = new Set(previous);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    const update = () => setScreen({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => {
      mounted.current = false;
      window.removeEventListener("resize", update);
      if (favoritesChanged.current) void queryClient.invalidateQueries({ queryKey: ["images"] });
    };
  }, [queryClient]);

  useLayoutEffect(() => {
    const update = () => {
      setControlsHeight((controls.current?.offsetHeight ?? 64) + 32);
      if (canvas.current) setCanvasSize({ width: canvas.current.clientWidth, height: canvas.current.clientHeight });
    };
    const observer = new ResizeObserver(update);
    if (controls.current) observer.observe(controls.current);
    if (canvas.current) observer.observe(canvas.current);
    update();
    closeButton.current?.focus({ preventScroll: true });
    return () => observer.disconnect();
  }, []);

  const queries = useQueries({ queries: draft.imageIds.map((id) => ({
    queryKey: ["image-compare", ownerId, id],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.imageDetail(id, { signal }),
    staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnMount: "always" as const
  })) });
  const entries = draft.imageIds.map((id, index) => {
    const query = queries[index];
    const unavailable = (query.error instanceof ApiError && [403, 404].includes(query.error.status)) || (query.isSuccess && !query.data.image);
    return { id, query, image: unavailable || query.isError ? null : query.data?.image, unavailable };
  });
  const current = entries.find((entry) => entry.id === draft.activeId);
  const image = current?.image;
  const infoImage = infoTarget ? entries.find((entry) => entry.id === infoTarget.id)?.image : null;
  const validImages = entries.flatMap((entry) => entry.image ? [entry.image] : []);
  const unavailableIds = entries.filter((entry) => entry.unavailable).map((entry) => entry.id);
  const validSlots = slots.filter((id) => draft.imageIds.includes(id));
  for (const id of draft.imageIds) if (validSlots.length < 2 && !validSlots.includes(id)) validSlots.push(id);
  if (mobile && draft.activeId && !validSlots.includes(draft.activeId)) validSlots[0] = draft.activeId;
  const visibleIds = mobile ? validSlots : draft.imageIds;
  const columns = compareLayoutColumns(visibleIds.map((id) => {
    const item = entries.find((entry) => entry.id === id)?.image;
    return { width: item?.imageWidth || 1024, height: item?.imageHeight || 1024 };
  }), canvasSize.width, canvasSize.height, mobile);
  const rows = Math.max(1, Math.ceil(visibleIds.length / columns));
  viewport.visible.current = visibleIds;
  const activeView = draft.views[draft.activeId] ?? defaultCompareView();
  const activeLabel = draft.activeId ? String.fromCharCode(65 + draft.imageIds.indexOf(draft.activeId)) : "—";
  const activeGeometry = sizes[draft.activeId];
  const zoomPercentage = (activeGeometry ? compareScale(activeView, activeGeometry) : activeView.zoom) * 100;
  const zoomLabel = `${Math.round(zoomPercentage)}%`;
  const resetView = compareViewIsAdjusted(activeView);
  const wantsOriginal = new Set(visibleIds.filter((id) => {
    const entry = entries.find((item) => item.id === id);
    return Boolean(entry?.image && compareWantsOriginal(imageSource, draft.views[id], sizes[id], Boolean(entry.image.imageWidth && entry.image.imageHeight)));
  }));
  const usingOriginal = wantsOriginal.has(draft.activeId);
  const nextImageSource = usingOriginal ? "preview" : "original";
  const switchSourceLabel = t(usingOriginal ? "compare.source.toPreview" : "compare.source.toOriginal");
  const syncLabel = t(draft.synced ? "compare.sync.disable" : "compare.sync.enable");
  const requests = [...visibleIds].sort((a, b) => Number(b === draft.activeId) - Number(a === draft.activeId))
    .flatMap((id) => {
      const item = entries.find((entry) => entry.id === id)?.image;
      return item && wantsOriginal.has(id) ? [{ id, url: item.originalUrl || item.url }] : [];
    });
  const originals = useCompareOriginals(requests);
  const onGeometry = useCallback((id: string, geometry: CompareGeometry | null) => {
    viewport.register(id, geometry);
    if (!geometry) return;
    setSizes((previous) => {
      const old = previous[id];
      return old && old.width === geometry.width && old.height === geometry.height && old.viewportWidth === geometry.viewportWidth && old.viewportHeight === geometry.viewportHeight ? previous : { ...previous, [id]: geometry };
    });
  }, [viewport.register]);
  const close = () => { viewport.commit(); onClose([...new Set([...removedUnavailable.current, ...unavailableIds])]); };
  const activate = (id: string, reveal = true) => {
    if (!viewport.latest.current.imageIds.includes(id)) return;
    if (mobile && !visibleIds.includes(id)) setSlots(replaceCompareSlot(validSlots, viewport.latest.current.activeId, id));
    viewport.activate(id);
    if (reveal) revealActiveImage();
  };
  const toggleMember = (id: string) => {
    const adding = !viewport.latest.current.imageIds.includes(id);
    const reason = viewport.toggleMember(id);
    if (reason) { showToast(t("compare.library.limit"), "error"); return; }
    const next = viewport.latest.current;
    setSlots((previous) => {
      let visible = previous.filter((key) => next.imageIds.includes(key));
      if (adding && !visible.includes(id)) visible = visible.length >= 2 ? replaceCompareSlot(visible, draft.activeId, id) : [...visible, id];
      for (const key of next.imageIds) if (visible.length < 2 && !visible.includes(key)) visible.push(key);
      return visible;
    });
  };
  const libraryActions = useRef({ toggleMember });
  libraryActions.current = { toggleMember };
  const onLibraryToggle = useCallback((id: string) => libraryActions.current.toggleMember(id), []);

  const favorite = async (item: WorkImage) => {
    if (pendingRef.current.has(item.id)) return;
    pendingRef.current.add(item.id);
    setPendingFavorites(new Set(pendingRef.current));
    try {
      const result = await api.setImageFavorite(item.id, !item.favorited);
      if (useImageCompare.getState().ownerId !== ownerId) return;
      favoritesChanged.current = true;
      const updateDetail = (data: { image: WorkImage | null } | undefined) => data?.image ? { image: { ...data.image, ...result } } : data;
      queryClient.setQueryData(["image-compare", ownerId, item.id], updateDetail);
      queryClient.setQueryData(["image-detail", item.id], updateDetail);
      queryClient.setQueriesData<InfiniteData<LibraryPage<LibraryImageCard>>>({ predicate: (q) => q.queryKey[0] === "images" && q.queryKey[1] === "library" }, (data) => data ? {
        ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map((card) => card.id === item.id ? { ...card, ...result } : card) }))
      } : data);
      void queryClient.invalidateQueries({ queryKey: ["images", "library-facets"] });
      if (mounted.current) showToast(t(result.favorited ? "toast.favoriteAdded" : "toast.favoriteRemoved"));
      else void queryClient.invalidateQueries({ queryKey: ["images"] });
    } catch (error) {
      if (mounted.current) showToast(error instanceof Error ? error.message : t("toast.imageFavoriteFailed"), "error");
    } finally {
      pendingRef.current.delete(item.id);
      if (mounted.current) setPendingFavorites(new Set(pendingRef.current));
    }
  };
  const edit = async () => {
    if (!image || editing) return;
    setEditing(true);
    viewport.commit();
    try {
      const result = await api.imageDetail(image.id);
      if (!mounted.current || useImageCompare.getState().ownerId !== ownerId) return;
      if (!result.image) throw new Error(t("compare.unavailable"));
      onEdit(result.image, validImages.map((item) => item.id === image.id ? result.image! : item));
    } catch (error) {
      if (mounted.current) showToast(error instanceof Error ? error.message : t("compare.loadFailed"), "error");
    } finally { if (mounted.current) setEditing(false); }
  };
  const keyboardRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyboardRef.current = (event) => {
    const target = event.target as HTMLElement | null;
    if (event.key === "Escape" && !event.defaultPrevented) {
      if (cleanView) { event.preventDefault(); setCleanView(false); return; }
      if (content?.querySelector('.image-download-menu.open, .image-download-popover[data-state="closing"]')) return;
      event.preventDefault();
      if (infoTarget) dismissInfo();
      else close();
      return;
    }
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || target?.closest("input, textarea, select, [contenteditable=true], [role=menu]")) return;
    if (window.getSelection()?.toString()) return;
    const index = Number(event.key) - 1;
    if (/^[1-4]$/.test(event.key) && draft.imageIds[index]) { event.preventDefault(); activate(draft.imageIds[index]); }
    else if (event.key.toLowerCase() === "f" && image) { event.preventDefault(); void favorite(image); }
    else if (event.key === "0") { event.preventDefault(); viewport.mode("fit"); }
    else if (["+", "=", "-"].includes(event.key)) { event.preventDefault(); viewport.scale(draft.activeId, zoomPercentage / 100 + (event.key === "-" ? -IMAGE_COMPARE_SCALE_STEP : IMAGE_COMPARE_SCALE_STEP), undefined, true); }
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => keyboardRef.current(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <section ref={setContent} className={cx("image-compare-workspace", dragging && "is-dragging", cleanView && "is-clean-view", libraryCollapsed && "library-collapsed")} aria-label={t("compare.title")} style={{ "--compare-top": "24px", "--compare-bottom": `${controlsHeight}px` } as CSSProperties}>
          <h1 className="sr-only">{t("compare.title")}</h1>
          <ImageCompareLibrary ownerId={ownerId} imageIds={draft.imageIds} activeId={draft.activeId} images={validImages} thumbnails={thumbnails}
            onToggle={onLibraryToggle} dragging={chromeHidden} collapsed={libraryCollapsed} onCollapsedChange={setLibraryCollapsed} revealVersion={libraryRevealVersion} />
          <div ref={controls} className="image-compare-controls" inert={chromeHidden}>
          <div className="image-compare-view-card image-compare-island">
            <div className="image-compare-nav">
              <button ref={closeButton} type="button" className="image-compare-back" onClick={close} aria-label={t("compare.back")} data-tooltip={t("compare.back")}><ArrowLeft size={CONTROL_ICON_SIZE} /></button>
            </div>
          <div className="image-compare-toolbar" role="toolbar" aria-label={t("compare.controls")}>
            <button type="button" className={cx("secondary-btn", draft.synced && "active")} disabled={!image} aria-label={syncLabel} data-tooltip={syncLabel} aria-pressed={draft.synced} onClick={viewport.sync}>
              {draft.synced ? <ScanEye size={CONTROL_ICON_SIZE} /> : <Eye size={CONTROL_ICON_SIZE} />}
            </button>
            <button type="button" className="secondary-btn" disabled={!image || !activeGeometry} onClick={() => viewport.toggleView(draft.activeId)}
              aria-label={t(resetView ? "imagePreview.reset" : "imagePreview.originalSize")} data-tooltip={t(resetView ? "imagePreview.reset" : "imagePreview.originalSize")}>
              {resetView ? <Minimize2 size={CONTROL_ICON_SIZE} /> : <Maximize2 size={CONTROL_ICON_SIZE} />}
            </button>
            <div className="image-compare-zoom" onPointerUp={viewport.commit} onKeyUp={viewport.commit} onBlur={viewport.commit}>
              <ImageZoomSlider min={Math.min(IMAGE_COMPARE_MIN_SCALE * 100, Math.max(1, Math.floor(zoomPercentage)))} max={IMAGE_COMPARE_MAX_SCALE * 100} value={zoomPercentage}
                label={zoomLabel} tooltip={`${t("compare.pixelScale")} · ${zoomLabel}`} disabled={!activeGeometry}
                onChange={(percentage) => viewport.scale(draft.activeId, percentage / 100)} />
            </div>
          </div>
          <div className="image-compare-options">
            <button type="button" className="secondary-btn" disabled={!image} aria-label={switchSourceLabel} data-tooltip={switchSourceLabel} aria-pressed={usingOriginal} onClick={() => {
              setImageSource(nextImageSource);
              showToast(t(usingOriginal ? "compare.source.previewSelected" : "compare.source.originalSelected"));
            }}>{usingOriginal ? <ImageIcon size={CONTROL_ICON_SIZE} /> : <ImageMinus size={CONTROL_ICON_SIZE} />}</button>
            <button type="button" className="secondary-btn" disabled={!image} aria-label={t("compare.clean.enter")} data-tooltip={t("compare.clean.enter")} aria-pressed={cleanView} onClick={() => setCleanView(true)}><Maximize size={CONTROL_ICON_SIZE} /></button>
          </div>
          </div>
          <div className="image-compare-action-card image-compare-island">
            <ImageCompareSelection imageIds={draft.imageIds} activeId={draft.activeId} mobile={mobile} onActivate={activate} />
            <div className="image-compare-footer-actions">
              <button type="button" className={cx("secondary-btn", image?.favorited && "image-compare-saved")} aria-pressed={Boolean(image?.favorited)} disabled={!image || pendingFavorites.has(image.id)} onClick={() => image && void favorite(image)} aria-label={t(image?.favorited ? "compare.unfavorite" : "compare.favorite", { label: activeLabel })} data-tooltip={t(image?.favorited ? "compare.unfavorite" : "compare.favorite", { label: activeLabel })}><Heart size={CONTROL_ICON_SIZE} fill={image?.favorited ? "currentColor" : "none"} /></button>
              <ImageDownloadMenu key={draft.activeId} portalContainer={content} source={image ? { type: "image", id: image.id, downloadBaseName: image.originPrompt || image.prompt } : null} className="secondary-btn" tooltip={t("download.image")} iconSize={CONTROL_ICON_SIZE} />
              <button type="button" className="secondary-btn" disabled={!image || editing} aria-label={t(editing ? "common.loading" : "compare.edit")} data-tooltip={t("compare.edit")} onClick={() => void edit()}>{editing ? <LoaderCircle className="image-compare-busy" size={CONTROL_ICON_SIZE} /> : <Pencil size={CONTROL_ICON_SIZE} />}</button>
            </div>
          </div>
          </div>
          {unavailableIds.length ? <div className="image-compare-alert" role="status">
            <span>{t("compare.someUnavailable")}</span>
            {draft.imageIds.length - unavailableIds.length >= 1 ? <button type="button" className="secondary-btn" onClick={() => {
              unavailableIds.forEach((id) => removedUnavailable.current.add(id));
              viewport.removeUnavailable(unavailableIds);
            }}>{t("compare.removeUnavailable")}</button> : null}
          </div> : null}
          <div ref={canvas} className="image-compare-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
            {!visibleIds.length ? <div className="image-compare-selection-empty" role="status">{t("compare.library.emptySelection")}</div> : null}
            {visibleIds.map((id, index) => {
              const entry = entries.find((item) => item.id === id)!;
              const label = String.fromCharCode(65 + draft.imageIds.indexOf(id));
              return <ImageCompareViewport key={id} id={id} label={label} firstRow={index < columns} lastRow={Math.floor(index / columns) === rows - 1} firstColumn={index % columns === 0} image={entry.image} thumbnail={thumbnails[id] || entry.image?.thumbnailUrl}
                active={id === draft.activeId} view={draft.views[id]} loading={entry.query.isPending} unavailable={entry.unavailable} error={entry.query.isError}
                favoritePending={pendingFavorites.has(id)} original={originals.results[id]} wantsOriginal={wantsOriginal.has(id)} wheelMode={wheelMode}
                onActivate={() => activate(id, false)} onReveal={revealActiveImage} onFavorite={() => entry.image && void favorite(entry.image)} onRetry={() => void entry.query.refetch()}
                onOriginalRetry={() => originals.retry(id)} onGeometry={onGeometry} onDisplayedResource={onDisplayedResource}
                infoOpen={!chromeHidden && infoTarget?.id === id}
                onInfoOpen={(anchor) => { if (restoringInfoFocus.current) return; keepInfoOpen(); setInfoTarget({ id, anchor }); }} onInfoLeave={dismissInfoSoon}
                onToggleView={() => viewport.toggleView(id)}
                onZoomBy={(factor, point) => { const g = viewport.geometries.current[id]; if (g) viewport.scale(id, compareScale(viewport.latest.current.views[id], g) * factor, point); }}
                onZoomStep={(direction) => { const g = viewport.geometries.current[id]; if (g) viewport.scale(id, Number((compareScale(viewport.latest.current.views[id], g) + direction * IMAGE_COMPARE_SCALE_STEP).toFixed(2))); }}
                onPan={(dx, dy) => viewport.pan(id, dx, dy)} onCommit={viewport.commit} onDragChange={onDragChange} />;
            })}
          </div>
          {!chromeHidden && infoTarget && infoImage && visibleIds.includes(infoTarget.id) ? <ImageCompareInfoCard image={infoImage} label={String.fromCharCode(65 + draft.imageIds.indexOf(infoImage.id))}
            resource={displayedResources[infoImage.id]}
            anchor={infoTarget.anchor} onKeepOpen={keepInfoOpen} onDismissSoon={dismissInfoSoon} onClose={closeInfo} onDismiss={dismissInfo} /> : null}
          {cleanView ? <div ref={setRecoveryControls} className="image-compare-clean-recovery" inert={dragging}
            onPointerDown={(event) => { if (event.pointerType === "touch") { event.preventDefault(); setCleanView(false); } }}>
            <button className="image-compare-clean-exit image-compare-island" type="button" aria-label={t("compare.clean.exit")} data-tooltip={t("compare.clean.exit")}
              onClick={() => setCleanView(false)}><Minimize size={CONTROL_ICON_SIZE} /></button>
          </div> : null}
          <ImageCompareTooltip container={cleanView ? recoveryControls : content} hidden={dragging} />
    </section>
  );
}
