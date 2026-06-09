import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CalendarDays, ChevronDown, ChevronUp, Heart, Images, LayoutGrid, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { AddAssetFromImageModal } from "../components/AddAssetFromImageModal";
import { AddCaseModal, type AddCaseSource } from "../components/AddCaseModal";
import { MyImageCard } from "../components/MyImageCard";
import { PageHeader } from "../components/PageHeader";
import { SearchHistoryInput } from "../components/SearchHistoryInput";
import { ScrollJumpButton } from "../components/ScrollJumpButton";
import { type AssetUploadMode } from "../lib/assets";
import { cx } from "../lib/cx";
import { groupImagesByTimeline, imageCreatedTime, imageTimelineDateParts } from "../lib/imageTimeline";
import { IMAGE_PAGE_SIZE } from "../lib/pagination";
import { newestWorkImages } from "../lib/workImages";
import { useInfinitePageLoader } from "../hooks/useInfinitePageLoader";
import { useScrollJump } from "../hooks/useScrollJump";
import { useWorkbench } from "../store/workbench";
import type { WorkImage } from "../types";
import { ConfirmDialog, useToast } from "../ui";

type ImagesViewMode = "grid" | "timeline";

const IMAGES_VIEW_MODE_STORAGE_KEY = "gpt-image.images.viewMode";

function storedImagesViewMode(): ImagesViewMode {
  try {
    const value = window.localStorage.getItem(IMAGES_VIEW_MODE_STORAGE_KEY);
    return value === "grid" || value === "timeline" ? value : "timeline";
  } catch {
    return "timeline";
  }
}

export function ImagesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setEditImage = useWorkbench((state) => state.setEditImage);
  const setEditorImageRequest = useWorkbench((state) => state.setEditorImageRequest);
  const setDraftPrompt = useWorkbench((state) => state.setDraftPrompt);
  const { showToast } = useToast();
  const assetCategories = useQuery({ queryKey: ["asset-categories"], queryFn: api.assetCategories });
  const [caseSource, setCaseSource] = useState<AddCaseSource | null>(null);
  const [assetTarget, setAssetTarget] = useState<WorkImage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkImage | null>(null);
  const [viewMode, setViewMode] = useState<ImagesViewMode>(storedImagesViewMode);
  const [keyword, setKeyword] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [collapsedTimelineGroups, setCollapsedTimelineGroups] = useState<Set<string>>(() => new Set());
  const [autoCollapseTimelineGroups, setAutoCollapseTimelineGroups] = useState(false);
  const knownTimelineGroupKeysRef = useRef<Set<string>>(new Set());
  const [timelineSort, setTimelineSort] = useState<"desc" | "asc">("desc");
  const images = useInfiniteQuery({
    queryKey: ["images", "paged", keyword, favoriteOnly, timelineSort],
    queryFn: ({ pageParam }) =>
      api.images({
        limit: IMAGE_PAGE_SIZE,
        offset: Number(pageParam),
        keyword,
        sort: timelineSort,
        favoriteOnly
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.pageInfo.hasMore ? lastPage.pageInfo.offset + lastPage.pageInfo.limit : undefined)
  });
  const imageItems = useMemo(() => images.data?.pages.flatMap((page) => page.images) ?? [], [images.data?.pages]);
  const imageLoadMoreRef = useInfinitePageLoader({
    fetchNextPage: () => images.fetchNextPage(),
    hasNextPage: Boolean(images.hasNextPage),
    isFetchingNextPage: images.isFetchingNextPage
  });
  const assetCategoryList = assetCategories.data?.categories ?? [];
  const allImagesNewestFirst = useMemo(() => newestWorkImages(imageItems), [imageItems]);
  const imageFilterCounts = useMemo(() => {
    const serverCounts = images.data?.pages[0]?.counts;
    if (serverCounts) return serverCounts;
    return {
      all: imageItems.length,
      favorite: imageItems.filter((image) => image.favorited).length
    };
  }, [imageItems, images.data?.pages]);
  const imageList = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return [...imageItems]
      .filter((image) => !favoriteOnly || image.favorited)
      .filter((image) => {
        if (!normalizedKeyword) return true;
        const dateParts = imageTimelineDateParts(image.createdAt);
        const haystack = [
          image.prompt,
          image.kind === "edit" ? "编辑" : "生成",
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
  }, [favoriteOnly, imageItems, keyword, timelineSort]);
  const timelineGroups = useMemo(() => groupImagesByTimeline(imageList), [imageList]);
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
        showToast("已加入素材库");
      } else {
        showToast(result.duplicateScope === "shared" ? "已存在共享中" : "已经在素材库", "error");
      }
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "加入素材库失败", "error");
    }
  });
  const setImageFavorite = useMutation({
    mutationFn: (payload: { imageId: string; favorited: boolean }) => api.setImageFavorite(payload.imageId, payload.favorited),
    onSuccess: ({ favorited }) => {
      showToast(favorited ? "已收藏" : "已取消收藏");
      queryClient.invalidateQueries({ queryKey: ["images"] });
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "收藏图片失败", "error");
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
      showToast("已删除图片及关联灵感、素材");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "删除图片失败", "error");
    }
  });

  const openEditor = (image: WorkImage) => {
    setDraftPrompt("");
    setEditImage(null);
    setEditorImageRequest({ image, images: allImagesNewestFirst });
    navigate("/");
  };

  const addCaseFromImage = (image: WorkImage) => {
    const originPrompt = image.originPrompt?.trim() || image.prompt;
    setCaseSource({
      type: "image",
      id: image.id,
      url: image.previewUrl || image.url,
      titleSeed: image.prompt,
      promptSeed: originPrompt,
      suggestedTitle: image.suggestedCaseTitle,
      suggestedCategoryIds: image.suggestedCaseCategoryIds
    });
  };

  const toggleImageFavorite = (image: WorkImage) => {
    setImageFavorite.mutate({ imageId: image.id, favorited: !image.favorited });
  };

  const toggleTimelineGroup = (groupKey: string) => {
    setCollapsedTimelineGroups((value) => {
      const next = new Set(value);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const toggleAllTimelineGroups = () => {
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
  };

  return (
    <section className="page-section">
      <PageHeader
        title="我的图片"
        desc="历史所有生成和编辑结果，支持再次编辑。"
        icon={<Images size={24} />}
        actions={
          <span className="page-header-view-toggle" role="group" aria-label="我的图片显示模式" data-active-index={viewMode === "timeline" ? "0" : "1"}>
            <button
              type="button"
              className={cx(viewMode === "timeline" && "active")}
              onClick={() => setViewMode("timeline")}
              aria-label="时间轴"
              aria-pressed={viewMode === "timeline"}
              title="时间轴"
            >
              <CalendarDays size={16} />
              <span>时间轴</span>
            </button>
            <button
              type="button"
              className={cx(viewMode === "grid" && "active")}
              onClick={() => setViewMode("grid")}
              aria-label="平铺"
              aria-pressed={viewMode === "grid"}
              title="平铺"
            >
              <LayoutGrid size={16} />
              <span>平铺</span>
            </button>
          </span>
        }
      />
      <div className="image-list-toolbar">
        <button
          className={cx("case-favorite-filter-btn", favoriteOnly && "active")}
          type="button"
          onClick={() => setFavoriteOnly((value) => !value)}
          aria-label={favoriteOnly ? "取消收藏筛选" : "只看收藏图片"}
          aria-pressed={favoriteOnly}
          title={favoriteOnly ? "取消收藏筛选" : "只看收藏图片"}
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
            aria-label={allTimelineGroupsCollapsed ? "全部展开时间轴节点" : "全部收起时间轴节点"}
            title={allTimelineGroupsCollapsed ? "全部展开时间轴节点" : "全部收起时间轴节点"}
          >
            {allTimelineGroupsCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            {allTimelineGroupsCollapsed ? "全部展开" : "全部收起"}
          </button>
        ) : null}
        <SearchHistoryInput
          scope="images"
          className="case-search image-search"
          value={keyword}
          onChange={setKeyword}
          placeholder="搜索提示词、尺寸或日期"
          ariaLabel="搜索我的图片"
          icon={<Search size={17} />}
        />
        <button
          className="secondary-btn image-sort-btn"
          type="button"
          onClick={() => setTimelineSort((value) => (value === "desc" ? "asc" : "desc"))}
          aria-label={`时间轴排序：${timelineSort === "desc" ? "新到旧" : "旧到新"}`}
          title={`时间轴排序：${timelineSort === "desc" ? "新到旧" : "旧到新"}`}
        >
          {timelineSort === "desc" ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
          {timelineSort === "desc" ? "新到旧" : "旧到新"}
        </button>
      </div>
      {viewMode === "grid" ? (
        <div className="image-grid">
          {imageList.map((image) => (
            <MyImageCard
              key={image.id}
              image={image}
              assetPending={addAsset.isPending}
              deletePending={deleteImage.isPending}
              favoritePending={setImageFavorite.isPending}
              onOpenEditor={openEditor}
              onAddCase={addCaseFromImage}
              onAddAsset={setAssetTarget}
              onDelete={setDeleteTarget}
              onToggleFavorite={toggleImageFavorite}
            />
          ))}
        </div>
      ) : (
        <div className="image-timeline">
          {timelineGroups.map((group) => {
            const collapsed = collapsedTimelineGroups.has(group.key);
            const panelId = `image-timeline-panel-${group.key}`;
            return (
              <section className={cx("image-timeline-node", collapsed && "collapsed")} key={group.key}>
                <span className="image-timeline-marker" aria-hidden="true" />
                <div className="image-timeline-date">
                  <strong>{group.dateLabel}</strong>
                  <span>{group.weekdayLabel}</span>
                  <small>共 {group.items.length} 张</small>
                  <button
                    className="image-timeline-toggle"
                    type="button"
                    onClick={() => toggleTimelineGroup(group.key)}
                    aria-expanded={!collapsed}
                    aria-controls={panelId}
                    aria-label={`${collapsed ? "展开" : "收起"}${group.dateLabel}时间轴节点`}
                    title={collapsed ? "展开" : "收起"}
                  >
                    {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                  </button>
                </div>
                <div id={panelId} className="image-timeline-panel" hidden={collapsed}>
                  <div className="image-timeline-images">
                    {group.items.map((image) => (
                      <MyImageCard
                        key={image.id}
                        image={image}
                        compact
                        assetPending={addAsset.isPending}
                        deletePending={deleteImage.isPending}
                        favoritePending={setImageFavorite.isPending}
                        onOpenEditor={openEditor}
                        onAddCase={addCaseFromImage}
                        onAddAsset={setAssetTarget}
                        onDelete={setDeleteTarget}
                        onToggleFavorite={toggleImageFavorite}
                      />
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
      {!images.isLoading && imageList.length === 0 ? <div className="case-empty">暂无匹配图片</div> : null}
      <div ref={imageLoadMoreRef} className="page-load-sentinel" aria-hidden="true" />
      <ScrollJumpButton className="page-scroll-jump-btn" scrollJump={scrollJump} onClick={jumpToScrollEdge} />
      {assetTarget ? (
        <AddAssetFromImageModal
          image={assetTarget}
          categories={assetCategoryList}
          pending={addAsset.isPending}
          error={addAsset.error instanceof Error ? addAsset.error : null}
          onClose={() => setAssetTarget(null)}
          onAdd={(payload) => addAsset.mutate({ image: assetTarget, ...payload })}
        />
      ) : null}
      {caseSource ? <AddCaseModal source={caseSource} onClose={() => setCaseSource(null)} /> : null}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除图片"
        description="会从我的图片和对应聊天图片消息中删除；基于这张图片保存到灵感空间的灵感、加入素材库的素材也会同步删除。确认继续吗？"
        confirmText="删除"
        cancelText="取消"
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
