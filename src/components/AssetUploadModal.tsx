import { useEffect, useRef, useState } from "react";
import { Check, ImageIcon, X } from "lucide-react";
import { useI18n } from "../i18n";
import { ASSET_UPLOAD_MODE_OPTIONS, assetUploadModeI18nKey, type AssetUploadMode } from "../lib/assets";
import { cx } from "../lib/cx";
import { formatImageFileSize } from "../lib/format";
import { ModalPortal } from "../ui";
import type { CaseCategory } from "../types";
import { CaseCategoryMultiSelect } from "./CaseCategoryMultiSelect";
import { CheckerboardImage } from "./CheckerboardImage";

export function AssetUploadModal({
  categories,
  initialCategoryIds,
  assetReviewEnabled,
  pending,
  error,
  onClose,
  onUpload
}: {
  categories: CaseCategory[];
  initialCategoryIds: string[];
  assetReviewEnabled: boolean;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onUpload: (payload: { files: File[]; spaceMode: AssetUploadMode; categoryIds: string[] }) => void;
}) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previewItems, setPreviewItems] = useState<Array<{ file: File; url: string }>>([]);
  const [spaceMode, setSpaceMode] = useState<AssetUploadMode>("private");
  const [categoryIds, setCategoryIds] = useState<string[]>(initialCategoryIds);

  useEffect(() => {
    setCategoryIds(initialCategoryIds);
  }, [initialCategoryIds]);

  useEffect(() => {
    const items = files.map((item) => ({ file: item, url: URL.createObjectURL(item) }));
    setPreviewItems(items);
    return () => items.forEach((item) => URL.revokeObjectURL(item.url));
  }, [files]);

  const submit = () => {
    if (files.length === 0 || pending) return;
    onUpload({ files, spaceMode, categoryIds });
  };
  const uploadModeOptions = ASSET_UPLOAD_MODE_OPTIONS.map((option) => ({
    ...option,
    label: t(assetUploadModeI18nKey(option.value, "label", assetReviewEnabled)),
    description: t(assetUploadModeI18nKey(option.value, "description", assetReviewEnabled))
  }));

  return (
    <ModalPortal>
      <div className="modal-backdrop">
        <section className="case-modal compact-modal asset-upload-modal">
          <header>
            <h3>{t("pages.assets.upload")}</h3>
            <button onClick={onClose} aria-label={t("common.close")}>
              <X size={18} />
            </button>
          </header>
          <button className={cx("asset-file-card", files.length > 0 && "has-file")} type="button" onClick={() => fileInputRef.current?.click()}>
            {previewItems.length > 0 ? (
              <div className="asset-file-list">
                {previewItems.map(({ file: item, url }, index) => (
                  <div className="asset-file-row" key={`${item.name}-${item.size}-${item.lastModified}-${index}`}>
                    <CheckerboardImage src={url} alt={item.name} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{formatImageFileSize(item.size) || t("pages.assets.localImage")}</small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <ImageIcon size={32} />
                <span>
                  <strong>{t("pages.assets.chooseImages")}</strong>
                  <small>{t("pages.assets.chooseImagesDesc")}</small>
                </span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                setFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </button>
          <label className="asset-upload-field">
            {t("pages.assets.uploadLocation")}
            <div className="asset-space-options" role="radiogroup" aria-label={t("pages.assets.uploadLocation")}>
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
          <label>
            {t("pages.assets.tagsLabel")}
            <CaseCategoryMultiSelect categories={categories} value={categoryIds} onChange={setCategoryIds} labelName={t("pages.assets.tag")} />
          </label>
          {error ? <div className="form-error">{error.message}</div> : null}
          <div className="row-actions">
            <button className="secondary-btn" type="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button className="primary-btn" type="button" onClick={submit} disabled={files.length === 0 || pending}>
              {pending ? t("common.uploading") : t("pages.assets.upload")}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
