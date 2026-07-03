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
import { LibraryEmptyState } from "../components/LibraryEmptyState";
import { PageHeader } from "../components/PageHeader";
import { PromptReferenceLinksDialog } from "../components/PromptReferenceLinksDialog";
import { SearchHistoryInput } from "../components/SearchHistoryInput";
import { SkeletonImage } from "../components/SkeletonImage";
import { ScrollJumpButton } from "../components/ScrollJumpButton";
import { useI18n } from "../i18n";
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

function caseReviewStatusLabel(status: GalleryCaseItem["reviewStatus"], t: (key: string) => string) {
  if (status === "pending") return t("status.pendingReview");
  if (status === "rejected") return t("status.rejected");
  return t("status.approved");
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
  const { t } = useI18n();
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
          <h3>{t("pages.cases.edit")}</h3>
          <button onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </header>
        <div className="case-modal-layout">
          <CaseModalImagePreview
            images={previewImages}
            fallbackUrl={item.imageUrl}
            alt={title}
            activeImageId={coverImageId}
            thumbStripLabel={t("pages.cases.coverStrip")}
            activeThumbLabel={t("pages.cases.cover")}
            thumbTitle={() => t("pages.cases.setCover")}
            thumbAriaLabel={(_, index) => t("pages.cases.setNthCover", { index: index + 1 })}
            onSelectImage={previewImages.length > 1 ? (image) => setCoverImageId(image.id) : undefined}
          />
          <div className="case-modal-form-pane">
            <label className={cx("case-reference-toggle", includeReferences && "active")}>
              <input type="checkbox" checked={includeReferences} onChange={(event) => setIncludeReferences(event.target.checked)} />
              <span className="case-reference-toggle-check" aria-hidden="true">
                {includeReferences ? <Check size={13} strokeWidth={2.5} /> : null}
              </span>
              <span className="case-reference-toggle-copy">
                <span>{t("pages.cases.includeReferences")}</span>
                <small>{t("pages.cases.includeReferencesDesc")}</small>
              </span>
            </label>
            <label>
              {t("pages.cases.style")}
              <CaseCategoryMultiSelect
                categories={categories}
                value={categoryIds}
                onChange={setCategoryIds}
                labelName={t("pages.cases.style")}
              />
            </label>
            <label>
              {t("pages.cases.titleField")}
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              {t("pages.cases.descriptionField")}
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} />
            </label>
            {error ? <div className="form-error">{error.message}</div> : null}
            <div className="row-actions">
              <button className="secondary-btn" type="button" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button className="primary-btn" type="button" onClick={submit} disabled={!title.trim() || !prompt.trim() || pending}>
                {pending ? t("common.saving") : t("common.save")}
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
  const resetNewChatComposer = useWorkbench((state) => state.resetNewChatComposer);
  const setEditImage = useWorkbench((state) => state.setEditImage);
  const setSelectedCaseMaterial = useWorkbench((state) => state.setSelectedCaseMaterial);
  const setMaterialPickerOpen = useWorkbench((state) => state.setMaterialPickerOpen);
  const { showToast } = useToast();
  const { t } = useI18n();
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
      showToast(t("toast.caseStyleCreated"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.caseStyleCreateFailed"), "error");
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
      showToast(t("toast.caseDeleted"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.caseDeleteFailed"), "error");
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
      showToast(t("toast.caseUpdated"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.caseUpdateFailed"), "error");
    }
  });
  const setCaseFavorite = useMutation({
    mutationFn: (payload: { caseId: string; favorited: boolean }) => api.setCaseFavorite(payload.caseId, payload.favorited),
    onSuccess: ({ favorited }) => {
      showToast(favorited ? t("toast.favoriteAdded") : t("toast.favoriteRemoved"));
      queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.caseFavoriteFailed"), "error");
    }
  });
  const submitCaseReview = useMutation({
    mutationFn: (caseId: string) => api.submitCaseReview(caseId),
    onSuccess: ({ reviewStatus }) => {
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      showToast(reviewStatus === "approved" ? t("toast.casePublished") : t("toast.caseReviewSubmitted"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.caseReviewSubmitFailed"), "error");
    }
  });
  const setCaseCover = useMutation({
    mutationFn: (payload: { caseId: string; groupImage: CaseGroupImage }) =>
      api.setCaseCover(payload.caseId, { groupImageId: payload.groupImage.id, sourceId: payload.groupImage.sourceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      showToast(t("toast.caseCoverUpdated"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.caseCoverUpdateFailed"), "error");
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
        showToast(t("toast.assetAdded"));
      } else {
        showToast(result.duplicateScope === "shared" ? t("toast.assetDuplicateShared") : t("toast.assetDuplicatePrivate"), "error");
      }
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.assetAddFailed"), "error");
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
            ...(styleNames.length > 0 ? [t("pages.cases.styleMeta", { styles: styleNames.join(" / ") })] : []),
            ...(groupImages.length > 1 ? [t("pages.cases.groupImageCount", { count: groupImages.length })] : [])
          ]
        };
      }),
    [t, visibleItems]
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
  const hasCaseFilters = selectedCategoryIds.length > 0 || mineOnly || favoriteOnly || Boolean(keyword.trim());
  const useCasePrompt = (item: GalleryCaseItem) => {
    resetNewChatComposer();
    setDraftPrompt(item.prompt, { caseItemId: item.groupId || item.id, prompt: item.prompt });
    navigate("/");
  };
  const startNewCaseCreation = () => {
    resetNewChatComposer();
    navigate("/");
  };
  const clearCaseFilters = () => {
    setSelectedCategoryIds([]);
    setMineOnly(false);
    setFavoriteOnly(false);
    setKeyword("");
  };
  const useCaseAsMaterial = (item: GalleryCaseItem) => {
    const caseMaterial = caseMaterialFromCaseItem(item);
    setSelectedCaseMaterial(caseMaterial);
    setEditImage(null);
    setMaterialPickerOpen(false);
    navigate("/");
    showToast(t("toast.caseUsedAsMaterial"));
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
        <FilterTabLabel count={caseFilterCounts.all}>{t("common.all")}</FilterTabLabel>
      </button>
      <button
        className={cx(mineOnly && "active")}
        onClick={() => {
          setSelectedCategoryIds([]);
          setMineOnly((value) => !value);
        }}
      >
        <FilterTabLabel count={caseFilterCounts.mine}>{t("common.mine")}</FilterTabLabel>
      </button>
    </>
  );

  return (
    <section className="page-section">
      <PageHeader
        title={t("pages.cases.title")}
        desc={t("pages.cases.desc")}
        icon={<Lightbulb size={24} />}
        actions={
          <div className="case-page-header-actions">
            <FilterModeToggle value={filterDisplayMode} onChange={setFilterDisplayMode} />
            <button className="secondary-btn prompt-reference-entry" type="button" onClick={() => navigate("/cases/barrage")}>
              <Balloon size={16} />
              {t("pages.cases.barrage")}
            </button>
            <button className="secondary-btn prompt-reference-entry" type="button" onClick={() => setPromptReferenceOpen(true)}>
              <Link2 size={16} />
              {t("pages.cases.links")}
            </button>
          </div>
        }
      />
      <div className={cx("library-filter-row", `filter-mode-${filterDisplayMode}`)}>
        {filterDisplayMode === "compact" ? (
          <div className="case-filter-pinned-tabs" role="group" aria-label={t("pages.cases.scope")}>
            {scopeFilterButtons}
          </div>
        ) : null}
        <FilterTabsScroller ariaLabel={t("pages.cases.styles")} hintKey={caseFilterHintKey} mode={filterDisplayMode}>
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
            aria-label={favoriteOnly ? t("pages.cases.cancelFavoriteOnly") : t("pages.cases.favoriteOnly")}
            aria-pressed={favoriteOnly}
            title={favoriteOnly ? t("pages.cases.cancelFavoriteOnly") : t("pages.cases.favoriteOnly")}
          >
            <Heart size={17} fill={favoriteOnly ? "currentColor" : "none"} />
            <span className="filter-tab-count">{caseFilterCounts.favorite}</span>
          </button>
          <SearchHistoryInput
            scope="cases"
            className="case-search"
            value={keyword}
            onChange={setKeyword}
            placeholder={t("pages.cases.searchPlaceholder")}
            ariaLabel={t("pages.cases.searchAria")}
            icon={<Search size={17} />}
          />
          <button className="secondary-btn case-add-tag" type="button" onClick={() => setTagDialogOpen(true)}>
            <Plus size={16} />
            {t("pages.cases.addStyle")}
          </button>
        </div>
      </div>
      <div className="case-grid">
        {visibleItems.map((item, index) => {
          const styleNames = visibleCaseStyleNames(item);
          return (
            <article className="case-card" key={item.id}>
              <div className="case-image-frame" title={(item.imageCount ?? 1) > 1 ? t("pages.cases.groupImage") : undefined}>
                <button className="case-image-btn" type="button" onClick={() => setPreviewIndex(index)}>
                  <SkeletonImage src={item.imageThumbnailUrl ?? item.imagePreviewUrl ?? item.imageUrl} alt={item.title} />
                </button>
                {(item.imageCount ?? 1) > 1 ? (
                  <span
                    className="case-multi-image-badge"
                    aria-label={t("pages.cases.groupImageCount", { count: item.imageCount ?? 0 })}
                  >
                    <ImagesIcon size={15} />
                    <span>{item.imageCount}</span>
                  </span>
                ) : null}
                <button
                  className={cx("case-action-icon", "case-favorite-btn", item.favorited && "active")}
                  type="button"
                  onClick={() => toggleCaseFavorite(item)}
                  aria-label={item.favorited ? t("pages.cases.unfavorite") : t("pages.cases.favorite")}
                  aria-pressed={item.favorited}
                  title={item.favorited ? t("pages.cases.unfavorite") : t("pages.cases.favorite")}
                  disabled={setCaseFavorite.isPending}
                >
                  <Heart size={16} fill={item.favorited ? "currentColor" : "none"} />
                </button>
                <div className="case-card-actions">
                  <button className="case-action-icon" type="button" onClick={() => useCasePrompt(item)} aria-label={t("pages.cases.usePrompt")} title={t("pages.cases.usePrompt")}>
                    <Send size={16} />
                  </button>
                  {item.canDelete ? (
                    <>
                      {item.reviewStatus === "rejected" ? (
                        <button
                          className="case-action-icon"
                          type="button"
                          onClick={() => submitCaseReview.mutate(item.groupId || item.id)}
                          aria-label={t("pages.cases.resubmitReview")}
                          title={t("pages.cases.resubmitReview")}
                          disabled={submitCaseReview.isPending}
                        >
                          <RefreshCw size={16} />
                        </button>
                      ) : null}
                      <button className="case-action-icon" type="button" onClick={() => setEditTarget(item)} aria-label={t("pages.cases.edit")} title={t("pages.cases.edit")}>
                        <Pencil size={16} />
                      </button>
                      <button className="case-action-icon danger" type="button" onClick={() => setDeleteTarget(item)} aria-label={t("pages.cases.delete")} title={t("pages.cases.delete")}>
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
                    <span className={cx("asset-space-badge", `share-status-${item.reviewStatus}`)}>{caseReviewStatusLabel(item.reviewStatus, t)}</span>
                  ) : null}
                </div>
                <p>{item.prompt}</p>
                {item.canDelete && item.reviewStatus === "rejected" && item.rejectReason ? (
                  <small className="case-review-reject">{t("pages.cases.rejectReason", { reason: item.rejectReason })}</small>
                ) : null}
                {styleNames.length > 0 ? <AssetTagScroller names={styleNames} /> : null}
              </div>
            </article>
          );
        })}
      </div>
      {!cases.isLoading && visibleItems.length === 0 ? (
        hasCaseFilters ? (
          <LibraryEmptyState
            compact
            imageSrc="/image/empty-states/inspiration-empty.png"
            imageAlt={t("pages.cases.emptyAlt")}
            title={t("pages.cases.noMatch")}
            description={t("empty.tryDifferentFilters")}
            action={
              <button className="secondary-btn" type="button" onClick={clearCaseFilters}>
                <X size={16} />
                {t("common.clearFilters")}
              </button>
            }
          />
        ) : (
          <LibraryEmptyState
            imageSrc="/image/empty-states/inspiration-empty.png"
            imageAlt={t("pages.cases.emptyAlt")}
            title={t("pages.cases.empty")}
            description={t("pages.cases.emptyDesc")}
            action={
              <button className="primary-btn" type="button" onClick={startNewCaseCreation}>
                <Send size={16} />
                {t("pages.cases.create")}
              </button>
            }
          />
        )
      ) : null}
      <div ref={caseLoadMoreRef} className="page-load-sentinel" aria-hidden="true" />
      <ScrollJumpButton className="page-scroll-jump-btn" scrollJump={scrollJump} onClick={jumpToScrollEdge} />
      {previewIndex !== null ? (
        <ImagePreviewModal
          items={casePreviewItems}
          index={previewIndex}
          ariaLabel={t("pages.cases.preview")}
          initialZoomMode="contain"
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          renderActions={(item) => (
            <>
              <button
                className={cx("case-preview-tool", "favorite", item.favorited && "active")}
                type="button"
                onClick={() => toggleCaseFavorite(item)}
                aria-label={item.favorited ? t("pages.cases.unfavorite") : t("pages.cases.favorite")}
                aria-pressed={item.favorited}
                title={item.favorited ? t("pages.cases.unfavorite") : t("pages.cases.favorite")}
                disabled={setCaseFavorite.isPending}
              >
                <Heart size={16} fill={item.favorited ? "currentColor" : "none"} />
              </button>
              <button className="case-preview-tool" type="button" onClick={() => useCasePrompt(item)} aria-label={t("pages.cases.usePrompt")} title={t("pages.cases.usePrompt")}>
                <Send size={16} />
              </button>
              {item.canDelete ? (
                <>
                  {item.reviewStatus === "rejected" ? (
                    <button
                      className="case-preview-tool"
                      type="button"
                      onClick={() => submitCaseReview.mutate(item.groupId || item.id)}
                      aria-label={t("pages.cases.resubmitReview")}
                      title={t("pages.cases.resubmitReview")}
                      disabled={submitCaseReview.isPending}
                    >
                      <RefreshCw size={16} />
                    </button>
                  ) : null}
                  <button className="case-preview-tool" type="button" onClick={() => setEditTarget(item)} aria-label={t("pages.cases.edit")} title={t("pages.cases.edit")}>
                    <Pencil size={16} />
                  </button>
                </>
              ) : null}
              {item.canDelete && item.activeGroupImage && (item.imageCount ?? 1) > 1 ? (
                <button
                  className="case-preview-tool"
                  type="button"
                  onClick={() => setCaseCover.mutate({ caseId: item.groupId || item.id, groupImage: item.activeGroupImage! })}
                  aria-label={item.isActiveGroupImageCover ? t("pages.cases.currentCover") : t("pages.cases.setCover")}
                  title={item.isActiveGroupImageCover ? t("pages.cases.currentCover") : t("pages.cases.setCover")}
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
                <button className="case-preview-tool danger" type="button" onClick={() => setDeleteTarget(item)} aria-label={t("pages.cases.delete")} title={t("pages.cases.delete")}>
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
        title={t("pages.cases.addStyleTitle")}
        label={t("pages.cases.styleName")}
        confirmText={createCategory.isPending ? t("common.saving") : t("pages.cases.addStyle")}
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
        title={t("pages.cases.deleteTitle")}
        description={t("pages.cases.deleteDescription", { title: deleteTarget?.title ?? "" })}
        confirmText={deleteCase.isPending ? t("common.deleting") : t("common.delete")}
        destructive
        onConfirm={() => {
          if (deleteTarget && !deleteCase.isPending) deleteCase.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
