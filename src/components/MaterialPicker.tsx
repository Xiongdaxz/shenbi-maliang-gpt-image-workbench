import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WheelEvent as ReactWheelEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrushCleaning, Check, Search, X } from "lucide-react";
import { api } from "../api";
import { useCursorLibraryQuery } from "../hooks/useCursorLibraryQuery";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useInfinitePageLoader } from "../hooks/useInfinitePageLoader";
import { useI18n } from "../i18n";
import { assetSpaceLabel } from "../lib/assets";
import { cx } from "../lib/cx";
import type { AssetItem, LibraryAssetCard } from "../types";
import { VirtualizedResponsiveGrid } from "./VirtualizedResponsiveGrid";

export const MATERIAL_PICKER_DRAWER_ANIMATION_MS = 240;

type MaterialPickerScrollAnchor = {
  id: string;
  offsetTop: number;
};

function materialCardToAsset(card: LibraryAssetCard): AssetItem {
  const originalUrl = `/api/files/assets/${encodeURIComponent(card.id)}`;
  return {
    ...card,
    url: originalUrl,
    originalUrl,
    previewUrl: `${originalUrl}?variant=preview`,
    thumbnailUrl: card.thumbnailUrl
  };
}

type MaterialPickerProps = {
  assets?: { assets: AssetItem[] };
  selectedAssets: AssetItem[];
  onToggleAsset: (asset: AssetItem) => void;
  onSelectedAssetsChange: (assets: AssetItem[]) => void;
  onClose?: () => void;
  closing?: boolean;
};

export function MaterialPickerDrawer({
  open,
  closing = false,
  assets,
  selectedAssets,
  onToggleAsset,
  onSelectedAssetsChange,
  onClose
}: Omit<MaterialPickerProps, "closing"> & { open: boolean; closing?: boolean }) {
  const [rendered, setRendered] = useState(open || closing);
  const closeTimerRef = useRef<number | null>(null);
  const drawerClosing = closing || (rendered && !open);

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (open || closing) {
      setRendered(true);
      return;
    }
    if (!rendered) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setRendered(false);
    }, MATERIAL_PICKER_DRAWER_ANIMATION_MS);
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [closing, open, rendered]);

  if (!rendered) return null;

  return (
    <div className="composer-material-drawer" data-state={drawerClosing ? "closing" : "open"}>
      <MaterialPicker
        assets={assets}
        selectedAssets={selectedAssets}
        onToggleAsset={onToggleAsset}
        onSelectedAssetsChange={onSelectedAssetsChange}
        onClose={onClose}
        closing={drawerClosing}
      />
    </div>
  );
}

export function MaterialPicker({
  assets: _legacyAssets,
  selectedAssets,
  onToggleAsset,
  onSelectedAssetsChange,
  onClose,
  closing = false
}: MaterialPickerProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const debouncedKeyword = useDebouncedValue(keyword, 250);
  const [selectedTagKey, setSelectedTagKey] = useState("");
  const materialTagFilterRef = useRef<HTMLDivElement | null>(null);
  const sectionsRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollAnchorRef = useRef<MaterialPickerScrollAnchor | null>(null);
  const selectedCategoryId = selectedTagKey.startsWith("id:") ? selectedTagKey.slice(3) : "";
  const libraryAssets = useCursorLibraryQuery({
    queryKey: ["assets", "material-picker", selectedCategoryId, debouncedKeyword],
    queryFn: ({ cursor, signal }) => api.libraryAssets({
      limit: 30,
      cursor,
      categoryIds: selectedCategoryId ? [selectedCategoryId] : [],
      keyword: debouncedKeyword,
      space: "all"
    }, { signal })
  });
  const categories = useQuery({
    queryKey: ["asset-categories"],
    queryFn: ({ signal }) => api.assetCategories({ signal }),
    staleTime: 30_000,
    gcTime: 10 * 60_000
  });
  const assetFacets = useQuery({
    queryKey: ["assets", "material-picker-facets", debouncedKeyword],
    queryFn: ({ signal }) => api.libraryAssetFacets({
      keyword: debouncedKeyword,
      space: "all"
    }, { signal }),
    staleTime: 30_000,
    gcTime: 10 * 60_000
  });
  const upload = useMutation({
    mutationFn: (form: FormData) => api.uploadAsset(form),
    onSuccess: (result) => {
      onSelectedAssetsChange([...selectedAssets, result.asset]);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    }
  });
  const allAssets = useMemo(
    () => (libraryAssets.data?.pages.flatMap((page) => page.items) ?? []).map(materialCardToAsset),
    [libraryAssets.data?.pages]
  );
  const materialTags = useMemo(() => {
    return (categories.data?.categories ?? []).map((category) => ({
      key: `id:${category.id}`,
      label: category.name,
      categoryId: category.id,
      count: assetFacets.data ? assetFacets.data.tags.byCategory[category.id] ?? 0 : undefined
    }));
  }, [assetFacets.data, categories.data?.categories]);
  const selectedTag = materialTags.find((tag) => tag.key === selectedTagKey);
  const filteredAssets = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return allAssets
      .filter((asset) => {
        if (!selectedTag) return true;
        if (selectedTag.categoryId) return asset.categoryIds.includes(selectedTag.categoryId);
        return true;
      })
      .filter((asset) => {
        if (!normalizedKeyword) return true;
        const haystack = [asset.name, asset.sourceUsername, assetSpaceLabel(asset, categories.data?.reviewEnabled ?? true), ...asset.categoryNames]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedKeyword);
      });
  }, [allAssets, categories.data?.reviewEnabled, keyword, selectedTag]);
  const sections = [
    { id: "shared", name: t("common.shared"), assets: filteredAssets.filter((asset) => asset.space === "shared" || asset.shared) },
    { id: "private", name: t("common.mine"), assets: filteredAssets.filter((asset) => asset.canEdit && asset.space === "private") }
  ];
  const totalVisibleAssets = sections.reduce((count, section) => count + section.assets.length, 0);
  const captureScrollAnchor = useCallback((): MaterialPickerScrollAnchor | null => {
    const root = sectionsRef.current;
    if (!root) return null;
    const rootRect = root.getBoundingClientRect();
    const card = Array.from(root.querySelectorAll<HTMLElement>("[data-material-picker-item-id]")).find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > rootRect.top + 1 && rect.top < rootRect.bottom - 1;
    });
    const id = card?.dataset.materialPickerItemId;
    if (!card || !id) return null;
    return { id, offsetTop: card.getBoundingClientRect().top - rootRect.top };
  }, []);
  const fetchNextMaterialPage = useCallback(() => {
    pendingScrollAnchorRef.current = captureScrollAnchor();
    return libraryAssets.fetchNextPage();
  }, [captureScrollAnchor, libraryAssets.fetchNextPage]);
  const loadMoreRef = useInfinitePageLoader({
    fetchNextPage: fetchNextMaterialPage,
    hasNextPage: Boolean(libraryAssets.hasNextPage),
    isFetchNextPageError: libraryAssets.isFetchNextPageError,
    isFetchingNextPage: libraryAssets.isFetchingNextPage,
    rootRef: sectionsRef,
    rootMargin: "320px"
  });
  const materialQuerySignature = `${selectedCategoryId}\u0000${debouncedKeyword}`;
  const materialPageCount = libraryAssets.data?.pages.length ?? 0;
  const centerSelectedTag = useCallback(() => {
    const container = materialTagFilterRef.current;
    if (!container) return;
    const selectedKey = selectedTagKey || "all";
    const selectedButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.dataset.materialTagKey === selectedKey
    );
    if (!selectedButton) return;
    const containerRect = container.getBoundingClientRect();
    const buttonRect = selectedButton.getBoundingClientRect();
    const centeredLeft = container.scrollLeft
      + buttonRect.left
      - containerRect.left
      - (container.clientWidth - buttonRect.width) / 2;
    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    container.scrollTo({
      left: Math.min(maxScrollLeft, Math.max(0, centeredLeft)),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  }, [selectedTagKey]);

  useEffect(() => {
    pendingScrollAnchorRef.current = null;
  }, [materialQuerySignature]);

  useEffect(() => {
    centerSelectedTag();
  }, [centerSelectedTag]);

  useEffect(() => {
    if (!libraryAssets.isFetchingNextPage) pendingScrollAnchorRef.current = null;
  }, [libraryAssets.isFetchingNextPage]);

  useLayoutEffect(() => {
    const anchor = pendingScrollAnchorRef.current;
    const root = sectionsRef.current;
    if (!anchor || !root) return;
    const card = Array.from(root.querySelectorAll<HTMLElement>("[data-material-picker-item-id]")).find(
      (element) => element.dataset.materialPickerItemId === anchor.id
    );
    pendingScrollAnchorRef.current = null;
    if (!card) return;
    const nextOffsetTop = card.getBoundingClientRect().top - root.getBoundingClientRect().top;
    root.scrollTop += nextOffsetTop - anchor.offsetTop;
  }, [materialPageCount]);

  useEffect(() => {
    if (!selectedTagKey || materialTags.some((tag) => tag.key === selectedTagKey)) return;
    setSelectedTagKey("");
  }, [materialTags, selectedTagKey]);

  const handleTagWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollWidth <= element.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const atStart = element.scrollLeft <= 0;
    const atEnd = Math.ceil(element.scrollLeft + element.clientWidth) >= element.scrollWidth;
    if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return;
    event.preventDefault();
    element.scrollLeft += delta;
  };
  return (
    <div className="material-picker" data-state={closing ? "closing" : "open"}>
      <div className="material-head">
        <div className="material-title-row">
          <strong>{t("materialPicker.title")}</strong>
          {materialTags.length > 0 ? (
            <div ref={materialTagFilterRef} className="material-tag-filter" aria-label={t("pages.assets.tags")} onWheel={handleTagWheel}>
              <button
                type="button"
                className={cx(!selectedTagKey && "active")}
                data-material-tag-key="all"
                onClick={() => setSelectedTagKey("")}
              >
                <span>{t("common.all")}</span>
                {typeof assetFacets.data?.tags.all === "number" ? <span className="filter-tab-count">{assetFacets.data.tags.all}</span> : null}
              </button>
              {materialTags.map((tag) => (
                <button
                  key={tag.key}
                  type="button"
                  className={cx(selectedTagKey === tag.key && "active")}
                  data-material-tag-key={tag.key}
                  onClick={() => setSelectedTagKey((value) => (value === tag.key ? "" : tag.key))}
                >
                  <span>{tag.label}</span>
                  {typeof tag.count === "number" ? <span className="filter-tab-count">{tag.count}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          <label className="case-search material-search">
            <Search size={16} />
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t("materialPicker.searchPlaceholder")} />
          </label>
        </div>
        <div className="material-head-actions">
          <label className="upload-btn compact">
            {t("materialPicker.localUpload")}
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.set("file", file);
                form.set("space", "private");
                upload.mutate(form);
                event.target.value = "";
              }}
            />
          </label>
          {onClose ? (
            <button type="button" className="icon-btn material-close-btn" onClick={onClose} aria-label={t("materialPicker.close")}>
              <X size={17} />
            </button>
          ) : null}
        </div>
      </div>
      <div ref={sectionsRef} className="material-sections">
        {libraryAssets.isLoading ? <p className="muted">{t("common.loading")}</p> : null}
        {sections.map((section) => (
          <section key={section.id}>
            <div className="material-section-head">
              <h4>{section.name}</h4>
              {section.assets.some((asset) => selectedAssets.some((item) => item.id === asset.id)) ? (
                <button
                  type="button"
                  className="material-clear-selected"
                  onClick={() => {
                    const sectionAssetIds = new Set(section.assets.map((asset) => asset.id));
                    onSelectedAssetsChange(selectedAssets.filter((asset) => !sectionAssetIds.has(asset.id)));
                  }}
                  aria-label={t("materialPicker.clearSelected", { section: section.name })}
                  title={t("materialPicker.clearSelected", { section: section.name })}
                >
                  <BrushCleaning size={14} />
                </button>
              ) : null}
            </div>
            {!libraryAssets.isLoading && section.assets.length === 0 ? <p className="muted">{totalVisibleAssets === 0 ? t("materialPicker.noMatch") : t("materialPicker.empty")}</p> : null}
            <VirtualizedResponsiveGrid
              items={section.assets}
              getKey={(asset) => asset.id}
              minColumnWidth={84}
              estimateCardHeight={(width) => width + 42}
              gap={8}
              mobileGap={8}
              className="material-virtual-grid"
              rowClassName="material-virtual-row"
              scrollRootRef={sectionsRef}
              renderItem={(asset, { eager, highPriority }) => {
                const active = selectedAssets.some((item) => item.id === asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    className={active ? "active" : ""}
                    data-material-picker-item-id={`${section.id}:${asset.id}`}
                    onClick={() => onToggleAsset(asset)}
                  >
                    {active ? (
                      <span className="material-grid-check" aria-hidden="true">
                        <Check size={12} />
                      </span>
                    ) : null}
                    <img
                      src={asset.thumbnailUrl ?? asset.previewUrl ?? asset.url}
                      alt={asset.name}
                      loading={eager ? "eager" : "lazy"}
                      decoding="async"
                      fetchPriority={highPriority ? "high" : "auto"}
                    />
                    <span>{asset.name}</span>
                  </button>
                );
              }}
            />
          </section>
        ))}
        <div ref={loadMoreRef} className="page-load-sentinel" aria-hidden="true" />
      </div>
    </div>
  );
}
