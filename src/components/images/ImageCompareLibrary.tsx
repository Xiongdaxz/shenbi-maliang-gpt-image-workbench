import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { api } from "../../api";
import { useCursorLibraryQuery } from "../../hooks/useCursorLibraryQuery";
import { useInfinitePageLoader } from "../../hooks/useInfinitePageLoader";
import { useI18n } from "../../i18n";
import { cx } from "../../lib/cx";
import { IMAGE_PAGE_SIZE } from "../../lib/pagination";
import { compareLibraryScrollTop } from "../../lib/imageCompare";
import { compareLibraryCandidates, rememberCompareCandidates, type CompareLibraryCandidate, type CompareLibrarySnapshot } from "../../lib/imageCompareLibrary";
import type { WorkImage } from "../../types";
import { CheckerboardImage } from "../CheckerboardImage";
import { VirtualizedResponsiveGrid } from "../VirtualizedResponsiveGrid";

const candidateKey = (item: CompareLibraryCandidate) => item.id;
const candidateHeight = (width: number) => width * 1.2;

type LibraryProps = {
  ownerId: string; imageIds: string[]; activeId: string; images: WorkImage[]; thumbnails: Record<string, string>;
  onToggle: (id: string) => void; dragging: boolean;
  collapsed: boolean; onToggleCollapsed: () => void;
  revealVersion: number;
};
export const ImageCompareLibrary = memo(function ImageCompareLibrary({ ownerId, imageIds, activeId, images, thumbnails, onToggle, dragging, collapsed, onToggleCollapsed, revealVersion }: LibraryProps) {
  const { t } = useI18n();
  const panelId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; y: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const positionedRequest = useRef("");
  const [remembered, setRemembered] = useState<CompareLibrarySnapshot>(() => ({ ownerId, candidates: [] }));
  const library = useCursorLibraryQuery({
    queryKey: ["images", "compare-library", ownerId],
    queryFn: ({ cursor, signal }) => api.libraryImages({ limit: IMAGE_PAGE_SIZE, cursor, sort: "desc" }, { signal })
  });
  const facets = useQuery({ queryKey: ["images", "compare-library-facets", ownerId], queryFn: ({ signal }) => api.libraryImageFacets({}, { signal }), staleTime: 30_000 });
  const loaded = useMemo(() => library.data?.pages.flatMap((page) => page.items) ?? [], [library.data]);
  const snapshot = useMemo(() => {
    const seen = new Set(loaded.map((item) => item.id));
    const pinned = imageIds.filter((id) => !seen.has(id)).map((id) => {
      const image = images.find((item) => item.id === id);
      return { id, thumbnailUrl: image?.thumbnailUrl || thumbnails[id] || "", title: image?.originPrompt || image?.prompt || t("compare.image", { label: String.fromCharCode(65 + imageIds.indexOf(id)) }) };
    });
    return rememberCompareCandidates(remembered, ownerId, pinned);
  }, [loaded, imageIds, images, thumbnails, t, remembered, ownerId]);
  useLayoutEffect(() => { setRemembered(snapshot); }, [snapshot]);
  const cards = useMemo(() => compareLibraryCandidates(snapshot, loaded), [snapshot, loaded]);
  const sentinel = useInfinitePageLoader({
    autoLoad: !collapsed && !dragging,
    rootRef: scroller, rootMargin: "400px", scrollIdleDelayMs: 48,
    fetchNextPage: library.fetchNextPage, hasNextPage: Boolean(library.hasNextPage), isFetchingNextPage: library.isFetchingNextPage,
    isFetchNextPageError: library.isFetchNextPageError
  });
  useLayoutEffect(() => {
    const request = `${activeId}:${revealVersion}`;
    if (positionedRequest.current === request || collapsed || dragging || library.isPending || !scroller.current) return;
    let settleFrame = 0;
    // Let the virtual grid measure its real single-column width before locating
    // an item that may not currently have a DOM node.
    const frame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        const element = scroller.current;
        const index = cards.findIndex((item) => item.id === activeId);
        if (!element || index < 0 || element.clientHeight < 1) return;
        const item = [...element.querySelectorAll<HTMLElement>("[data-compare-image-id]")].find((node) => node.dataset.compareImageId === activeId);
        const containerBounds = element.getBoundingClientRect(), itemBounds = item?.getBoundingClientRect();
        positionedRequest.current = request;
        if (itemBounds && itemBounds.top >= containerBounds.top + 4 && itemBounds.bottom <= containerBounds.bottom - 4) return;
        const top = itemBounds
          ? Math.max(0, element.scrollTop + itemBounds.top - containerBounds.top + itemBounds.height / 2 - element.clientHeight / 2)
          : compareLibraryScrollTop(index, element.clientWidth, element.clientHeight, cards.length);
        element.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      });
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(settleFrame); };
  }, [activeId, revealVersion, collapsed, dragging, cards, library.isPending]);
  const toggleLabel = `${t(collapsed ? "common.expand" : "common.collapse")} · ${t("pages.images.title")}`;
  return <><aside id={panelId} className={cx("image-compare-library image-compare-island", collapsed && "collapsed")} inert={dragging || collapsed} aria-hidden={dragging || collapsed} aria-label={t("compare.library.title")}>
    <header aria-live="polite"><strong>{t("pages.images.title")}</strong><span dir="ltr">{imageIds.length}/{facets.data?.all ?? "—"}</span></header>
    <div ref={scroller} className="image-compare-library-scroll"
      onPointerDown={(event) => {
        suppressClick.current = false;
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX >= bounds.left + event.currentTarget.clientWidth) return;
        pointer.current = { id: event.pointerId, y: event.clientY, top: event.currentTarget.scrollTop, moved: false };
      }}
      onPointerMove={(event) => {
        const state = pointer.current;
        if (!state || event.pointerId !== state.id) return;
        if (!(event.buttons & 1)) { pointer.current = null; return; }
        if (!state.moved && Math.abs(event.clientY - state.y) < 5) return;
        state.moved = true;
        suppressClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.scrollTop = state.top + state.y - event.clientY;
      }}
      onPointerUp={(event) => { pointer.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { pointer.current = null; }} onLostPointerCapture={() => { pointer.current = null; }}
      onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
      <VirtualizedResponsiveGrid items={cards} getKey={candidateKey} minColumnWidth={200} mobileColumns={1} gap={8} mobileGap={8}
        estimateCardHeight={candidateHeight} scrollRootRef={scroller} overscanMultiplier={0.5}
        renderItem={(item, context) => {
          const index = imageIds.indexOf(item.id), selected = index >= 0;
          return <div data-compare-image-id={item.id} className={cx("image-compare-library-item", selected && "selected", item.id === activeId && "active")}>
            <button className="image-compare-library-preview" type="button" aria-label={t(selected ? "compare.library.remove" : "compare.library.add", { name: item.title })}
              aria-pressed={selected} data-tooltip={t(selected ? "compare.library.remove" : "compare.library.add", { name: item.title })} onClick={() => onToggle(item.id)}>
              {item.thumbnailUrl ? <CheckerboardImage src={item.thumbnailUrl} alt="" loading={context.eager ? "eager" : "lazy"} decoding="async" draggable={false} /> : <span>{t("compare.unavailable")}</span>}
              {selected ? <span className="image-compare-library-letter">{String.fromCharCode(65 + index)}</span> : null}
              {selected ? <span className="image-compare-library-toggle" aria-hidden="true"><Check size={14} /></span> : null}
            </button>
          </div>;
        }} />
      {library.isPending || library.isFetchingNextPage ? <div className="image-compare-library-status" role="status">{t("common.loading")}</div> : null}
      {library.isError ? <button className="image-compare-library-retry" type="button" onClick={() => void (library.isFetchNextPageError ? library.fetchNextPage() : library.refetch())}><RefreshCw size={15} />{t("common.retry")}</button> : null}
      {!library.isPending && !library.isError && cards.length === 0 ? <div className="image-compare-library-status">{t("pages.images.empty")}</div> : null}
      <div ref={sentinel} className="image-compare-library-sentinel" aria-hidden="true" />
    </div>
  </aside>
    {collapsed ? <div className="image-compare-library-edge" aria-hidden="true" inert={dragging}
      onPointerDown={(event) => { if (event.pointerType === "touch") onToggleCollapsed(); }} /> : null}
    <button type="button" className={cx("image-compare-library-handle", collapsed && "collapsed")} onClick={onToggleCollapsed}
      inert={dragging} aria-controls={panelId} aria-expanded={!collapsed} aria-label={toggleLabel} data-tooltip={toggleLabel}>
      {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
    </button>
  </>;
}, (before, after) => before.ownerId === after.ownerId && before.activeId === after.activeId && before.dragging === after.dragging
  && before.revealVersion === after.revealVersion
  && before.collapsed === after.collapsed && before.onToggleCollapsed === after.onToggleCollapsed
  && before.onToggle === after.onToggle
  && before.imageIds.length === after.imageIds.length && before.imageIds.every((id, index) => id === after.imageIds[index] && before.thumbnails[id] === after.thumbnails[id])
  && before.images.length === after.images.length && before.images.every((image, index) => image === after.images[index]));
