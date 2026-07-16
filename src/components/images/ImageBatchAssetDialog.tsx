import { useState } from "react";
import { Check, Tags, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { ASSET_UPLOAD_MODE_OPTIONS, assetUploadModeI18nKey, type AssetUploadMode } from "../../lib/assets";
import { cx } from "../../lib/cx";
import type { WorkImage } from "../../types";
import { ModalPortal } from "../../ui";

export function ImageBatchAssetDialog({
  images,
  assetReviewEnabled,
  pending,
  error,
  onClose,
  onSubmit
}: {
  images: WorkImage[];
  assetReviewEnabled: boolean;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onSubmit: (payload: { spaceMode: AssetUploadMode }) => void;
}) {
  const { t } = useI18n();
  const [spaceMode, setSpaceMode] = useState<AssetUploadMode>("private");
  const uploadModeOptions = ASSET_UPLOAD_MODE_OPTIONS.map((option) => ({
    ...option,
    label: t(assetUploadModeI18nKey(option.value, "label", assetReviewEnabled)),
    description: t(assetUploadModeI18nKey(option.value, "description", assetReviewEnabled))
  }));

  return (
    <ModalPortal>
      <div className="modal-backdrop">
        <section className="case-modal compact-modal image-batch-dialog">
          <header>
            <h3>{t("pages.images.batch.assetTitle", { count: images.length })}</h3>
            <button type="button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>
          </header>
          <div className="image-batch-preview-strip">
            {images.slice(0, 8).map((image) => <img key={image.id} src={image.thumbnailUrl || image.previewUrl || image.url} alt="" />)}
            {images.length > 8 ? <span>+{images.length - 8}</span> : null}
          </div>
          <div className="image-batch-auto-field-hint">
            <Tags size={19} />
            <span>
              <strong>{t("pages.images.batch.assetAutoTags")}</strong>
              <small>{t("pages.images.batch.assetAutoTagsDesc")}</small>
            </span>
          </div>
          <label className="asset-upload-field">
            {t("pages.assets.saveLocation")}
            <div className="asset-space-options" role="radiogroup" aria-label={t("pages.assets.saveLocation")}>
              {uploadModeOptions.map((option) => {
                const selected = option.value === spaceMode;
                return (
                  <button key={option.value} type="button" role="radio" aria-checked={selected} className={cx("asset-space-option-rich", selected && "active")} onClick={() => setSpaceMode(option.value)}>
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
            <button className="secondary-btn" type="button" onClick={onClose} disabled={pending}>{t("common.cancel")}</button>
            <button className="primary-btn" type="button" onClick={() => onSubmit({ spaceMode })} disabled={pending}>
              {pending ? t("common.adding") : t("pages.images.batch.assetConfirm", { count: images.length })}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
