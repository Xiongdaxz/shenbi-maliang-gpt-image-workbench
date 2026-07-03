import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { ASSET_UPLOAD_MODE_OPTIONS, type AssetUploadMode } from "../lib/assets";
import { cx } from "../lib/cx";
import { formatImageFileSize } from "../lib/format";
import type { CaseCategory, CaseMaterialItem, WorkImage } from "../types";
import { CaseCategoryMultiSelect } from "./CaseCategoryMultiSelect";

function initialAssetName(image: WorkImage | CaseMaterialItem) {
  const imageSuggestion = image as Partial<WorkImage>;
  return imageSuggestion.suggestedAssetName?.trim() || imageSuggestion.suggestedCaseTitle?.trim() || ("title" in image ? image.title.trim() : "");
}

function initialAssetCategoryIds(image: WorkImage | CaseMaterialItem) {
  const imageSuggestion = image as Partial<WorkImage>;
  return Array.from(new Set((imageSuggestion.suggestedAssetCategoryIds ?? []).map((id) => id.trim()).filter(Boolean)));
}

function isWorkImage(image: WorkImage | CaseMaterialItem): image is WorkImage {
  return "kind" in image;
}

export function AddAssetFromImageModal({
  image,
  categories,
  pending,
  error,
  onClose,
  onAdd
}: {
  image: WorkImage | CaseMaterialItem;
  categories: CaseCategory[];
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onAdd: (payload: { name?: string; spaceMode: AssetUploadMode; categoryIds: string[] }) => void;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [name, setName] = useState(() => initialAssetName(image));
  const [spaceMode, setSpaceMode] = useState<AssetUploadMode>("private");
  const [categoryIds, setCategoryIds] = useState<string[]>(() => initialAssetCategoryIds(image));
  const [categorySuggestionPending, setCategorySuggestionPending] = useState(false);
  const [nameSuggestionPending, setNameSuggestionPending] = useState(false);
  const nameTouchedRef = useRef(false);
  const categoryTouchedRef = useRef(false);
  const categorySuggestionRequestRef = useRef("");
  const nameSuggestionRequestRef = useRef("");
  const fieldSuggestionPending = categorySuggestionPending || nameSuggestionPending;
  const imageSizeLabel =
    image.imageWidth > 0 && image.imageHeight > 0
      ? `${image.imageWidth} x ${image.imageHeight}`
      : "size" in image && image.size && image.size !== "auto"
        ? image.size
        : "";
  const imageFileSizeLabel = formatImageFileSize(image.imageFileSize);
  const imageMetaLabels = [imageSizeLabel, imageFileSizeLabel].filter(Boolean);
  const uploadModeOptions = ASSET_UPLOAD_MODE_OPTIONS.map((option) => ({
    ...option,
    label: t(`asset.uploadMode.${option.value}.label`),
    description: t(`asset.uploadMode.${option.value}.description`)
  }));

  useEffect(() => {
    nameTouchedRef.current = false;
    categoryTouchedRef.current = false;
    categorySuggestionRequestRef.current = "";
    nameSuggestionRequestRef.current = "";
    setName(initialAssetName(image));
    setCategoryIds(initialAssetCategoryIds(image));
  }, [image.id]);

  useEffect(() => {
    if (!isWorkImage(image)) return;
    if (initialAssetName(image)) return;
    const requestKey = image.id;
    if (!requestKey || nameSuggestionRequestRef.current === requestKey) return;
    nameSuggestionRequestRef.current = requestKey;
    let cancelled = false;
    setNameSuggestionPending(true);
    api.suggestImageCaseFields(image.id)
      .then((result) => {
        if (cancelled) return;
        if (!nameTouchedRef.current) setName(initialAssetName(result.image));
        queryClient.invalidateQueries({ queryKey: ["images"] });
        if (result.image.sessionId) queryClient.invalidateQueries({ queryKey: ["messages", result.image.sessionId] });
      })
      .catch(() => {
        if (!cancelled) nameSuggestionRequestRef.current = "";
      })
      .finally(() => {
        if (!cancelled) setNameSuggestionPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [image, queryClient]);

  useEffect(() => {
    if (!isWorkImage(image)) return;
    if (initialAssetCategoryIds(image).length > 0) return;
    const requestKey = image.id;
    if (!requestKey || categorySuggestionRequestRef.current === requestKey) return;
    categorySuggestionRequestRef.current = requestKey;
    let cancelled = false;
    setCategorySuggestionPending(true);
    api.suggestImageAssetCategories(image.id)
      .then((result) => {
        if (cancelled) return;
        if (!categoryTouchedRef.current) {
          setCategoryIds(initialAssetCategoryIds(result.image));
        }
        setName((value) => value.trim() ? value : initialAssetName(result.image));
        queryClient.invalidateQueries({ queryKey: ["images"] });
        if (result.image.sessionId) queryClient.invalidateQueries({ queryKey: ["messages", result.image.sessionId] });
      })
      .catch(() => {
        if (!cancelled) categorySuggestionRequestRef.current = "";
      })
      .finally(() => {
        if (!cancelled) setCategorySuggestionPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [image, queryClient]);

  useEffect(() => {
    if (categories.length === 0) return;
    const selectableIds = new Set(categories.map((category) => category.id));
    setCategoryIds((value) => {
      const filtered = value.filter((categoryId) => selectableIds.has(categoryId));
      return filtered.length === value.length ? value : filtered;
    });
  }, [categories]);

  const submit = () => {
    if (pending || fieldSuggestionPending) return;
    const nextName = name.trim();
    onAdd({
      ...(nextName ? { name: nextName } : {}),
      spaceMode,
      categoryIds
    });
  };

  return (
    <div className="modal-backdrop">
      <section className="case-modal compact-modal asset-from-image-modal">
        <header>
          <h3>{t("pages.cases.addToAssets")}</h3>
          <button onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </header>
        <div className="asset-from-image-preview">
          <img src={image.previewUrl || image.url} alt={image.prompt} />
          <div>
            <strong>{image.prompt || t("pages.images.generatedImage")}</strong>
            {imageMetaLabels.length > 0 ? <span>{imageMetaLabels.join(" / ")}</span> : null}
          </div>
        </div>
        <label>
          {t("pages.assets.tagsLabel")}
          <CaseCategoryMultiSelect
            categories={categories}
            value={categoryIds}
            onChange={(nextCategoryIds) => {
              categoryTouchedRef.current = true;
              setCategoryIds(nextCategoryIds);
            }}
            labelName={t("pages.assets.tag")}
            placeholder={categorySuggestionPending ? t("pages.assets.generatingTags") : t("pages.assets.noTag")}
            pendingSelectionLabel={t("pages.assets.generatedTagCount", { count: categoryIds.length })}
          />
        </label>
        <label>
          {t("pages.assets.name")}
          <input
            value={name}
            onChange={(event) => {
              nameTouchedRef.current = true;
              setName(event.target.value);
            }}
            placeholder={nameSuggestionPending ? t("pages.assets.generatingName") : t("pages.assets.namePlaceholder")}
          />
        </label>
        <label className="asset-upload-field">
          {t("pages.assets.saveLocation")}
          <div className="asset-space-options" role="radiogroup" aria-label={t("pages.assets.saveLocation")}>
            {uploadModeOptions.map((option) => {
              const selected = option.value === spaceMode;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={cx("asset-space-option-rich", selected && "active")}
                  onClick={() => setSpaceMode(option.value)}
                >
                  <span className="asset-option-check">{selected ? <Check size={14} /> : null}</span>
                  <span className="asset-space-option-copy">
                    <span className="asset-space-option-label">{option.label}</span>
                    <span className="asset-space-option-desc">{option.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </label>
        {error ? <div className="form-error">{error.message}</div> : null}
        <div className="row-actions">
          <button className="secondary-btn" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="primary-btn" type="button" onClick={submit} disabled={pending || fieldSuggestionPending}>
            {pending ? t("common.adding") : fieldSuggestionPending ? t("common.generatingFields") : t("pages.cases.addToAssets")}
          </button>
        </div>
      </section>
    </div>
  );
}
