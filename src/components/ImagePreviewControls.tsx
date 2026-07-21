import { useEffect, useRef } from "react";
import type {
  CSSProperties,
  MouseEventHandler,
  PointerEventHandler,
  ReactEventHandler,
  ReactNode,
  RefObject,
  WheelEventHandler
} from "react";
import { ChevronLeft, ChevronRight, Download, Maximize2, RefreshCw, RotateCcw, RotateCw, ZoomIn, ZoomOut, X } from "lucide-react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import type { CaseGroupImage, ImageReferenceItem } from "../types";
import type { ImagePreviewItem } from "./ImagePreviewModal";

export type PreviewNavigatorMetrics = {
  scale: number;
  imageWidth: number;
  imageHeight: number;
  rectLeft: number;
  rectTop: number;
  rectWidth: number;
  rectHeight: number;
};

type ImagePreviewStageProps = {
  canNext: boolean;
  canPan: boolean;
  canPrev: boolean;
  imageSrc: string;
  imageSize: { width: number; height: number } | null;
  imageStyle: CSSProperties;
  imagePixelSnapped: boolean;
  item: ImagePreviewItem;
  navigatorMetrics: PreviewNavigatorMetrics | null;
  previewDragging: boolean;
  previewUsesHandCursor: boolean;
  previewRotation: number;
  showNavigator: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  onImageLoad: ReactEventHandler<HTMLImageElement>;
  onClick: MouseEventHandler<HTMLDivElement>;
  onNavigatorPointerCancel: PointerEventHandler<HTMLDivElement>;
  onNavigatorPointerDown: PointerEventHandler<HTMLDivElement>;
  onNavigatorPointerMove: PointerEventHandler<HTMLDivElement>;
  onNavigatorPointerUp: PointerEventHandler<HTMLDivElement>;
  onNext: () => void;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPrev: () => void;
  onWheel: WheelEventHandler<HTMLDivElement>;
};

export function ImagePreviewStage({
  canNext,
  canPan,
  canPrev,
  imageSrc,
  imageSize,
  imageStyle,
  imagePixelSnapped,
  item,
  navigatorMetrics,
  previewDragging,
  previewUsesHandCursor,
  previewRotation,
  showNavigator,
  stageRef,
  onImageLoad,
  onClick,
  onNavigatorPointerCancel,
  onNavigatorPointerDown,
  onNavigatorPointerMove,
  onNavigatorPointerUp,
  onNext,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPrev,
  onWheel
}: ImagePreviewStageProps) {
  const { t } = useI18n();
  return (
    <div
      className={cx("case-preview-stage", showNavigator && "has-navigator", canPan && "is-pannable", previewUsesHandCursor && "is-zoomed", previewDragging && "is-dragging")}
      ref={stageRef}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
    >
      <button
        className="case-preview-nav prev"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onPrev();
        }}
        disabled={!canPrev}
        aria-label={t("imagePreview.previous")}
      >
        <ChevronLeft size={24} />
      </button>
      <img
        key={imageSrc}
        className={cx("case-preview-image", imagePixelSnapped && "is-pixel-snapped")}
        src={imageSrc}
        alt={item.title}
        draggable={false}
        style={{
          width: imageSize?.width,
          height: imageSize?.height,
          ...imageStyle
        }}
        onLoad={onImageLoad}
      />
      {showNavigator && navigatorMetrics && imageSize ? (
        <div className={cx("case-preview-navigator", canPan && "is-active")} aria-label={t("imagePreview.longNavigator")}>
          <div
            className="case-preview-navigator-track"
            style={{
              width: navigatorMetrics.imageWidth,
              height: navigatorMetrics.imageHeight
            }}
            onPointerDown={onNavigatorPointerDown}
            onPointerMove={onNavigatorPointerMove}
            onPointerUp={onNavigatorPointerUp}
            onPointerCancel={onNavigatorPointerCancel}
          >
            <img
              src={item.thumbnailUrl ?? item.previewUrl ?? item.imageUrl}
              alt=""
              draggable={false}
              style={{
                width: imageSize.width * navigatorMetrics.scale,
                height: imageSize.height * navigatorMetrics.scale,
                transform: `translate(-50%, -50%) rotate(${previewRotation}deg)`
              }}
            />
            <span
              className="case-preview-navigator-window"
              style={{
                left: navigatorMetrics.rectLeft,
                top: navigatorMetrics.rectTop,
                width: navigatorMetrics.rectWidth,
                height: navigatorMetrics.rectHeight
              }}
            />
          </div>
        </div>
      ) : null}
      <button
        className="case-preview-nav next"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onNext();
        }}
        disabled={!canNext}
        aria-label={t("imagePreview.next")}
      >
        <ChevronRight size={24} />
      </button>
    </div>
  );
}

type ImagePreviewToolbarProps = {
  actions: ReactNode;
  activeGroupImageIndex: number;
  fileSizeLabel: string;
  groupImages: CaseGroupImage[];
  index: number;
  item: ImagePreviewItem;
  itemCount: number;
  referenceImages: ImageReferenceItem[];
  sizeLabel: string;
  zoomLabel: string;
  onCopyDescription: () => void;
  onGroupImageSelect: (index: number) => void;
  onOriginalSize: () => void;
  onReferencePreview: (reference: ImageReferenceItem) => void;
  onReset: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  toolbarRef?: RefObject<HTMLDivElement | null>;
};

export function ImagePreviewItemThumbnails({
  items,
  index,
  onItemSelect
}: {
  items: ImagePreviewItem[];
  index: number;
  onItemSelect: (index: number) => void;
}) {
  const { t } = useI18n();
  const activeThumbnailRef = useRef<HTMLButtonElement | null>(null);
  const activeItemId = items[index]?.id;

  useEffect(() => {
    activeThumbnailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeItemId, index]);

  return (
    <div className="case-preview-item-thumbs" aria-label={t("imageLightbox.thumbnails")}>
      {items.map((thumbnailItem, itemIndex) => (
        <button
          key={`${thumbnailItem.id}-${itemIndex}`}
          ref={itemIndex === index ? activeThumbnailRef : undefined}
          type="button"
          className={cx(itemIndex === index && "active")}
          onClick={() => onItemSelect(itemIndex)}
          aria-label={t("imageLightbox.viewNth", { index: itemIndex + 1 })}
          aria-pressed={itemIndex === index}
          title={thumbnailItem.title}
        >
          <img src={thumbnailItem.thumbnailUrl ?? thumbnailItem.previewUrl ?? thumbnailItem.imageUrl} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  );
}

export function ImagePreviewToolbar({
  actions,
  activeGroupImageIndex,
  fileSizeLabel,
  groupImages,
  index,
  item,
  itemCount,
  referenceImages,
  sizeLabel,
  zoomLabel,
  onCopyDescription,
  onGroupImageSelect,
  onOriginalSize,
  onReferencePreview,
  onReset,
  onRotateLeft,
  onRotateRight,
  onZoomIn,
  onZoomOut,
  toolbarRef
}: ImagePreviewToolbarProps) {
  const { t } = useI18n();
  return (
    <div className="case-preview-bottom">
      {groupImages.length > 1 ? (
        <div className="case-preview-group-thumbs" aria-label={t("imagePreview.groupThumbnails")}>
          <span className="case-preview-reference-label">{t("imagePreview.group")}</span>
          <div className="case-preview-group-thumb-list">
            {groupImages.map((image, imageIndex) => (
              <button
                key={image.id}
                type="button"
                className={cx(imageIndex === activeGroupImageIndex && "active")}
                onClick={() => onGroupImageSelect(imageIndex)}
                aria-label={t("imagePreview.viewGroupNth", { index: imageIndex + 1 })}
                aria-pressed={imageIndex === activeGroupImageIndex}
              >
                <img src={image.imageThumbnailUrl ?? image.imagePreviewUrl ?? image.imageUrl} alt="" loading="lazy" />
                {image.isCover ? <span className="case-preview-cover-dot">{t("pages.cases.cover")}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="case-preview-toolbar" ref={toolbarRef}>
        <div className="case-preview-info">
          <h3>{item.title}</h3>
          {item.description ? (
            <button
              className="case-preview-description"
              type="button"
              onClick={onCopyDescription}
              aria-label={t("imagePreview.copyFullText")}
              title={t("imagePreview.copyText")}
            >
              <span className="case-preview-description-text">{item.description}</span>
              <span className="case-preview-description-popover" role="tooltip">
                {item.description}
              </span>
            </button>
          ) : null}
          <span className="case-preview-info-meta">
            <span>{index + 1} / {itemCount}</span>
            {item.metaItems?.map((metaItem) => (
              <span key={metaItem}>{metaItem}</span>
            ))}
            <span>{t("imagePreview.size", { size: sizeLabel })}</span>
            {fileSizeLabel ? <span>{fileSizeLabel}</span> : null}
            {item.sourceUsername ? <span>{t("imagePreview.author", { author: item.sourceUsername })}</span> : null}
            {typeof item.useCount === "number" ? <span>{t("imagePreview.useCount", { count: item.useCount })}</span> : null}
            {typeof item.favoriteCount === "number" ? <span>{t("imagePreview.favoriteCount", { count: item.favoriteCount })}</span> : null}
          </span>
        </div>
        <div className="case-preview-divider" aria-hidden="true" />
        <div className="case-preview-controls">
          <div className="case-preview-control-row">
            <div className="case-preview-transform-tools" aria-label={t("imagePreview.tools")}>
              <button className="case-preview-tool" type="button" onClick={onRotateLeft} aria-label={t("imagePreview.rotateLeft")} title={t("imagePreview.rotateLeft")}>
                <RotateCcw size={16} />
              </button>
              <button className="case-preview-tool" type="button" onClick={onRotateRight} aria-label={t("imagePreview.rotateRight")} title={t("imagePreview.rotateRight")}>
                <RotateCw size={16} />
              </button>
              <button className="case-preview-tool" type="button" onClick={onZoomOut} aria-label={t("imagePreview.zoomOut")} title={t("imagePreview.zoomOut")}>
                <ZoomOut size={16} />
              </button>
              <span className="case-preview-zoom">{zoomLabel}</span>
              <button className="case-preview-tool" type="button" onClick={onZoomIn} aria-label={t("imagePreview.zoomIn")} title={t("imagePreview.zoomIn")}>
                <ZoomIn size={16} />
              </button>
              <button className="case-preview-tool text" type="button" onClick={onReset} aria-label={t("imagePreview.reset")} title={t("imagePreview.reset")}>
                <RefreshCw size={15} />
                {t("imagePreview.resetShort")}
              </button>
              <button className="case-preview-tool text" type="button" onClick={onOriginalSize} aria-label={t("imagePreview.originalSize")} title={t("imagePreview.originalSize")}>
                <Maximize2 size={15} />
                {t("imagePreview.originalSize")}
              </button>
            </div>
            {actions ? <div className="case-preview-actions">{actions}</div> : null}
            {referenceImages.length > 0 ? (
              <div className="case-preview-references" aria-label={t("imagePreview.referenceAssets")}>
                <span className="case-preview-reference-label">{t("imagePreview.referenceAssets")}</span>
                <div className="case-preview-reference-list">
                  {referenceImages.map((reference) => (
                    <div className="case-preview-reference-item" key={reference.id}>
                      <button
                        className="case-preview-reference-thumb"
                        type="button"
                        onClick={() => onReferencePreview(reference)}
                        aria-label={t("imagePreview.viewReference", { name: reference.name })}
                        title={reference.name}
                      >
                        <img src={reference.thumbnailUrl ?? reference.previewUrl ?? reference.url} alt={reference.name} loading="lazy" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

type ReferenceLightboxProps = {
  reference: ImageReferenceItem;
  onClose: () => void;
};

export function ReferenceLightbox({ reference, onClose }: ReferenceLightboxProps) {
  const { t } = useI18n();
  return (
    <div className="case-reference-lightbox" onMouseDown={onClose}>
      <button
        type="button"
        className="case-reference-lightbox-close"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onClose}
        aria-label={t("imagePreview.closeReference")}
      >
        <X size={20} />
      </button>
      <a
        className="case-reference-lightbox-download"
        href={reference.originalUrl ?? reference.url}
        download={reference.name}
        rel="noopener"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        aria-label={t("imagePreview.downloadReference")}
        title={t("imagePreview.downloadReference")}
      >
        <Download size={20} />
      </a>
      <div className="case-reference-lightbox-frame" onMouseDown={(event) => event.stopPropagation()}>
        <img src={reference.previewUrl ?? reference.url} alt={reference.name} />
        <span>{reference.name}</span>
      </div>
    </div>
  );
}
