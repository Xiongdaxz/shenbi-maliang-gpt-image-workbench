import { cx } from "../lib/cx";
import { CheckerboardImage } from "./CheckerboardImage";

export type CaseModalPreviewImage = {
  id: string;
  url: string;
  previewUrl?: string;
  thumbnailUrl?: string;
};

type CaseModalImagePreviewProps = {
  images: CaseModalPreviewImage[];
  fallbackUrl: string;
  alt: string;
  activeImageId?: string;
  thumbStripLabel?: string;
  activeThumbLabel?: string;
  inactiveThumbLabel?: (index: number) => string;
  thumbTitle?: (image: CaseModalPreviewImage, index: number, active: boolean) => string;
  thumbAriaLabel?: (image: CaseModalPreviewImage, index: number, active: boolean) => string;
  onSelectImage?: (image: CaseModalPreviewImage, index: number) => void;
};

export function CaseModalImagePreview({
  images,
  fallbackUrl,
  alt,
  activeImageId,
  thumbStripLabel,
  activeThumbLabel = "封面",
  inactiveThumbLabel = (index) => String(index + 1),
  thumbTitle,
  thumbAriaLabel,
  onSelectImage
}: CaseModalImagePreviewProps) {
  const activeImage = images.find((image) => image.id === activeImageId) ?? images[0] ?? null;
  const showThumbs = images.length > 1 && Boolean(onSelectImage);

  return (
    <div className="case-modal-preview-pane">
      <div className={cx("case-modal-preview-frame", showThumbs && "has-thumbs")}>
        <CheckerboardImage src={activeImage?.previewUrl || activeImage?.url || fallbackUrl} alt={alt} />
        {showThumbs ? (
          <div className="case-preview-thumb-strip" aria-label={thumbStripLabel}>
            {images.map((image, index) => {
              const active = image.id === activeImage?.id;
              return (
                <button
                  key={image.id}
                  type="button"
                  className={cx(active && "active")}
                  onClick={() => onSelectImage?.(image, index)}
                  aria-label={thumbAriaLabel?.(image, index, active)}
                  aria-pressed={active}
                  title={thumbTitle?.(image, index, active)}
                >
                  <CheckerboardImage src={image.thumbnailUrl || image.previewUrl || image.url} alt="" />
                  <span>{active ? activeThumbLabel : inactiveThumbLabel(index)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
