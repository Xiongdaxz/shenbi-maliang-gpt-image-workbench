import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Check, Heart, Lightbulb, Search, X } from "lucide-react";
import { api } from "../api";
import { buildGalleryCaseItems, caseMaterialFromCaseItem, caseStyleCategories } from "../lib/caseMaterials";
import { cx } from "../lib/cx";
import { IMAGE_PAGE_SIZE } from "../lib/pagination";
import { useInfinitePageLoader } from "../hooks/useInfinitePageLoader";
import { FilterTabLabel, FilterTabsScroller } from "./HorizontalScrollers";
import { SearchHistoryInput } from "./SearchHistoryInput";
import { SkeletonImage } from "./SkeletonImage";
import type { CaseMaterialItem } from "../types";

const CASE_MATERIAL_PICKER_CLOSE_ANIMATION_MS = 240;

type CasePickerScrollAnchor = {
  id: string;
  offsetTop: number;
};

export function CaseMaterialPickerModal({
  open,
  selectedCaseMaterials,
  onClose,
  onConfirm
}: {
  open: boolean;
  selectedCaseMaterials: CaseMaterialItem[];
  onClose: () => void;
  onConfirm: (caseMaterials: CaseMaterialItem[]) => void;
}) {
  const closeTimerRef = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollAnchorRef = useRef<CasePickerScrollAnchor | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [mineOnly, setMineOnly] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [closing, setClosing] = useState(false);
  const [draftSelectedCaseMaterials, setDraftSelectedCaseMaterials] = useState<CaseMaterialItem[]>([]);
  const visible = open || closing;
  const caseQuerySignature = useMemo(
    () => [selectedCategoryIds.join(","), mineOnly ? "mine" : "all", favoriteOnly ? "favorite" : "normal", keyword].join("\u0000"),
    [favoriteOnly, keyword, mineOnly, selectedCategoryIds]
  );
  const cases = useInfiniteQuery({
    queryKey: ["case-material-picker", selectedCategoryIds.join(","), mineOnly, favoriteOnly, keyword],
    queryFn: ({ pageParam }) =>
      api.cases({
        limit: IMAGE_PAGE_SIZE,
        offset: Number(pageParam),
        categoryIds: selectedCategoryIds,
        mineOnly,
        favoriteOnly,
        keyword
      }),
    enabled: visible,
    initialPageParam: 0,
    placeholderData: (previousData) => previousData,
    getNextPageParam: (lastPage) => (lastPage.pageInfo.hasMore ? lastPage.pageInfo.offset + lastPage.pageInfo.limit : undefined)
  });
  const categories = useMemo(() => {
    const pages = cases.data?.pages ?? [];
    const baseCategories = pages[0]?.categories ?? [];
    return baseCategories.map((category) => ({
      ...category,
      items: pages.flatMap((page) => page.categories.find((item) => item.id === category.id)?.items ?? [])
    }));
  }, [cases.data?.pages]);
  const captureScrollAnchor = useCallback((): CasePickerScrollAnchor | null => {
    const body = bodyRef.current;
    if (!body) return null;
    const bodyRect = body.getBoundingClientRect();
    const card = Array.from(body.querySelectorAll<HTMLElement>("[data-case-picker-item-id]")).find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > bodyRect.top + 1 && rect.top < bodyRect.bottom - 1;
    });
    const id = card?.dataset.casePickerItemId;
    if (!card || !id) return null;
    return {
      id,
      offsetTop: card.getBoundingClientRect().top - bodyRect.top
    };
  }, []);
  const fetchNextPickerPage = useCallback(() => {
    pendingScrollAnchorRef.current = captureScrollAnchor();
    return cases.fetchNextPage();
  }, [captureScrollAnchor, cases.fetchNextPage]);
  const loadMoreRef = useInfinitePageLoader({
    fetchNextPage: fetchNextPickerPage,
    hasNextPage: Boolean(cases.hasNextPage),
    isFetchingNextPage: cases.isFetchingNextPage,
    rootRef: bodyRef
  });
  const styles = useMemo(() => caseStyleCategories(categories), [categories]);
  const visibleItems = useMemo(() => {
    const selectedCategorySet = new Set(selectedCategoryIds);
    const sourceCategories = selectedCategoryIds.length === 0 ? categories : categories.filter((category) => selectedCategorySet.has(category.id));
    return buildGalleryCaseItems(sourceCategories);
  }, [categories, selectedCategoryIds]);
  const counts = cases.data?.pages[0]?.counts;
  const activeCaseItemIds = useMemo(() => new Set(draftSelectedCaseMaterials.map((item) => item.caseItemId)), [draftSelectedCaseMaterials]);
  const selectedCount = draftSelectedCaseMaterials.length;
  const hintKey = useMemo(
    () => ["case-picker-filter", mineOnly ? "mine" : "all", favoriteOnly ? "favorite" : "normal", selectedCategoryIds.join(","), ...styles.map((category) => `${category.id}:${category.name}`)].join("\u0000"),
    [favoriteOnly, mineOnly, selectedCategoryIds, styles]
  );
  const pageCount = cases.data?.pages.length ?? 0;

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const closeWithMotion = useCallback(
    (afterClose: () => void) => {
      if (!open || closing) return;
      clearCloseTimer();
      setClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        afterClose();
        setClosing(false);
      }, CASE_MATERIAL_PICKER_CLOSE_ANIMATION_MS);
    },
    [clearCloseTimer, closing, open]
  );

  const requestClose = useCallback(() => closeWithMotion(onClose), [closeWithMotion, onClose]);

  const confirmSelection = useCallback(() => {
    const nextCaseMaterials = draftSelectedCaseMaterials;
    closeWithMotion(() => onConfirm(nextCaseMaterials));
  }, [closeWithMotion, draftSelectedCaseMaterials, onConfirm]);

  useEffect(() => {
    if (!open) return;
    clearCloseTimer();
    setClosing(false);
    setDraftSelectedCaseMaterials(selectedCaseMaterials);
  }, [clearCloseTimer, open, selectedCaseMaterials]);

  useEffect(() => {
    pendingScrollAnchorRef.current = null;
  }, [caseQuerySignature]);

  useEffect(() => {
    if (!cases.isFetchingNextPage) {
      pendingScrollAnchorRef.current = null;
    }
  }, [cases.isFetchingNextPage]);

  useLayoutEffect(() => {
    const anchor = pendingScrollAnchorRef.current;
    const body = bodyRef.current;
    if (!anchor || !body) return;
    const card = Array.from(body.querySelectorAll<HTMLElement>("[data-case-picker-item-id]")).find(
      (element) => element.dataset.casePickerItemId === anchor.id
    );
    pendingScrollAnchorRef.current = null;
    if (!card) return;
    const nextOffsetTop = card.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTop += nextOffsetTop - anchor.offsetTop;
  }, [pageCount]);

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    [clearCloseTimer]
  );

  if (!visible) return null;

  const toggleCategory = (categoryId: string) => {
    setMineOnly(false);
    setSelectedCategoryIds((value) => (value.includes(categoryId) ? [] : [categoryId]));
  };

  const toggleCaseMaterial = (caseMaterial: CaseMaterialItem) => {
    setDraftSelectedCaseMaterials((current) =>
      current.some((item) => item.caseItemId === caseMaterial.caseItemId)
        ? current.filter((item) => item.caseItemId !== caseMaterial.caseItemId)
        : [...current, caseMaterial]
    );
  };
  const scopeFilterButtons = (
    <>
      <button
        type="button"
        className={cx(selectedCategoryIds.length === 0 && !mineOnly && "active")}
        onClick={() => {
          setSelectedCategoryIds([]);
          setMineOnly(false);
        }}
      >
        <FilterTabLabel count={counts?.all}>全部</FilterTabLabel>
      </button>
      <button
        type="button"
        className={cx(mineOnly && "active")}
        onClick={() => {
          setSelectedCategoryIds([]);
          setMineOnly((value) => !value);
        }}
      >
        <FilterTabLabel count={counts?.mine}>我的</FilterTabLabel>
      </button>
    </>
  );

  return (
    <div className="modal-backdrop case-picker-backdrop" onMouseDown={requestClose}>
      <section
        className={cx("case-picker-modal", "ui-modal-motion")}
        role="dialog"
        aria-modal="true"
        aria-label="选择灵感图片作为素材"
        data-state={closing ? "closing" : "open"}
        data-placement="center"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="case-picker-header">
          <div>
            <span className="case-picker-title-icon" aria-hidden="true">
              <Lightbulb size={18} />
            </span>
            <h3>选择灵感图片作为素材</h3>
          </div>
          <button type="button" className="case-picker-close" onClick={requestClose} aria-label="关闭灵感选择">
            <X size={18} />
          </button>
        </header>
        <div className="case-picker-filter-row">
          <div className="case-picker-pinned-tabs" role="group" aria-label="灵感范围筛选">
            {scopeFilterButtons}
          </div>
          <FilterTabsScroller ariaLabel="灵感风格筛选" hintKey={hintKey} mode="compact">
            {styles.map((category) => (
              <button
                key={category.id}
                type="button"
                className={cx(selectedCategoryIds.includes(category.id) && "active")}
                onClick={() => toggleCategory(category.id)}
              >
                <FilterTabLabel count={counts?.byCategory?.[category.id]}>{category.name}</FilterTabLabel>
              </button>
            ))}
          </FilterTabsScroller>
          <div className="case-picker-filter-actions">
            <button
              className={cx("case-favorite-filter-btn", favoriteOnly && "active")}
              type="button"
              onClick={() => setFavoriteOnly((value) => !value)}
              aria-label={favoriteOnly ? "取消收藏筛选" : "只看收藏灵感"}
              aria-pressed={favoriteOnly}
              title={favoriteOnly ? "取消收藏筛选" : "只看收藏灵感"}
            >
              <Heart size={17} fill={favoriteOnly ? "currentColor" : "none"} />
              <span className="filter-tab-count">{counts?.favorite ?? 0}</span>
            </button>
            <SearchHistoryInput
              scope="cases"
              className="case-search case-picker-search"
              value={keyword}
              onChange={setKeyword}
              placeholder="搜索标题、描述或风格"
              ariaLabel="搜索灵感"
              icon={<Search size={17} />}
            />
          </div>
        </div>
        <div className="case-picker-body" ref={bodyRef}>
          {cases.isLoading ? <div className="case-empty">正在加载灵感图片</div> : null}
          {!cases.isLoading && visibleItems.length === 0 ? <div className="case-empty">暂无匹配灵感</div> : null}
          <div className="case-picker-grid">
            {visibleItems.map((item) => {
              const caseMaterial = caseMaterialFromCaseItem(item);
              const active = activeCaseItemIds.has(caseMaterial.caseItemId);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cx("case-picker-card", active && "active")}
                  data-case-picker-item-id={item.id}
                  onClick={() => toggleCaseMaterial(caseMaterial)}
                  aria-pressed={active}
                >
                  {active ? (
                    <span className="case-picker-check" aria-hidden="true">
                      <Check size={13} />
                    </span>
                  ) : null}
                  <SkeletonImage src={item.imageThumbnailUrl ?? item.imagePreviewUrl ?? item.imageUrl} alt={item.title} />
                  <span className="case-picker-card-copy">
                    <strong>{item.title}</strong>
                    <span>{item.prompt}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div ref={loadMoreRef} className="page-load-sentinel" aria-hidden="true" />
        </div>
        <footer className="case-picker-footer">
          <span>已选 {selectedCount} 张</span>
          <div className="case-picker-footer-actions">
            <button type="button" className="secondary-btn" onClick={requestClose}>
              取消
            </button>
            <button type="button" className="primary-btn" onClick={confirmSelection}>
              确认选择{selectedCount > 0 ? ` (${selectedCount})` : ""}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
