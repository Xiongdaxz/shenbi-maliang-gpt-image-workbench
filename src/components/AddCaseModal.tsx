import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { api } from "../api";
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
  autoGenerateFields = false
}: {
  source: AddCaseSource;
  onClose: () => void;
  autoGenerateFields?: boolean;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const cases = useQuery({ queryKey: ["cases"], queryFn: () => api.cases() });
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
  const [includeAllImages, setIncludeAllImages] = useState(canAddAll);
  const [selectedImageId, setSelectedImageId] = useState(source.id);
  const [coverImageId, setCoverImageId] = useState(source.id);
  const canSave = Boolean(prompt.trim()) && Boolean(title.trim()) && !caseSuggestionPending;
  const activePreviewId = includeAllImages ? coverImageId : selectedImageId;
  const save = useMutation({
    mutationFn: () =>
      api.addCase({
        ...(source.type === "image"
          ? includeAllImages && sourceImages.length > 1
            ? { imageIds: sourceImages.map((image) => image.id), coverImageId }
            : { imageId: selectedImageId, coverImageId: selectedImageId }
          : { assetId: source.id }),
        categoryIds,
        title: title.trim(),
        prompt: prompt.trim(),
        autoCategory: false,
        includeReferences
      }),
    onSuccess: ({ caseItems, skipped }) => {
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      if (skipped > 0) {
        showToast(caseItems.length === 0 ? "已经在灵感空间" : "部分风格已经加入，已加入新的风格", "error");
      } else {
        const reviewStatus = String(caseItems[0]?.reviewStatus ?? "");
        showToast(reviewStatus === "pending" ? "已提交灵感审核" : "已加入灵感空间");
      }
      onClose();
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "加入灵感空间失败", "error");
    }
  });

  useEffect(() => {
    titleTouchedRef.current = false;
    categoryTouchedRef.current = false;
    caseSuggestionRequestRef.current = "";
    setTitle(initialCaseTitle(source));
    setCategoryIds(initialCategoryIds(source));
    setPrompt(source.promptSeed);
  }, [source.id, source.promptSeed]);

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
      <section className="case-modal">
        <header>
          <h3>加入灵感空间</h3>
          <button onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="case-modal-layout">
          <CaseModalImagePreview
            images={sourceImages}
            fallbackUrl={source.url}
            alt={title}
            activeImageId={activePreviewId}
            thumbStripLabel={includeAllImages ? "设置封面图" : "选择加入图片"}
            activeThumbLabel={includeAllImages ? "封面" : "选中"}
            thumbTitle={() => (includeAllImages ? "设为封面" : "选择这张")}
            thumbAriaLabel={(_, index) => (includeAllImages ? `设第 ${index + 1} 张为封面` : `选择第 ${index + 1} 张加入`)}
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
            {canAddAll ? (
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
                  <span>全部加入</span>
                  <small>勾选后保存全部 {sourceImages.length} 张；取消后只保存当前选中图。</small>
                </span>
              </label>
            ) : null}
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
                categories={selectableCategories}
                value={categoryIds}
                onChange={updateCategoryIds}
                labelName="风格"
                placeholder={caseSuggestionPending ? "正在生成风格..." : "不选择风格"}
              />
            </label>
            <label>
              标题
              <input
                value={title}
                onChange={(event) => updateTitle(event.target.value)}
                placeholder={caseSuggestionPending ? "正在生成标题..." : "请输入标题"}
              />
            </label>
            <label>
              {autoGenerateFields ? "提示内容" : "提示词"}
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                placeholder={autoGenerateFields ? "请输入提示内容" : undefined}
              />
            </label>
            {save.error ? <div className="form-error">{save.error.message}</div> : null}
            <div className="row-actions">
              <button className="secondary-btn" onClick={onClose}>
                取消
              </button>
              <button className="primary-btn" onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
                {save.isPending ? "加入中" : caseSuggestionPending ? "生成字段中" : "加入灵感空间"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );

  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
}
