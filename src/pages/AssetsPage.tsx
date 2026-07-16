import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Pencil, Plus, Search, Send, Share2, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { AssetEditModal } from "../components/AssetEditModal";
import { AssetUploadModal } from "../components/AssetUploadModal";
import { AssetTagScroller, FilterModeToggle, FilterTabLabel, FilterTabsScroller, useLibraryFilterDisplayMode } from "../components/HorizontalScrollers";
import { ImageDownloadMenu } from "../components/ImageDownloadMenu";
import { ImagePreviewModal } from "../components/ImagePreviewModal";
import { LibraryEmptyState } from "../components/LibraryEmptyState";
import { PageHeader } from "../components/PageHeader";
import { SearchHistoryInput } from "../components/SearchHistoryInput";
import { SkeletonImage } from "../components/SkeletonImage";
import { ScrollJumpButton } from "../components/ScrollJumpButton";
import { useI18n } from "../i18n";
import { assetSpaceLabel, type AssetUploadMode } from "../lib/assets";
import { cx } from "../lib/cx";
import { formatImageFileSize } from "../lib/format";
import { imageCreatedTime } from "../lib/imageTimeline";
import { IMAGE_PAGE_SIZE } from "../lib/pagination";
import { useInfinitePageLoader } from "../hooks/useInfinitePageLoader";
import { useScrollJump } from "../hooks/useScrollJump";
import { useWorkbench } from "../store/workbench";
import type { AssetItem, ImagePreviewOpenMode, ImagePreviewWheelMode } from "../types";
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

export function AssetsPage({
  imagePreviewWheelMode,
  imagePreviewOpenMode
}: {
  imagePreviewWheelMode: ImagePreviewWheelMode;
  imagePreviewOpenMode: ImagePreviewOpenMode;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
  const { t } = useI18n();
  const resetNewChatComposer = useWorkbench((state) => state.resetNewChatComposer);
  const setSelectedAssets = useWorkbench((state) => state.setSelectedAssets);
  const assetCategories = useQuery({ queryKey: ["asset-categories"], queryFn: api.assetCategories });
  const openAssetId = searchParams.get("open")?.trim() ?? "";
  const urlKeyword = searchParams.get("keyword") ?? "";
  const failedOpenAssetRef = useRef("");
  const [spaceFilter, setSpaceFilter] = useState<"all" | AssetItem["space"]>("all");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [keyword, setKeyword] = useState(() => urlKeyword);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AssetItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetItem | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [filterDisplayMode, setFilterDisplayMode] = useLibraryFilterDisplayMode();
  const clearOpenAsset = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("open");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);
  const openAsset = useQuery({
    queryKey: ["asset-detail", openAssetId],
    queryFn: ({ signal }) => api.assetDetail(openAssetId, { signal }),
    enabled: Boolean(openAssetId),
    retry: false
  });
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
  const assetReviewEnabled = assetCategories.data?.reviewEnabled ?? true;
  const createCategory = useMutation({
    mutationFn: (name: string) => api.createAssetCategory(name),
    onSuccess: ({ category }) => {
      queryClient.invalidateQueries({ queryKey: ["asset-categories"] });
      setSelectedCategoryIds([category.id]);
      setTagDialogOpen(false);
      showToast(t("toast.assetTagCreated"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.assetTagCreateFailed"), "error");
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
      showToast(t("toast.assetUploaded"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.assetUploadFailed"), "error");
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
      showToast(t("toast.assetUpdated"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.assetUpdateFailed"), "error");
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
      showToast(t("toast.assetDeleted"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.assetDeleteFailed"), "error");
    }
  });
  const updateShare = useMutation({
    mutationFn: (payload: { assetId: string; shared: boolean }) => api.updateAsset(payload.assetId, { shared: payload.shared }),
    onSuccess: (result, payload) => {
      queryClient.setQueryData<{ assets: AssetItem[] }>(["assets"], (current) =>
        current ? { assets: current.assets.map((item) => (item.id === result.asset.id ? result.asset : item)) } : current
      );
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      showToast(payload.shared ? t("toast.assetShareSubmitted") : result.asset.shareStatus === "none" ? t("toast.assetShareCancelled") : t("toast.assetShareStatusUpdated"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.assetShareUpdateFailed"), "error");
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
  const previewSourceAssets = useMemo(() => {
    const target = openAsset.data?.asset;
    if (!openAssetId || !target || visibleAssets.some((asset) => asset.id === target.id)) return visibleAssets;
    return [target, ...visibleAssets];
  }, [openAsset.data?.asset, openAssetId, visibleAssets]);
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
  const assetSpaceLabelText = (asset: AssetItem) => {
    if (asset.shareStatus === "pending") return t("status.pendingReview");
    if (asset.shareStatus === "rejected") return t("status.rejected");
    if (asset.space === "private" && asset.shared) return asset.canEdit ? t("status.privateAndShared") : t("common.shared");
    return asset.space === "shared" ? t("common.shared") : t("common.mine");
  };
  const assetPreviewItems = useMemo(
    () =>
      previewSourceAssets.map((asset) => ({
        ...asset,
        title: asset.name,
        description: asset.categoryNames.length > 0 ? asset.categoryNames.join(" / ") : assetSpaceLabelText(asset),
        imageUrl: asset.previewUrl ?? asset.url,
        originalUrl: asset.originalUrl ?? asset.url,
        previewUrl: asset.previewUrl ?? asset.url,
        thumbnailUrl: asset.thumbnailUrl ?? asset.previewUrl ?? asset.url,
        imageFileSize: asset.size
      })),
    [previewSourceAssets, t]
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
  const hasAssetFilters = spaceFilter !== "all" || selectedCategoryIds.length > 0 || Boolean(keyword.trim());

  const toggleAssetCategory = (categoryId: string) => {
    setSelectedCategoryIds((value) => (value.includes(categoryId) ? [] : [categoryId]));
  };
  const openUploadModal = () => {
    upload.reset();
    setUploadOpen(true);
  };
  const clearAssetFilters = () => {
    setSpaceFilter("all");
    setSelectedCategoryIds([]);
    setKeyword("");
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
    if (previewIndex !== null && previewIndex >= previewSourceAssets.length) {
      setPreviewIndex(previewSourceAssets.length > 0 ? previewSourceAssets.length - 1 : null);
    }
  }, [previewIndex, previewSourceAssets.length]);

  useEffect(() => {
    setKeyword((current) => (current === urlKeyword ? current : urlKeyword));
  }, [urlKeyword]);

  useEffect(() => {
    if (!openAssetId || !openAsset.data?.asset) return;
    const nextIndex = previewSourceAssets.findIndex((asset) => asset.id === openAssetId);
    if (nextIndex >= 0) setPreviewIndex(nextIndex);
  }, [openAsset.data?.asset, openAssetId, previewSourceAssets]);

  useEffect(() => {
    if (!openAssetId || !openAsset.isError || failedOpenAssetRef.current === openAssetId) return;
    failedOpenAssetRef.current = openAssetId;
    showToast(t("globalSearch.openUnavailable"), "error");
    clearOpenAsset();
  }, [clearOpenAsset, openAsset.isError, openAssetId, showToast, t]);

  return (
    <section className="page-section">
      <PageHeader
        title={t("pages.assets.title")}
        desc={t("pages.assets.desc")}
        icon={<FolderOpen size={24} />}
        actions={<FilterModeToggle value={filterDisplayMode} onChange={setFilterDisplayMode} />}
      />
      <div className={cx("library-filter-row asset-filter-row", `filter-mode-${filterDisplayMode}`)}>
        <div className="asset-space-filter-tabs" role="group" aria-label={t("pages.assets.scope")}>
          {[
            { value: "all", label: t("common.all"), count: assetSpaceFilterCounts.all },
            { value: "shared", label: t("common.shared"), count: assetSpaceFilterCounts.shared },
            { value: "private", label: t("common.mine"), count: assetSpaceFilterCounts.private }
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
        <FilterTabsScroller className="asset-filter-tabs" ariaLabel={t("pages.assets.tags")} hintKey={assetFilterHintKey} mode={filterDisplayMode}>
          <button
            type="button"
            className={cx(selectedCategoryIds.length === 0 && "active")}
            onClick={() => setSelectedCategoryIds([])}
          >
            <FilterTabLabel count={assetTagFilterCounts.all}>{t("common.all")}</FilterTabLabel>
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
            placeholder={t("pages.assets.searchPlaceholder")}
            ariaLabel={t("pages.assets.searchAria")}
            icon={<Search size={17} />}
          />
          <button className="secondary-btn case-add-tag" type="button" onClick={() => setTagDialogOpen(true)}>
            <Plus size={16} />
            {t("pages.assets.addTag")}
          </button>
          <button className="upload-btn" type="button" onClick={openUploadModal}>
            <Plus size={16} />
            {t("pages.assets.upload")}
          </button>
        </div>
      </div>
      <div className="asset-grid asset-library-grid">
        {visibleAssets.map((asset, index) => (
          <article className="asset-card" key={asset.id}>
            <div className="asset-image-frame">
              <button className="asset-image-btn" type="button" onClick={() => setPreviewIndex(index)} aria-label={t("pages.assets.previewAsset", { name: asset.name })}>
                <SkeletonImage src={asset.thumbnailUrl ?? asset.previewUrl ?? asset.url} alt={asset.name} />
              </button>
              <div className="asset-card-actions">
                <button type="button" onClick={() => useAssetInNewChat(asset)} aria-label={t("pages.assets.useAsset")} title={t("pages.assets.useAsset")}>
                  <Send size={16} />
                </button>
                {asset.canEdit ? (
                  <>
                    {asset.space === "private" ? (
                      <button
                        type="button"
                        onClick={() => updateShare.mutate({ assetId: asset.id, shared: !(asset.shared || asset.shareStatus === "pending") })}
                        disabled={updateShare.isPending}
                        aria-label={asset.shared || asset.shareStatus === "pending" ? t("pages.assets.cancelShare") : t("pages.assets.submitShare")}
                        title={asset.shared || asset.shareStatus === "pending" ? t("pages.assets.cancelShare") : t("pages.assets.submitShare")}
                      >
                        {asset.shared || asset.shareStatus === "pending" ? <X size={16} /> : <Share2 size={16} />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setEditTarget(asset)}
                      aria-label={t("pages.assets.editAsset")}
                      title={t("pages.assets.editAsset")}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => setDeleteTarget(asset)}
                      aria-label={t("pages.assets.deleteAsset")}
                      title={t("pages.assets.deleteAsset")}
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
                <span className={cx("asset-space-badge", asset.space, asset.shared && "is-shared", `share-status-${asset.shareStatus}`)}>{assetSpaceLabelText(asset)}</span>
              </div>
              <div className="asset-card-meta">
                <span>{formatImageFileSize(asset.size) || t("pages.assets.imageMaterial")}</span>
                <span>{t("pages.assets.source", { source: asset.sourceUsername })}</span>
              </div>
              <AssetTagScroller names={asset.categoryNames} />
            </div>
          </article>
        ))}
      </div>
      {!assets.isLoading && visibleAssets.length === 0 ? (
        hasAssetFilters ? (
          <LibraryEmptyState
            compact
            imageSrc="/image/empty-states/assets-empty.png"
            imageAlt={t("pages.assets.emptyAlt")}
            title={t("pages.assets.noMatch")}
            description={t("empty.tryDifferentFilters")}
            action={
              <button className="secondary-btn" type="button" onClick={clearAssetFilters}>
                <X size={16} />
                {t("common.clearFilters")}
              </button>
            }
          />
        ) : (
          <LibraryEmptyState
            imageSrc="/image/empty-states/assets-empty.png"
            imageAlt={t("pages.assets.emptyAlt")}
            title={t("pages.assets.empty")}
            description={t("pages.assets.emptyDesc")}
            action={
              <button className="primary-btn" type="button" onClick={openUploadModal}>
                <Plus size={16} />
                {t("pages.assets.upload")}
              </button>
            }
          />
        )
      ) : null}
      <div ref={assetLoadMoreRef} className="page-load-sentinel" aria-hidden="true" />
      <ScrollJumpButton className="page-scroll-jump-btn" scrollJump={scrollJump} onClick={jumpToScrollEdge} />
      {previewIndex !== null ? (
        <ImagePreviewModal
          items={assetPreviewItems}
          index={previewIndex}
          ariaLabel={t("pages.assets.preview")}
          initialZoomMode={imagePreviewOpenMode}
          wheelMode={imagePreviewWheelMode}
          onIndexChange={setPreviewIndex}
          onClose={() => {
            setPreviewIndex(null);
            if (openAssetId) clearOpenAsset();
          }}
          renderActions={(item) => (
            <>
              <button className="case-preview-tool" type="button" onClick={() => useAssetInNewChat(item)} aria-label={t("pages.assets.useAsset")} title={t("pages.assets.useAsset")}>
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
                      aria-label={item.shared || item.shareStatus === "pending" ? t("pages.assets.cancelShare") : t("pages.assets.submitShare")}
                      title={item.shared || item.shareStatus === "pending" ? t("pages.assets.cancelShare") : t("pages.assets.submitShare")}
                    >
                      {item.shared || item.shareStatus === "pending" ? <X size={16} /> : <Share2 size={16} />}
                    </button>
                  ) : null}
                  <button className="case-preview-tool" type="button" onClick={() => setEditTarget(item)} aria-label={t("pages.assets.editAsset")} title={t("pages.assets.editAsset")}>
                    <Pencil size={16} />
                  </button>
                </>
              ) : null}
              <ImageDownloadMenu source={{ type: "asset", id: item.id }} className="case-preview-tool" />
              {item.canEdit ? (
                <button className="case-preview-tool danger" type="button" onClick={() => setDeleteTarget(item)} aria-label={t("pages.assets.deleteAsset")} title={t("pages.assets.deleteAsset")}>
                  <Trash2 size={16} />
                </button>
              ) : null}
            </>
          )}
        />
      ) : null}
      <PromptDialog
        open={tagDialogOpen}
        title={t("pages.assets.addTagTitle")}
        label={t("pages.assets.tagName")}
        confirmText={createCategory.isPending ? t("common.saving") : t("pages.assets.addTag")}
        onSubmit={(value) => {
          if (!createCategory.isPending) createCategory.mutate(value.trim());
        }}
        onCancel={() => setTagDialogOpen(false)}
      />
      {uploadOpen ? (
        <AssetUploadModal
          categories={categories}
          initialCategoryIds={selectedCategoryIds}
          assetReviewEnabled={assetReviewEnabled}
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
        title={t("pages.assets.deleteTitle")}
        description={t("pages.assets.deleteDescription", { name: deleteTarget?.name ?? "" })}
        confirmText={deleteAsset.isPending ? t("common.deleting") : t("common.delete")}
        destructive
        onConfirm={() => {
          if (deleteTarget && !deleteAsset.isPending) deleteAsset.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
