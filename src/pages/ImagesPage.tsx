import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { CalendarArrowDown, CalendarArrowUp, CalendarDays, ChevronDown, ChevronUp, Heart, Images, LayoutGrid, ListChecks, Plus, Search, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { AddAssetFromImageModal } from "../components/AddAssetFromImageModal";
import { AddCaseModal, type AddCaseSource } from "../components/AddCaseModal";
import { PageHeaderViewToggle } from "../components/HorizontalScrollers";
import { MyImageCard } from "../components/MyImageCard";
import { ImagePreviewModal } from "../components/ImagePreviewModal";
import { ImageBatchAssetDialog } from "../components/images/ImageBatchAssetDialog";
import { ImageBatchCaseDialog } from "../components/images/ImageBatchCaseDialog";
import { ImageBatchDeleteDialog } from "../components/images/ImageBatchDeleteDialog";
import { ImageBatchDownloadDialog } from "../components/images/ImageBatchDownloadDialog";
import { ImageBatchResultDialog } from "../components/images/ImageBatchResultDialog";
import { ImageBatchToolbar, type ImageBatchAction } from "../components/images/ImageBatchToolbar";
import { LibraryEmptyState } from "../components/LibraryEmptyState";
import { PageHeader } from "../components/PageHeader";
import { SearchHistoryInput } from "../components/SearchHistoryInput";
import { ScrollJumpButton } from "../components/ScrollJumpButton";
import { VirtualizedResponsiveGrid } from "../components/VirtualizedResponsiveGrid";
import { useI18n } from "../i18n";
import { type AssetUploadMode } from "../lib/assets";
import { cx } from "../lib/cx";
import { groupImagesByTimeline, imageCreatedTime, imageTimelineDateParts } from "../lib/imageTimeline";
import { IMAGE_PAGE_SIZE } from "../lib/pagination";
import { orderedWorkImages, workImageFromLibraryCard } from "../lib/workImages";
import { useInfinitePageLoader } from "../hooks/useInfinitePageLoader";
import { useCursorLibraryQuery } from "../hooks/useCursorLibraryQuery";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useScrollJump } from "../hooks/useScrollJump";
import { useWorkbench } from "../store/workbench";
import type { ImageBatchResult, ImageDeleteImpact, ImagePreviewOpenMode, ImagePreviewWheelMode, LibraryImageCard, LibraryPage, WorkImage } from "../types";
import { ConfirmDialog, useToast } from "../ui";

type ImagesViewMode = "grid" | "timeline";
type ImageInfiniteData = InfiniteData<LibraryPage<LibraryImageCard>, string | null>;
type BatchResultState = { title: string; result: ImageBatchResult };

const IMAGES_VIEW_MODE_STORAGE_KEY = "gpt-image.images.viewMode";
const VIRTUAL_OVERSCAN_PX = 900;
const GRID_MIN_CARD_WIDTH = 240;
const GRID_GAP = 16;
const GRID_MOBILE_GAP = 10;
const TIMELINE_MIN_CARD_WIDTH = 148;
const TIMELINE_GAP = 18;
const TIMELINE_MOBILE_GAP = 14;
const TIMELINE_PANEL_GAP = 10;
const TIMELINE_MOBILE_PANEL_GAP = 8;
const TIMELINE_PADDING_LEFT = 30;
const TIMELINE_MOBILE_PADDING_LEFT = 22;
const TIMELINE_DATE_ROW_HEIGHT = 28;
const TIMELINE_MOBILE_DATE_ROW_HEIGHT = 24;
const TIMELINE_LAYOUT_SETTLE_MS = 48;

function imageCardToWorkImage(card: LibraryImageCard): WorkImage {
  return workImageFromLibraryCard(card);
}

type VirtualMetric = {
  top: number;
  height: number;
};

type TimelineVirtualRow =
  | {
      type: "date";
      key: string;
      top: number;
      height: number;
      group: ReturnType<typeof groupImagesByTimeline>[number];
      collapsed: boolean;
    }
  | {
      type: "images";
      key: string;
      top: number;
      height: number;
      groupKey: string;
      images: WorkImage[];
    };

type TimelineScrollAnchor =
  | { type: "date"; rowKey: string; viewportTop: number }
  | { type: "image"; imageId: string; viewportTop: number };

function storedImagesViewMode(): ImagesViewMode {
  try {
    const value = window.localStorage.getItem(IMAGES_VIEW_MODE_STORAGE_KEY);
    return value === "grid" || value === "timeline" ? value : "timeline";
  } catch {
    return "timeline";
  }
}

function columnsForWidth(width: number, minWidth: number, gap: number, fixedMobileColumns = false) {
  if (fixedMobileColumns) return 2;
  return Math.max(1, Math.floor((Math.max(1, width) + gap) / (minWidth + gap)));
}

function useSettledElementWidth<T extends HTMLElement>(ref: RefObject<T | null>, observeKey: unknown) {
  const [width, setWidth] = useState(0);
  const [settling, setSettling] = useState(false);
  const settlingRef = useRef(false);

  useLayoutEffect(() => {
    settlingRef.current = false;
    setSettling(false);
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    let settleTimer = 0;
    let initialized = false;
    let lastObservedWidth = -1;
    const measure = () => {
      frame = 0;
      const nextWidth = Math.round(element.getBoundingClientRect().width);
      if (nextWidth === lastObservedWidth) return;
      lastObservedWidth = nextWidth;
      window.clearTimeout(settleTimer);
      if (!initialized) {
        initialized = true;
        setWidth(nextWidth);
        return;
      }
      if (!settlingRef.current) {
        settlingRef.current = true;
        setSettling(true);
      }
      settleTimer = window.setTimeout(() => {
        setWidth((current) => current === lastObservedWidth ? current : lastObservedWidth);
        settlingRef.current = false;
        setSettling(false);
      }, TIMELINE_LAYOUT_SETTLE_MS);
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      settlingRef.current = false;
      observer.disconnect();
    };
  }, [observeKey, ref]);

  return { settling, width };
}

function lowerBound(metrics: VirtualMetric[], value: number, useEnd: boolean) {
  let low = 0;
  let high = metrics.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const metric = metrics[mid];
    const compare = useEnd ? metric.top + metric.height : metric.top;
    if (compare < value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function useWindowVirtualRange<T extends HTMLElement>(
  metrics: VirtualMetric[],
  overscan = VIRTUAL_OVERSCAN_PX,
  externalRef?: RefObject<T | null>,
  observeKey?: unknown
) {
  const ownedRef = useRef<T | null>(null);
  const containerRef = externalRef ?? ownedRef;
  const [range, setRange] = useState({ start: 0, end: 0 });

  useEffect(() => {
    let frame = 0;
    const updateRange = () => {
      const container = containerRef.current;
      if (!container || metrics.length === 0) {
        setRange({ start: 0, end: 0 });
        return;
      }
      const containerTop = container.getBoundingClientRect().top + window.scrollY;
      const viewportTop = window.scrollY - containerTop;
      const viewportBottom = viewportTop + window.innerHeight;
      const startPx = Math.max(0, viewportTop - overscan);
      const endPx = viewportBottom + overscan;
      const start = Math.min(metrics.length - 1, Math.max(0, lowerBound(metrics, startPx, true)));
      const end = Math.max(start + 1, Math.min(metrics.length, lowerBound(metrics, endPx, false) + 1));
      setRange((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateRange);
    };
    updateRange();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [metrics, observeKey, overscan]);

  return { containerRef, range };
}

export function ImagesPage({
  imagePreviewWheelMode,
  imagePreviewOpenMode
}: {
  imagePreviewWheelMode: ImagePreviewWheelMode;
  imagePreviewOpenMode: ImagePreviewOpenMode;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setEditImage = useWorkbench((state) => state.setEditImage);
  const setEditorImageRequest = useWorkbench((state) => state.setEditorImageRequest);
  const setDraftPrompt = useWorkbench((state) => state.setDraftPrompt);
  const { showToast } = useToast();
  const { resolvedLanguage, t } = useI18n();
  const assetCategories = useQuery({ queryKey: ["asset-categories"], queryFn: api.assetCategories });
  const openImageId = searchParams.get("open")?.trim() ?? "";
  const urlKeyword = searchParams.get("keyword") ?? "";
  const failedOpenImageRef = useRef("");
  const [caseSource, setCaseSource] = useState<AddCaseSource | null>(null);
  const [assetTarget, setAssetTarget] = useState<WorkImage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkImage | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(() => new Set());
  const [pendingBatchAction, setPendingBatchAction] = useState<ImageBatchAction | null>(null);
  const [batchAssetOpen, setBatchAssetOpen] = useState(false);
  const [batchDownloadOpen, setBatchDownloadOpen] = useState(false);
  const [batchDeleteImpact, setBatchDeleteImpact] = useState<ImageDeleteImpact | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResultState | null>(null);
  const [batchCaseOpen, setBatchCaseOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ImagesViewMode>(storedImagesViewMode);
  const [keyword, setKeyword] = useState(() => urlKeyword);
  const debouncedKeyword = useDebouncedValue(keyword, 250);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [collapsedTimelineGroups, setCollapsedTimelineGroups] = useState<Set<string>>(() => new Set());
  const [autoCollapseTimelineGroups, setAutoCollapseTimelineGroups] = useState(false);
  const knownTimelineGroupKeysRef = useRef<Set<string>>(new Set());
  const timelineVirtualRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollAnchorRef = useRef<TimelineScrollAnchor | null>(null);
  const { settling: timelineLayoutSettling, width: timelineWidth } = useSettledElementWidth(timelineVirtualRef, viewMode);
  const [timelineSort, setTimelineSort] = useState<"desc" | "asc">("desc");
  const clearOpenImage = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("open");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);
  const openImage = useQuery({
    queryKey: ["image-detail", openImageId],
    queryFn: ({ signal }) => api.imageDetail(openImageId, { signal }),
    enabled: Boolean(openImageId),
    retry: false
  });
  const images = useCursorLibraryQuery({
    queryKey: ["images", "library", debouncedKeyword, favoriteOnly, timelineSort],
    queryFn: ({ cursor, signal }) =>
      api.libraryImages({
        limit: IMAGE_PAGE_SIZE,
        cursor,
        keyword: debouncedKeyword,
        sort: timelineSort,
        favoriteOnly
      }, { signal })
  });
  const imageFacets = useQuery({
    queryKey: ["images", "library-facets", debouncedKeyword],
    queryFn: ({ signal }) => api.libraryImageFacets({ keyword: debouncedKeyword }, { signal }),
    staleTime: 30_000,
    gcTime: 10 * 60_000
  });
  const imageItems = useMemo(
    () => (images.data?.pages.flatMap((page) => page.items) ?? []).map(imageCardToWorkImage),
    [images.data?.pages]
  );
  const openImagePreviewItems = useMemo(() => {
    const image = openImage.data?.image;
    if (!image) return [];
    return [{
      id: image.id,
      title: image.prompt,
      description: image.originPrompt?.trim() || image.prompt,
      imageUrl: image.previewUrl || image.url,
      originalUrl: image.originalUrl || image.url,
      previewUrl: image.previewUrl || image.url,
      thumbnailUrl: image.thumbnailUrl || image.previewUrl || image.url,
      imageWidth: image.imageWidth,
      imageHeight: image.imageHeight,
      imageFileSize: image.imageFileSize,
      downloadSourceType: "image" as const,
      downloadSourceId: image.id,
      favoriteCount: image.favoriteCount,
      favorited: image.favorited,
      referenceImages: image.referenceImages,
      metaItems: [
        image.kind === "edit" ? t("pages.images.edit") : t("pages.images.generation"),
        image.size,
        image.quality
      ].filter(Boolean)
    }];
  }, [openImage.data?.image, t]);
  const imageLoadMoreRef = useInfinitePageLoader({
    fetchNextPage: () => images.fetchNextPage(),
    hasNextPage: Boolean(images.hasNextPage),
    isFetchNextPageError: images.isFetchNextPageError,
    isFetchingNextPage: images.isFetchingNextPage,
    rootMargin: "320px"
  });
  const assetCategoryList = assetCategories.data?.categories ?? [];
  const assetReviewEnabled = assetCategories.data?.reviewEnabled ?? true;
  useEffect(() => {
    setKeyword((current) => (current === urlKeyword ? current : urlKeyword));
  }, [urlKeyword]);

  useEffect(() => {
    if (!openImageId || !openImage.isError || failedOpenImageRef.current === openImageId) return;
    failedOpenImageRef.current = openImageId;
    showToast(t("globalSearch.openUnavailable"), "error");
    clearOpenImage();
  }, [clearOpenImage, openImage.isError, openImageId, showToast, t]);
  const imageFilterCounts = useMemo(() => {
    const serverCounts = imageFacets.data;
    if (serverCounts) return serverCounts;
    return {
      all: imageItems.length,
      favorite: imageItems.filter((image) => image.favorited).length
    };
  }, [imageFacets.data, imageItems]);
  const imageList = useMemo(() => {
    const normalizedKeyword = debouncedKeyword.trim().toLowerCase();
    return [...imageItems]
      .filter((image) => !favoriteOnly || image.favorited)
      .filter((image) => {
        if (!normalizedKeyword) return true;
        const dateParts = imageTimelineDateParts(image.createdAt, resolvedLanguage);
        const haystack = [
          image.prompt,
          image.kind === "edit" ? t("pages.images.edit") : t("pages.images.generation"),
          image.size,
          image.quality,
          image.providerId,
          dateParts.dateLabel,
          dateParts.weekdayLabel
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedKeyword);
      })
      .sort((a, b) => {
        const diff = imageCreatedTime(b.createdAt) - imageCreatedTime(a.createdAt);
        return timelineSort === "desc" ? diff : -diff;
      });
  }, [debouncedKeyword, favoriteOnly, imageItems, resolvedLanguage, t, timelineSort]);
  const selectedImages = useMemo(() => imageList.filter((image) => selectedImageIds.has(image.id)), [imageList, selectedImageIds]);
  const selectableLoadedImages = useMemo(() => imageList.slice(0, 200), [imageList]);
  const allLoadedSelected = selectableLoadedImages.length > 0 && selectableLoadedImages.every((image) => selectedImageIds.has(image.id));
  const timelineGroups = useMemo(() => groupImagesByTimeline(imageList, resolvedLanguage), [imageList, resolvedLanguage]);
  const visibleTimelineGroupKeys = useMemo(() => timelineGroups.map((group) => group.key), [timelineGroups]);
  const allTimelineGroupsCollapsed = timelineGroups.length > 0 && visibleTimelineGroupKeys.every((key) => collapsedTimelineGroups.has(key));
  const collapsedTimelineGroupKey = useMemo(
    () => visibleTimelineGroupKeys.filter((key) => collapsedTimelineGroups.has(key)).join(","),
    [collapsedTimelineGroups, visibleTimelineGroupKeys]
  );
  const imageScrollJumpKey = useMemo(
    () => ["images", viewMode, timelineSort, keyword, imageList.length, timelineGroups.length, collapsedTimelineGroupKey].join("\u0000"),
    [collapsedTimelineGroupKey, imageList.length, keyword, timelineGroups.length, timelineSort, viewMode]
  );
  const { jumpToScrollEdge, scrollJump } = useScrollJump({ syncKey: imageScrollJumpKey });

  useEffect(() => {
    try {
      window.localStorage.setItem(IMAGES_VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      // Ignore private browsing or blocked storage; the page still works with the in-memory state.
    }
  }, [viewMode]);

  useEffect(() => {
    const knownKeys = knownTimelineGroupKeysRef.current;
    const newKeys = visibleTimelineGroupKeys.filter((key) => !knownKeys.has(key));
    knownTimelineGroupKeysRef.current = new Set(visibleTimelineGroupKeys);
    if (!autoCollapseTimelineGroups || newKeys.length === 0) return;
    setCollapsedTimelineGroups((value) => {
      const next = new Set(value);
      let changed = false;
      for (const key of newKeys) {
        if (next.has(key)) continue;
        next.add(key);
        changed = true;
      }
      return changed ? next : value;
    });
  }, [autoCollapseTimelineGroups, visibleTimelineGroupKeys]);

  const updateCachedImages = useCallback((updater: (items: LibraryImageCard[]) => LibraryImageCard[]) => {
    queryClient.setQueriesData<ImageInfiniteData>({
      predicate: (query) => query.queryKey[0] === "images" && query.queryKey[1] === "library"
    }, (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({ ...page, items: updater(page.items) }))
      };
    });
  }, [queryClient]);

  const exitBatchMode = useCallback(() => {
    if (pendingBatchAction) return;
    setSelectionMode(false);
    setSelectedImageIds(new Set());
    setBatchAssetOpen(false);
    setBatchCaseOpen(false);
    setBatchDownloadOpen(false);
    setBatchDeleteImpact(null);
    setBatchResult(null);
  }, [pendingBatchAction]);

  useEffect(() => {
    if (!selectionMode) return;
    const visibleIds = new Set(imageList.map((image) => image.id));
    setSelectedImageIds((value) => {
      const next = new Set(Array.from(value).filter((id) => visibleIds.has(id)));
      return next.size === value.size ? value : next;
    });
  }, [imageList, selectionMode]);

  useEffect(() => {
    if (!selectionMode || batchAssetOpen || batchCaseOpen || batchDownloadOpen || batchDeleteImpact || batchResult || caseSource) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      exitBatchMode();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [batchAssetOpen, batchCaseOpen, batchDeleteImpact, batchDownloadOpen, batchResult, caseSource, exitBatchMode, selectionMode]);

  const addAsset = useMutation({
    mutationFn: (payload: { image: WorkImage; name?: string; spaceMode: AssetUploadMode; categoryIds: string[] }) =>
      api.addAssetFromImage({
        imageId: payload.image.id,
        name: payload.name,
        spaceMode: payload.spaceMode,
        categoryIds: payload.categoryIds
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setAssetTarget(null);
      if (result.created) {
        showToast(t("toast.assetAdded"));
      } else {
        showToast(result.duplicateScope === "shared" ? t("toast.assetDuplicateShared") : t("toast.assetDuplicatePrivate"), "error");
      }
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.assetAddFailed"), "error");
    }
  });
  const setImageFavorite = useMutation({
    mutationFn: (payload: { imageId: string; favorited: boolean }) => api.setImageFavorite(payload.imageId, payload.favorited),
    onSuccess: ({ favorited }) => {
      showToast(favorited ? t("toast.favoriteAdded") : t("toast.favoriteRemoved"));
      queryClient.invalidateQueries({ queryKey: ["images"] });
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.imageFavoriteFailed"), "error");
    }
  });
  const deleteImage = useMutation({
    mutationFn: api.deleteImage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["images"] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({
        predicate: (query) => ["messages", "session-image-jobs"].includes(String(query.queryKey[0]))
      });
      showToast(t("toast.imageDeleted"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.imageDeleteFailed"), "error");
    }
  });
  const setImageBatchFavorite = useMutation({
    mutationFn: (payload: { imageIds: string[]; favorited: boolean }) => api.setImageBatchFavorite(payload.imageIds, payload.favorited),
    onMutate: (payload) => setPendingBatchAction(payload.favorited ? "favorite" : "unfavorite"),
    onSuccess: (result, payload) => {
      const updatedIds = new Set(result.items.filter((item) => item.status === "updated").map((item) => item.imageId));
      updateCachedImages((items) => items.map((image) => updatedIds.has(image.id) ? { ...image, favorited: payload.favorited } : image));
      queryClient.invalidateQueries({ queryKey: ["images"] });
      showToast(t(payload.favorited ? "toast.imageBatchFavorited" : "toast.imageBatchUnfavorited", { count: result.succeeded }));
      if (result.skipped > 0 || result.failed > 0) setBatchResult({ title: t("pages.images.batch.favoriteResult"), result });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("toast.imageFavoriteFailed"), "error"),
    onSettled: () => setPendingBatchAction(null)
  });
  const addImageBatchAssets = useMutation({
    mutationFn: (payload: { spaceMode: AssetUploadMode }) =>
      api.addAssetsFromImages({ imageIds: selectedImages.map((image) => image.id), ...payload, autoCategory: true, duplicateMode: "skip" }),
    onMutate: () => setPendingBatchAction("asset"),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setBatchAssetOpen(false);
      showToast(t("toast.imageBatchAssetsAdded", { count: result.succeeded }));
      if (result.skipped > 0 || result.failed > 0) setBatchResult({ title: t("pages.images.batch.assetResult"), result });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("toast.assetAddFailed"), "error"),
    onSettled: () => setPendingBatchAction(null)
  });
  const addImageBatchCases = useMutation({
    mutationFn: (payload: { includeReferences: boolean }) =>
      api.addCasesFromImages({ imageIds: selectedImages.map((image) => image.id), ...payload }),
    onMutate: () => setPendingBatchAction("case"),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      queryClient.invalidateQueries({ queryKey: ["images"] });
      setBatchCaseOpen(false);
      showToast(t("toast.imageBatchCasesAdded", { count: result.succeeded }));
      if (result.skipped > 0 || result.failed > 0) setBatchResult({ title: t("pages.images.batch.caseResult"), result });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("toast.caseAddFailed"), "error"),
    onSettled: () => setPendingBatchAction(null)
  });
  const createImageBatchDownload = useMutation({
    mutationFn: (payload: { variant: "original" | "preview" | "thumb"; includeManifest: boolean }) =>
      api.createImageBatchDownload({ imageIds: selectedImages.map((image) => image.id), ...payload }),
    onMutate: () => setPendingBatchAction("download"),
    onSuccess: (result) => {
      setBatchDownloadOpen(false);
      const link = document.createElement("a");
      link.href = result.downloadUrl;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast(t("toast.imageBatchDownloadStarted"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("toast.imageBatchDownloadFailed"), "error"),
    onSettled: () => setPendingBatchAction(null)
  });
  const previewImageBatchDelete = useMutation({
    mutationFn: (imageIds: string[]) => api.imageBatchDeletePreview(imageIds),
    onMutate: () => setPendingBatchAction("delete"),
    onSuccess: ({ impact }) => setBatchDeleteImpact(impact),
    onError: (error) => showToast(error instanceof Error ? error.message : t("toast.imageDeleteFailed"), "error"),
    onSettled: () => setPendingBatchAction(null)
  });
  const deleteImageBatch = useMutation({
    mutationFn: (payload: { imageIds: string[]; confirmAssociated: boolean }) => api.deleteImagesBatch(payload.imageIds, payload.confirmAssociated),
    onMutate: () => setPendingBatchAction("delete"),
    onSuccess: (result) => {
      const deletedIds = new Set(result.items.filter((item) => item.status === "deleted").map((item) => item.imageId));
      updateCachedImages((items) => items.filter((image) => !deletedIds.has(image.id)));
      setSelectedImageIds((value) => new Set(Array.from(value).filter((id) => !deletedIds.has(id))));
      setBatchDeleteImpact(null);
      queryClient.invalidateQueries({ queryKey: ["images"] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({
        predicate: (query) => ["messages", "session-image-jobs"].includes(String(query.queryKey[0]))
      });
      showToast(t("toast.imageBatchDeleted", { count: result.succeeded }));
      if (result.cleanupWarnings > 0) showToast(t("toast.imageBatchCleanupWarning"), "error");
      if (result.skipped > 0 || result.failed > 0) setBatchResult({ title: t("pages.images.batch.deleteResult"), result });
    },
    onError: (error, payload) => {
      if (error instanceof ApiError && error.status === 409) {
        void api.imageBatchDeletePreview(payload.imageIds).then(({ impact }) => setBatchDeleteImpact(impact)).catch(() => undefined);
      }
      showToast(error instanceof Error ? error.message : t("toast.imageDeleteFailed"), "error");
    },
    onSettled: () => setPendingBatchAction(null)
  });
  const mutateImageFavorite = setImageFavorite.mutate;
  const hasImageFilters = favoriteOnly || Boolean(keyword.trim());

  const loadImageDetail = useCallback(
    (imageId: string) => queryClient.fetchQuery({
      queryKey: ["image-detail", imageId],
      queryFn: ({ signal }) => api.imageDetail(imageId, { signal }),
      staleTime: 30_000
    }).then((result) => result.image),
    [queryClient]
  );
  const openEditor = useCallback(async (image: WorkImage) => {
    const index = imageList.findIndex((item) => item.id === image.id);
    const neighborCards = imageList.slice(Math.max(0, index - 1), Math.min(imageList.length, index + 2));
    try {
      const [active, counts] = await Promise.all([
        loadImageDetail(image.id),
        imageFacets.data
          ? Promise.resolve(imageFacets.data)
          : queryClient.fetchQuery({
              queryKey: ["images", "library-facets", debouncedKeyword],
              queryFn: ({ signal }) => api.libraryImageFacets({ keyword: debouncedKeyword }, { signal }),
              staleTime: 30_000,
              gcTime: 10 * 60_000
            }).catch(() => ({
              all: imageList.length,
              favorite: imageList.filter((item) => item.favorited).length
            }))
      ]);
      if (!active) throw new Error(t("globalSearch.openUnavailable"));
      const pageInfo = images.data?.pages.at(-1)?.pageInfo;
      const continuationDirection = timelineSort === "asc" ? "newer" : "older";
      const libraryContinuations = pageInfo?.hasMore && pageInfo.nextCursor
        ? {
            [continuationDirection]: {
              keyword: debouncedKeyword,
              favoriteOnly,
              sort: timelineSort,
              nextCursor: pageInfo.nextCursor,
              hasMore: true
            }
          }
        : undefined;
      setDraftPrompt("");
      setEditImage(null);
      setEditorImageRequest({
        image: active,
        images: orderedWorkImages(imageList.map((item) => item.id === active.id ? active : item), "desc"),
        imageSort: "desc",
        totalImageCount: favoriteOnly ? counts.favorite : counts.all,
        libraryContinuations
      });
      navigate("/");
      for (const item of neighborCards) {
        if (item.id === active.id) continue;
        void queryClient.prefetchQuery({
          queryKey: ["image-detail", item.id],
          queryFn: ({ signal }) => api.imageDetail(item.id, { signal }),
          staleTime: 30_000
        });
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("globalSearch.openUnavailable"), "error");
    }
  }, [debouncedKeyword, favoriteOnly, imageFacets.data, imageList, images.data?.pages, loadImageDetail, navigate, queryClient, setDraftPrompt, setEditImage, setEditorImageRequest, showToast, t, timelineSort]);
  const startImageCreation = useCallback(() => {
    setDraftPrompt("");
    setEditImage(null);
    setEditorImageRequest(null);
    navigate("/");
  }, [navigate, setDraftPrompt, setEditImage, setEditorImageRequest]);
  const clearImageFilters = useCallback(() => {
    setFavoriteOnly(false);
    setKeyword("");
  }, []);

  const addCaseFromImage = useCallback(async (image: WorkImage) => {
    try {
      const detail = await loadImageDetail(image.id);
      if (!detail) throw new Error(t("globalSearch.openUnavailable"));
      const originPrompt = detail.originPrompt?.trim() || detail.prompt;
      setCaseSource({
        type: "image",
        id: detail.id,
        url: detail.previewUrl || detail.url,
        titleSeed: detail.prompt,
        promptSeed: originPrompt,
        suggestedTitle: detail.suggestedCaseTitle,
        suggestedCategoryIds: detail.suggestedCaseCategoryIds
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("globalSearch.openUnavailable"), "error");
    }
  }, [loadImageDetail, showToast, t]);
  const openAssetFromImage = useCallback(async (image: WorkImage) => {
    try {
      const detail = await loadImageDetail(image.id);
      if (!detail) throw new Error(t("globalSearch.openUnavailable"));
      setAssetTarget(detail);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("globalSearch.openUnavailable"), "error");
    }
  }, [loadImageDetail, showToast, t]);

  const enterBatchMode = useCallback(() => {
    if (imageList.length === 0) return;
    setSelectedImageIds(new Set());
    setSelectionMode(true);
  }, [imageList.length]);

  const toggleSelectedImage = useCallback((image: WorkImage) => {
    if (pendingBatchAction) return;
    if (!selectedImageIds.has(image.id) && selectedImageIds.size >= 200) {
      showToast(t("pages.images.batch.limit", { count: 200 }), "error");
      return;
    }
    setSelectedImageIds((value) => {
      const next = new Set(value);
      if (next.has(image.id)) next.delete(image.id);
      else next.add(image.id);
      return next;
    });
  }, [pendingBatchAction, selectedImageIds, showToast, t]);

  const toggleAllLoadedImages = useCallback(() => {
    if (pendingBatchAction) return;
    if (allLoadedSelected) {
      setSelectedImageIds(new Set());
      return;
    }
    const selectedIds = selectableLoadedImages.map((image) => image.id);
    setSelectedImageIds(new Set(selectedIds));
    if (imageList.length > 200) showToast(t("pages.images.batch.selectLimitReached", { count: 200 }), "error");
  }, [allLoadedSelected, imageList.length, pendingBatchAction, selectableLoadedImages, showToast, t]);

  const toggleImageFavorite = useCallback((image: WorkImage) => {
    mutateImageFavorite({ imageId: image.id, favorited: !image.favorited });
  }, [mutateImageFavorite]);

  const toggleTimelineGroup = useCallback((groupKey: string) => {
    setCollapsedTimelineGroups((value) => {
      const next = new Set(value);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const toggleAllTimelineGroups = useCallback(() => {
    const shouldExpandAll = allTimelineGroupsCollapsed;
    setAutoCollapseTimelineGroups(!shouldExpandAll);
    setCollapsedTimelineGroups((value) => {
      if (shouldExpandAll) {
        const next = new Set(value);
        for (const key of visibleTimelineGroupKeys) next.delete(key);
        return next;
      }
      return new Set([...value, ...visibleTimelineGroupKeys]);
    });
  }, [allTimelineGroupsCollapsed, visibleTimelineGroupKeys]);

  const timelineVirtual = useMemo(() => {
    const measuredWidth = Math.max(1, timelineWidth || 840);
    const mobile = measuredWidth <= 640;
    const groupGap = mobile ? TIMELINE_MOBILE_GAP : TIMELINE_GAP;
    const panelGap = mobile ? TIMELINE_MOBILE_PANEL_GAP : TIMELINE_PANEL_GAP;
    const paddingLeft = mobile ? TIMELINE_MOBILE_PADDING_LEFT : TIMELINE_PADDING_LEFT;
    const dateRowHeight = mobile ? TIMELINE_MOBILE_DATE_ROW_HEIGHT : TIMELINE_DATE_ROW_HEIGHT;
    const contentWidth = Math.max(1, measuredWidth - paddingLeft);
    const columns = columnsForWidth(contentWidth, TIMELINE_MIN_CARD_WIDTH, panelGap, mobile);
    const cardWidth = (contentWidth - panelGap * (columns - 1)) / columns;
    const cardHeight = Math.ceil(cardWidth * 1.25) + 2;
    const rows: TimelineVirtualRow[] = [];
    let cursor = 0;

    for (const group of timelineGroups) {
      const collapsed = collapsedTimelineGroups.has(group.key);
      rows.push({
        type: "date",
        key: `${group.key}:date`,
        top: cursor,
        height: dateRowHeight,
        group,
        collapsed
      });
      cursor += dateRowHeight;

      if (!collapsed && group.items.length > 0) {
        cursor += panelGap;
        for (let index = 0; index < group.items.length; index += columns) {
          rows.push({
            type: "images",
            key: `${group.key}:images:${index}`,
            top: cursor,
            height: cardHeight,
            groupKey: group.key,
            images: group.items.slice(index, index + columns)
          });
          cursor += cardHeight;
          if (index + columns < group.items.length) cursor += panelGap;
        }
      }

      cursor += groupGap;
    }

    return {
      columns,
      contentWidth,
      panelGap,
      paddingLeft,
      rows,
      metrics: rows.map((row) => ({ top: row.top, height: row.height })),
      totalHeight: rows.length > 0 ? Math.max(0, cursor - groupGap) : 0
    };
  }, [collapsedTimelineGroups, timelineGroups, timelineWidth]);

  useLayoutEffect(() => {
    if (viewMode !== "timeline") {
      timelineScrollAnchorRef.current = null;
      return;
    }
    const container = timelineVirtualRef.current;
    if (!container || timelineVirtual.rows.length === 0) return;

    const containerTop = container.getBoundingClientRect().top + window.scrollY;
    if (timelineLayoutSettling) {
      if (timelineScrollAnchorRef.current) return;
      const viewportOffset = window.scrollY - containerTop;
      const anchorRow = timelineVirtual.rows.find((row) => row.top + row.height > viewportOffset)
        ?? timelineVirtual.rows[0];
      const viewportTop = containerTop + anchorRow.top - window.scrollY;
      if (anchorRow.type === "date") {
        timelineScrollAnchorRef.current = { type: "date", rowKey: anchorRow.key, viewportTop };
        return;
      }
      const imageId = anchorRow.images[0]?.id;
      if (imageId) timelineScrollAnchorRef.current = { type: "image", imageId, viewportTop };
      return;
    }

    const anchor = timelineScrollAnchorRef.current;
    if (!anchor) return;
    timelineScrollAnchorRef.current = null;
    const targetRow = anchor.type === "date"
      ? timelineVirtual.rows.find((row) => row.key === anchor.rowKey)
      : timelineVirtual.rows.find((row) => row.type === "images" && row.images.some((image) => image.id === anchor.imageId));
    if (!targetRow) return;
    const nextViewportTop = containerTop + targetRow.top - window.scrollY;
    const scrollDelta = nextViewportTop - anchor.viewportTop;
    if (Math.abs(scrollDelta) > 0.5) window.scrollBy({ top: scrollDelta, behavior: "auto" });
  }, [timelineLayoutSettling, timelineVirtual.rows, timelineWidth, viewMode]);

  const timelineRange = useWindowVirtualRange<HTMLDivElement>(timelineVirtual.metrics, VIRTUAL_OVERSCAN_PX, timelineVirtualRef, viewMode).range;

  const imageContent = useMemo(() => {
    if (viewMode === "grid") {
      return (
        <VirtualizedResponsiveGrid
          items={imageList}
          getKey={(image) => image.id}
          minColumnWidth={GRID_MIN_CARD_WIDTH}
          estimateCardHeight={(cardWidth) => Math.ceil(cardWidth * 1.25) + 2}
          gap={GRID_GAP}
          mobileGap={GRID_MOBILE_GAP}
          className="image-virtual-grid"
          rowClassName="image-virtual-grid-row"
          renderItem={(image, { eager, highPriority }) => (
            <MyImageCard
              key={image.id}
              image={image}
              loading={eager ? "eager" : "lazy"}
              fetchPriority={highPriority ? "high" : "auto"}
              assetPending={addAsset.isPending}
              deletePending={deleteImage.isPending}
              favoritePending={setImageFavorite.isPending}
              selectionMode={selectionMode}
              selected={selectedImageIds.has(image.id)}
              selectionDisabled={Boolean(pendingBatchAction)}
              onOpenEditor={openEditor}
              onAddCase={addCaseFromImage}
              onAddAsset={openAssetFromImage}
              onDelete={setDeleteTarget}
              onToggleFavorite={toggleImageFavorite}
              onToggleSelected={toggleSelectedImage}
            />
          )}
        />
      );
    }

    const visibleRows = timelineVirtual.rows.slice(timelineRange.start, timelineRange.end);
    return (
      <div
        ref={timelineVirtualRef}
        className="image-timeline image-virtual-timeline"
        data-layout-settling={timelineLayoutSettling || undefined}
        style={{
          height: timelineVirtual.totalHeight,
          overflowX: timelineLayoutSettling ? "clip" : undefined
        }}
      >
        {visibleRows.map((row) => {
          if (row.type === "date") {
            return (
              <section
                className={cx("image-timeline-node", "image-virtual-timeline-row", "image-virtual-timeline-date-row", row.collapsed && "collapsed")}
                data-timeline-row-key={row.key}
                key={row.key}
                style={{
                  height: row.height,
                  left: timelineVirtual.paddingLeft,
                  width: timelineVirtual.contentWidth,
                  transform: `translateY(${row.top}px)`
                }}
              >
                <span className="image-timeline-marker" aria-hidden="true" />
                <button
                  className="image-timeline-date"
                  type="button"
                  onClick={() => toggleTimelineGroup(row.group.key)}
                  aria-expanded={!row.collapsed}
                  aria-label={row.collapsed ? t("pages.images.expandTimelineNode", { date: row.group.dateLabel }) : t("pages.images.collapseTimelineNode", { date: row.group.dateLabel })}
                  title={row.collapsed ? t("common.expand") : t("common.collapse")}
                >
                  <strong>{row.group.dateLabel}</strong>
                  <span>{row.group.weekdayLabel}</span>
                  <small>{t("pages.images.count", { count: row.group.items.length })}</small>
                  <span className="image-timeline-toggle" aria-hidden="true">
                    {row.collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                  </span>
                </button>
              </section>
            );
          }

          return (
            <div
              className="image-timeline-panel image-virtual-timeline-row image-virtual-timeline-image-row"
              data-timeline-row-key={row.key}
              key={row.key}
              style={{
                height: row.height,
                left: timelineVirtual.paddingLeft,
                width: timelineVirtual.contentWidth,
                transform: `translateY(${row.top}px)`
              }}
            >
              <div
                className="image-timeline-images"
                style={{
                  gap: timelineVirtual.panelGap,
                  gridTemplateColumns: `repeat(${timelineVirtual.columns}, minmax(0, 1fr))`
                }}
              >
                {row.images.map((image) => (
                  <MyImageCard
                    key={image.id}
                    image={image}
                    compact
                    assetPending={addAsset.isPending}
                    deletePending={deleteImage.isPending}
                    favoritePending={setImageFavorite.isPending}
                    selectionMode={selectionMode}
                    selected={selectedImageIds.has(image.id)}
                    selectionDisabled={Boolean(pendingBatchAction)}
                    onOpenEditor={openEditor}
                    onAddCase={addCaseFromImage}
                    onAddAsset={openAssetFromImage}
                    onDelete={setDeleteTarget}
                    onToggleFavorite={toggleImageFavorite}
                    onToggleSelected={toggleSelectedImage}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }, [
    addAsset.isPending,
    addCaseFromImage,
    deleteImage.isPending,
    imageList,
    openEditor,
    openAssetFromImage,
    pendingBatchAction,
    selectedImageIds,
    selectionMode,
    setImageFavorite.isPending,
    t,
    timelineRange.end,
    timelineRange.start,
    timelineLayoutSettling,
    timelineVirtual,
    toggleImageFavorite,
    toggleSelectedImage,
    toggleTimelineGroup,
    viewMode
  ]);

  return (
    <section className={cx("page-section", selectionMode && "image-batch-active")}>
      <PageHeader
        title={t("pages.images.title")}
        desc={t("pages.images.desc")}
        icon={<Images size={24} />}
        actions={
          <PageHeaderViewToggle
            value={viewMode}
            onChange={setViewMode}
            ariaLabel={t("pages.images.viewMode")}
            options={[
              { value: "timeline", label: t("pages.images.timeline"), icon: <CalendarDays size={16} /> },
              { value: "grid", label: t("pages.images.grid"), icon: <LayoutGrid size={16} /> }
            ]}
          />
        }
      />
      {selectionMode ? (
        <ImageBatchToolbar
          selectedCount={selectedImages.length}
          loadedCount={imageList.length}
          allLoadedSelected={allLoadedSelected}
          pendingAction={pendingBatchAction}
          onToggleAllLoaded={toggleAllLoadedImages}
          onFavorite={(favorited) => setImageBatchFavorite.mutate({ imageIds: selectedImages.map((image) => image.id), favorited })}
          onAddAsset={() => setBatchAssetOpen(true)}
          onAddCase={() => setBatchCaseOpen(true)}
          onDownload={() => setBatchDownloadOpen(true)}
          onDelete={() => previewImageBatchDelete.mutate(selectedImages.map((image) => image.id))}
          onExit={exitBatchMode}
        />
      ) : <div className="image-list-toolbar">
        <span className="image-total-count" aria-label={t("pages.images.totalAria", { count: imageFilterCounts.all })} title={t("pages.images.total", { count: imageFilterCounts.all })}>
          {t("pages.images.countPrefix")} <strong>{imageFilterCounts.all}</strong> {t("pages.images.countSuffix")}
        </span>
        <button
          className={cx("case-favorite-filter-btn", favoriteOnly && "active")}
          type="button"
          onClick={() => setFavoriteOnly((value) => !value)}
          aria-label={favoriteOnly ? t("pages.images.cancelFavoriteOnly") : t("pages.images.favoriteOnly")}
          aria-pressed={favoriteOnly}
          title={favoriteOnly ? t("pages.images.cancelFavoriteOnly") : t("pages.images.favoriteOnly")}
        >
          <Heart size={17} fill={favoriteOnly ? "currentColor" : "none"} />
          <span className="filter-tab-count">{imageFilterCounts.favorite}</span>
        </button>
        {viewMode === "timeline" ? (
          <button
            className="secondary-btn image-collapse-all-btn"
            type="button"
            onClick={toggleAllTimelineGroups}
            disabled={timelineGroups.length === 0}
            aria-label={allTimelineGroupsCollapsed ? t("pages.images.expandAllTimeline") : t("pages.images.collapseAllTimeline")}
            title={allTimelineGroupsCollapsed ? t("pages.images.expandAllTimeline") : t("pages.images.collapseAllTimeline")}
          >
            {allTimelineGroupsCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            {allTimelineGroupsCollapsed ? t("pages.images.expandAll") : t("pages.images.collapseAll")}
          </button>
        ) : null}
        <SearchHistoryInput
          scope="images"
          className="case-search image-search"
          value={keyword}
          onChange={setKeyword}
          placeholder={t("pages.images.searchPlaceholder")}
          ariaLabel={t("pages.images.searchAria")}
          icon={<Search size={17} />}
        />
        <button
          className="secondary-btn image-sort-btn"
          type="button"
          onClick={() => setTimelineSort((value) => (value === "desc" ? "asc" : "desc"))}
          aria-label={t("pages.images.sort", { sort: timelineSort === "desc" ? t("pages.images.newToOld") : t("pages.images.oldToNew") })}
          title={t("pages.images.sort", { sort: timelineSort === "desc" ? t("pages.images.newToOld") : t("pages.images.oldToNew") })}
        >
          {timelineSort === "desc" ? <CalendarArrowDown size={16} /> : <CalendarArrowUp size={16} />}
          {timelineSort === "desc" ? t("pages.images.newToOld") : t("pages.images.oldToNew")}
        </button>
        <button className="secondary-btn image-batch-enter" type="button" onClick={enterBatchMode} disabled={imageList.length === 0}>
          <ListChecks size={16} />
          {t("pages.images.batch.manage")}
        </button>
      </div>}
      {imageContent}
      {!images.isLoading && imageList.length === 0 ? (
        hasImageFilters ? (
          <LibraryEmptyState
            compact
            imageSrc="/image/empty-states/images-empty.png"
            imageAlt={t("pages.images.emptyAlt")}
            title={t("pages.images.noMatch")}
            description={t("empty.tryDifferentFilters")}
            action={
              <button className="secondary-btn" type="button" onClick={clearImageFilters}>
                <X size={16} />
                {t("common.clearFilters")}
              </button>
            }
          />
        ) : (
          <LibraryEmptyState
            imageSrc="/image/empty-states/images-empty.png"
            imageAlt={t("pages.images.emptyAlt")}
            title={t("pages.images.empty")}
            description={t("pages.images.emptyDesc")}
            action={
              <button className="primary-btn" type="button" onClick={startImageCreation}>
                <Plus size={16} />
                {t("pages.images.create")}
              </button>
            }
          />
        )
      ) : null}
      <div ref={imageLoadMoreRef} className="page-load-sentinel" aria-hidden="true" />
      <ScrollJumpButton className="page-scroll-jump-btn" scrollJump={scrollJump} onClick={jumpToScrollEdge} />
      {openImageId && openImagePreviewItems.length > 0 ? (
        <ImagePreviewModal
          items={openImagePreviewItems}
          index={0}
          ariaLabel={t("globalSearch.imagePreview")}
          initialZoomMode={imagePreviewOpenMode}
          wheelMode={imagePreviewWheelMode}
          suppressStableScrollbarGutter
          onIndexChange={() => undefined}
          onClose={clearOpenImage}
        />
      ) : null}
      {assetTarget ? (
        <AddAssetFromImageModal
          image={assetTarget}
          categories={assetCategoryList}
          assetReviewEnabled={assetReviewEnabled}
          pending={addAsset.isPending}
          error={addAsset.error instanceof Error ? addAsset.error : null}
          onClose={() => setAssetTarget(null)}
          onAdd={(payload) => addAsset.mutate({ image: assetTarget, ...payload })}
        />
      ) : null}
      {batchAssetOpen ? (
        <ImageBatchAssetDialog
          images={selectedImages}
          assetReviewEnabled={assetReviewEnabled}
          pending={addImageBatchAssets.isPending}
          error={addImageBatchAssets.error instanceof Error ? addImageBatchAssets.error : null}
          onClose={() => {
            if (!addImageBatchAssets.isPending) setBatchAssetOpen(false);
          }}
          onSubmit={(payload) => addImageBatchAssets.mutate(payload)}
        />
      ) : null}
      {batchDownloadOpen ? (
        <ImageBatchDownloadDialog
          images={selectedImages}
          pending={createImageBatchDownload.isPending}
          error={createImageBatchDownload.error instanceof Error ? createImageBatchDownload.error : null}
          onClose={() => {
            if (!createImageBatchDownload.isPending) setBatchDownloadOpen(false);
          }}
          onSubmit={(payload) => createImageBatchDownload.mutate(payload)}
        />
      ) : null}
      {batchCaseOpen ? (
        <ImageBatchCaseDialog
          images={selectedImages}
          pending={addImageBatchCases.isPending}
          error={addImageBatchCases.error instanceof Error ? addImageBatchCases.error : null}
          onClose={() => {
            if (!addImageBatchCases.isPending) setBatchCaseOpen(false);
          }}
          onSubmit={(payload) => addImageBatchCases.mutate(payload)}
        />
      ) : null}
      {caseSource ? <AddCaseModal source={caseSource} onClose={() => setCaseSource(null)} /> : null}
      {batchDeleteImpact ? (
        <ImageBatchDeleteDialog
          selectedCount={selectedImages.length}
          impact={batchDeleteImpact}
          pending={deleteImageBatch.isPending}
          onClose={() => {
            if (!deleteImageBatch.isPending) setBatchDeleteImpact(null);
          }}
          onConfirm={() => deleteImageBatch.mutate({
            imageIds: selectedImages.map((image) => image.id),
            confirmAssociated: batchDeleteImpact.hasAssociated
          })}
        />
      ) : null}
      {batchResult ? <ImageBatchResultDialog title={batchResult.title} result={batchResult.result} onClose={() => setBatchResult(null)} /> : null}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("pages.images.deleteTitle")}
        description={t("pages.images.deleteDescription")}
        confirmText={deleteImage.isPending ? t("common.deleting") : t("common.delete")}
        cancelText={t("common.cancel")}
        destructive
        onConfirm={() => {
          if (!deleteTarget || deleteImage.isPending) return;
          const target = deleteTarget;
          setDeleteTarget(null);
          deleteImage.mutate(target.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
