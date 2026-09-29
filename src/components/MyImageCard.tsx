import { useLayoutEffect, useRef, useState } from "react";
import { Brush, Check, Columns2, Heart, LoaderCircle } from "lucide-react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import type { WorkImage } from "../types";
import { ImageDownloadMenu } from "./ImageDownloadMenu";
import { SkeletonImage } from "./SkeletonImage";
import { MyImageMoreMenu } from "./images/MyImageMoreMenu";

export function MyImageCard({
  image,
  compact = false,
  loading = "lazy",
  fetchPriority = "auto",
  assetPending,
  deletePending,
  favoritePending,
  comparePending = false,
  compareDisabled = false,
  selectionMode = false,
  selected = false,
  selectionDisabled = false,
  onOpenEditor,
  onCompare,
  onAddCase,
  onAddAsset,
  onDelete,
  onToggleFavorite,
  onToggleSelected
}: {
  image: WorkImage;
  compact?: boolean;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  assetPending: boolean;
  deletePending: boolean;
  favoritePending: boolean;
  comparePending?: boolean;
  compareDisabled?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  selectionDisabled?: boolean;
  onOpenEditor: (image: WorkImage) => void;
  onCompare: (image: WorkImage) => void;
  onAddCase: (image: WorkImage) => void;
  onAddAsset: (image: WorkImage) => void;
  onDelete: (image: WorkImage) => void;
  onToggleFavorite: (image: WorkImage) => void;
  onToggleSelected?: (image: WorkImage) => void;
}) {
  const { t } = useI18n();
  const frame = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(compact);
  const compactActions = compact || narrow;
  useLayoutEffect(() => {
    if (compact || !frame.current) return;
    const element = frame.current;
    const update = () => { const width = element.clientWidth; if (width > 0) setNarrow(width < 176); };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, [compact]);
  const thumbnailUrl = image.thumbnailUrl || image.previewUrl || image.url;
  const downloadSource = { type: "image" as const, id: image.id,
    downloadBaseName: image.suggestedCaseTitle?.trim() || image.suggestedAssetName?.trim() || image.originPrompt?.trim() || image.prompt };
  return (
    <article className={cx("image-card", compact && "compact", selectionMode && "selection-mode", selected && "selected")}>
      <div ref={frame} className="image-card-frame">
        <button
          className="image-card-image-btn"
          type="button"
          onClick={() => selectionMode ? onToggleSelected?.(image) : onOpenEditor(image)}
          aria-label={selectionMode ? t("pages.images.batch.selectImage") : t("pages.images.editImage")}
          aria-pressed={selectionMode ? selected : undefined}
          title={selectionMode ? t("pages.images.batch.selectImage") : t("pages.images.editImage")}
          disabled={selectionMode && selectionDisabled}
        >
          <SkeletonImage
            src={thumbnailUrl}
            alt={image.prompt}
            loading={loading}
            fetchPriority={fetchPriority}
            detectTransparency
          />
        </button>
        {selectionMode ? (
          <button
            className={cx("image-card-select", selected && "selected")}
            type="button"
            onClick={() => onToggleSelected?.(image)}
            aria-label={selected ? t("pages.images.batch.unselectImage") : t("pages.images.batch.selectImage")}
            aria-pressed={selected}
            data-library-tooltip data-tooltip={selected ? t("pages.images.batch.unselectImage") : t("pages.images.batch.selectImage")}
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
          data-library-tooltip data-tooltip={image.favorited ? t("pages.images.unfavoriteImage") : t("pages.images.favoriteImage")}
          disabled={favoritePending}
        >
          <Heart size={16} fill={image.favorited ? "currentColor" : "none"} />
        </button>}
        {!selectionMode ? <div className={cx("case-card-actions image-card-actions", compactActions && "narrow-actions")}>
          <button className="case-action-icon" type="button" onClick={() => onOpenEditor(image)} aria-label={t("pages.images.editImage")} data-library-tooltip data-tooltip={t("pages.images.editImage")}>
            <Brush size={16} />
          </button>
          <button className="case-action-icon" type="button" onClick={() => onCompare(image)} disabled={compareDisabled}
            aria-label={t("compare.title")} data-library-tooltip data-tooltip={t(comparePending ? "common.loading" : "compare.title")} aria-busy={comparePending}>
            {comparePending ? <LoaderCircle size={16} className="animate-spin" /> : <Columns2 size={16} />}
          </button>
          <ImageDownloadMenu source={downloadSource} className="case-action-icon" libraryTooltip />
          <MyImageMoreMenu assetPending={assetPending}
            onAddCase={() => onAddCase(image)} onAddAsset={() => onAddAsset(image)} />
        </div> : null}
      </div>
    </article>
  );
}
