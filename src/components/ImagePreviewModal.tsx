import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  ImagePreviewStage,
  ImagePreviewToolbar,
  ReferenceLightbox
} from "./ImagePreviewControls";
import { useI18n } from "../i18n";
import { copyTextToClipboard } from "../lib/clipboard";
import { formatImageFileSize } from "../lib/format";
import type { CaseGroupImage, ImagePreviewOpenMode, ImagePreviewWheelMode, ImageReferenceItem } from "../types";
import { useToast } from "../ui";

export type ImagePreviewItem = {
  id: string;
  title: string;
  description?: string;
  imageUrl: string;
  originalUrl?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageFileSize?: number;
  downloadSourceType?: "image" | "asset" | null;
  downloadSourceId?: string | null;
  useCount?: number;
  favoriteCount?: number;
  favorited?: boolean;
  sourceUsername?: string;
  metaItems?: string[];
  referenceImages?: ImageReferenceItem[];
  groupImages?: CaseGroupImage[];
  activeGroupImage?: CaseGroupImage;
  isActiveGroupImageCover?: boolean;
};

type ImagePreviewModalProps<TItem extends ImagePreviewItem> = {
  items: TItem[];
  index: number;
  ariaLabel: string;
  initialZoomMode?: ImagePreviewOpenMode;
  wheelMode?: ImagePreviewWheelMode;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  renderActions?: (item: TItem) => ReactNode;
};

const PREVIEW_MIN_ZOOM = 0.1;
const PREVIEW_MAX_ZOOM = 3;
const PREVIEW_CONTAIN_INSET = 12;
const PREVIEW_WHEEL_LINE_PX = 16;

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function previewWheelDelta(delta: number, deltaMode: number, pageSize: number) {
  const unit = deltaMode === 1 ? PREVIEW_WHEEL_LINE_PX : deltaMode === 2 ? Math.max(1, pageSize) : 1;
  return delta * unit;
}

function buildPreviewPanAxisBounds(contentSize: number, stageSize: number, visibleSize: number) {
  if (contentSize <= 0 || stageSize <= 0) return { min: 0, max: 0 };
  const safeVisibleSize = clampNumber(visibleSize > 0 ? visibleSize : stageSize, 0, stageSize);
  if (safeVisibleSize <= 0) return { min: 0, max: 0 };
  const alignStartPan = contentSize / 2 - stageSize / 2;
  const alignEndPan = safeVisibleSize - stageSize / 2 - contentSize / 2;
  return {
    min: Math.min(alignStartPan, alignEndPan),
    max: Math.max(alignStartPan, alignEndPan)
  };
}

function buildPreviewCenterPan(stageSize: number, visibleSize: number, bounds: { min: number; max: number }) {
  const safeVisibleSize = clampNumber(visibleSize > 0 ? visibleSize : stageSize, 0, stageSize);
  return clampNumber(safeVisibleSize / 2 - stageSize / 2, bounds.min, bounds.max);
}

function buildPreviewStartPan(contentSize: number, stageSize: number, visibleSize: number) {
  const bounds = buildPreviewPanAxisBounds(contentSize, stageSize, visibleSize);
  const safeVisibleSize = clampNumber(visibleSize > 0 ? visibleSize : stageSize, 0, stageSize);
  const startPan = contentSize > safeVisibleSize ? contentSize / 2 - stageSize / 2 : 0;
  return clampNumber(startPan, bounds.min, bounds.max);
}

export function ImagePreviewModal<TItem extends ImagePreviewItem>({
  items,
  index,
  ariaLabel,
  initialZoomMode = "contain",
  wheelMode = "zoom",
  onIndexChange,
  onClose,
  renderActions
}: ImagePreviewModalProps<TItem>) {
  const { showToast } = useToast();
  const { t } = useI18n();
  const previewItem = items[index] ?? null;
  const [previewGroupImageIndex, setPreviewGroupImageIndex] = useState(0);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [previewImageSize, setPreviewImageSize] = useState<{ width: number; height: number } | null>(null);
  const [previewStageSize, setPreviewStageSize] = useState<{ width: number; height: number } | null>(null);
  const [previewToolbarHeight, setPreviewToolbarHeight] = useState(0);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [previewDragging, setPreviewDragging] = useState(false);
  const defaultPreviewImageSource = initialZoomMode === "actual" ? "original" : "preview";
  const [previewImageSource, setPreviewImageSource] = useState<"preview" | "original">(defaultPreviewImageSource);
  const [previewLoadedSrc, setPreviewLoadedSrc] = useState("");
  const [referencePreview, setReferencePreview] = useState<ImageReferenceItem | null>(null);
  const previewModalRef = useRef<HTMLElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const previewToolbarRef = useRef<HTMLDivElement | null>(null);
  const previewDragRef = useRef<{ pointerId: number; startX: number; startY: number; startPan: { x: number; y: number }; moved: boolean } | null>(null);
  const previewNavigatorDragRef = useRef<number | null>(null);
  const previewUserAdjustedRef = useRef(false);
  const pendingOriginalPanRef = useRef(false);
  const previewGroupImages = previewItem?.groupImages ?? [];
  const normalizedGroupImageIndex = Math.max(0, Math.min(previewGroupImageIndex, Math.max(0, previewGroupImages.length - 1)));
  const activeGroupImage = previewGroupImages.length > 1 ? previewGroupImages[normalizedGroupImageIndex] ?? previewGroupImages[0] : null;
  const activeGroupImageId = activeGroupImage?.id ?? "";
  const previewDisplayItem = activeGroupImage && previewItem
    ? {
        ...previewItem,
        imageUrl: activeGroupImage.imageUrl,
        originalUrl: activeGroupImage.imageOriginalUrl ?? activeGroupImage.imageUrl,
        previewUrl: activeGroupImage.imagePreviewUrl ?? activeGroupImage.imageUrl,
        thumbnailUrl: activeGroupImage.imageThumbnailUrl ?? activeGroupImage.imagePreviewUrl ?? activeGroupImage.imageUrl,
        imageWidth: activeGroupImage.imageWidth,
        imageHeight: activeGroupImage.imageHeight,
        imageFileSize: activeGroupImage.imageFileSize,
        downloadSourceType: activeGroupImage.downloadSourceType,
        downloadSourceId: activeGroupImage.downloadSourceId,
        referenceImages: activeGroupImage.referenceImages ?? [],
        activeGroupImage,
        isActiveGroupImageCover: activeGroupImage.isCover
      } as TItem
    : previewItem;
  const hasPreviewPrev = items.length > 1;
  const hasPreviewNext = items.length > 1;
  const previewSizeLabel = previewImageSize ? `${previewImageSize.width} x ${previewImageSize.height}` : "--";
  const previewFileSizeLabel = formatImageFileSize(previewDisplayItem?.imageFileSize);
  const referenceImages = previewDisplayItem?.referenceImages ?? [];
  const previewObscuredHeight = !previewDragging ? previewToolbarHeight : 0;
  const previewZoomLabel = `${Math.round(previewZoom * 100)}%`;
  const previewImageSrc =
    previewImageSource === "original"
      ? previewDisplayItem?.originalUrl ?? previewDisplayItem?.imageUrl ?? ""
      : previewDisplayItem?.previewUrl ?? previewDisplayItem?.imageUrl ?? "";
  const normalizedPreviewRotation = ((previewRotation % 360) + 360) % 360;
  const isPreviewRotatedSideways = normalizedPreviewRotation === 90 || normalizedPreviewRotation === 270;
  const previewScale = previewZoom;
  const previewContentSize = previewImageSize
    ? {
        width: isPreviewRotatedSideways ? previewImageSize.height : previewImageSize.width,
        height: isPreviewRotatedSideways ? previewImageSize.width : previewImageSize.height
      }
    : null;
  const previewDisplaySize = previewContentSize
    ? {
        width: previewContentSize.width * previewScale,
        height: previewContentSize.height * previewScale
      }
    : null;
  const previewVisibleStageSize = previewStageSize
    ? {
        width: previewStageSize.width,
        height: Math.max(0, previewStageSize.height - previewObscuredHeight)
      }
    : null;
  const previewPanBounds =
    previewDisplaySize && previewStageSize && previewVisibleStageSize
      ? {
          x: buildPreviewPanAxisBounds(previewDisplaySize.width, previewStageSize.width, previewVisibleStageSize.width),
          y: buildPreviewPanAxisBounds(previewDisplaySize.height, previewStageSize.height, previewVisibleStageSize.height)
        }
      : { x: { min: 0, max: 0 }, y: { min: 0, max: 0 } };
  const previewDefaultZoom =
    initialZoomMode === "contain" && previewContentSize && previewStageSize
      ? clampNumber(
          Math.min(
            1,
            Math.max(1, previewStageSize.width - PREVIEW_CONTAIN_INSET) / previewContentSize.width,
            Math.max(1, (previewVisibleStageSize?.height ?? previewStageSize.height) - PREVIEW_CONTAIN_INSET) / previewContentSize.height
          ),
          PREVIEW_MIN_ZOOM,
          PREVIEW_MAX_ZOOM
        )
      : 1;
  const previewDefaultDisplaySize = previewContentSize
    ? {
        width: previewContentSize.width * previewDefaultZoom,
        height: previewContentSize.height * previewDefaultZoom
      }
    : null;
  const previewDefaultPanBounds =
    previewDefaultDisplaySize && previewStageSize && previewVisibleStageSize
      ? {
          x: buildPreviewPanAxisBounds(previewDefaultDisplaySize.width, previewStageSize.width, previewVisibleStageSize.width),
          y: buildPreviewPanAxisBounds(previewDefaultDisplaySize.height, previewStageSize.height, previewVisibleStageSize.height)
        }
      : { x: { min: 0, max: 0 }, y: { min: 0, max: 0 } };
  const previewDefaultPan =
    previewDefaultDisplaySize && previewStageSize && previewVisibleStageSize
      ? {
          x: buildPreviewCenterPan(previewStageSize.width, previewVisibleStageSize.width, previewDefaultPanBounds.x),
          y: initialZoomMode === "contain"
            ? buildPreviewCenterPan(previewStageSize.height, previewVisibleStageSize.height, previewDefaultPanBounds.y)
            : buildPreviewStartPan(previewDefaultDisplaySize.height, previewStageSize.height, previewVisibleStageSize.height)
        }
      : { x: 0, y: 0 };
  const canPreviewPan = Boolean(
    previewDisplaySize &&
      previewVisibleStageSize &&
      (previewDisplaySize.width > previewVisibleStageSize.width + 1 || previewDisplaySize.height > previewVisibleStageSize.height + 1)
  );
  const previewUsesHandCursor = previewImageSource === "original" || Math.abs(previewZoom - previewDefaultZoom) > 0.001;
  const showPreviewNavigator = Boolean(previewImageSize && previewStageSize && previewDisplaySize && canPreviewPan);
  const previewImagePosition =
    previewImageSize && previewDisplaySize && previewStageSize
      ? (() => {
          const rawLeft = previewStageSize.width / 2 + previewPan.x - previewImageSize.width / 2;
          const rawTop = previewStageSize.height / 2 + previewPan.y - previewImageSize.height / 2;
          const pixelSnapped = normalizedPreviewRotation === 0 && previewScale === 1;
          const left = pixelSnapped ? Math.round(rawLeft) : rawLeft;
          const top = pixelSnapped ? Math.round(rawTop) : rawTop;
          const centerX = left + previewImageSize.width / 2;
          const centerY = top + previewImageSize.height / 2;
          return {
            left,
            top,
            displayLeft: centerX - previewDisplaySize.width / 2,
            displayTop: centerY - previewDisplaySize.height / 2,
            pixelSnapped
          };
        })()
      : null;
  const previewImageStyle = previewImagePosition
    ? {
        left: previewImagePosition.left,
        top: previewImagePosition.top,
        transform: previewImagePosition.pixelSnapped ? "none" : `rotate(${previewRotation}deg) scale(${previewScale})`
      }
    : {
        transform: `translate(-50%, -50%) translate(${previewPan.x}px, ${previewPan.y}px) rotate(${previewRotation}deg) scale(${previewScale})`
      };
  const previewNavigatorMetrics =
    showPreviewNavigator && previewContentSize && previewDisplaySize && previewStageSize && previewVisibleStageSize
      ? (() => {
          const maxWidth = 88;
          const maxHeight = 148;
          const scale = Math.min(maxWidth / previewContentSize.width, maxHeight / previewContentSize.height);
          const imageWidth = previewContentSize.width * scale;
          const imageHeight = previewContentSize.height * scale;
          const imageLeft = previewImagePosition?.displayLeft ?? (previewStageSize.width - previewDisplaySize.width) / 2 + previewPan.x;
          const imageTop = previewImagePosition?.displayTop ?? (previewStageSize.height - previewDisplaySize.height) / 2 + previewPan.y;
          const visibleLeft = clampNumber(-imageLeft, 0, previewDisplaySize.width);
          const visibleTop = clampNumber(-imageTop, 0, previewDisplaySize.height);
          const visibleRight = clampNumber(previewVisibleStageSize.width - imageLeft, 0, previewDisplaySize.width);
          const visibleBottom = clampNumber(previewVisibleStageSize.height - imageTop, 0, previewDisplaySize.height);
          const rectMinSize = 14;
          const rawRectWidth = Math.max(rectMinSize, ((visibleRight - visibleLeft) / previewDisplaySize.width) * imageWidth);
          const rawRectHeight = Math.max(rectMinSize, ((visibleBottom - visibleTop) / previewDisplaySize.height) * imageHeight);
          const rectWidth = Math.min(imageWidth, rawRectWidth);
          const rectHeight = Math.min(imageHeight, rawRectHeight);
          return {
            scale,
            imageWidth,
            imageHeight,
            rectLeft: clampNumber((visibleLeft / previewDisplaySize.width) * imageWidth, 0, Math.max(0, imageWidth - rectWidth)),
            rectTop: clampNumber((visibleTop / previewDisplaySize.height) * imageHeight, 0, Math.max(0, imageHeight - rectHeight)),
            rectWidth,
            rectHeight
          };
        })()
      : null;
  const actions = previewDisplayItem ? renderActions?.(previewDisplayItem) : null;

  const copyPreviewDescription = async () => {
    const description = previewDisplayItem?.description?.trim();
    if (!description) return;
    const copied = await copyTextToClipboard(description);
    showToast(copied ? t("imagePreview.copySuccess") : t("imagePreview.copyFailed"), copied ? "success" : "error");
  };

  const clampPreviewPan = (pan: { x: number; y: number }) => ({
    x: clampNumber(pan.x, previewPanBounds.x.min, previewPanBounds.x.max),
    y: clampNumber(pan.y, previewPanBounds.y.min, previewPanBounds.y.max)
  });

  const getPreviewHorizontalCenterPanForZoom = (zoom: number) =>
    previewContentSize && previewStageSize && previewVisibleStageSize
      ? buildPreviewCenterPan(
          previewStageSize.width,
          previewVisibleStageSize.width,
          buildPreviewPanAxisBounds(previewContentSize.width * zoom, previewStageSize.width, previewVisibleStageSize.width)
        )
      : 0;

  const getPreviewStartPanWithCenteredXForZoom = (zoom: number) =>
    previewContentSize && previewStageSize && previewVisibleStageSize
      ? {
          x: getPreviewHorizontalCenterPanForZoom(zoom),
          y: buildPreviewStartPan(previewContentSize.height * zoom, previewStageSize.height, previewVisibleStageSize.height)
        }
      : { x: 0, y: 0 };

  const resetPreviewTransform = (applyStartPan = true) => {
    previewUserAdjustedRef.current = false;
    pendingOriginalPanRef.current = initialZoomMode === "actual";
    setPreviewImageSource(defaultPreviewImageSource);
    setPreviewLoadedSrc("");
    setPreviewZoom(previewDefaultZoom);
    setPreviewRotation(0);
    setPreviewPan(applyStartPan ? previewDefaultPan : { x: 0, y: 0 });
    setPreviewDragging(false);
    previewDragRef.current = null;
    previewNavigatorDragRef.current = null;
  };

  const showPreviewOriginalSize = () => {
    previewUserAdjustedRef.current = true;
    pendingOriginalPanRef.current = true;
    setPreviewLoadedSrc("");
    setPreviewImageSource("original");
    setPreviewZoom(1);
    setPreviewPan(getPreviewStartPanWithCenteredXForZoom(1));
    setPreviewDragging(false);
    previewDragRef.current = null;
    previewNavigatorDragRef.current = null;
  };

  const adjustPreviewZoom = (delta: number) => {
    previewUserAdjustedRef.current = true;
    setPreviewZoom((value) => {
      const nextZoom = Number((value + delta).toFixed(2));
      return previewImageSource === "original"
        ? Math.max(PREVIEW_MIN_ZOOM, nextZoom)
        : clampNumber(nextZoom, PREVIEW_MIN_ZOOM, PREVIEW_MAX_ZOOM);
    });
  };

  const handlePreviewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (wheelMode === "zoom" || event.ctrlKey || event.metaKey) {
      const zoomDelta = event.deltaY || event.deltaX;
      if (!zoomDelta) return;
      adjustPreviewZoom((zoomDelta < 0 ? 1 : -1) * 0.1);
      return;
    }
    if (!canPreviewPan || !previewStageSize) return;

    let deltaX = previewWheelDelta(event.deltaX, event.deltaMode, previewStageSize.width);
    let deltaY = previewWheelDelta(event.deltaY, event.deltaMode, previewVisibleStageSize?.height ?? previewStageSize.height);
    const canPanX = previewPanBounds.x.max - previewPanBounds.x.min > 1;
    const canPanY = previewPanBounds.y.max - previewPanBounds.y.min > 1;

    if (event.shiftKey && Math.abs(deltaY) > Math.abs(deltaX)) {
      deltaX = deltaY;
      deltaY = 0;
    }
    if (!canPanX) deltaX = 0;
    if (!canPanY) deltaY = 0;
    if (!deltaX && !deltaY) return;

    previewUserAdjustedRef.current = true;
    setPreviewPan((current) => {
      const next = clampPreviewPan({ x: current.x - deltaX, y: current.y - deltaY });
      return next.x === current.x && next.y === current.y ? current : next;
    });
  };

  const updatePreviewPanFromNavigator = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!previewNavigatorMetrics || !previewDisplaySize || !previewStageSize || !previewVisibleStageSize) return;
    previewUserAdjustedRef.current = true;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = clampNumber(event.clientX - rect.left, 0, rect.width);
    const pointerY = clampNumber(event.clientY - rect.top, 0, rect.height);
    const displayCenterX = (pointerX / Math.max(rect.width, 1)) * previewDisplaySize.width;
    const displayCenterY = (pointerY / Math.max(rect.height, 1)) * previewDisplaySize.height;
    setPreviewPan(
      clampPreviewPan({
        x: previewVisibleStageSize.width / 2 - displayCenterX - previewStageSize.width / 2 + previewDisplaySize.width / 2,
        y: previewVisibleStageSize.height / 2 - displayCenterY - previewStageSize.height / 2 + previewDisplaySize.height / 2
      })
    );
  };

  const handlePreviewPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canPreviewPan || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    previewDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPan: previewPan,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePreviewPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      previewUserAdjustedRef.current = true;
      setPreviewDragging(true);
    }
    setPreviewPan(
      clampPreviewPan({
        x: drag.startPan.x + deltaX,
        y: drag.startPan.y + deltaY
      })
    );
  };

  const releasePreviewDrag = (event: ReactPointerEvent<HTMLDivElement>, activateOriginalSize: boolean) => {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    previewDragRef.current = null;
    setPreviewDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (activateOriginalSize && !drag.moved && !previewUsesHandCursor) showPreviewOriginalSize();
  };
  const finishPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => releasePreviewDrag(event, true);
  const cancelPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => releasePreviewDrag(event, false);
  const handlePreviewClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (canPreviewPan || previewUsesHandCursor) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("button")) return;
    showPreviewOriginalSize();
  };

  const handlePreviewNavigatorPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!showPreviewNavigator || !canPreviewPan || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    previewNavigatorDragRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreviewDragging(true);
    updatePreviewPanFromNavigator(event);
  };

  const handlePreviewNavigatorPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (previewNavigatorDragRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updatePreviewPanFromNavigator(event);
  };

  const finishPreviewNavigatorDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (previewNavigatorDragRef.current === event.pointerId) {
      previewNavigatorDragRef.current = null;
      setPreviewDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  const closePreview = () => {
    resetPreviewTransform();
    setReferencePreview(null);
    setPreviewImageSize(null);
    setPreviewStageSize(null);
    setPreviewToolbarHeight(0);
    onClose();
  };

  useLayoutEffect(() => {
    const coverIndex = previewItem?.groupImages?.findIndex((image) => image.isCover) ?? -1;
    setPreviewGroupImageIndex(coverIndex >= 0 ? coverIndex : 0);
  }, [previewItem?.id]);

  useLayoutEffect(() => {
    previewUserAdjustedRef.current = false;
    setPreviewZoom(1);
    setPreviewRotation(0);
    setPreviewPan({ x: 0, y: 0 });
    setPreviewDragging(false);
    setPreviewImageSource(defaultPreviewImageSource);
    setPreviewLoadedSrc("");
    previewDragRef.current = null;
    previewNavigatorDragRef.current = null;
    pendingOriginalPanRef.current = initialZoomMode === "actual";
    setPreviewImageSize(
      previewDisplayItem?.imageWidth && previewDisplayItem.imageHeight
        ? { width: previewDisplayItem.imageWidth, height: previewDisplayItem.imageHeight }
        : null
    );
    setPreviewStageSize(null);
    setReferencePreview(null);
  }, [activeGroupImage?.id, defaultPreviewImageSource, initialZoomMode, previewDisplayItem?.id, previewDisplayItem?.imageWidth, previewDisplayItem?.imageHeight]);

  useEffect(() => {
    setPreviewPan((value) => {
      const next = clampPreviewPan(value);
      return next.x === value.x && next.y === value.y ? value : next;
    });
  }, [previewPanBounds.x.min, previewPanBounds.x.max, previewPanBounds.y.min, previewPanBounds.y.max]);

  useLayoutEffect(() => {
    if (!previewDisplayItem || !previewImageSize || !previewStageSize || previewUserAdjustedRef.current) return;
    setPreviewZoom(previewDefaultZoom);
    setPreviewPan(previewDefaultPan);
  }, [
    activeGroupImageId,
    previewDefaultPan.x,
    previewDefaultPan.y,
    previewDefaultZoom,
    previewImageSize,
    previewImageSource,
    previewDisplayItem?.id,
    previewStageSize
  ]);

  useEffect(() => {
    if (
      !pendingOriginalPanRef.current ||
      previewImageSource !== "original" ||
      previewLoadedSrc !== previewImageSrc ||
      !previewImageSize ||
      !previewStageSize
    ) {
      return;
    }
    pendingOriginalPanRef.current = false;
    setPreviewPan(getPreviewStartPanWithCenteredXForZoom(1));
  }, [
    previewImageSrc,
    previewContentSize?.height,
    previewContentSize?.width,
    previewImageSize,
    previewImageSource,
    previewLoadedSrc,
    previewRotation,
    previewStageSize
  ]);

  useEffect(() => {
    if (!previewDisplayItem) return;
    const root = document.documentElement;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    const previousRootOverflow = root.style.overflow;
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    if (scrollbarWidth > 0) {
      const currentPaddingRight = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
    }
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";
    return () => {
      root.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [previewDisplayItem?.id]);

  useLayoutEffect(() => {
    const stage = previewStageRef.current;
    if (!stage || !previewDisplayItem) return;
    const updateStageSize = () => {
      const rect = stage.getBoundingClientRect();
      setPreviewStageSize({ width: rect.width, height: rect.height });
    };
    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [activeGroupImageId, previewDisplayItem?.id]);

  useLayoutEffect(() => {
    const toolbar = previewToolbarRef.current;
    if (!toolbar || !previewDisplayItem) {
      setPreviewToolbarHeight(0);
      return;
    }
    const updateToolbarHeight = () => {
      const rect = toolbar.getBoundingClientRect();
      const nextHeight = Math.max(0, rect.height);
      setPreviewToolbarHeight((current) => (Math.abs(current - nextHeight) < 0.5 ? current : nextHeight));
    };
    updateToolbarHeight();
    const observer = new ResizeObserver(updateToolbarHeight);
    observer.observe(toolbar);
    window.addEventListener("resize", updateToolbarHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateToolbarHeight);
    };
  }, [activeGroupImageId, previewDisplayItem?.id]);

  useEffect(() => {
    const modal = previewModalRef.current;
    if (!modal) return;
    const preventBrowserZoom = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.cancelable) event.preventDefault();
      if (previewStageRef.current?.contains(event.target as Node)) return;
      const zoomDelta = event.deltaY || event.deltaX;
      if (!zoomDelta) return;
      adjustPreviewZoom((zoomDelta < 0 ? 1 : -1) * 0.1);
    };
    modal.addEventListener("wheel", preventBrowserZoom, { passive: false });
    return () => modal.removeEventListener("wheel", preventBrowserZoom);
  }, [previewDisplayItem?.id, previewImageSource]);

  if (!previewDisplayItem) return null;

  const modal = (
    <div className="case-preview-backdrop">
      <section ref={previewModalRef} className={previewDragging ? "case-preview-modal is-preview-dragging" : "case-preview-modal"} aria-label={ariaLabel}>
        <button className="case-preview-close" type="button" onClick={closePreview} aria-label={t("imagePreview.close")}>
          <X size={18} />
        </button>
        <ImagePreviewStage
          canNext={hasPreviewNext}
          canPan={canPreviewPan}
          canPrev={hasPreviewPrev}
          imageSize={previewImageSize}
          imageSrc={previewImageSrc}
          imageStyle={previewImageStyle}
          imagePixelSnapped={Boolean(previewImagePosition?.pixelSnapped)}
          item={previewDisplayItem}
          navigatorMetrics={previewNavigatorMetrics}
          previewDragging={previewDragging}
          previewUsesHandCursor={previewUsesHandCursor}
          previewRotation={previewRotation}
          showNavigator={showPreviewNavigator}
          stageRef={previewStageRef}
          onClick={handlePreviewClick}
          onImageLoad={(event) => {
            setPreviewLoadedSrc(event.currentTarget.getAttribute("src") ?? event.currentTarget.currentSrc);
            setPreviewImageSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight
            });
          }}
          onNavigatorPointerCancel={finishPreviewNavigatorDrag}
          onNavigatorPointerDown={handlePreviewNavigatorPointerDown}
          onNavigatorPointerMove={handlePreviewNavigatorPointerMove}
          onNavigatorPointerUp={finishPreviewNavigatorDrag}
          onNext={() => onIndexChange((index + 1) % items.length)}
          onPointerCancel={cancelPreviewDrag}
          onPointerDown={handlePreviewPointerDown}
          onPointerMove={handlePreviewPointerMove}
          onPointerUp={finishPreviewDrag}
          onPrev={() => onIndexChange((index - 1 + items.length) % items.length)}
          onWheel={handlePreviewWheel}
        />
        <ImagePreviewToolbar
          actions={actions}
          fileSizeLabel={previewFileSizeLabel}
          index={index}
          groupImages={previewGroupImages}
          activeGroupImageIndex={normalizedGroupImageIndex}
          item={previewDisplayItem}
          itemCount={items.length}
          referenceImages={referenceImages}
          sizeLabel={previewSizeLabel}
          zoomLabel={previewZoomLabel}
          onCopyDescription={() => void copyPreviewDescription()}
          onReferencePreview={setReferencePreview}
          onGroupImageSelect={setPreviewGroupImageIndex}
          toolbarRef={previewToolbarRef}
          onOriginalSize={showPreviewOriginalSize}
          onReset={() => resetPreviewTransform()}
          onRotateLeft={() => setPreviewRotation((value) => value - 90)}
          onRotateRight={() => setPreviewRotation((value) => value + 90)}
          onZoomIn={() => adjustPreviewZoom(0.1)}
          onZoomOut={() => adjustPreviewZoom(-0.1)}
        />
      </section>
      {referencePreview ? (
        <ReferenceLightbox reference={referencePreview} onClose={() => setReferencePreview(null)} />
      ) : null}
    </div>
  );

  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
}
