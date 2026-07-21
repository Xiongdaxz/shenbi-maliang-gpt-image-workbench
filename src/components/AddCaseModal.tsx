import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import { isUncategorizedCaseCategory } from "../lib/cases";
import { useToast } from "../ui";
import { CaseCategoryMultiSelect } from "./CaseCategoryMultiSelect";
import { CaseModalImagePreview } from "./CaseModalImagePreview";

export type AddCaseSource = {
  type: "image" | "asset";
  id: string;
  url: string;
  titleSeed: string;
  promptSeed: string;
  suggestedTitle?: string;
  suggestedCategoryIds?: string[];
  images?: Array<{
    id: string;
    url: string;
    originalUrl?: string;
    previewUrl?: string;
    thumbnailUrl?: string;
    prompt?: string;
    suggestedCaseTitle?: string;
    suggestedCaseCategoryIds?: string[];
  }>;
};

function initialCaseTitle(source: AddCaseSource) {
  return source.suggestedTitle?.trim() || "";
}

function initialCategoryIds(source: AddCaseSource) {
  return Array.from(new Set((source.suggestedCategoryIds ?? []).map((id) => id.trim()).filter(Boolean)));
}

export function AddCaseModal({
  source,
  onClose,
  autoGenerateFields = false,
  forceAllImages = false,
  onSaved
}: {
  source: AddCaseSource;
  onClose: () => void;
  autoGenerateFields?: boolean;
  forceAllImages?: boolean;
  onSaved?: (result: { caseItems: Array<Record<string, string | number | boolean | string[]>>; skipped: number; createdImageIds?: string[]; skippedImageIds?: string[] }) => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useI18n();
  const cases = useQuery({ queryKey: ["case-categories"], queryFn: () => api.caseCategories() });
  const selectableCategories = useMemo(
    () => (cases.data?.categories ?? []).filter((category) => !isUncategorizedCaseCategory(category)),
    [cases.data?.categories]
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(() => initialCategoryIds(source));
  const [title, setTitle] = useState(() => initialCaseTitle(source));
  const [prompt, setPrompt] = useState(source.promptSeed);
  const [caseSuggestionPending, setCaseSuggestionPending] = useState(false);
  const titleTouchedRef = useRef(false);
  const categoryTouchedRef = useRef(false);
  const caseSuggestionRequestRef = useRef("");
  const [includeReferences, setIncludeReferences] = useState(true);
  const sourceImages = useMemo(
    () =>
      source.type === "image"
        ? (source.images?.length ? source.images : [{ id: source.id, url: source.url, previewUrl: source.url, thumbnailUrl: source.url, prompt: source.promptSeed }])
            .filter((image) => image.id && image.url)
        : [],
    [source.id, source.images, source.promptSeed, source.type, source.url]
  );
  const canAddAll = source.type === "image" && sourceImages.length > 1;
  const [includeAllImagesState, setIncludeAllImages] = useState(canAddAll);
  const includeAllImages = forceAllImages ? canAddAll : includeAllImagesState;
  const [selectedImageId, setSelectedImageId] = useState(source.id);
  const [coverImageId, setCoverImageId] = useState(source.id);
  const canSave = Boolean(prompt.trim()) && Boolean(title.trim()) && !caseSuggestionPending;
  const activePreviewId = includeAllImages ? coverImageId : selectedImageId;
  const save = useMutation({
    mutationFn: () =>
      api.addCase({
        ...(source.type === "image"
          ? forceAllImages || (includeAllImages && sourceImages.length > 1)
            ? { imageIds: sourceImages.map((image) => image.id), coverImageId, duplicateMode: "skip" as const }
            : { imageId: selectedImageId, coverImageId: selectedImageId }
          : { assetId: source.id }),
        categoryIds,
        title: title.trim(),
        prompt: prompt.trim(),
        autoCategory: false,
        includeReferences
      }),
    onSuccess: (result) => {
      const { caseItems, skipped } = result;
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      if (skipped > 0) {
        showToast(caseItems.length === 0 ? t("toast.caseDuplicate") : t("toast.casePartialAdded"), "error");
      } else {
        const reviewStatus = String(caseItems[0]?.reviewStatus ?? "");
        showToast(reviewStatus === "pending" ? t("toast.caseReviewSubmitted") : t("toast.caseAdded"));
      }
      onSaved?.(result);
      onClose();
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.caseAddFailed"), "error");
    }
  });

  useEffect(() => {
    titleTouchedRef.current = false;
    categoryTouchedRef.current = false;
    caseSuggestionRequestRef.current = "";
    setTitle(initialCaseTitle(source));
    setCategoryIds(initialCategoryIds(source));
    setPrompt(source.promptSeed);
    setIncludeAllImages(canAddAll);
    setSelectedImageId(source.id);
    setCoverImageId(source.id);
  }, [canAddAll, source.id, source.promptSeed]);

  useEffect(() => {
    if (source.type !== "image") return;
    if (source.suggestedTitle?.trim()) return;
    const requestKey = source.id;
    if (!requestKey || caseSuggestionRequestRef.current === requestKey) return;
    caseSuggestionRequestRef.current = requestKey;
    let cancelled = false;
    setCaseSuggestionPending(true);
    api.suggestImageCaseFields(source.id)
      .then((result) => {
        if (cancelled) return;
        if (!titleTouchedRef.current) setTitle(result.title);
        if (!categoryTouchedRef.current) {
          setCategoryIds(Array.from(new Set(result.categoryIds.map((id) => id.trim()).filter(Boolean))));
        }
        queryClient.invalidateQueries({ queryKey: ["images"] });
        if (result.image.sessionId) queryClient.invalidateQueries({ queryKey: ["messages", result.image.sessionId] });
      })
      .catch(() => {
        if (!cancelled) caseSuggestionRequestRef.current = "";
      })
      .finally(() => {
        if (!cancelled) setCaseSuggestionPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient, source.id, source.suggestedTitle, source.type]);

  useEffect(() => {
    if (selectableCategories.length === 0) return;
    const selectableIds = new Set(selectableCategories.map((category) => category.id));
    setCategoryIds((value) => value.filter((categoryId) => selectableIds.has(categoryId)));
  }, [selectableCategories]);

  const updateCategoryIds = (nextCategoryIds: string[]) => {
    categoryTouchedRef.current = true;
    setCategoryIds(nextCategoryIds);
  };

  const updateTitle = (nextTitle: string) => {
    titleTouchedRef.current = true;
    setTitle(nextTitle);
  };

  const modal = (
    <div className="modal-backdrop">
      <section className="case-modal add-case-modal">
        <header>
          <h3>{t("pages.cases.addToInspiration")}</h3>
          <button onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </header>
        <div className="case-modal-layout">
          <CaseModalImagePreview
            images={sourceImages}
            fallbackUrl={source.url}
            alt={title}
            activeImageId={activePreviewId}
            thumbStripLabel={includeAllImages ? t("pages.cases.coverStrip") : t("pages.cases.selectImageToAdd")}
            activeThumbLabel={includeAllImages ? t("pages.cases.cover") : t("pages.cases.selected")}
            thumbTitle={() => (includeAllImages ? t("pages.cases.setCover") : t("pages.cases.selectThisImage"))}
            thumbAriaLabel={(_, index) => (includeAllImages ? t("pages.cases.setNthCover", { index: index + 1 }) : t("pages.cases.selectNthImage", { index: index + 1 }))}
            onSelectImage={
              canAddAll
                ? (image) => {
                    setSelectedImageId(image.id);
                    if (includeAllImages) setCoverImageId(image.id);
                  }
                : undefined
            }
          />
          <div className="case-modal-form-pane">
            {canAddAll && !forceAllImages ? (
              <label className={cx("case-reference-toggle", includeAllImages && "active")}>
                <input
                  type="checkbox"
                  checked={includeAllImages}
                  onChange={(event) => {
                    setIncludeAllImages(event.target.checked);
                    if (event.target.checked) setCoverImageId(selectedImageId);
                  }}
                />
                <span className="case-reference-toggle-check" aria-hidden="true">
                  {includeAllImages ? <Check size={13} strokeWidth={2.5} /> : null}
                </span>
                <span className="case-reference-toggle-copy">
                  <span>{t("pages.cases.addAllImages")}</span>
                  <small>{t("pages.cases.addAllImagesDesc", { count: sourceImages.length })}</small>
                </span>
              </label>
            ) : null}
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
                categories={selectableCategories}
                value={categoryIds}
                onChange={updateCategoryIds}
                labelName={t("pages.cases.style")}
                placeholder={caseSuggestionPending ? t("pages.cases.generatingStyle") : t("pages.cases.noStyle")}
              />
            </label>
            <label>
              {t("pages.cases.titleField")}
              <input
                value={title}
                onChange={(event) => updateTitle(event.target.value)}
                placeholder={caseSuggestionPending ? t("pages.cases.generatingTitle") : t("pages.cases.titlePlaceholder")}
              />
            </label>
            <label className="case-modal-prompt-field">
              {autoGenerateFields ? t("pages.cases.promptContent") : t("pages.cases.prompt")}
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                placeholder={autoGenerateFields ? t("pages.cases.promptContentPlaceholder") : undefined}
              />
            </label>
            {save.error ? <div className="form-error">{save.error.message}</div> : null}
            <div className="row-actions">
              <button className="secondary-btn" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button className="primary-btn" onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
                {save.isPending ? t("common.adding") : caseSuggestionPending ? t("common.generatingFields") : t("pages.cases.addToInspiration")}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );

  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
}
