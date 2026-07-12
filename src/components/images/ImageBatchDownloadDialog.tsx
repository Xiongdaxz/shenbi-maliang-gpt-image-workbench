import { useMemo, useState, type CSSProperties } from "react";
import { Check, Download, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { cx } from "../../lib/cx";
import { formatImageFileSize } from "../../lib/format";
import type { ImageBatchDownloadVariant, WorkImage } from "../../types";
import { ModalPortal } from "../../ui";

const VARIANTS: ImageBatchDownloadVariant[] = ["original", "preview", "thumb"];

const DERIVATIVE_ESTIMATES: Record<Exclude<ImageBatchDownloadVariant, "original">, {
  maxSize: number;
  sourceRatio: number;
  minBytesPerPixel: number;
  maxBytesPerPixel: number;
}> = {
  preview: { maxSize: 1600, sourceRatio: 0.3, minBytesPerPixel: 0.18, maxBytesPerPixel: 0.75 },
  thumb: { maxSize: 512, sourceRatio: 0.24, minBytesPerPixel: 0.14, maxBytesPerPixel: 0.52 }
};

function estimateDerivativeSize(image: WorkImage, variant: Exclude<ImageBatchDownloadVariant, "original">) {
  const sourceBytes = Math.max(0, Number(image.imageFileSize) || 0);
  const width = Math.max(0, Number(image.imageWidth) || 0);
  const height = Math.max(0, Number(image.imageHeight) || 0);
  const config = DERIVATIVE_ESTIMATES[variant];
  if (sourceBytes <= 0) return 0;
  if (width <= 0 || height <= 0) return Math.round(sourceBytes * (variant === "preview" ? 0.35 : 0.12));

  const sourcePixels = width * height;
  const scale = Math.min(1, config.maxSize / Math.max(width, height));
  const targetPixels = sourcePixels * scale * scale;
  const estimatedBytesPerPixel = Math.min(
    config.maxBytesPerPixel,
    Math.max(config.minBytesPerPixel, (sourceBytes / sourcePixels) * config.sourceRatio)
  );
  return Math.round(Math.min(sourceBytes, targetPixels * estimatedBytesPerPixel));
}

function estimateVariantSize(images: WorkImage[], variant: ImageBatchDownloadVariant) {
  return images.reduce((total, image) => {
    if (variant === "original") return total + Math.max(0, Number(image.imageFileSize) || 0);
    return total + estimateDerivativeSize(image, variant);
  }, 0);
}

export function ImageBatchDownloadDialog({ images, pending, error, onClose, onSubmit }: {
  images: WorkImage[];
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onSubmit: (payload: { variant: ImageBatchDownloadVariant; includeManifest: boolean }) => void;
}) {
  const { t } = useI18n();
  const [variant, setVariant] = useState<ImageBatchDownloadVariant>("original");
  const [includeManifest, setIncludeManifest] = useState(true);
  const estimatedSizes = useMemo(() => Object.fromEntries(
    VARIANTS.map((item) => [item, estimateVariantSize(images, item)])
  ) as Record<ImageBatchDownloadVariant, number>, [images]);
  const selectedEstimatedSize = formatImageFileSize(estimatedSizes[variant]) || t("download.unknownSize");
  const variantSliderStyle = {
    "--image-batch-variant-offset": `${VARIANTS.indexOf(variant) * 100}%`
  } as CSSProperties;
  return (
    <ModalPortal>
      <div className="modal-backdrop">
        <section className="case-modal compact-modal image-batch-dialog">
          <header>
            <h3>{t("pages.images.batch.downloadTitle", { count: images.length })}</h3>
            <button type="button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>
          </header>
          <div className="image-batch-download-meta">
            <span className="image-batch-download-meta-icon" aria-hidden="true"><Download size={18} /></span>
            <span className="image-batch-download-meta-copy">
              <strong>{t("pages.images.batch.estimatedSize", { size: selectedEstimatedSize })}</strong>
              <small>{t("pages.images.batch.estimatedSizeNote")}</small>
            </span>
          </div>
          <label>
            {t("pages.images.batch.downloadVariant")}
            <div className="image-batch-option-grid" role="radiogroup" style={variantSliderStyle}>
              <span className="image-batch-option-slider" aria-hidden="true" />
              {VARIANTS.map((item) => {
                const label = t(`download.${item === "thumb" ? "thumbnail" : item}`);
                const size = formatImageFileSize(estimatedSizes[item]) || t("download.unknownSize");
                return (
                  <button
                    key={item}
                    type="button"
                    role="radio"
                    aria-checked={variant === item}
                    aria-label={`${label}，${t("pages.images.batch.variantEstimatedSize", { size })}`}
                    className={cx("image-batch-option", variant === item && "active")}
                    onClick={() => setVariant(item)}
                  >
                    <span className="image-batch-option-label">{label}</span>
                    <small>{t("pages.images.batch.variantEstimatedSize", { size })}</small>
                  </button>
                );
              })}
            </div>
          </label>
          <label className={cx("case-reference-toggle", includeManifest && "active")}>
            <input type="checkbox" checked={includeManifest} onChange={(event) => setIncludeManifest(event.target.checked)} />
            <span className="case-reference-toggle-check" aria-hidden="true">{includeManifest ? <Check size={13} /> : null}</span>
            <span className="case-reference-toggle-copy">
              <span>{t("pages.images.batch.includeManifest")}</span>
              <small>{t("pages.images.batch.includeManifestDesc")}</small>
            </span>
          </label>
          {error ? <div className="form-error">{error.message}</div> : null}
          <div className="row-actions">
            <button className="secondary-btn" type="button" onClick={onClose} disabled={pending}>{t("common.cancel")}</button>
            <button className="primary-btn" type="button" onClick={() => onSubmit({ variant, includeManifest })} disabled={pending}>
              {pending ? t("pages.images.batch.preparingDownload") : t("pages.images.batch.createZip")}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
