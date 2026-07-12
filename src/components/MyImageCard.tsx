import { Brush, Check, FolderOpen, Heart, Lightbulb } from "lucide-react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import type { WorkImage } from "../types";
import { ImageDownloadMenu } from "./ImageDownloadMenu";
import { SkeletonImage } from "./SkeletonImage";

export function MyImageCard({
  image,
  compact = false,
  assetPending,
  deletePending,
  favoritePending,
  selectionMode = false,
  selected = false,
  selectionDisabled = false,
  onOpenEditor,
  onAddCase,
  onAddAsset,
  onDelete,
  onToggleFavorite,
  onToggleSelected
}: {
  image: WorkImage;
  compact?: boolean;
  assetPending: boolean;
  deletePending: boolean;
  favoritePending: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  selectionDisabled?: boolean;
  onOpenEditor: (image: WorkImage) => void;
  onAddCase: (image: WorkImage) => void;
  onAddAsset: (image: WorkImage) => void;
  onDelete: (image: WorkImage) => void;
  onToggleFavorite: (image: WorkImage) => void;
  onToggleSelected?: (image: WorkImage) => void;
}) {
  const { t } = useI18n();
  const thumbnailUrl = image.thumbnailUrl || image.previewUrl || image.url;
  return (
    <article className={cx("image-card", compact && "compact", selectionMode && "selection-mode", selected && "selected")}>
      <div className="image-card-frame">
        <button
          className="image-card-image-btn"
          type="button"
          onClick={() => selectionMode ? onToggleSelected?.(image) : onOpenEditor(image)}
          aria-label={selectionMode ? t("pages.images.batch.selectImage") : t("pages.images.editImage")}
          aria-pressed={selectionMode ? selected : undefined}
          title={selectionMode ? t("pages.images.batch.selectImage") : t("pages.images.editImage")}
          disabled={selectionMode && selectionDisabled}
        >
          <SkeletonImage src={thumbnailUrl} alt={image.prompt} />
        </button>
        {selectionMode ? (
          <button
            className={cx("image-card-select", selected && "selected")}
            type="button"
            onClick={() => onToggleSelected?.(image)}
            aria-label={selected ? t("pages.images.batch.unselectImage") : t("pages.images.batch.selectImage")}
            aria-pressed={selected}
            disabled={selectionDisabled}
          >
            {selected ? <Check size={16} strokeWidth={3} /> : null}
          </button>
        ) : <button
          className={cx("case-action-icon", "case-favorite-btn", image.favorited && "active")}
          type="button"
          onClick={() => onToggleFavorite(image)}
          aria-label={image.favorited ? t("pages.images.unfavoriteImage") : t("pages.images.favoriteImage")}
          aria-pressed={image.favorited}
          title={image.favorited ? t("pages.images.unfavoriteImage") : t("pages.images.favoriteImage")}
          disabled={favoritePending}
        >
          <Heart size={16} fill={image.favorited ? "currentColor" : "none"} />
        </button>}
        {!selectionMode ? <div className="case-card-actions image-card-actions">
          <button className="case-action-icon" type="button" onClick={() => onOpenEditor(image)} aria-label={t("pages.images.editImage")} title={t("pages.images.editImage")}>
            <Brush size={16} />
          </button>
          <button
            className="case-action-icon"
            type="button"
            onClick={() => onAddCase(image)}
            aria-label={t("pages.cases.addToInspiration")}
            title={t("pages.cases.addToInspiration")}
          >
            <Lightbulb size={16} />
          </button>
          <button
            className="case-action-icon"
            type="button"
            onClick={() => onAddAsset(image)}
            disabled={assetPending}
            aria-label={t("pages.cases.addToAssets")}
            title={t("pages.cases.addToAssets")}
          >
            <FolderOpen size={16} />
          </button>
          <ImageDownloadMenu source={{ type: "image", id: image.id }} className="case-action-icon" />
        </div> : null}
      </div>
    </article>
  );
}
