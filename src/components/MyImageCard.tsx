import { Brush, FolderOpen, Heart, Lightbulb } from "lucide-react";
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
  const thumbnailUrl = image.thumbnailUrl || image.previewUrl || image.url;
  return (
    <article className={cx("image-card", compact && "compact")}>
      <div className="image-card-frame">
        <button className="image-card-image-btn" type="button" onClick={() => onOpenEditor(image)} aria-label="编辑图片" title="编辑图片">
          <SkeletonImage src={thumbnailUrl} alt={image.prompt} />
        </button>
        <button
          className={cx("case-action-icon", "case-favorite-btn", image.favorited && "active")}
          type="button"
          onClick={() => onToggleFavorite(image)}
          aria-label={image.favorited ? "取消收藏图片" : "收藏图片"}
          aria-pressed={image.favorited}
          title={image.favorited ? "取消收藏" : "收藏"}
          disabled={favoritePending}
        >
          <Heart size={16} fill={image.favorited ? "currentColor" : "none"} />
        </button>
        <div className="case-card-actions image-card-actions">
          <button className="case-action-icon" type="button" onClick={() => onOpenEditor(image)} aria-label="编辑图片" title="编辑图片">
            <Brush size={16} />
          </button>
          <button
            className="case-action-icon"
            type="button"
            onClick={() => onAddCase(image)}
            aria-label="加入灵感空间"
            title="加入灵感空间"
          >
            <Lightbulb size={16} />
          </button>
          <button
            className="case-action-icon"
            type="button"
            onClick={() => onAddAsset(image)}
            disabled={assetPending}
            aria-label="加入素材库"
            title="加入素材库"
          >
            <FolderOpen size={16} />
          </button>
          <ImageDownloadMenu source={{ type: "image", id: image.id }} className="case-action-icon" />
        </div>
      </div>
    </article>
  );
}
