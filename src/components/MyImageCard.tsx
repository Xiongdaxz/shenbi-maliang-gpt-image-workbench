import { Brush, FolderOpen, Heart, Lightbulb } from "lucide-react";
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
  onOpenEditor,
  onAddCase,
  onAddAsset,
  onDelete,
  onToggleFavorite
}: {
  image: WorkImage;
  compact?: boolean;
  assetPending: boolean;
  deletePending: boolean;
  favoritePending: boolean;
  onOpenEditor: (image: WorkImage) => void;
  onAddCase: (image: WorkImage) => void;
  onAddAsset: (image: WorkImage) => void;
  onDelete: (image: WorkImage) => void;
  onToggleFavorite: (image: WorkImage) => void;
}) {
  const { t } = useI18n();
  const thumbnailUrl = image.thumbnailUrl || image.previewUrl || image.url;
  return (
    <article className={cx("image-card", compact && "compact")}>
      <div className="image-card-frame">
        <button className="image-card-image-btn" type="button" onClick={() => onOpenEditor(image)} aria-label={t("pages.images.editImage")} title={t("pages.images.editImage")}>
          <SkeletonImage src={thumbnailUrl} alt={image.prompt} />
        </button>
        <button
          className={cx("case-action-icon", "case-favorite-btn", image.favorited && "active")}
          type="button"
          onClick={() => onToggleFavorite(image)}
          aria-label={image.favorited ? t("pages.images.unfavoriteImage") : t("pages.images.favoriteImage")}
          aria-pressed={image.favorited}
          title={image.favorited ? t("pages.images.unfavoriteImage") : t("pages.images.favoriteImage")}
          disabled={favoritePending}
        >
          <Heart size={16} fill={image.favorited ? "currentColor" : "none"} />
        </button>
        <div className="case-card-actions image-card-actions">
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
        </div>
      </div>
    </article>
  );
}
