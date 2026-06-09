import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Balloon, Check, Heart, Images as ImagesIcon, Lightbulb, Link2, Pencil, Plus, RefreshCw, Search, Send, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { AddAssetFromImageModal } from "../components/AddAssetFromImageModal";
import { CaseModalImagePreview, type CaseModalPreviewImage } from "../components/CaseModalImagePreview";
import { CaseCategoryMultiSelect } from "../components/CaseCategoryMultiSelect";
import { CaseMaterialActionsMenu } from "../components/CaseMaterialActionsMenu";
import { AssetTagScroller, FilterModeToggle, FilterTabLabel, FilterTabsScroller, useLibraryFilterDisplayMode } from "../components/HorizontalScrollers";
import { ImageDownloadMenu } from "../components/ImageDownloadMenu";
import { ImagePreviewModal } from "../components/ImagePreviewModal";
import { PageHeader } from "../components/PageHeader";
import { PromptReferenceLinksDialog } from "../components/PromptReferenceLinksDialog";
import { SearchHistoryInput } from "../components/SearchHistoryInput";
import { SkeletonImage } from "../components/SkeletonImage";
import { ScrollJumpButton } from "../components/ScrollJumpButton";
import { isUncategorizedCaseCategory } from "../lib/cases";
import { buildGalleryCaseItems, caseMaterialFromCaseItem, visibleCaseStyleNames, type GalleryCaseItem } from "../lib/caseMaterials";
import { cx } from "../lib/cx";
import { IMAGE_PAGE_SIZE } from "../lib/pagination";
import { useInfinitePageLoader } from "../hooks/useInfinitePageLoader";
import { useScrollJump } from "../hooks/useScrollJump";
import { useWorkbench } from "../store/workbench";
import { type AssetUploadMode } from "../lib/assets";
import type { CaseCategory, CaseGroupImage } from "../types";
import { ConfirmDialog, PromptDialog, useToast } from "../ui";

function filterGalleryCaseItems(items: GalleryCaseItem[], options: { mineOnly: boolean; favoriteOnly: boolean; keyword: string }) {
  const ownedItems = options.mineOnly ? items.filter((item) => item.canDelete) : items;
  const favoriteItems = options.favoriteOnly ? ownedItems.filter((item) => item.favorited) : ownedItems;
  const normalizedKeyword = options.keyword.trim().toLowerCase();
  if (!normalizedKeyword) return favoriteItems;
  return favoriteItems.filter((item) => {
    const title = item.title.toLowerCase();
    const desc = item.prompt.toLowerCase();
    const styleNames = visibleCaseStyleNames(item).join(" ").toLowerCase();
    return title.includes(normalizedKeyword) || desc.includes(normalizedKeyword) || styleNames.includes(normalizedKeyword);
  });
}

function caseReviewStatusLabel(status: GalleryCaseItem["reviewStatus"]) {
  if (status === "pending") return "待审核";
  if (status === "rejected") return "未通过";
  return "已通过";
}

function EditCaseModal({
  item,
  categories,
  onClose,
  onSave,
  pending,
  error
}: {
  item: GalleryCaseItem;
  categories: CaseCategory[];
  onClose: () => void;
  onSave: (payload: { title: string; prompt: string; categoryIds: string[]; includeReferences: boolean; coverImage?: CaseGroupImage }) => void;
  pending: boolean;
  error: Error | null;
}) {
  const [title, setTitle] = useState(item.title);
  const [prompt, setPrompt] = useState(item.prompt);
  const [categoryIds, setCategoryIds] = useState<string[]>(item.categoryIds);
  const [includeReferences, setIncludeReferences] = useState(item.includeReferences);
  const groupImages = useMemo(() => (item.images ?? []).filter((image) => image.id && image.imageUrl), [item.images]);
  const previewImages = useMemo<CaseModalPreviewImage[]>(
    () =>
      groupImages.length > 0
        ? groupImages.map((image) => ({
            id: image.id,
            url: image.imageUrl,
            previewUrl: image.imagePreviewUrl ?? image.imageUrl,
            thumbnailUrl: image.imageThumbnailUrl ?? image.imagePreviewUrl ?? image.imageUrl
          }))
        : [
            {
              id: item.id,
              url: item.imageUrl,
              previewUrl: item.imagePreviewUrl ?? item.imageUrl,
              thumbnailUrl: item.imageThumbnailUrl ?? item.imagePreviewUrl ?? item.imageUrl
            }
          ],
    [groupImages, item.id, item.imagePreviewUrl, item.imageThumbnailUrl, item.imageUrl]
  );
  const currentCoverImageId = useMemo(
    () =>
      groupImages.find((image) => image.isCover)?.id ??
      groupImages.find((image) => image.sourceId === item.coverImageId)?.id ??
      previewImages[0]?.id ??
      item.id,
    [groupImages, item.coverImageId, item.id, previewImages]
  );
  const [coverImageId, setCoverImageId] = useState(currentCoverImageId);
  const selectedCoverImage = groupImages.find((image) => image.id === coverImageId);

  useEffect(() => {
    setTitle(item.title);
    setPrompt(item.prompt);
    setCategoryIds(item.categoryIds);
    setIncludeReferences(item.includeReferences);
    setCoverImageId(currentCoverImageId);
  }, [currentCoverImageId, item.categoryIds, item.id, item.includeReferences, item.prompt, item.title]);

  const submit = () => {
    if (pending || !title.trim() || !prompt.trim()) return;
    onSave({
      title: title.trim(),
      prompt: prompt.trim(),
      categoryIds,
      includeReferences,
      coverImage: selectedCoverImage && !selectedCoverImage.isCover ? selectedCoverImage : undefined
    });
  };

  return (
    <div className="modal-backdrop">
      <section className="case-modal">
        <header>
          <h3>编辑灵感</h3>
          <button onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="case-modal-layout">
          <CaseModalImagePreview
            images={previewImages}
            fallbackUrl={item.imageUrl}
            alt={title}
            activeImageId={coverImageId}
            thumbStripLabel="设置封面图"
            activeThumbLabel="封面"
            thumbTitle={() => "设为封面"}
            thumbAriaLabel={(_, index) => `设第 ${index + 1} 张为封面`}
            onSelectImage={previewImages.length > 1 ? (image) => setCoverImageId(image.id) : undefined}
          />
          <div className="case-modal-form-pane">
            <label className={cx("case-reference-toggle", includeReferences && "active")}>
              <input type="checkbox" checked={includeReferences} onChange={(event) => setIncludeReferences(event.target.checked)} />
              <span className="case-reference-toggle-check" aria-hidden="true">
                {includeReferences ? <Check size={13} strokeWidth={2.5} /> : null}
              </span>
              <span className="case-reference-toggle-copy">
                <span>允许查看和下载素材</span>
                <small>勾选后，灵感空间会显示这张图引用的素材；取消则看不到素材。</small>
              </span>
            </label>
            <label>
              风格
              <CaseCategoryMultiSelect
                categories={categories}
                value={categoryIds}
                onChange={setCategoryIds}
                labelName="风格"
              />
            </label>
            <label>
              标题
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              描述
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} />
            </label>
            {error ? <div className="form-error">{error.message}</div> : null}
            <div className="row-actions">
              <button className="secondary-btn" type="button" onClick={onClose}>
                取消
              </button>
              <button className="primary-btn" type="button" onClick={submit} disabled={!title.trim() || !prompt.trim() || pending}>
                {pending ? "保存中" : "保存"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function CasesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setDraftPrompt = useWorkbench((state) => state.setDraftPrompt);
  const setEditImage = useWorkbench((state) => state.setEditImage);
  const setSelectedCaseMaterial = useWorkbench((state) => state.setSelectedCaseMaterial);
  const setMaterialPickerOpen = useWorkbench((state) => state.setMaterialPickerOpen);
  const { showToast } = useToast();
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [mineOnly, setMineOnly] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GalleryCaseItem | null>(null);
  const [editTarget, setEditTarget] = useState<GalleryCaseItem | null>(null);
  const [assetCaseTarget, setAssetCaseTarget] = useState<GalleryCaseItem | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [promptReferenceOpen, setPromptReferenceOpen] = useState(false);
  const [filterDisplayMode, setFilterDisplayMode] = useLibraryFilterDisplayMode();
  const cases = useInfiniteQuery({
    queryKey: ["cases", "paged", selectedCategoryIds.join(","), mineOnly, favoriteOnly, keyword],
    queryFn: ({ pageParam }) =>
      api.cases({
        limit: IMAGE_PAGE_SIZE,
        offset: Number(pageParam),
        categoryIds: selectedCategoryIds,
        mineOnly,
        favoriteOnly,
        keyword
      }),
    initialPageParam: 0,
    placeholderData: (previousData) => previousData,
    getNextPageParam: (lastPage) => (lastPage.pageInfo.hasMore ? lastPage.pageInfo.offset + lastPage.pageInfo.limit : undefined)
  });
  const assetCategories = useQuery({ queryKey: ["asset-categories"], queryFn: api.assetCategories, enabled: Boolean(assetCaseTarget) });
  const categories = useMemo(() => {
    const pages = cases.data?.pages ?? [];
    const baseCategories = pages[0]?.categories ?? [];
    return baseCategories.map((category) => ({
      ...category,
      items: pages.flatMap((page) => page.categories.find((item) => item.id === category.id)?.items ?? [])
    }));
  }, [cases.data?.pages]);
  const caseLoadMoreRef = useInfinitePageLoader({
    fetchNextPage: () => cases.fetchNextPage(),
    hasNextPage: Boolean(cases.hasNextPage),
    isFetchingNextPage: cases.isFetchingNextPage
  });
  const caseStyleCategories = useMemo(() => categories.filter((category) => !isUncategorizedCaseCategory(category)), [categories]);
  const createCategory = useMutation({
    mutationFn: (name: string) => api.createCaseCategory(name),
    onSuccess: ({ category }) => {
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      setSelectedCategoryIds([category.id]);
      setMineOnly(false);
      setTagDialogOpen(false);
      showToast("风格已新增");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "新增风格失败", "error");
    }
  });
  const deleteCase = useMutation({
    mutationFn: (caseId: string) => api.deleteCase(caseId),
    onSuccess: (_, caseId) => {
      setPreviewIndex((value) => {
        if (value === null) return null;
        const nextItems = visibleItems.filter((item) => item.id !== caseId);
        if (nextItems.length === 0) return null;
        return Math.min(value, nextItems.length - 1);
      });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      setDeleteTarget(null);
      showToast("灵感已删除");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "删除灵感失败", "error");
    }
  });
  const updateCase = useMutation({
    mutationFn: async (payload: { caseId: string; title: string; prompt: string; categoryIds: string[]; includeReferences: boolean; coverImage?: CaseGroupImage }) => {
      const result = await api.updateCase(payload.caseId, {
        title: payload.title,
        prompt: payload.prompt,
        categoryIds: payload.categoryIds,
        includeReferences: payload.includeReferences
      });
      if (payload.coverImage) {
        await api.setCaseCover(payload.caseId, { groupImageId: payload.coverImage.id, sourceId: payload.coverImage.sourceId });
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      setEditTarget(null);
      showToast("灵感已更新");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "保存灵感失败", "error");
    }
  });
  const setCaseFavorite = useMutation({
    mutationFn: (payload: { caseId: string; favorited: boolean }) => api.setCaseFavorite(payload.caseId, payload.favorited),
    onSuccess: ({ favorited }) => {
      showToast(favorited ? "已收藏" : "已取消收藏");
      queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "收藏灵感失败", "error");
    }
  });
  const submitCaseReview = useMutation({
    mutationFn: (caseId: string) => api.submitCaseReview(caseId),
    onSuccess: ({ reviewStatus }) => {
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      showToast(reviewStatus === "approved" ? "灵感已公开" : "灵感已提交审核");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "提交审核失败", "error");
    }
  });
  const setCaseCover = useMutation({
    mutationFn: (payload: { caseId: string; groupImage: CaseGroupImage }) =>
      api.setCaseCover(payload.caseId, { groupImageId: payload.groupImage.id, sourceId: payload.groupImage.sourceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      showToast("封面已更新");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "设置封面失败", "error");
    }
  });
  const addAssetFromCase = useMutation({
    mutationFn: (payload: { item: GalleryCaseItem; name?: string; spaceMode: AssetUploadMode; categoryIds: string[] }) =>
      api.addAssetFromImage({
        caseItemId: payload.item.groupId || payload.item.id,
        name: payload.name,
        spaceMode: payload.spaceMode,
        categoryIds: payload.categoryIds
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setAssetCaseTarget(null);
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
  const visibleItems = useMemo(() => {
    const selectedCategorySet = new Set(selectedCategoryIds);
    const sourceCategories =
      selectedCategoryIds.length === 0 ? categories : categories.filter((category) => selectedCategorySet.has(category.id));
    return filterGalleryCaseItems(buildGalleryCaseItems(sourceCategories), { mineOnly, favoriteOnly, keyword });
  }, [categories, favoriteOnly, keyword, mineOnly, selectedCategoryIds]);
  const caseFilterCounts = useMemo(() => {
    const serverCounts = cases.data?.pages[0]?.counts;
    if (serverCounts) return { ...serverCounts, favorite: serverCounts.favorite ?? 0, byCategory: new Map(Object.entries(serverCounts.byCategory)) };
    const allItems = buildGalleryCaseItems(categories);
    return {
      all: filterGalleryCaseItems(allItems, { mineOnly: false, favoriteOnly: false, keyword }).length,
      mine: filterGalleryCaseItems(allItems, { mineOnly: true, favoriteOnly: false, keyword }).length,
      favorite: filterGalleryCaseItems(allItems, { mineOnly: false, favoriteOnly: true, keyword }).length,
      byCategory: new Map(
        caseStyleCategories.map((category) => [
          category.id,
          filterGalleryCaseItems(buildGalleryCaseItems([category]), { mineOnly: false, favoriteOnly: false, keyword }).length
        ])
      )
    };
  }, [caseStyleCategories, cases.data?.pages, categories, keyword]);
  const casePreviewItems = useMemo(
    () =>
      visibleItems.map((item) => {
        const styleNames = visibleCaseStyleNames(item);
        const originalUrl = item.imageOriginalUrl ?? item.imageUrl;
        const groupImages = (item.images ?? []).map((image) => ({
          ...image,
          imageOriginalUrl: image.imageOriginalUrl ?? image.imageUrl,
          imagePreviewUrl: image.imagePreviewUrl ?? image.imageUrl,
          imageThumbnailUrl: image.imageThumbnailUrl ?? image.imagePreviewUrl ?? image.imageUrl
        }));
        return {
          ...item,
          imageUrl: originalUrl,
          originalUrl,
          previewUrl: originalUrl,
          thumbnailUrl: item.imageThumbnailUrl ?? item.imagePreviewUrl ?? item.imageUrl,
          description: item.prompt,
          groupImages,
          activeGroupImage: undefined as CaseGroupImage | undefined,
          isActiveGroupImageCover: undefined as boolean | undefined,
          metaItems: [
            ...(styleNames.length > 0 ? [`风格：${styleNames.join(" / ")}`] : []),
            ...(groupImages.length > 1 ? [`组图：${groupImages.length} 张`] : [])
          ]
        };
      }),
    [visibleItems]
  );
  const caseFilterHintKey = useMemo(
    () =>
      ["case-filter", mineOnly ? "mine" : "all", favoriteOnly ? "favorite" : "normal", selectedCategoryIds.join(","), ...caseStyleCategories.map((category) => `${category.id}:${category.name}`)].join("\u0000"),
    [caseStyleCategories, favoriteOnly, mineOnly, selectedCategoryIds]
  );
  const caseScrollJumpKey = useMemo(
    () => ["cases", filterDisplayMode, mineOnly ? "mine" : "all", favoriteOnly ? "favorite" : "normal", selectedCategoryIds.join(","), keyword, visibleItems.length].join("\u0000"),
    [favoriteOnly, filterDisplayMode, keyword, mineOnly, selectedCategoryIds, visibleItems.length]
  );
  const { jumpToScrollEdge, scrollJump } = useScrollJump({ syncKey: caseScrollJumpKey });
  const useCasePrompt = (item: GalleryCaseItem) => {
    setDraftPrompt(item.prompt, { caseItemId: item.groupId || item.id, prompt: item.prompt });
    navigate("/");
  };
  const useCaseAsMaterial = (item: GalleryCaseItem) => {
    const caseMaterial = caseMaterialFromCaseItem(item);
    setSelectedCaseMaterial(caseMaterial);
    setEditImage(null);
    setMaterialPickerOpen(false);
    navigate("/");
    showToast("已作为素材使用");
  };
  const toggleCaseFavorite = (item: GalleryCaseItem) => {
    setCaseFavorite.mutate({ caseId: item.groupId || item.id, favorited: !item.favorited });
  };

  const toggleCaseCategory = (categoryId: string) => {
    setMineOnly(false);
    setSelectedCategoryIds((value) => (value.includes(categoryId) ? [] : [categoryId]));
  };

  useEffect(() => {
    if (selectedCategoryIds.length === 0 || categories.length === 0) return;
    const categoryIds = new Set(caseStyleCategories.map((category) => category.id));
    setSelectedCategoryIds((value) => value.filter((item) => categoryIds.has(item)).slice(0, 1));
  }, [caseStyleCategories, selectedCategoryIds.length]);

  useEffect(() => {
    if (previewIndex !== null && previewIndex >= visibleItems.length) {
      setPreviewIndex(visibleItems.length > 0 ? visibleItems.length - 1 : null);
    }
  }, [previewIndex, visibleItems.length]);

  const scopeFilterButtons = (
    <>
      <button
        className={cx(selectedCategoryIds.length === 0 && !mineOnly && "active")}
        onClick={() => {
          setSelectedCategoryIds([]);
          setMineOnly(false);
        }}
      >
        <FilterTabLabel count={caseFilterCounts.all}>全部</FilterTabLabel>
      </button>
      <button
        className={cx(mineOnly && "active")}
        onClick={() => {
          setSelectedCategoryIds([]);
          setMineOnly((value) => !value);
        }}
      >
        <FilterTabLabel count={caseFilterCounts.mine}>我的</FilterTabLabel>
      </button>
    </>
  );

  return (
    <section className="page-section">
      <PageHeader
        title="灵感空间"
        desc="不同风格的灵感图片和提示词，可直接带入对话。"
        icon={<Lightbulb size={24} />}
        actions={
          <div className="case-page-header-actions">
            <FilterModeToggle value={filterDisplayMode} onChange={setFilterDisplayMode} />
            <button className="secondary-btn prompt-reference-entry" type="button" onClick={() => navigate("/cases/barrage")}>
              <Balloon size={16} />
              灵感弹幕
            </button>
            <button className="secondary-btn prompt-reference-entry" type="button" onClick={() => setPromptReferenceOpen(true)}>
              <Link2 size={16} />
              灵感链接
            </button>
          </div>
        }
      />
      <div className={cx("library-filter-row", `filter-mode-${filterDisplayMode}`)}>
        {filterDisplayMode === "compact" ? (
          <div className="case-filter-pinned-tabs" role="group" aria-label="灵感范围筛选">
            {scopeFilterButtons}
          </div>
        ) : null}
        <FilterTabsScroller ariaLabel="灵感风格筛选" hintKey={caseFilterHintKey} mode={filterDisplayMode}>
          {filterDisplayMode === "compact" ? null : scopeFilterButtons}
          {caseStyleCategories.map((category) => (
            <button
              key={category.slug}
              className={cx(selectedCategoryIds.includes(category.id) && "active")}
              onClick={() => toggleCaseCategory(category.id)}
            >
              <FilterTabLabel count={caseFilterCounts.byCategory.get(category.id)}>{category.name}</FilterTabLabel>
            </button>
          ))}
        </FilterTabsScroller>
        <div className="library-filter-actions">
          <button
            className={cx("case-favorite-filter-btn", favoriteOnly && "active")}
            type="button"
            onClick={() => setFavoriteOnly((value) => !value)}
            aria-label={favoriteOnly ? "取消收藏筛选" : "只看收藏灵感"}
            aria-pressed={favoriteOnly}
            title={favoriteOnly ? "取消收藏筛选" : "只看收藏灵感"}
          >
            <Heart size={17} fill={favoriteOnly ? "currentColor" : "none"} />
            <span className="filter-tab-count">{caseFilterCounts.favorite}</span>
          </button>
          <SearchHistoryInput
            scope="cases"
            className="case-search"
            value={keyword}
            onChange={setKeyword}
            placeholder="搜索标题、描述或风格"
            ariaLabel="搜索灵感"
            icon={<Search size={17} />}
          />
          <button className="secondary-btn case-add-tag" type="button" onClick={() => setTagDialogOpen(true)}>
            <Plus size={16} />
            新增风格
          </button>
        </div>
      </div>
      <div className="case-grid">
        {visibleItems.map((item, index) => {
          const styleNames = visibleCaseStyleNames(item);
          return (
            <article className="case-card" key={item.id}>
              <div className="case-image-frame" title={(item.imageCount ?? 1) > 1 ? "组图" : undefined}>
                <button className="case-image-btn" type="button" onClick={() => setPreviewIndex(index)}>
                  <SkeletonImage src={item.imageThumbnailUrl ?? item.imagePreviewUrl ?? item.imageUrl} alt={item.title} />
                </button>
                {(item.imageCount ?? 1) > 1 ? (
                  <span
                    className="case-multi-image-badge"
                    aria-label={`组图，共 ${item.imageCount} 张`}
                  >
                    <ImagesIcon size={15} />
                    <span>{item.imageCount}</span>
                  </span>
                ) : null}
                <button
                  className={cx("case-action-icon", "case-favorite-btn", item.favorited && "active")}
                  type="button"
                  onClick={() => toggleCaseFavorite(item)}
                  aria-label={item.favorited ? "取消收藏灵感" : "收藏灵感"}
                  aria-pressed={item.favorited}
                  title={item.favorited ? "取消收藏" : "收藏"}
                  disabled={setCaseFavorite.isPending}
                >
                  <Heart size={16} fill={item.favorited ? "currentColor" : "none"} />
                </button>
                <div className="case-card-actions">
                  <button className="case-action-icon" type="button" onClick={() => useCasePrompt(item)} aria-label="使用提示词" title="使用提示词">
                    <Send size={16} />
                  </button>
                  {item.canDelete ? (
                    <>
                      {item.reviewStatus === "rejected" ? (
                        <button
                          className="case-action-icon"
                          type="button"
                          onClick={() => submitCaseReview.mutate(item.groupId || item.id)}
                          aria-label="重新提交审核"
                          title="重新提交审核"
                          disabled={submitCaseReview.isPending}
                        >
                          <RefreshCw size={16} />
                        </button>
                      ) : null}
                      <button className="case-action-icon" type="button" onClick={() => setEditTarget(item)} aria-label="编辑灵感" title="编辑灵感">
                        <Pencil size={16} />
                      </button>
                      <button className="case-action-icon danger" type="button" onClick={() => setDeleteTarget(item)} aria-label="删除灵感" title="删除灵感">
                        <Trash2 size={16} />
                      </button>
                    </>
                  ) : null}
                  <CaseMaterialActionsMenu
                    buttonClassName="case-action-icon"
                    onUseAsMaterial={() => useCaseAsMaterial(item)}
                    onAddToAssets={() => {
                      addAssetFromCase.reset();
                      setAssetCaseTarget(item);
                    }}
                  />
                </div>
              </div>
              <div className={cx("case-card-body", styleNames.length === 0 && "no-style")}>
                <div className="case-card-title-row">
                  <h3>{item.title}</h3>
                  {item.canDelete && item.reviewStatus !== "approved" ? (
                    <span className={cx("asset-space-badge", `share-status-${item.reviewStatus}`)}>{caseReviewStatusLabel(item.reviewStatus)}</span>
                  ) : null}
                </div>
                <p>{item.prompt}</p>
                {item.canDelete && item.reviewStatus === "rejected" && item.rejectReason ? (
                  <small className="case-review-reject">原因：{item.rejectReason}</small>
                ) : null}
                {styleNames.length > 0 ? <AssetTagScroller names={styleNames} /> : null}
              </div>
            </article>
          );
        })}
      </div>
      {visibleItems.length === 0 ? <div className="case-empty">暂无匹配灵感</div> : null}
      <div ref={caseLoadMoreRef} className="page-load-sentinel" aria-hidden="true" />
      <ScrollJumpButton className="page-scroll-jump-btn" scrollJump={scrollJump} onClick={jumpToScrollEdge} />
      {previewIndex !== null ? (
        <ImagePreviewModal
          items={casePreviewItems}
          index={previewIndex}
          ariaLabel="灵感预览"
          initialZoomMode="contain"
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          renderActions={(item) => (
            <>
              <button
                className={cx("case-preview-tool", "favorite", item.favorited && "active")}
                type="button"
                onClick={() => toggleCaseFavorite(item)}
                aria-label={item.favorited ? "取消收藏灵感" : "收藏灵感"}
                aria-pressed={item.favorited}
                title={item.favorited ? "取消收藏" : "收藏"}
                disabled={setCaseFavorite.isPending}
              >
                <Heart size={16} fill={item.favorited ? "currentColor" : "none"} />
              </button>
              <button className="case-preview-tool" type="button" onClick={() => useCasePrompt(item)} aria-label="使用提示词" title="使用提示词">
                <Send size={16} />
              </button>
              {item.canDelete ? (
                <>
                  {item.reviewStatus === "rejected" ? (
                    <button
                      className="case-preview-tool"
                      type="button"
                      onClick={() => submitCaseReview.mutate(item.groupId || item.id)}
                      aria-label="重新提交审核"
                      title="重新提交审核"
                      disabled={submitCaseReview.isPending}
                    >
                      <RefreshCw size={16} />
                    </button>
                  ) : null}
                  <button className="case-preview-tool" type="button" onClick={() => setEditTarget(item)} aria-label="编辑灵感" title="编辑灵感">
                    <Pencil size={16} />
                  </button>
                </>
              ) : null}
              {item.canDelete && item.activeGroupImage && (item.imageCount ?? 1) > 1 ? (
                <button
                  className="case-preview-tool"
                  type="button"
                  onClick={() => setCaseCover.mutate({ caseId: item.groupId || item.id, groupImage: item.activeGroupImage! })}
                  aria-label={item.isActiveGroupImageCover ? "当前封面" : "设为封面"}
                  title={item.isActiveGroupImageCover ? "当前封面" : "设为封面"}
                  disabled={Boolean(item.isActiveGroupImageCover) || setCaseCover.isPending}
                >
                  <ImagesIcon size={16} />
                </button>
              ) : null}
              <ImageDownloadMenu
                source={item.downloadSourceType && item.downloadSourceId ? { type: item.downloadSourceType, id: item.downloadSourceId } : null}
                className="case-preview-tool"
              />
              {item.canDelete ? (
                <button className="case-preview-tool danger" type="button" onClick={() => setDeleteTarget(item)} aria-label="删除灵感" title="删除灵感">
                  <Trash2 size={16} />
                </button>
              ) : null}
              <CaseMaterialActionsMenu
                buttonClassName="case-preview-tool"
                onUseAsMaterial={() => useCaseAsMaterial(item)}
                onAddToAssets={() => {
                  addAssetFromCase.reset();
                  setAssetCaseTarget(item);
                }}
              />
            </>
          )}
        />
      ) : null}
      <PromptDialog
        open={tagDialogOpen}
        title="新增风格"
        label="风格名称"
        confirmText={createCategory.isPending ? "保存中" : "新增风格"}
        onSubmit={(value) => {
          if (!createCategory.isPending) createCategory.mutate(value.trim());
        }}
        onCancel={() => setTagDialogOpen(false)}
      />
      <PromptReferenceLinksDialog open={promptReferenceOpen} onClose={() => setPromptReferenceOpen(false)} />
      {editTarget ? (
        <EditCaseModal
          item={editTarget}
          categories={caseStyleCategories}
          pending={updateCase.isPending}
          error={updateCase.error instanceof Error ? updateCase.error : null}
          onClose={() => setEditTarget(null)}
          onSave={(payload) => updateCase.mutate({ caseId: editTarget.groupId || editTarget.id, ...payload })}
        />
      ) : null}
      {assetCaseTarget ? (
        <AddAssetFromImageModal
          image={caseMaterialFromCaseItem(assetCaseTarget)}
          categories={assetCategories.data?.categories ?? []}
          pending={addAssetFromCase.isPending}
          error={addAssetFromCase.error instanceof Error ? addAssetFromCase.error : null}
          onClose={() => setAssetCaseTarget(null)}
          onAdd={(payload) => addAssetFromCase.mutate({ item: assetCaseTarget, ...payload })}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除灵感"
        description={`确认删除“${deleteTarget?.title ?? ""}”？删除后不会影响原图片。`}
        confirmText={deleteCase.isPending ? "删除中" : "删除"}
        destructive
        onConfirm={() => {
          if (deleteTarget && !deleteCase.isPending) deleteCase.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
