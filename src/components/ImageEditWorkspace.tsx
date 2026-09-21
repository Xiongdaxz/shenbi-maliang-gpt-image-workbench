import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { createPortal } from "react-dom";
import { Check, Trash2, X } from "lucide-react";
import {
  ImageEditorComposer,
  ImageEditorRail,
  ImageEditorTopbar,
  type ImageEditorMode,
  type ImageMarkupZoomValue
} from "./ImageEditorControls";
import { DrawingCanvasDialog } from "./DrawingCanvasDialog";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import { buildQualityOptions, type SizeOption } from "../lib/imageOptions";
import { REMOVE_IMAGE_BACKGROUND_PROMPT, type ImageBackgroundOption } from "../lib/imageBackground";
import {
  DEFAULT_EDIT_IMAGE_MODEL,
  DEFAULT_IMAGE_QUALITY,
  imageModelQualities,
  isImageQualitySupported,
  normalizeImageModel,
  normalizeImageQuality,
  type ImageModelId,
  type ImageQuality
} from "../lib/imageModels";
import { resolveImageEditCount, resolveSelectedImageCount } from "../lib/imagePromptCount";
import { drawDrawingElements, type DrawingElement } from "../lib/drawingCanvas";
import { IMAGE_MARKUP_DEFAULT_PROMPT } from "../lib/imageMarkup";
import { editorPreviewPanY, shouldWheelAdjustToolSize, wheelSizeDelta } from "../lib/editorInput";
import {
  REMOVE_SELECTED_AREA_PROMPT,
  formatImageAnnotationDisplayText,
  imageAnnotationEditorPositionInViewport,
  moveEditableImageAnnotation,
  removeEditableImageAnnotation,
  upsertEditableImageAnnotation,
  type EditableImageAnnotation,
  type ImageAnnotationDraft,
  type ImageEditIntent
} from "../lib/imageAnnotations";
import {
  BRUSH_MAX_SIZE,
  BRUSH_MIN_SIZE,
  BRUSH_SIZE_STEP,
  DEFAULT_BRUSH_PREVIEW_ANCHOR,
  SELECTION_DASH_PATTERN_LENGTH,
  SELECTION_DASH_SPEED_MS,
  brushPreviewMetrics,
  brushSizeRatioFromDisplayPixels,
  buildSelectionOverlaySnapshot,
  centeredBrushCursorOffset,
  clampRatio,
  renderMaskStroke,
  renderSelectionOverlay,
  selectionPreviewCanvasSize,
  selectionOverlayKey,
  type SelectionOverlaySnapshot,
  type Stroke
} from "../lib/selectionMask";
import { useWorkbench, type ImageEditorImageSort, type ImageLibraryContinuations } from "../store/workbench";
import type { AssetItem, ImagePreviewWheelMode, WorkImage } from "../types";

export type ImageEditorState = {
  images: WorkImage[];
  activeImageId: string;
  imageSort: ImageEditorImageSort;
  totalImageCount?: number;
  libraryContinuations?: ImageLibraryContinuations;
  initialPrompt?: string;
  initialImageCount?: number;
  initialImageModel?: ImageModelId;
  initialQuality?: ImageQuality;
  discardDraftOnClose?: boolean;
};

type ImageEditWorkspaceProps = {
  images: WorkImage[];
  activeImageId: string;
  imageSort?: ImageEditorImageSort;
  totalImageCount?: number;
  downloadBaseName?: string;
  initialPrompt?: string;
  initialImageCount?: number;
  initialImageModel?: ImageModelId;
  initialQuality?: ImageQuality;
  sizeOptions: SizeOption[];
  selectedSize: string;
  isSubmitting: boolean;
  wheelMode?: ImagePreviewWheelMode;
  assets?: { assets: AssetItem[] };
  materialPickerOpen: boolean;
  hasMoreNewerImages?: boolean;
  hasMoreOlderImages?: boolean;
  failedLoadingNewerImages?: boolean;
  failedLoadingOlderImages?: boolean;
  loadingMoreImages?: boolean;
  onClose: () => void;
  onActiveImageChange?: (imageId: string) => void;
  onLoadMoreImages?: (direction: "newer" | "older") => void;
  onLockedRequest: () => void;
  onPickSize: (image: WorkImage, option: SizeOption, imageCount: number, imageModel: ImageModelId, quality: ImageQuality) => void;
  onOpenCasePicker: () => void;
  onToggleMaterialPicker: () => void;
  onSubmitEdit: (payload: {
    image: WorkImage;
    prompt: string;
    imageCount: number;
    imageModel: ImageModelId;
    quality: ImageQuality;
    background?: ImageBackgroundOption;
    editIntent?: ImageEditIntent;
    imageAnnotations?: Array<{ xPercent: number; yPercent: number; instruction: string }>;
    maskDataUrl?: string;
    sourceAssetIds?: string[];
    sourceCaseItemIds?: string[];
    sourceInlineImages?: Array<{ id?: string; name?: string; dataUrl: string }>;
    imageMarkupReference?: boolean;
  }) => void;
};

const EDITOR_PREVIEW_MIN_SCALE = 0.1;
const EDITOR_PREVIEW_MAX_SCALE = 3;
const EDITOR_PREVIEW_SCALE_STEP = 0.1;
const EDITOR_PREVIEW_WHEEL_LINE_PX = 16;
const ANNOTATION_PREVIEW_VERTICAL_INSET = 2;

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function previewWheelDelta(delta: number, deltaMode: number, pageSize: number) {
  const unit = deltaMode === 1 ? EDITOR_PREVIEW_WHEEL_LINE_PX : deltaMode === 2 ? Math.max(1, pageSize) : 1;
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

export function ImageEditWorkspace({
  images,
  activeImageId,
  imageSort = "asc",
  totalImageCount,
  downloadBaseName,
  initialPrompt,
  initialImageCount,
  initialImageModel,
  initialQuality,
  sizeOptions,
  selectedSize,
  isSubmitting,
  wheelMode = "pan",
  assets,
  materialPickerOpen,
  hasMoreNewerImages = false,
  hasMoreOlderImages = false,
  failedLoadingNewerImages = false,
  failedLoadingOlderImages = false,
  loadingMoreImages = false,
  onClose,
  onActiveImageChange,
  onLoadMoreImages,
  onLockedRequest,
  onPickSize,
  onOpenCasePicker,
  onToggleMaterialPicker,
  onSubmitEdit
}: ImageEditWorkspaceProps) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState(activeImageId);
  const [mode, setMode] = useState<ImageEditorMode>("standard");
  const [prompt, setPrompt] = useState(() => formatImageAnnotationDisplayText(initialPrompt ?? ""));
  const [imageCount, setImageCount] = useState(() => resolveSelectedImageCount(initialImageCount));
  const [imageModel, setImageModel] = useState(() => normalizeImageModel(initialImageModel, DEFAULT_EDIT_IMAGE_MODEL));
  const [quality, setQuality] = useState<ImageQuality>(() => normalizeImageQuality(
    normalizeImageModel(initialImageModel, DEFAULT_EDIT_IMAGE_MODEL),
    initialQuality ?? DEFAULT_IMAGE_QUALITY
  ));
  const [brushSize, setBrushSize] = useState(80);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStrokes, setRedoStrokes] = useState<Stroke[]>([]);
  const [liveStrokeActive, setLiveStrokeActive] = useState(false);
  const [brushPreviewActive, setBrushPreviewActive] = useState(false);
  const [brushPreviewAnchor, setBrushPreviewAnchor] = useState<{ x: number; y: number }>(DEFAULT_BRUSH_PREVIEW_ANCHOR);
  const [annotations, setAnnotations] = useState<EditableImageAnnotation[]>([]);
  const [annotationDraft, setAnnotationDraft] = useState<ImageAnnotationDraft | null>(null);
  const [annotationTooltipsVisible, setAnnotationTooltipsVisible] = useState(false);
  const [markupElements, setMarkupElements] = useState<DrawingElement[]>([]);
  const [markupZoomValue, setMarkupZoomValue] = useState<ImageMarkupZoomValue>("fit");
  const [editSurfaceBounds, setEditSurfaceBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [editorError, setEditorError] = useState("");
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [visibleStageSize, setVisibleStageSize] = useState({ width: 0, height: 0 });
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [previewDragging, setPreviewDragging] = useState(false);
  const [previewOriginalSizeMode, setPreviewOriginalSizeMode] = useState(false);
  const selectedAssets = useWorkbench((state) => state.selectedAssets);
  const selectedCaseMaterials = useWorkbench((state) => state.selectedCaseMaterials);
  const setSelectedCaseMaterials = useWorkbench((state) => state.setSelectedCaseMaterials);
  const toggleAsset = useWorkbench((state) => state.toggleAsset);
  const setSelectedAssets = useWorkbench((state) => state.setSelectedAssets);
  const stageRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const composerWrapRef = useRef<HTMLElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const editSurfacePortalRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushCursorRef = useRef<HTMLSpanElement | null>(null);
  const brushCursorPointRef = useRef<{ clientX: number; clientY: number; inside: boolean } | null>(null);
  const brushSizeRef = useRef(80);
  const annotationLayerRef = useRef<HTMLDivElement | null>(null);
  const annotationInputRef = useRef<HTMLInputElement | null>(null);
  const annotationIdRef = useRef(0);
  const annotationDragRef = useRef<{
    id: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);
  const thumbListRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);
  const thumbWheelThrottleRef = useRef<number | null>(null);
  const previewDragRef = useRef<{ pointerId: number; startX: number; startY: number; startPan: { x: number; y: number }; moved: boolean } | null>(null);
  const previewNavigatorDragRef = useRef<number | null>(null);
  const previewClickHandledRef = useRef(false);
  const previewPointerStartedOnImageRef = useRef(false);
  const previewOriginalSizeModeRef = useRef(false);
  const pointerActiveRef = useRef(false);
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number; sizeRatio: number } | null>(null);
  const dashOffsetRef = useRef(0);
  const selectionSnapshotRef = useRef<{ key: string; snapshot: SelectionOverlaySnapshot | null } | null>(null);

  const selectionMode = mode === "remove";
  const markupMode = mode === "markup";
  const annotationMode = mode === "annotation";
  const modeActive = mode !== "standard";
  const requestEditIntent: ImageEditIntent = markupMode ? "standard" : mode;
  const selectedSourceAssetIds = selectedAssets.filter((asset) => !asset.temporary && !asset.dataUrl).map((asset) => asset.id);
  const selectedSourceInlineImages = selectedAssets
    .filter((asset) => (asset.temporary || asset.dataUrl) && asset.dataUrl)
    .map((asset) => ({ id: asset.id, name: asset.name, dataUrl: asset.dataUrl ?? asset.url }));
  const effectiveImageCount = resolveImageEditCount(
    markupMode ? prompt.trim() || IMAGE_MARKUP_DEFAULT_PROMPT : prompt,
    imageCount,
    requestEditIntent,
    1 + selectedSourceAssetIds.length + selectedSourceInlineImages.length + selectedCaseMaterials.length + (markupElements.length > 0 ? 1 : 0)
  );
  const qualityOptions = useMemo(() => buildQualityOptions(imageModelQualities(imageModel)), [imageModel]);
  const selectImageModel = (nextModel: ImageModelId) => {
    setImageModel(nextModel);
    if (!isImageQualitySupported(nextModel, quality)) setQuality(DEFAULT_IMAGE_QUALITY);
  };

  const activeImage = images.find((image) => image.id === activeId) ?? images[0];
  const activeIndex = Math.max(0, images.findIndex((image) => image.id === activeImage?.id));
  const activeImageOriginalUrl = activeImage?.originalUrl || activeImage?.url || "";
  const activeImageMetadataSize =
    activeImage && activeImage.imageWidth > 0 && activeImage.imageHeight > 0
      ? { width: activeImage.imageWidth, height: activeImage.imageHeight }
      : null;
  const activeImageDisplayUrl = activeImageOriginalUrl;
  const activeImageDisplayPrompt = activeImage ? formatImageAnnotationDisplayText(activeImage.prompt) : "";
  const hasSelection = strokes.length > 0 || liveStrokeActive;
  const editorComposerPreviews = [
    ...selectedCaseMaterials.map((caseMaterial) => ({
      id: `case-${caseMaterial.caseItemId}`,
      url: caseMaterial.thumbnailUrl ?? caseMaterial.previewUrl ?? caseMaterial.url,
      previewUrl: caseMaterial.previewUrl ?? caseMaterial.originalUrl ?? caseMaterial.url,
      name: t("chat.editor.inspirationMaterial"),
      title: caseMaterial.title,
      onRemove: () => setSelectedCaseMaterials(selectedCaseMaterials.filter((item) => item.caseItemId !== caseMaterial.caseItemId))
    })),
    ...selectedAssets.map((asset) => ({
      id: asset.id,
      url: asset.thumbnailUrl ?? asset.previewUrl ?? asset.url,
      previewUrl: asset.previewUrl ?? asset.originalUrl ?? asset.url,
      name: asset.name,
      title: asset.name,
      onRemove: () => setSelectedAssets(selectedAssets.filter((item) => item.id !== asset.id))
    }))
  ];
  const annotationComposerExpanded = annotationMode && (editorComposerPreviews.length > 0 || annotations.length > 0);
  const wheelAdjustsToolSize = shouldWheelAdjustToolSize(markupZoomValue);
  const brushProgress = ((brushSize - BRUSH_MIN_SIZE) / (BRUSH_MAX_SIZE - BRUSH_MIN_SIZE)) * 100;
  const brushSizeControlStyle = { "--drawing-size-progress": `${Math.max(0, Math.min(100, brushProgress))}%` } as CSSProperties;
  const brushPreview = brushPreviewMetrics(
    brushPreviewAnchor,
    brushSizeRatioFromDisplayPixels(
      brushSize,
      editSurfaceBounds?.width ?? displaySize.width,
      editSurfaceBounds?.height ?? displaySize.height
    ),
    editSurfaceBounds?.width ?? displaySize.width,
    editSurfaceBounds?.height ?? displaySize.height
  );
  const annotationEditor = annotationDraft && editSurfaceBounds
    ? imageAnnotationEditorPositionInViewport(
        annotationDraft.xPercent,
        annotationDraft.yPercent,
        editSurfaceBounds.width,
        editSurfaceBounds.height,
        {
          canvasLeft: editSurfaceBounds.left,
          canvasTop: editSurfaceBounds.top,
          width: visibleStageSize.width,
          height: visibleStageSize.height,
          margin: 12
        }
      )
    : null;
  const annotationDraftFocusKey = annotationDraft ? annotationDraft.id ?? "new" : "";
  const normalizedPreviewRotation = ((previewRotation % 360) + 360) % 360;
  const previewRotatedSideways = normalizedPreviewRotation === 90 || normalizedPreviewRotation === 270;
  const previewBaseSize =
    previewOriginalSizeMode && naturalSize.width > 0 && naturalSize.height > 0
      ? naturalSize
      : displaySize;
  const previewContentSize =
    previewBaseSize.width > 0 && previewBaseSize.height > 0
      ? {
          width: previewRotatedSideways ? previewBaseSize.height : previewBaseSize.width,
          height: previewRotatedSideways ? previewBaseSize.width : previewBaseSize.height
        }
      : null;
  const previewDisplaySize = previewContentSize
    ? {
        width: previewContentSize.width * previewZoom,
        height: previewContentSize.height * previewZoom
      }
    : null;
  const previewBaseScale =
    previewOriginalSizeMode
      ? 1
      : displaySize.width > 0 && displaySize.height > 0 && naturalSize.width > 0 && naturalSize.height > 0
      ? Math.min(displaySize.width / naturalSize.width, displaySize.height / naturalSize.height)
      : 1;
  const previewZoomPercentage = previewZoom * previewBaseScale * 100;
  const previewPanBounds =
    previewDisplaySize && stageSize.width > 0 && stageSize.height > 0
      ? {
          x: buildPreviewPanAxisBounds(previewDisplaySize.width, stageSize.width, visibleStageSize.width),
          y: buildPreviewPanAxisBounds(previewDisplaySize.height, stageSize.height, visibleStageSize.height)
        }
      : { x: { min: 0, max: 0 }, y: { min: 0, max: 0 } };
  const canPreviewPan = Boolean(
    previewDisplaySize &&
    ((visibleStageSize.width > 0 && previewDisplaySize.width > visibleStageSize.width + 1) ||
      (visibleStageSize.height > 0 && previewDisplaySize.height > visibleStageSize.height + 1))
  );
  const previewUsesHandCursor = !modeActive && (previewOriginalSizeMode || Math.abs(previewZoom - 1) > 0.001);
  const previewZoomLabel = `${Math.round(previewZoomPercentage)}%`;
  const previewOriginalSizeLabel =
    naturalSize.width > 0 && naturalSize.height > 0 ? `${naturalSize.width}x${naturalSize.height}` : "";
  const originalSizePreviewActive = !modeActive && previewOriginalSizeMode && naturalSize.width > 0 && naturalSize.height > 0;
  const previewResetActive = Boolean(
    !modeActive &&
      (previewOriginalSizeMode || Math.abs(previewZoom - 1) > 0.001)
  );
  const previewCanvasPosition =
    previewBaseSize.width > 0 && previewBaseSize.height > 0 && previewDisplaySize && stageSize.width > 0 && stageSize.height > 0
      ? (() => {
          const rawLeft = stageSize.width / 2 + previewPan.x - previewBaseSize.width / 2;
          const previewPanY = editorPreviewPanY(
            previewPan.y,
            annotationComposerExpanded,
            markupZoomValue,
            visibleStageSize.height,
            stageSize.height
          );
          const rawTop = stageSize.height / 2 + previewPanY - previewBaseSize.height / 2;
          const snapToDevicePixel = originalSizePreviewActive && previewZoom === 1;
          const left = snapToDevicePixel ? Math.round(rawLeft) : rawLeft;
          const top = snapToDevicePixel ? Math.round(rawTop) : rawTop;
          const centerX = left + previewBaseSize.width / 2;
          const centerY = top + previewBaseSize.height / 2;
          return {
            left,
            top,
            displayLeft: centerX - previewDisplaySize.width / 2,
            displayTop: centerY - previewDisplaySize.height / 2
          };
        })()
      : null;
  const previewCanvasRotation = modeActive ? 0 : previewRotation;
  const previewCanvasStyle = previewCanvasPosition
    ? ({
        left: previewCanvasPosition.left,
        top: previewCanvasPosition.top,
        transform: `rotate(${previewCanvasRotation}deg) scale(${previewZoom})`
      } satisfies CSSProperties)
    : ({
        transform: `translate(-50%, -50%) rotate(${previewCanvasRotation}deg) scale(${previewZoom})`
      } satisfies CSSProperties);
  const animatePreviewTransform = Boolean(
    !modeActive &&
      previewCanvasPosition &&
      (previewZoom !== 1 || normalizedPreviewRotation !== 0)
  );
  const previewImageStyle = originalSizePreviewActive
    ? ({
        width: naturalSize.width,
        height: naturalSize.height
      } satisfies CSSProperties)
    : annotationComposerExpanded && wheelAdjustsToolSize && visibleStageSize.height > 0
      ? ({
          maxHeight: `min(calc(100vh - 210px), ${Math.max(0, Math.floor(visibleStageSize.height) - ANNOTATION_PREVIEW_VERTICAL_INSET * 2)}px)`
        } satisfies CSSProperties)
    : undefined;
  const previewNavigatorMetrics =
    !modeActive && canPreviewPan && previewContentSize && previewDisplaySize && visibleStageSize.width > 0 && visibleStageSize.height > 0
      ? (() => {
          const maxWidth = 88;
          const maxHeight = 148;
          const scale = Math.min(maxWidth / previewContentSize.width, maxHeight / previewContentSize.height);
          const imageWidth = previewContentSize.width * scale;
          const imageHeight = previewContentSize.height * scale;
          const imageLeft = previewCanvasPosition?.displayLeft ?? (stageSize.width - previewDisplaySize.width) / 2 + previewPan.x;
          const imageTop = previewCanvasPosition?.displayTop ?? (stageSize.height - previewDisplaySize.height) / 2 + previewPan.y;
          const visibleLeft = clampNumber(-imageLeft, 0, previewDisplaySize.width);
          const visibleTop = clampNumber(-imageTop, 0, previewDisplaySize.height);
          const visibleRight = clampNumber(visibleStageSize.width - imageLeft, 0, previewDisplaySize.width);
          const visibleBottom = clampNumber(visibleStageSize.height - imageTop, 0, previewDisplaySize.height);
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
  function mapClientPoint(clientX: number, clientY: number, size = brushSizeRef.current) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clampRatio((clientX - rect.left) / rect.width),
      y: clampRatio((clientY - rect.top) / rect.height),
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      sizeRatio: brushSizeRatioFromDisplayPixels(size, rect.width, rect.height)
    };
  }

  function updateBrushCursor(clientX: number, clientY: number, size = brushSizeRef.current) {
    brushCursorPointRef.current = { clientX, clientY, inside: true };
    const point = mapClientPoint(clientX, clientY, size);
    if (!point) {
      hideBrushCursor();
      return null;
    }
    setBrushPreviewAnchor({ x: point.x, y: point.y });
    const cursor = brushCursorRef.current;
    if (cursor) {
      const offset = centeredBrushCursorOffset(point.offsetX, point.offsetY, size);
      cursor.style.display = "block";
      cursor.style.width = `${size}px`;
      cursor.style.height = `${size}px`;
      cursor.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
    }
    return point;
  }

  function setBrushSizeValue(value: number) {
    const nextSize = Math.max(BRUSH_MIN_SIZE, Math.min(BRUSH_MAX_SIZE, value));
    brushSizeRef.current = nextSize;
    setBrushSize(nextSize);
    const cursorPoint = brushCursorPointRef.current;
    if (cursorPoint?.inside) updateBrushCursor(cursorPoint.clientX, cursorPoint.clientY, nextSize);
    return nextSize;
  }

  function adjustBrushSize(delta: number) {
    setBrushSizeValue(brushSizeRef.current + delta);
  }

  function setBrushSizePreviewActive(active: boolean) {
    if (active) setBrushPreviewAnchor(DEFAULT_BRUSH_PREVIEW_ANCHOR);
    setBrushPreviewActive(active);
  }
  const clampPreviewPan = (pan: { x: number; y: number }) => ({
    x: clampNumber(pan.x, previewPanBounds.x.min, previewPanBounds.x.max),
    y: clampNumber(pan.y, previewPanBounds.y.min, previewPanBounds.y.max)
  });
  const previewHorizontalCenterPanForZoom = (zoom: number) =>
    previewContentSize && stageSize.width > 0 && stageSize.height > 0 && visibleStageSize.width > 0 && visibleStageSize.height > 0
      ? buildPreviewCenterPan(
          stageSize.width,
          visibleStageSize.width,
          buildPreviewPanAxisBounds(previewContentSize.width * zoom, stageSize.width, visibleStageSize.width)
        )
      : 0;
  const previewFittedPan = () => {
    const fittedSize = displaySize.width > 0 && displaySize.height > 0 ? displaySize : null;
    return fittedSize && stageSize.width > 0 && stageSize.height > 0 && visibleStageSize.width > 0 && visibleStageSize.height > 0
      ? {
          x: buildPreviewCenterPan(
            stageSize.width,
            visibleStageSize.width,
            buildPreviewPanAxisBounds(fittedSize.width, stageSize.width, visibleStageSize.width)
          ),
          y: buildPreviewStartPan(fittedSize.height, stageSize.height, visibleStageSize.height)
        }
      : { x: 0, y: 0 };
  };
  const previewStartPanWithCenteredXForZoom = (zoom: number) =>
    previewContentSize && stageSize.width > 0 && stageSize.height > 0 && visibleStageSize.width > 0 && visibleStageSize.height > 0
      ? {
          x: previewHorizontalCenterPanForZoom(zoom),
          y: buildPreviewStartPan(previewContentSize.height * zoom, stageSize.height, visibleStageSize.height)
        }
      : { x: 0, y: 0 };
  const resetPreviewTransform = () => {
    previewOriginalSizeModeRef.current = false;
    setPreviewOriginalSizeMode(false);
    setPreviewZoom(1);
    setPreviewRotation(0);
    setPreviewPan(previewFittedPan());
    setPreviewDragging(false);
    previewDragRef.current = null;
    previewNavigatorDragRef.current = null;
  };
  const showPreviewOriginalSize = () => {
    previewOriginalSizeModeRef.current = true;
    setPreviewOriginalSizeMode(true);
    const nextZoom = 1;
    setPreviewZoom(nextZoom);
    setPreviewPan(
      naturalSize.width > 0 &&
        naturalSize.height > 0 &&
        stageSize.width > 0 &&
        stageSize.height > 0 &&
        visibleStageSize.width > 0 &&
        visibleStageSize.height > 0
        ? {
            x: buildPreviewCenterPan(
              stageSize.width,
              visibleStageSize.width,
              buildPreviewPanAxisBounds((previewRotatedSideways ? naturalSize.height : naturalSize.width) * nextZoom, stageSize.width, visibleStageSize.width)
            ),
            y: buildPreviewStartPan((previewRotatedSideways ? naturalSize.width : naturalSize.height) * nextZoom, stageSize.height, visibleStageSize.height)
          }
        : previewStartPanWithCenteredXForZoom(nextZoom)
    );
    setPreviewDragging(false);
    previewDragRef.current = null;
    previewNavigatorDragRef.current = null;
  };
  const adjustPreviewZoom = (delta: number) => {
    setPreviewZoom((value) => {
      if (previewOriginalSizeMode) {
        return clampNumber(Number((value + delta).toFixed(2)), EDITOR_PREVIEW_MIN_SCALE, EDITOR_PREVIEW_MAX_SCALE);
      }
      const currentScale = value * previewBaseScale;
      const nextScale = clampNumber(Number((currentScale + delta).toFixed(2)), EDITOR_PREVIEW_MIN_SCALE, EDITOR_PREVIEW_MAX_SCALE);
      return previewBaseScale > 0 ? nextScale / previewBaseScale : nextScale;
    });
  };

  const setPreviewZoomPercentage = (percentage: number) => {
    const nextScale = clampNumber(percentage / 100, EDITOR_PREVIEW_MIN_SCALE, EDITOR_PREVIEW_MAX_SCALE);
    setPreviewZoom(previewBaseScale > 0 ? nextScale / previewBaseScale : nextScale);
  };

  const setMarkupPreviewZoom = (value: ImageMarkupZoomValue) => {
    setMarkupZoomValue(value);
    if (value === "fit") {
      resetPreviewTransform();
      return;
    }
    previewOriginalSizeModeRef.current = false;
    setPreviewOriginalSizeMode(false);
    const nextScale = clampNumber(value / 100, EDITOR_PREVIEW_MIN_SCALE, EDITOR_PREVIEW_MAX_SCALE);
    const nextZoom = previewBaseScale > 0 ? nextScale / previewBaseScale : nextScale;
    setPreviewZoom(nextZoom);
    setPreviewPan(previewStartPanWithCenteredXForZoom(nextZoom));
    setPreviewDragging(false);
    previewDragRef.current = null;
    previewNavigatorDragRef.current = null;
  };

  const updatePreviewPanFromNavigator = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!previewNavigatorMetrics || !previewDisplaySize || stageSize.width <= 0 || stageSize.height <= 0 || visibleStageSize.width <= 0 || visibleStageSize.height <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = clampNumber(event.clientX - rect.left, 0, rect.width);
    const pointerY = clampNumber(event.clientY - rect.top, 0, rect.height);
    const displayCenterX = (pointerX / Math.max(rect.width, 1)) * previewDisplaySize.width;
    const displayCenterY = (pointerY / Math.max(rect.height, 1)) * previewDisplaySize.height;
    setPreviewPan(
      clampPreviewPan({
        x: visibleStageSize.width / 2 - displayCenterX - stageSize.width / 2 + previewDisplaySize.width / 2,
        y: visibleStageSize.height / 2 - displayCenterY - stageSize.height / 2 + previewDisplaySize.height / 2
      })
    );
  };

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateStageSize = () => {
      const rect = viewport.getBoundingClientRect();
      const composerRect = composerWrapRef.current?.getBoundingClientRect();
      const viewportStyle = window.getComputedStyle(viewport);
      const coveredGap = Number.parseFloat(viewportStyle.getPropertyValue("--image-editor-obscured-gap")) || 0;
      const coveredHeight = composerRect ? clampNumber(rect.bottom - composerRect.top + coveredGap, 0, rect.height) : 0;
      const fullSize = {
        width: Math.max(0, rect.width),
        height: Math.max(0, rect.height)
      };
      const visibleSize = {
        width: fullSize.width,
        height: Math.max(0, fullSize.height - coveredHeight)
      };
      setStageSize((current) => {
        return current.width === fullSize.width && current.height === fullSize.height ? current : fullSize;
      });
      setVisibleStageSize((current) => {
        return current.width === visibleSize.width && current.height === visibleSize.height ? current : visibleSize;
      });
    };
    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(viewport);
    if (composerWrapRef.current) observer.observe(composerWrapRef.current);
    window.addEventListener("resize", updateStageSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateStageSize);
    };
  }, [activeImage?.id, editorComposerPreviews.length, editorError, materialPickerOpen, mode]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const preventBrowserZoom = (event: WheelEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.cancelable) event.preventDefault();
    };
    stage.addEventListener("wheel", preventBrowserZoom, { passive: false });
    return () => stage.removeEventListener("wheel", preventBrowserZoom);
  }, [activeImage?.id]);

  useEffect(() => {
    setPreviewPan((value) => {
      const next = clampPreviewPan(value);
      return next.x === value.x && next.y === value.y ? value : next;
    });
  }, [modeActive, previewPanBounds.x.min, previewPanBounds.x.max, previewPanBounds.y.min, previewPanBounds.y.max]);

  const drawSelectionOverlay = () => {
    const canvas = canvasRef.current;
    if (!canvas || displaySize.width <= 0 || displaySize.height <= 0) return;
    const previewCanvasSize = selectionPreviewCanvasSize(
      displaySize.width,
      displaySize.height,
      naturalSize.width,
      naturalSize.height
    );
    if (canvas.width !== previewCanvasSize.width) canvas.width = previewCanvasSize.width;
    if (canvas.height !== previewCanvasSize.height) canvas.height = previewCanvasSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const selectedStrokes = currentStrokeRef.current ? [...strokesRef.current, currentStrokeRef.current] : strokesRef.current;
    const key = selectionOverlayKey(selectedStrokes, canvas.width, canvas.height);
    if (selectionSnapshotRef.current?.key !== key) {
      selectionSnapshotRef.current = {
        key,
        snapshot: buildSelectionOverlaySnapshot(selectedStrokes, canvas.width, canvas.height)
      };
    }
    if (selectionSnapshotRef.current.snapshot) {
      renderSelectionOverlay(ctx, selectionSnapshotRef.current.snapshot, dashOffsetRef.current, previewCanvasSize.scale);
    }
  };

  useLayoutEffect(() => {
    if (!selectionMode || !editSurfaceBounds) return;
    drawSelectionOverlay();
    const cursorPoint = brushCursorPointRef.current;
    if (cursorPoint?.inside) updateBrushCursor(cursorPoint.clientX, cursorPoint.clientY);
  }, [selectionMode, editSurfaceBounds]);

  function hideBrushCursor() {
    if (brushCursorPointRef.current) {
      brushCursorPointRef.current = { ...brushCursorPointRef.current, inside: false };
    }
    const cursor = brushCursorRef.current;
    if (cursor) cursor.style.display = "none";
  }

  useEffect(() => setActiveId(activeImageId), [activeImageId]);

  useEffect(() => setImageCount(resolveSelectedImageCount(initialImageCount)), [initialImageCount]);

  useEffect(() => {
    if (activeImage?.id) onActiveImageChange?.(activeImage.id);
  }, [activeImage?.id, onActiveImageChange]);

  useEffect(() => {
    if (loadingMoreImages || !onLoadMoreImages) return;
    const threshold = Math.min(8, Math.max(1, Math.floor(images.length / 3)));
    const startDirection = imageSort === "asc" ? "older" : "newer";
    const endDirection = imageSort === "asc" ? "newer" : "older";
    const canLoad = (direction: "newer" | "older") =>
      direction === "newer"
        ? hasMoreNewerImages && !failedLoadingNewerImages
        : hasMoreOlderImages && !failedLoadingOlderImages;
    if (activeIndex <= threshold && canLoad(startDirection)) {
      onLoadMoreImages(startDirection);
      return;
    }
    if (activeIndex >= Math.max(0, images.length - threshold - 1) && canLoad(endDirection)) {
      onLoadMoreImages(endDirection);
    }
  }, [
    activeIndex,
    failedLoadingNewerImages,
    failedLoadingOlderImages,
    hasMoreNewerImages,
    hasMoreOlderImages,
    imageSort,
    images.length,
    loadingMoreImages,
    onLoadMoreImages
  ]);

  useEffect(() => {
    for (const index of [activeIndex - 2, activeIndex - 1, activeIndex + 1, activeIndex + 2]) {
      const image = images[index];
      const url = image?.previewUrl || image?.url;
      if (!url) continue;
      const preload = new Image();
      preload.decoding = "async";
      preload.src = url;
    }
  }, [activeIndex, images]);

  useEffect(() => {
    const root = document.documentElement;
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousRootScrollbarGutter = root.style.scrollbarGutter;
    document.body.classList.add("image-editor-open");
    root.style.overflow = "hidden";
    root.style.scrollbarGutter = "auto";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.classList.remove("image-editor-open");
      root.style.overflow = previousRootOverflow;
      root.style.scrollbarGutter = previousRootScrollbarGutter;
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (thumbWheelThrottleRef.current) window.clearTimeout(thumbWheelThrottleRef.current);
    };
  }, []);

  useEffect(() => {
    pointerActiveRef.current = false;
    setMode("standard");
    resetPreviewTransform();
    hideBrushCursor();
    setBrushPreviewActive(false);
    setBrushPreviewAnchor(DEFAULT_BRUSH_PREVIEW_ANCHOR);
    setAnnotations([]);
    setAnnotationDraft(null);
    setAnnotationTooltipsVisible(false);
    setMarkupElements([]);
    setMarkupZoomValue("fit");
    setStrokes([]);
    setRedoStrokes([]);
    setLiveStrokeActive(false);
    strokesRef.current = [];
    currentStrokeRef.current = null;
    pointerStartRef.current = null;
    selectionSnapshotRef.current = null;
    setEditorError("");
    setNaturalSize(activeImageMetadataSize ?? { width: 0, height: 0 });
  }, [activeImage?.id, activeImageMetadataSize?.height, activeImageMetadataSize?.width]);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const updateSize = () => {
      if (!previewOriginalSizeModeRef.current) {
        setDisplaySize({
          width: Math.max(0, Math.round(image.offsetWidth)),
          height: Math.max(0, Math.round(image.offsetHeight))
        });
      }
      if (activeImageMetadataSize) {
        setNaturalSize(activeImageMetadataSize);
      } else if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(image);
    window.addEventListener("resize", updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, [activeImageDisplayUrl, activeImageMetadataSize?.height, activeImageMetadataSize?.width, mode]);

  useLayoutEffect(() => {
    if (!modeActive) {
      setEditSurfaceBounds(null);
      return;
    }
    const image = imageRef.current;
    const viewport = viewportRef.current;
    if (!image || !viewport) return;
    const imageRect = image.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    if (imageRect.width <= 0 || imageRect.height <= 0) return;
    const next = {
      left: imageRect.left - viewportRect.left,
      top: imageRect.top - viewportRect.top,
      width: imageRect.width,
      height: imageRect.height
    };
    setEditSurfaceBounds((current) =>
      current
      && Math.abs(current.left - next.left) < 0.25
      && Math.abs(current.top - next.top) < 0.25
      && Math.abs(current.width - next.width) < 0.25
      && Math.abs(current.height - next.height) < 0.25
        ? current
        : next
    );
  }, [
    activeImageDisplayUrl,
    displaySize.height,
    displaySize.width,
    modeActive,
    previewPan.x,
    previewPan.y,
    previewZoom,
    stageSize.height,
    stageSize.width,
    visibleStageSize.height,
    visibleStageSize.width
  ]);

  useEffect(() => {
    if (!annotationDraft) return;
    const frame = requestAnimationFrame(() => {
      annotationInputRef.current?.focus();
      annotationInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [annotationDraftFocusKey]);

  useEffect(() => {
    if (annotations.length === 0) setAnnotationTooltipsVisible(false);
  }, [annotations.length]);

  useEffect(() => {
    strokesRef.current = strokes;
    drawSelectionOverlay();
  }, [displaySize, naturalSize, strokes]);

  useEffect(() => {
    if (!selectionMode || !hasSelection) {
      drawSelectionOverlay();
      return;
    }
    let frame = 0;
    const tick = (timestamp: number) => {
      dashOffsetRef.current = (timestamp / SELECTION_DASH_SPEED_MS) % SELECTION_DASH_PATTERN_LENGTH;
      drawSelectionOverlay();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [selectionMode, hasSelection, displaySize, naturalSize, strokes]);

  useEffect(() => {
    if (!selectionMode) return;

    function isTextInputTarget(target: EventTarget | null) {
      const element = target instanceof HTMLElement ? target : null;
      return Boolean(element?.closest("input:not([type='range']), textarea, select, [contenteditable='true']"));
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTextInputTarget(event.target)) return;
      const isIncrease = event.key === "+" || event.key === "=" || event.code === "NumpadAdd";
      const isDecrease = event.key === "-" || event.key === "_" || event.code === "NumpadSubtract";
      if (!isIncrease && !isDecrease) return;
      event.preventDefault();
      adjustBrushSize(isIncrease ? BRUSH_SIZE_STEP : -BRUSH_SIZE_STEP);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectionMode]);

  useEffect(() => {
    if (images.length <= 1 || modeActive) return;

    function isTypingTarget(target: EventTarget | null) {
      const element = target instanceof HTMLElement ? target : null;
      return Boolean(element?.closest(
        "input, textarea, select, [contenteditable='true'], .editor-size-picker, .image-count-stepper, .image-count-menu"
      ));
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isTypingTarget(event.target)) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const offset = event.key === "ArrowUp" ? -1 : 1;
      const nextIndex = activeIndex + offset;
      if (nextIndex < 0 || nextIndex >= images.length) return;
      setActiveId(images[nextIndex].id);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, images, modeActive]);

  useEffect(() => {
    if (images.length <= 1 || modeActive) return;
    const frame = requestAnimationFrame(() => {
      const list = thumbListRef.current;
      const thumb = activeThumbRef.current;
      if (!list || !thumb) return;
      const top = thumb.offsetTop - (list.clientHeight - thumb.offsetHeight) / 2;
      const left = thumb.offsetLeft - (list.clientWidth - thumb.offsetWidth) / 2;
      list.scrollTo({
        top: Math.max(0, top),
        left: Math.max(0, left),
        behavior: "smooth"
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeImage?.id, images.length, modeActive]);

  if (!activeImage) return null;

  const selectImage = (image: WorkImage) => {
    setActiveId(image.id);
  };
  const selectByOffset = (offset: number) => {
    if (images.length <= 1) return;
    const nextIndex = activeIndex + offset;
    if (nextIndex < 0 || nextIndex >= images.length) return;
    setActiveId(images[nextIndex].id);
  };
  const handleEditorWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (images.length <= 1 || modeActive) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest(
      "input, textarea, select, [contenteditable='true'], .editor-size-picker, .image-count-stepper, .image-count-menu, .material-picker"
    )) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(delta) < 4) return;
    event.preventDefault();
    if (thumbWheelThrottleRef.current) return;
    const nextIndex = activeIndex + (delta > 0 ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= images.length) return;
    setActiveId(images[nextIndex].id);
    thumbWheelThrottleRef.current = window.setTimeout(() => {
      thumbWheelThrottleRef.current = null;
    }, 180);
  };
  const handlePreviewWheel = (event: ReactWheelEvent<HTMLElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable='true'], .image-editor-annotation-input")) return;
    const targetButton = target?.closest("button");
    if (targetButton && !targetButton.classList.contains("image-editor-annotation-marker")) return;
    if (
      selectionMode
      && wheelAdjustsToolSize
      && target?.closest(".image-editor-mask-canvas")
    ) {
      const sizeDelta = wheelSizeDelta(event.deltaX, event.deltaY, BRUSH_SIZE_STEP);
      if (!sizeDelta) return;
      event.preventDefault();
      event.stopPropagation();
      adjustBrushSize(sizeDelta);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!modeActive && (wheelMode === "zoom" || event.ctrlKey || event.metaKey)) {
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (Math.abs(delta) < 1) return;
      adjustPreviewZoom(delta < 0 ? EDITOR_PREVIEW_SCALE_STEP : -EDITOR_PREVIEW_SCALE_STEP);
      return;
    }
    if (!canPreviewPan) return;

    let deltaX = previewWheelDelta(event.deltaX, event.deltaMode, stageSize.width);
    let deltaY = previewWheelDelta(event.deltaY, event.deltaMode, visibleStageSize.height || stageSize.height);
    const canPanX = previewPanBounds.x.max - previewPanBounds.x.min > 1;
    const canPanY = previewPanBounds.y.max - previewPanBounds.y.min > 1;

    if (event.shiftKey && Math.abs(deltaY) > Math.abs(deltaX)) {
      deltaX = deltaY;
      deltaY = 0;
    }
    if (!canPanX) deltaX = 0;
    if (!canPanY) deltaY = 0;
    if (!deltaX && !deltaY) return;

    setPreviewPan((current) => {
      const next = clampPreviewPan({ x: current.x - deltaX, y: current.y - deltaY });
      return next.x === current.x && next.y === current.y ? current : next;
    });
  };
  const handlePreviewPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!canPreviewPan || event.button !== 0) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const startsOnImage = Boolean(target?.closest(".image-editor-canvas-wrap"));
    const startsOnAnnotationSurface = annotationMode && target === annotationLayerRef.current;
    if ((modeActive && !startsOnAnnotationSurface) || (!startsOnImage && !startsOnAnnotationSurface)) return;
    previewPointerStartedOnImageRef.current = true;
    previewDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPan: previewPan,
      moved: false
    };
    if (!startsOnAnnotationSurface) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };
  const handlePreviewPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    event.preventDefault();
    event.stopPropagation();
    if (!drag.moved) {
      drag.moved = true;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      setPreviewDragging(true);
    }
    setPreviewPan(
      clampPreviewPan({
        x: drag.startPan.x + deltaX,
        y: drag.startPan.y + deltaY
      })
    );
  };
  const releasePreviewDrag = (event: ReactPointerEvent<HTMLElement>, activateOriginalSize: boolean) => {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    previewDragRef.current = null;
    setPreviewDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!activateOriginalSize) {
      previewPointerStartedOnImageRef.current = false;
      return;
    }
    if (activateOriginalSize && drag.moved) {
      previewClickHandledRef.current = true;
    }
    window.setTimeout(() => {
      previewClickHandledRef.current = false;
      previewPointerStartedOnImageRef.current = false;
    }, 250);
  };
  const finishPreviewDrag = (event: ReactPointerEvent<HTMLElement>) => releasePreviewDrag(event, true);
  const cancelPreviewDrag = (event: ReactPointerEvent<HTMLElement>) => releasePreviewDrag(event, false);
  const handlePreviewClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (modeActive) return;
    const startedOnImage = previewPointerStartedOnImageRef.current;
    previewPointerStartedOnImageRef.current = false;
    if (previewClickHandledRef.current) {
      previewClickHandledRef.current = false;
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target?.closest(".image-editor-canvas-wrap") && !startedOnImage) return;
    if (previewUsesHandCursor) resetPreviewTransform();
    else showPreviewOriginalSize();
  };
  const handlePreviewNavigatorPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (modeActive || !previewNavigatorMetrics || !canPreviewPan || event.button !== 0) return;
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
    if (previewNavigatorDragRef.current !== event.pointerId) return;
    previewNavigatorDragRef.current = null;
    setPreviewDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const clearSelection = () => {
    pointerActiveRef.current = false;
    currentStrokeRef.current = null;
    pointerStartRef.current = null;
    strokesRef.current = [];
    selectionSnapshotRef.current = null;
    setStrokes([]);
    setRedoStrokes([]);
    setLiveStrokeActive(false);
    hideBrushCursor();
    drawSelectionOverlay();
  };
  const clearAnnotations = () => {
    annotationDragRef.current = null;
    setAnnotations([]);
    setAnnotationDraft(null);
    setAnnotationTooltipsVisible(false);
    setEditorError("");
  };
  const enterMode = (nextMode: "markup" | "annotation" | "remove") => {
    setMarkupZoomValue("fit");
    resetPreviewTransform();
    clearSelection();
    clearAnnotations();
    setMarkupElements([]);
    setBrushPreviewActive(false);
    setBrushPreviewAnchor(DEFAULT_BRUSH_PREVIEW_ANCHOR);
    setEditorError("");
    setMode(nextMode);
  };
  const exitMode = () => {
    setMode("standard");
    clearSelection();
    clearAnnotations();
    setMarkupElements([]);
    setBrushPreviewActive(false);
    setBrushPreviewAnchor(DEFAULT_BRUSH_PREVIEW_ANCHOR);
    setEditorError("");
  };
  const annotationPointFromClient = (clientX: number, clientY: number) => {
    const layer = annotationLayerRef.current;
    if (!layer) return null;
    const rect = layer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      xPercent: clampRatio((clientX - rect.left) / rect.width) * 100,
      yPercent: clampRatio((clientY - rect.top) / rect.height) * 100
    };
  };
  const openAnnotationDraft = (annotation: EditableImageAnnotation) => {
    setAnnotationDraft({ ...annotation });
    setEditorError("");
  };
  const saveAnnotationDraft = () => {
    if (!annotationDraft?.instruction.trim()) return;
    setAnnotations((current) =>
      upsertEditableImageAnnotation(current, annotationDraft, () => {
        annotationIdRef.current += 1;
        return `annotation-${annotationIdRef.current}`;
      })
    );
    setAnnotationDraft(null);
    setEditorError("");
  };
  const deleteAnnotation = (id: string) => {
    setAnnotations((current) => removeEditableImageAnnotation(current, id));
    setAnnotationDraft((current) => (current?.id === id ? null : current));
  };
  const updateAnnotationPosition = (id: string, xPercent: number, yPercent: number) => {
    setAnnotations((current) => moveEditableImageAnnotation(current, id, xPercent, yPercent));
    setAnnotationDraft((current) =>
      current?.id === id ? { ...current, xPercent: clampNumber(xPercent, 0, 100), yPercent: clampNumber(yPercent, 0, 100) } : current
    );
  };
  const handleAnnotationLayerClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!annotationMode || event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    if (previewClickHandledRef.current) return;
    const point = annotationPointFromClient(event.clientX, event.clientY);
    if (!point) return;
    setAnnotationDraft({ ...point, instruction: "" });
    setEditorError("");
  };
  const handleAnnotationPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, annotation: EditableImageAnnotation) => {
    if (!annotationMode || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    annotationDragRef.current = {
      id: annotation.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleAnnotationPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = annotationDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (!drag.moved && Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < 4) return;
    drag.moved = true;
    const point = annotationPointFromClient(event.clientX, event.clientY);
    if (point) updateAnnotationPosition(drag.id, point.xPercent, point.yPercent);
  };
  const finishAnnotationDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = annotationDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    annotationDragRef.current = null;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved) {
      const annotation = annotations.find((item) => item.id === drag.id);
      if (annotation) openAnnotationDraft(annotation);
    }
  };
  const handleAnnotationKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, annotation: EditableImageAnnotation) => {
    const arrowDeltas: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 }
    };
    const delta = arrowDeltas[event.key];
    if (delta) {
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 2 : 0.5;
      updateAnnotationPosition(annotation.id, annotation.xPercent + delta.x * step, annotation.yPercent + delta.y * step);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      deleteAnnotation(annotation.id);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      openAnnotationDraft(annotation);
    }
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!selectionMode) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = updateBrushCursor(event.clientX, event.clientY);
    if (!point) return;
    pointerActiveRef.current = true;
    pointerStartRef.current = point;
    currentStrokeRef.current = null;
    setLiveStrokeActive(false);
    drawSelectionOverlay();
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!selectionMode) return;
    event.preventDefault();
    const point = updateBrushCursor(event.clientX, event.clientY);
    if (!pointerActiveRef.current || !point) return;
    const startPoint = pointerStartRef.current;
    if (!currentStrokeRef.current) {
      if (!startPoint || Math.hypot(point.offsetX - startPoint.offsetX, point.offsetY - startPoint.offsetY) < 5) return;
      setRedoStrokes([]);
      currentStrokeRef.current = {
        points: [
          { x: startPoint.x, y: startPoint.y },
          { x: point.x, y: point.y }
        ],
        sizeRatio: startPoint.sizeRatio
      };
      setLiveStrokeActive(true);
      drawSelectionOverlay();
      return;
    }
    const lastPoint = currentStrokeRef.current.points[currentStrokeRef.current.points.length - 1];
    if (
      Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y)
        * Math.min(editSurfaceBounds?.width ?? displaySize.width, editSurfaceBounds?.height ?? displaySize.height)
      < 1.5
    ) return;
    currentStrokeRef.current.points.push({ x: point.x, y: point.y });
    drawSelectionOverlay();
  };
  const finishStroke = (hideCursor = false, commitTap = true) => {
    const startPoint = pointerStartRef.current;
    pointerActiveRef.current = false;
    pointerStartRef.current = null;
    if (hideCursor) hideBrushCursor();
    const stroke =
      currentStrokeRef.current ??
      (commitTap && startPoint
        ? {
            points: [{ x: startPoint.x, y: startPoint.y }],
            sizeRatio: startPoint.sizeRatio
          }
        : null);
    currentStrokeRef.current = null;
    setLiveStrokeActive(false);
    if (!stroke || stroke.points.length === 0) {
      drawSelectionOverlay();
      return;
    }
    setRedoStrokes([]);
    const next = [...strokesRef.current, stroke];
    strokesRef.current = next;
    setStrokes(next);
    drawSelectionOverlay();
  };
  const undoStroke = () => {
    setStrokes((current) => {
      const next = [...current];
      const removed = next.pop();
      if (removed) setRedoStrokes((redo) => [...redo, removed]);
      strokesRef.current = next;
      return next;
    });
    requestAnimationFrame(drawSelectionOverlay);
  };
  const redoStroke = () => {
    setRedoStrokes((current) => {
      const next = [...current];
      const restored = next.pop();
      if (restored) {
        setStrokes((value) => {
          const restoredStrokes = [...value, restored];
          strokesRef.current = restoredStrokes;
          return restoredStrokes;
        });
      }
      return next;
    });
    requestAnimationFrame(drawSelectionOverlay);
  };
  const buildMaskDataUrl = () => {
    const selectedStrokes = (currentStrokeRef.current ? [...strokesRef.current, currentStrokeRef.current] : strokesRef.current).filter(
      (stroke) => stroke.points.length > 0
    );
    if (naturalSize.width <= 0 || naturalSize.height <= 0) throw new Error(t("imageEditor.error.sizeReadFailed"));
    if (selectedStrokes.length === 0) throw new Error(t("imageEditor.error.noSelection"));
    const canvas = document.createElement("canvas");
    canvas.width = naturalSize.width;
    canvas.height = naturalSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(t("imageEditor.error.maskCreateFailed"));
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-out";
    for (const stroke of selectedStrokes) {
      renderMaskStroke(ctx, stroke, canvas.width, canvas.height, "#000000");
    }
    return canvas.toDataURL("image/png");
  };
  const buildMarkupDataUrl = () => {
    if (naturalSize.width <= 0 || naturalSize.height <= 0) throw new Error(t("imageEditor.error.sizeReadFailed"));
    if (markupElements.length === 0) throw new Error(t("imageEditor.error.markupRequired"));
    const sourceImage = imageRef.current;
    if (!sourceImage?.complete || sourceImage.naturalWidth <= 0 || sourceImage.naturalHeight <= 0) {
      throw new Error(t("imageEditor.error.sizeReadFailed"));
    }
    const canvas = document.createElement("canvas");
    canvas.width = naturalSize.width;
    canvas.height = naturalSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(t("imageEditor.error.markupCreateFailed"));
    drawDrawingElements(ctx, markupElements, canvas.width, canvas.height, {
      background: null,
      backgroundImage: sourceImage
    });
    try {
      return canvas.toDataURL("image/png");
    } catch {
      throw new Error(t("imageEditor.error.markupCreateFailed"));
    }
  };
  const submitFromEditor = () => {
    if (isSubmitting) {
      onLockedRequest();
      return;
    }
    const trimmedPrompt = prompt.trim();
    if (mode === "standard" && !trimmedPrompt) {
      setEditorError(t("imageEditor.error.promptRequired"));
      return;
    }
    if (markupMode && markupElements.length === 0) {
      setEditorError(t("imageEditor.error.markupRequired"));
      return;
    }
    if (annotationMode && annotations.length === 0) {
      setEditorError(t("imageEditor.error.annotationRequired"));
      return;
    }
    try {
      const maskDataUrl = selectionMode ? buildMaskDataUrl() : undefined;
      const markupDataUrl = markupMode ? buildMarkupDataUrl() : undefined;
      const editPrompt = markupMode ? trimmedPrompt || IMAGE_MARKUP_DEFAULT_PROMPT : selectionMode ? REMOVE_SELECTED_AREA_PROMPT : trimmedPrompt;
      setEditorError("");
      onSubmitEdit({
        image: activeImage,
        prompt: editPrompt,
        imageCount,
        imageModel,
        quality,
        editIntent: requestEditIntent,
        ...(annotationMode
          ? {
              imageAnnotations: annotations.map(({ xPercent, yPercent, instruction }) => ({
                xPercent,
                yPercent,
                instruction
              }))
            }
          : {}),
        maskDataUrl,
        sourceAssetIds: mode !== "remove" ? selectedSourceAssetIds : [],
        sourceCaseItemIds: mode !== "remove" ? selectedCaseMaterials.map((item) => item.caseItemId) : [],
        sourceInlineImages: mode !== "remove"
          ? [
              ...selectedSourceInlineImages,
              ...(markupDataUrl
                ? [{ id: `image-markup-${activeImage.id}`, name: `图片标注-${Date.now()}.png`, dataUrl: markupDataUrl }]
                : [])
            ]
          : [],
        ...(markupDataUrl ? { imageMarkupReference: true } : {})
      });
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : t("imageEditor.error.submitFailed"));
    }
  };
  const submitRemoveBackground = () => {
    if (isSubmitting) {
      onLockedRequest();
      return;
    }
    setEditorError("");
    onSubmitEdit({
      image: activeImage,
      prompt: REMOVE_IMAGE_BACKGROUND_PROMPT,
      imageCount,
      imageModel,
      quality,
      background: "transparent",
      sourceAssetIds: [],
      sourceCaseItemIds: []
    });
  };
  return (
    <div
      className={cx(
        "image-editor-shell",
        selectionMode && "is-remove-mode",
        markupMode && "is-markup-mode",
        annotationMode && "is-annotation-mode",
        images.length <= 1 && "single-image",
        previewDragging && "is-preview-dragging"
      )}
      onWheel={handleEditorWheel}
    >
      <ImageEditorTopbar
        activeImage={activeImage}
        downloadBaseName={downloadBaseName}
        hasSelection={hasSelection}
        isSubmitting={isSubmitting}
        mode={mode}
        markupZoomValue={markupZoomValue}
        redoStrokeCount={redoStrokes.length}
        selectedSize={selectedSize}
        sizeOptions={sizeOptions}
        strokeCount={strokes.length}
        previewOriginalSizeLabel={previewOriginalSizeLabel}
        previewResetActive={previewResetActive}
        previewZoomLabel={previewZoomLabel}
        previewZoomMin={Math.min(EDITOR_PREVIEW_MIN_SCALE * 100, Math.max(1, Math.floor(previewZoomPercentage)))}
        previewZoomMax={EDITOR_PREVIEW_MAX_SCALE * 100}
        previewZoomValue={previewZoomPercentage}
        showPreviewControls={!modeActive}
        onClearSelection={clearSelection}
        onClose={onClose}
        onEnterMode={enterMode}
        onExitMode={exitMode}
        onLockedRequest={onLockedRequest}
        onMarkupZoomChange={setMarkupPreviewZoom}
        onRemoveBackground={submitRemoveBackground}
        onRemoveSubmit={submitFromEditor}
        onPickSize={(option) => onPickSize(activeImage, option, imageCount, imageModel, quality)}
        onPreviewOriginalSize={showPreviewOriginalSize}
        onPreviewReset={resetPreviewTransform}
        onPreviewRotateLeft={() => setPreviewRotation((value) => value - 90)}
        onPreviewRotateRight={() => setPreviewRotation((value) => value + 90)}
        onPreviewZoomIn={() => adjustPreviewZoom(EDITOR_PREVIEW_SCALE_STEP)}
        onPreviewZoomOut={() => adjustPreviewZoom(-EDITOR_PREVIEW_SCALE_STEP)}
        onPreviewZoomChange={setPreviewZoomPercentage}
        onRedoStroke={redoStroke}
        onUndoStroke={undoStroke}
      />
      <div className="image-editor-body">
        {!modeActive && images.length > 1 ? (
          <ImageEditorRail
            activeImage={activeImage}
            activeIndex={activeIndex}
            activeThumbRef={activeThumbRef}
            images={images}
            totalImageCount={totalImageCount}
            thumbListRef={thumbListRef}
            onSelectByOffset={selectByOffset}
            onSelectImage={selectImage}
          />
        ) : null}
        <main
          ref={stageRef}
          className={cx(
            "image-editor-stage",
            previewNavigatorMetrics && "has-preview-navigator",
            canPreviewPan && "is-pannable",
            previewUsesHandCursor && "is-preview-zoomed",
            previewDragging && "is-dragging"
          )}
          onPointerDown={handlePreviewPointerDown}
          onPointerMove={handlePreviewPointerMove}
          onPointerUp={finishPreviewDrag}
          onPointerCancel={cancelPreviewDrag}
          onClick={handlePreviewClick}
          onWheel={handlePreviewWheel}
        >
          <div ref={viewportRef} className="image-editor-viewport">
            {selectionMode ? (
              <label
                className="drawing-size-control drawing-size-control-embedded image-editor-remove-size-control"
                style={brushSizeControlStyle}
              >
                <span className="visually-hidden">{t("imageEditor.brushSize")}</span>
                <span className="drawing-size-rail" aria-hidden="true">
                  <span className="drawing-size-fill" />
                  <span className="drawing-size-thumb" />
                </span>
                <input
                  type="range"
                  min={BRUSH_MIN_SIZE}
                  max={BRUSH_MAX_SIZE}
                  step={BRUSH_SIZE_STEP}
                  value={brushSize}
                  aria-label={t("imageEditor.brushSize")}
                  aria-valuetext={`${brushSize}px`}
                  aria-orientation="vertical"
                  onPointerDown={() => setBrushSizePreviewActive(true)}
                  onPointerUp={() => setBrushSizePreviewActive(false)}
                  onPointerCancel={() => setBrushSizePreviewActive(false)}
                  onLostPointerCapture={() => setBrushSizePreviewActive(false)}
                  onBlur={() => setBrushSizePreviewActive(false)}
                  onChange={(event) => setBrushSizeValue(Number(event.currentTarget.value))}
                />
              </label>
            ) : null}
            <div
              className={cx(
                "image-editor-canvas-wrap",
                originalSizePreviewActive && "is-original-size",
                animatePreviewTransform && "is-transform-animated"
              )}
              style={previewCanvasStyle}
            >
              <img
                ref={imageRef}
                src={activeImageDisplayUrl}
                alt={activeImageDisplayPrompt}
                className="image-editor-image"
                style={previewImageStyle}
                onLoad={(event) => {
                  const target = event.currentTarget;
                  setNaturalSize(activeImageMetadataSize ?? { width: target.naturalWidth, height: target.naturalHeight });
                  if (!previewOriginalSizeModeRef.current) {
                    setDisplaySize({ width: Math.round(target.offsetWidth), height: Math.round(target.offsetHeight) });
                  }
                }}
              />
              {selectionMode && editSurfacePortalRef.current ? createPortal(<>
              <canvas
                ref={canvasRef}
                className="image-editor-mask-canvas enabled"
                style={{
                  width: "100%",
                  height: "100%"
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerEnter={(event) => {
                  if (selectionMode) updateBrushCursor(event.clientX, event.clientY);
                }}
                onPointerUp={() => finishStroke()}
                onPointerCancel={() => finishStroke(true, false)}
                onPointerLeave={() => finishStroke(true, false)}
              />
              {selectionMode ? (
                <>
                  <span
                    ref={brushCursorRef}
                    className="image-editor-brush-cursor"
                    style={{
                      width: brushSize,
                      height: brushSize
                    }}
                  />
                  {brushPreviewActive ? (
                    <span
                      className="image-editor-brush-size-preview"
                      data-testid="brush-size-preview"
                      style={{
                        left: brushPreview.centerX,
                        top: brushPreview.centerY,
                        width: brushPreview.diameter,
                        height: brushPreview.diameter
                      }}
                    />
                  ) : null}
                </>
              ) : null}
              </>, editSurfacePortalRef.current) : null}
              {annotationMode && editSurfacePortalRef.current ? createPortal(
                <div
                  ref={annotationLayerRef}
                  className={cx("image-editor-annotation-layer", annotationTooltipsVisible && "show-all-tooltips")}
                  onClick={handleAnnotationLayerClick}
                >
                  <span className="visually-hidden">{t("imageEditor.annotationInstruction")}</span>
                  {annotations.map((annotation, index) => (
                    <button
                      key={annotation.id}
                      type="button"
                      className={cx("image-editor-annotation-marker", annotationDraft?.id === annotation.id && "active")}
                      style={{ left: `${annotation.xPercent}%`, top: `${annotation.yPercent}%` }}
                      aria-label={t("imageEditor.annotationMarkerLabel", { count: index + 1, instruction: annotation.instruction })}
                      onPointerDown={(event) => handleAnnotationPointerDown(event, annotation)}
                      onPointerMove={handleAnnotationPointerMove}
                      onPointerUp={finishAnnotationDrag}
                      onPointerCancel={finishAnnotationDrag}
                      onKeyDown={(event) => handleAnnotationKeyDown(event, annotation)}
                    >
                      <span className="image-editor-annotation-marker-number">{index + 1}</span>
                      <span className="image-editor-annotation-tooltip" aria-hidden="true">
                        {annotation.instruction}
                      </span>
                    </button>
                  ))}
                  {annotationDraft && !annotationDraft.id ? (
                    <span
                      className="image-editor-annotation-marker is-draft"
                      style={{ left: `${annotationDraft.xPercent}%`, top: `${annotationDraft.yPercent}%` }}
                      aria-hidden="true"
                    >
                      <span className="image-editor-annotation-marker-number">{annotations.length + 1}</span>
                    </span>
                  ) : null}
                  {annotationDraft && annotationEditor ? (
                    <div
                      className="image-editor-annotation-input"
                      style={{ left: annotationEditor.left, top: annotationEditor.top, width: annotationEditor.width }}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <input
                        ref={annotationInputRef}
                        value={annotationDraft.instruction}
                        maxLength={2000}
                        placeholder={t("imageEditor.annotationPlaceholder")}
                        aria-label={t("imageEditor.annotationPlaceholder")}
                        onChange={(event) => setAnnotationDraft((current) => current ? { ...current, instruction: event.target.value } : current)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            saveAnnotationDraft();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            setAnnotationDraft(null);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="image-editor-annotation-save"
                        disabled={!annotationDraft.instruction.trim()}
                        aria-label={t("common.save")}
                        onClick={saveAnnotationDraft}
                      >
                        <Check size={16} />
                      </button>
                      {annotationDraft.id ? (
                        <button
                          type="button"
                          className="image-editor-annotation-delete"
                          aria-label={t("common.delete")}
                          onClick={() => deleteAnnotation(annotationDraft.id!)}
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="image-editor-annotation-cancel"
                          aria-label={t("common.cancel")}
                          onClick={() => setAnnotationDraft(null)}
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>,
                editSurfacePortalRef.current
              ) : null}
            </div>
            {modeActive ? (
              <div
                ref={editSurfacePortalRef}
                className="image-editor-mode-surface"
                style={editSurfaceBounds
                  ? {
                      left: editSurfaceBounds.left,
                      top: editSurfaceBounds.top,
                      width: editSurfaceBounds.width,
                      height: editSurfaceBounds.height
                    }
                  : { display: "none" }}
              />
            ) : null}
            {markupMode && editSurfaceBounds ? (
              <DrawingCanvasDialog
                open
                embedded
                embeddedBounds={editSurfaceBounds}
                wheelAdjustsSize={wheelAdjustsToolSize}
                onClose={exitMode}
                onElementsChange={setMarkupElements}
              />
            ) : null}
          </div>
          {selectionMode && editorError ? <div className="image-editor-mode-error form-error">{editorError}</div> : null}
          {previewNavigatorMetrics ? (
            <div className={cx("image-editor-preview-navigator", canPreviewPan && "is-active")} aria-label={t("imagePreview.tools")}>
              <div
                className="image-editor-preview-navigator-track"
                style={{
                  width: previewNavigatorMetrics.imageWidth,
                  height: previewNavigatorMetrics.imageHeight
                }}
                onPointerDown={handlePreviewNavigatorPointerDown}
                onPointerMove={handlePreviewNavigatorPointerMove}
                onPointerUp={finishPreviewNavigatorDrag}
                onPointerCancel={finishPreviewNavigatorDrag}
              >
                <img
                  src={activeImage.thumbnailUrl || activeImage.previewUrl || activeImage.url}
                  alt=""
                  draggable={false}
                  style={{
                    width: previewBaseSize.width * previewNavigatorMetrics.scale,
                    height: previewBaseSize.height * previewNavigatorMetrics.scale,
                    transform: `translate(-50%, -50%) rotate(${previewRotation}deg)`
                  }}
                />
                <span
                  className="image-editor-preview-navigator-window"
                  style={{
                    left: previewNavigatorMetrics.rectLeft,
                    top: previewNavigatorMetrics.rectTop,
                    width: previewNavigatorMetrics.rectWidth,
                    height: previewNavigatorMetrics.rectHeight
                  }}
                />
              </div>
            </div>
          ) : null}
        </main>
      </div>
      {!selectionMode ? <ImageEditorComposer
        annotationCount={annotations.length}
        annotationMode={annotationMode}
        annotationTooltipsVisible={annotationTooltipsVisible}
        markupCount={markupElements.length}
        markupMode={markupMode}
        assets={assets}
        composerWrapRef={composerWrapRef}
        editorError={editorError}
        effectiveImageCount={effectiveImageCount}
        imageCount={imageCount}
        imageModel={imageModel}
        isSubmitting={isSubmitting}
        materialPickerOpen={materialPickerOpen}
        previews={editorComposerPreviews}
        prompt={prompt}
        quality={quality}
        qualityOptions={qualityOptions}
        selectedAssets={selectedAssets}
        onPromptChange={setPrompt}
        onImageCountChange={setImageCount}
        onImageModelChange={selectImageModel}
        onQualityChange={setQuality}
        onLockedRequest={onLockedRequest}
        onClearAnnotations={clearAnnotations}
        onToggleAnnotationTooltips={() => setAnnotationTooltipsVisible((visible) => !visible)}
        onSelectedAssetsChange={setSelectedAssets}
        onSubmit={(event) => {
          event.preventDefault();
          submitFromEditor();
        }}
        onOpenCasePicker={onOpenCasePicker}
        onToggleAsset={toggleAsset}
        onToggleMaterialPicker={onToggleMaterialPicker}
      /> : null}
    </div>
  );
}
