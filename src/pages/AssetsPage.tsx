import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Pencil, Plus, Search, Send, Share2, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { AssetEditModal } from "../components/AssetEditModal";
import { AssetUploadModal } from "../components/AssetUploadModal";
import { AssetTagScroller, FilterModeToggle, FilterTabLabel, FilterTabsScroller, useLibraryFilterDisplayMode } from "../components/HorizontalScrollers";
import { ImageDownloadMenu } from "../components/ImageDownloadMenu";
import { ImagePreviewModal } from "../components/ImagePreviewModal";
import { PageHeader } from "../components/PageHeader";
import { SearchHistoryInput } from "../components/SearchHistoryInput";
import { SkeletonImage } from "../components/SkeletonImage";
import { ScrollJumpButton } from "../components/ScrollJumpButton";
import { assetSpaceLabel, type AssetUploadMode } from "../lib/assets";
import { cx } from "../lib/cx";
import { formatImageFileSize } from "../lib/format";
import { imageCreatedTime } from "../lib/imageTimeline";
import { IMAGE_PAGE_SIZE } from "../lib/pagination";
import { useInfinitePageLoader } from "../hooks/useInfinitePageLoader";
import { useScrollJump } from "../hooks/useScrollJump";
import { useWorkbench } from "../store/workbench";
import type { AssetItem } from "../types";
import { ConfirmDialog, PromptDialog, useToast } from "../ui";

function assetMatchesSpace(asset: AssetItem, spaceFilter: "all" | AssetItem["space"]) {
  if (spaceFilter === "all") return true;
  if (spaceFilter === "shared") return asset.space === "shared" || asset.shared;
  return asset.canEdit && asset.space === "private";
}

function assetMatchesKeyword(asset: AssetItem, normalizedKeyword: string) {
  if (!normalizedKeyword) return true;
  const haystack = [asset.name, asset.sourceUsername, assetSpaceLabel(asset), ...asset.categoryNames]
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalizedKeyword);
}

export function AssetsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const resetNewChatComposer = useWorkbench((state) => state.resetNewChatComposer);
  const setSelectedAssets = useWorkbench((state) => state.setSelectedAssets);
  const assetCategories = useQuery({ queryKey: ["asset-categories"], queryFn: api.assetCategories });
  const [spaceFilter, setSpaceFilter] = useState<"all" | AssetItem["space"]>("all");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AssetItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetItem | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [filterDisplayMode, setFilterDisplayMode] = useLibraryFilterDisplayMode();
  const assets = useInfiniteQuery({
    queryKey: ["assets", "paged", spaceFilter, selectedCategoryIds.join(","), keyword],
    queryFn: ({ pageParam }) =>
      api.assets({
        limit: IMAGE_PAGE_SIZE,
        offset: Number(pageParam),
        categoryIds: selectedCategoryIds,
        keyword,
        space: spaceFilter
      }),
    initialPageParam: 0,
    placeholderData: (previousData) => previousData,
    getNextPageParam: (lastPage) => (lastPage.pageInfo.hasMore ? lastPage.pageInfo.offset + lastPage.pageInfo.limit : undefined)
  });
  const assetItems = useMemo(() => assets.data?.pages.flatMap((page) => page.assets) ?? [], [assets.data?.pages]);
  const assetLoadMoreRef = useInfinitePageLoader({
    fetchNextPage: () => assets.fetchNextPage(),
    hasNextPage: Boolean(assets.hasNextPage),
    isFetchingNextPage: assets.isFetchingNextPage
  });
  const categories = assetCategories.data?.categories ?? [];
  const createCategory = useMutation({
    mutationFn: (name: string) => api.createAssetCategory(name),
    onSuccess: ({ category }) => {
      queryClient.invalidateQueries({ queryKey: ["asset-categories"] });
      setSelectedCategoryIds([category.id]);
      setTagDialogOpen(false);
      showToast("素材标签已新增");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "新增素材标签失败", "error");
    }
  });
  const upload = useMutation({
    mutationFn: async (payload: { files: File[]; spaceMode: AssetUploadMode; categoryIds: string[] }) => {
      const assets: AssetItem[] = [];
      for (const file of payload.files) {
        const form = new FormData();
        form.set("file", file);
        form.set("spaceMode", payload.spaceMode);
        payload.categoryIds.forEach((categoryId) => form.append("categoryIds", categoryId));
        const result = await api.uploadAsset(form);
        assets.push(result.asset);
      }
      return { assets };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setUploadOpen(false);
      showToast("素材已上传");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "上传素材失败", "error");
    }
  });
  const updateAsset = useMutation({
    mutationFn: (payload: { assetId: string; name: string; categoryIds: string[]; shared?: boolean }) =>
      api.updateAsset(payload.assetId, { name: payload.name, categoryIds: payload.categoryIds, shared: payload.shared }),
    onSuccess: (result) => {
      queryClient.setQueryData<{ assets: AssetItem[] }>(["assets"], (current) =>
        current ? { assets: current.assets.map((item) => (item.id === result.asset.id ? result.asset : item)) } : current
      );
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setEditTarget(null);
      showToast("素材信息已更新");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "保存素材信息失败", "error");
    }
  });
  const deleteAsset = useMutation({
    mutationFn: (assetId: string) => api.deleteAsset(assetId),
    onSuccess: (_, assetId) => {
      setPreviewIndex((value) => {
        if (value === null) return null;
        const nextItems = visibleAssets.filter((item) => item.id !== assetId);
        if (nextItems.length === 0) return null;
        return Math.min(value, nextItems.length - 1);
      });
      queryClient.setQueryData<{ assets: AssetItem[] }>(["assets"], (current) =>
        current ? { assets: current.assets.filter((item) => item.id !== assetId) } : current
      );
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setEditTarget((current) => (current?.id === assetId ? null : current));
      setDeleteTarget(null);
      showToast("素材已删除");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "删除素材失败", "error");
    }
  });
  const updateShare = useMutation({
    mutationFn: (payload: { assetId: string; shared: boolean }) => api.updateAsset(payload.assetId, { shared: payload.shared }),
    onSuccess: (result, payload) => {
      queryClient.setQueryData<{ assets: AssetItem[] }>(["assets"], (current) =>
        current ? { assets: current.assets.map((item) => (item.id === result.asset.id ? result.asset : item)) } : current
      );
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      showToast(payload.shared ? "已提交共享审核" : result.asset.shareStatus === "none" ? "已取消共享" : "共享状态已更新");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "更新分享状态失败", "error");
    }
  });
  const visibleAssets = useMemo(() => {
    const selectedCategorySet = new Set(selectedCategoryIds);
    const normalizedKeyword = keyword.trim().toLowerCase();
    return [...assetItems]
      .filter((asset) => assetMatchesSpace(asset, spaceFilter))
      .filter((asset) => selectedCategoryIds.length === 0 || asset.categoryIds.some((categoryId) => selectedCategorySet.has(categoryId)))
      .filter((asset) => assetMatchesKeyword(asset, normalizedKeyword))
      .sort((a, b) => imageCreatedTime(b.createdAt) - imageCreatedTime(a.createdAt));
  }, [assetItems, keyword, selectedCategoryIds, spaceFilter]);
  const assetTagFilterCounts = useMemo(() => {
    const serverCounts = assets.data?.pages[0]?.counts?.tags;
    if (serverCounts) return { all: serverCounts.all, byCategory: new Map(Object.entries(serverCounts.byCategory)) };
    const normalizedKeyword = keyword.trim().toLowerCase();
    const baseAssets = assetItems
      .filter((asset) => assetMatchesSpace(asset, spaceFilter))
      .filter((asset) => assetMatchesKeyword(asset, normalizedKeyword));
    return {
      all: baseAssets.length,
      byCategory: new Map(categories.map((category) => [category.id, baseAssets.filter((asset) => asset.categoryIds.includes(category.id)).length]))
    };
  }, [assetItems, assets.data?.pages, categories, keyword, spaceFilter]);
  const assetSpaceFilterCounts = useMemo(() => {
    const serverCounts = assets.data?.pages[0]?.counts?.spaces;
    if (serverCounts) return serverCounts;
    const selectedCategorySet = new Set(selectedCategoryIds);
    const normalizedKeyword = keyword.trim().toLowerCase();
    const baseAssets = assetItems
      .filter((asset) => selectedCategoryIds.length === 0 || asset.categoryIds.some((categoryId) => selectedCategorySet.has(categoryId)))
      .filter((asset) => assetMatchesKeyword(asset, normalizedKeyword));
    return {
      all: baseAssets.length,
      shared: baseAssets.filter((asset) => assetMatchesSpace(asset, "shared")).length,
      private: baseAssets.filter((asset) => assetMatchesSpace(asset, "private")).length
    };
  }, [assetItems, assets.data?.pages, keyword, selectedCategoryIds]);
  const assetPreviewItems = useMemo(
    () =>
      visibleAssets.map((asset) => ({
        ...asset,
        title: asset.name,
        description: asset.categoryNames.length > 0 ? asset.categoryNames.join(" / ") : assetSpaceLabel(asset),
        imageUrl: asset.previewUrl ?? asset.url,
        originalUrl: asset.originalUrl ?? asset.url,
        previewUrl: asset.previewUrl ?? asset.url,
        thumbnailUrl: asset.thumbnailUrl ?? asset.previewUrl ?? asset.url,
        imageFileSize: asset.size
      })),
    [visibleAssets]
  );
  const assetFilterHintKey = useMemo(
    () => ["asset-filter", spaceFilter, selectedCategoryIds.join(","), ...categories.map((category) => `${category.id}:${category.name}`)].join("\u0000"),
    [categories, selectedCategoryIds, spaceFilter]
  );
  const assetScrollJumpKey = useMemo(
    () => ["assets", filterDisplayMode, spaceFilter, selectedCategoryIds.join(","), keyword, visibleAssets.length].join("\u0000"),
    [filterDisplayMode, keyword, selectedCategoryIds, spaceFilter, visibleAssets.length]
  );
  const { jumpToScrollEdge, scrollJump } = useScrollJump({ syncKey: assetScrollJumpKey });

  const toggleAssetCategory = (categoryId: string) => {
    setSelectedCategoryIds((value) => (value.includes(categoryId) ? [] : [categoryId]));
  };
  const useAssetInNewChat = (asset: AssetItem) => {
    resetNewChatComposer();
    setSelectedAssets([asset]);
    navigate("/");
  };

  useEffect(() => {
    if (selectedCategoryIds.length === 0 || categories.length === 0) return;
    const categoryIds = new Set(categories.map((category) => category.id));
    setSelectedCategoryIds((value) => value.filter((item) => categoryIds.has(item)).slice(0, 1));
  }, [categories, selectedCategoryIds.length]);

  useEffect(() => {
    if (previewIndex !== null && previewIndex >= visibleAssets.length) {
      setPreviewIndex(visibleAssets.length > 0 ? visibleAssets.length - 1 : null);
    }
  }, [previewIndex, visibleAssets.length]);

  return (
    <section className="page-section">
      <PageHeader
        title="素材库"
        desc="共享和我的参考图片，可按标签筛选和复用；共享需后台审核通过后公开。"
        icon={<FolderOpen size={24} />}
        actions={<FilterModeToggle value={filterDisplayMode} onChange={setFilterDisplayMode} />}
      />
      <div className={cx("library-filter-row asset-filter-row", `filter-mode-${filterDisplayMode}`)}>
        <div className="asset-space-filter-tabs" role="group" aria-label="素材范围筛选">
          {[
            { value: "all", label: "所有", count: assetSpaceFilterCounts.all },
            { value: "shared", label: "共享", count: assetSpaceFilterCounts.shared },
            { value: "private", label: "我的", count: assetSpaceFilterCounts.private }
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              className={cx(spaceFilter === item.value && "active")}
              onClick={() => setSpaceFilter(item.value as typeof spaceFilter)}
            >
              <FilterTabLabel count={item.count}>{item.label}</FilterTabLabel>
            </button>
          ))}
        </div>
        <span className="asset-filter-divider" aria-hidden="true" />
        <FilterTabsScroller className="asset-filter-tabs" ariaLabel="素材标签筛选" hintKey={assetFilterHintKey} mode={filterDisplayMode}>
          <button
            type="button"
            className={cx(selectedCategoryIds.length === 0 && "active")}
            onClick={() => setSelectedCategoryIds([])}
          >
            <FilterTabLabel count={assetTagFilterCounts.all}>全部</FilterTabLabel>
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={cx(selectedCategoryIds.includes(category.id) && "active")}
              onClick={() => toggleAssetCategory(category.id)}
            >
              <FilterTabLabel count={assetTagFilterCounts.byCategory.get(category.id)}>{category.name}</FilterTabLabel>
            </button>
          ))}
        </FilterTabsScroller>
        <div className="library-filter-actions asset-upload-controls">
          <SearchHistoryInput
            scope="assets"
            className="case-search asset-search"
            value={keyword}
            onChange={setKeyword}
            placeholder="搜索素材、标签或来源"
            ariaLabel="搜索素材"
            icon={<Search size={17} />}
          />
          <button className="secondary-btn case-add-tag" type="button" onClick={() => setTagDialogOpen(true)}>
            <Plus size={16} />
            新增标签
          </button>
          <button
            className="upload-btn"
            type="button"
            onClick={() => {
              upload.reset();
              setUploadOpen(true);
            }}
          >
            <Plus size={16} />
            上传素材
          </button>
        </div>
      </div>
      <div className="asset-grid asset-library-grid">
        {visibleAssets.map((asset, index) => (
          <article className="asset-card" key={asset.id}>
            <div className="asset-image-frame">
              <button className="asset-image-btn" type="button" onClick={() => setPreviewIndex(index)} aria-label={`预览素材 ${asset.name}`}>
                <SkeletonImage src={asset.thumbnailUrl ?? asset.previewUrl ?? asset.url} alt={asset.name} />
              </button>
              <div className="asset-card-actions">
                <button type="button" onClick={() => useAssetInNewChat(asset)} aria-label="使用素材" title="使用素材">
                  <Send size={16} />
                </button>
                {asset.canEdit ? (
                  <>
                    {asset.space === "private" ? (
                      <button
                        type="button"
                        onClick={() => updateShare.mutate({ assetId: asset.id, shared: !(asset.shared || asset.shareStatus === "pending") })}
                        disabled={updateShare.isPending}
                        aria-label={asset.shared || asset.shareStatus === "pending" ? "取消共享" : "提交共享审核"}
                        title={asset.shared || asset.shareStatus === "pending" ? "取消共享" : "提交共享审核"}
                      >
                        {asset.shared || asset.shareStatus === "pending" ? <X size={16} /> : <Share2 size={16} />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setEditTarget(asset)}
                      aria-label="编辑素材"
                      title="编辑素材"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => setDeleteTarget(asset)}
                      aria-label="删除素材"
                      title="删除素材"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            <div className="asset-card-body">
              <div className="asset-card-title-row">
                <h3>{asset.name}</h3>
                <span className={cx("asset-space-badge", asset.space, asset.shared && "is-shared", `share-status-${asset.shareStatus}`)}>{assetSpaceLabel(asset)}</span>
              </div>
              <div className="asset-card-meta">
                <span>{formatImageFileSize(asset.size) || "图片素材"}</span>
                <span>来源：{asset.sourceUsername}</span>
              </div>
              <AssetTagScroller names={asset.categoryNames} />
            </div>
          </article>
        ))}
      </div>
      {visibleAssets.length === 0 ? <div className="case-empty">暂无匹配素材</div> : null}
      <div ref={assetLoadMoreRef} className="page-load-sentinel" aria-hidden="true" />
      <ScrollJumpButton className="page-scroll-jump-btn" scrollJump={scrollJump} onClick={jumpToScrollEdge} />
      {previewIndex !== null ? (
        <ImagePreviewModal
          items={assetPreviewItems}
          index={previewIndex}
          ariaLabel="素材预览"
          initialZoomMode="contain"
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          renderActions={(item) => (
            <>
              <button className="case-preview-tool" type="button" onClick={() => useAssetInNewChat(item)} aria-label="使用素材" title="使用素材">
                <Send size={16} />
              </button>
              {item.canEdit ? (
                <>
                  {item.space === "private" ? (
                    <button
                      className="case-preview-tool"
                      type="button"
                      onClick={() => updateShare.mutate({ assetId: item.id, shared: !(item.shared || item.shareStatus === "pending") })}
                      disabled={updateShare.isPending}
                      aria-label={item.shared || item.shareStatus === "pending" ? "取消共享" : "提交共享审核"}
                      title={item.shared || item.shareStatus === "pending" ? "取消共享" : "提交共享审核"}
                    >
                      {item.shared || item.shareStatus === "pending" ? <X size={16} /> : <Share2 size={16} />}
                    </button>
                  ) : null}
                  <button className="case-preview-tool" type="button" onClick={() => setEditTarget(item)} aria-label="编辑素材" title="编辑素材">
                    <Pencil size={16} />
                  </button>
                </>
              ) : null}
              <ImageDownloadMenu source={{ type: "asset", id: item.id }} className="case-preview-tool" />
              {item.canEdit ? (
                <button className="case-preview-tool danger" type="button" onClick={() => setDeleteTarget(item)} aria-label="删除素材" title="删除素材">
                  <Trash2 size={16} />
                </button>
              ) : null}
            </>
          )}
        />
      ) : null}
      <PromptDialog
        open={tagDialogOpen}
        title="新增素材标签"
        label="标签名称"
        confirmText={createCategory.isPending ? "保存中" : "新增标签"}
        onSubmit={(value) => {
          if (!createCategory.isPending) createCategory.mutate(value.trim());
        }}
        onCancel={() => setTagDialogOpen(false)}
      />
      {uploadOpen ? (
        <AssetUploadModal
          categories={categories}
          initialCategoryIds={selectedCategoryIds}
          pending={upload.isPending}
          error={upload.error instanceof Error ? upload.error : null}
          onClose={() => setUploadOpen(false)}
          onUpload={(payload) => upload.mutate(payload)}
        />
      ) : null}
      {editTarget ? (
        <AssetEditModal
          asset={editTarget}
          categories={categories}
          pending={updateAsset.isPending}
          error={updateAsset.error instanceof Error ? updateAsset.error : null}
          onClose={() => setEditTarget(null)}
          onSave={(payload) => updateAsset.mutate({ assetId: editTarget.id, ...payload })}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除素材"
        description={`确认删除“${deleteTarget?.name ?? ""}”？删除后素材库中将不再显示。`}
        confirmText={deleteAsset.isPending ? "删除中" : "删除"}
        destructive
        onConfirm={() => {
          if (deleteTarget && !deleteAsset.isPending) deleteAsset.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
