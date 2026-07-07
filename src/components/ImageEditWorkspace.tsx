import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import {
  ImageEditorComposer,
  ImageEditorRail,
  ImageEditorTopbar
} from "./ImageEditorControls";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import type { SizeOption } from "../lib/imageOptions";
import {
  BRUSH_MAX_SIZE,
  BRUSH_MIN_SIZE,
  BRUSH_SIZE_STEP,
  SELECTION_DASH_PATTERN_LENGTH,
  SELECTION_DASH_SPEED_MS,
  buildSelectionOverlaySnapshot,
  clampRatio,
  renderMaskStroke,
  renderSelectionOverlay,
  selectionOverlayKey,
  type SelectionOverlaySnapshot,
  type Stroke
} from "../lib/selectionMask";
import { useWorkbench } from "../store/workbench";
import type { AssetItem, WorkImage } from "../types";

export type ImageEditorState = {
  images: WorkImage[];
  activeImageId: string;
};

type ImageEditWorkspaceProps = {
  images: WorkImage[];
  activeImageId: string;
  sizeOptions: SizeOption[];
  selectedSize: string;
  isSubmitting: boolean;
  assets?: { assets: AssetItem[] };
  materialPickerOpen: boolean;
  onClose: () => void;
  onPickSize: (image: WorkImage, option: SizeOption) => void;
  onOpenCasePicker: () => void;
  onToggleMaterialPicker: () => void;
  onSubmitEdit: (payload: { image: WorkImage; prompt: string; maskDataUrl?: string; sourceAssetIds?: string[]; sourceCaseItemIds?: string[] }) => void;
};

const EDITOR_PREVIEW_MIN_SCALE = 0.1;
const EDITOR_PREVIEW_MAX_SCALE = 3;
const EDITOR_PREVIEW_SCALE_STEP = 0.1;

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
  sizeOptions,
  selectedSize,
  isSubmitting,
  assets,
  materialPickerOpen,
  onClose,
  onPickSize,
  onOpenCasePicker,
  onToggleMaterialPicker,
  onSubmitEdit
}: ImageEditWorkspaceProps) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState(activeImageId);
  const [selectionMode, setSelectionMode] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [brushSize, setBrushSize] = useState(80);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStrokes, setRedoStrokes] = useState<Stroke[]>([]);
  const [liveStrokeActive, setLiveStrokeActive] = useState(false);
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushCursorRef = useRef<HTMLSpanElement | null>(null);
  const thumbListRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);
  const thumbWheelThrottleRef = useRef<number | null>(null);
  const previewDragRef = useRef<{ pointerId: number; startX: number; startY: number; startPan: { x: number; y: number } } | null>(null);
  const previewNavigatorDragRef = useRef<number | null>(null);
  const pointerActiveRef = useRef(false);
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number; sizeRatio: number } | null>(null);
  const dashOffsetRef = useRef(0);
  const selectionSnapshotRef = useRef<{ key: string; snapshot: SelectionOverlaySnapshot | null } | null>(null);

  const activeImage = images.find((image) => image.id === activeId) ?? images[0];
  const activeIndex = Math.max(0, images.findIndex((image) => image.id === activeImage?.id));
  const activeImageOriginalUrl = activeImage?.originalUrl || activeImage?.url || "";
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
  const brushProgress = ((brushSize - BRUSH_MIN_SIZE) / (BRUSH_MAX_SIZE - BRUSH_MIN_SIZE)) * 100;
  const brushRangeStyle = { "--brush-progress": `${Math.max(0, Math.min(100, brushProgress))}%` } as CSSProperties;
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
  const previewPanBounds =
    previewDisplaySize && stageSize.width > 0 && stageSize.height > 0
      ? {
          x: buildPreviewPanAxisBounds(previewDisplaySize.width, stageSize.width, visibleStageSize.width),
          y: buildPreviewPanAxisBounds(previewDisplaySize.height, stageSize.height, visibleStageSize.height)
        }
      : { x: { min: 0, max: 0 }, y: { min: 0, max: 0 } };
  const canPreviewPan = Boolean(
    !selectionMode &&
    previewDisplaySize &&
    ((visibleStageSize.width > 0 && previewDisplaySize.width > visibleStageSize.width + 1) ||
      (visibleStageSize.height > 0 && previewDisplaySize.height > visibleStageSize.height + 1))
  );
  const previewZoomLabel = `${Math.round(previewZoom * previewBaseScale * 100)}%`;
  const previewOriginalSizeLabel =
    naturalSize.width > 0 && naturalSize.height > 0 ? `${naturalSize.width}x${naturalSize.height}` : "";
  const originalSizePreviewActive = !selectionMode && previewOriginalSizeMode && naturalSize.width > 0 && naturalSize.height > 0;
  const previewCanvasPosition =
    previewBaseSize.width > 0 && previewBaseSize.height > 0 && previewDisplaySize && stageSize.width > 0 && stageSize.height > 0
      ? (() => {
          const rawLeft = stageSize.width / 2 + previewPan.x - previewBaseSize.width / 2;
          const rawTop = stageSize.height / 2 + previewPan.y - previewBaseSize.height / 2;
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
  const previewCanvasStyle = selectionMode
    ? previewCanvasPosition
      ? ({
          left: previewCanvasPosition.left,
          top: previewCanvasPosition.top,
          transform: "rotate(0deg) scale(1)"
        } satisfies CSSProperties)
      : ({ transform: "translate(-50%, -50%)" } satisfies CSSProperties)
    : previewCanvasPosition
    ? ({
        left: previewCanvasPosition.left,
        top: previewCanvasPosition.top,
        transform: `rotate(${previewRotation}deg) scale(${previewZoom})`
      } satisfies CSSProperties)
    : ({
        transform: `translate(-50%, -50%) rotate(${previewRotation}deg) scale(${previewZoom})`
      } satisfies CSSProperties);
  const animatePreviewTransform = Boolean(
    !selectionMode &&
      previewCanvasPosition &&
      (previewZoom !== 1 || normalizedPreviewRotation !== 0)
  );
  const originalSizeImageStyle = originalSizePreviewActive
    ? ({
        width: naturalSize.width,
        height: naturalSize.height
      } satisfies CSSProperties)
    : undefined;
  const previewNavigatorMetrics =
    !selectionMode && canPreviewPan && previewContentSize && previewDisplaySize && visibleStageSize.width > 0 && visibleStageSize.height > 0
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
  const adjustBrushSize = (delta: number) => {
    setBrushSize((value) => Math.max(BRUSH_MIN_SIZE, Math.min(BRUSH_MAX_SIZE, value + delta)));
  };
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
  const previewDefaultPan = () => {
    const defaultContentSize = previewContentSize ?? (displaySize.width > 0 && displaySize.height > 0 ? displaySize : null);
    return defaultContentSize && stageSize.width > 0 && stageSize.height > 0 && visibleStageSize.width > 0 && visibleStageSize.height > 0
      ? {
          x: buildPreviewCenterPan(
            stageSize.width,
            visibleStageSize.width,
            buildPreviewPanAxisBounds(defaultContentSize.width, stageSize.width, visibleStageSize.width)
          ),
          y: buildPreviewStartPan(defaultContentSize.height, stageSize.height, visibleStageSize.height)
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
    setPreviewOriginalSizeMode(false);
    setPreviewZoom(1);
    setPreviewRotation(0);
    setPreviewPan(previewDefaultPan());
    setPreviewDragging(false);
    previewDragRef.current = null;
    previewNavigatorDragRef.current = null;
  };
  const showPreviewOriginalSize = () => {
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
        return Math.max(EDITOR_PREVIEW_MIN_SCALE, Number((value + delta).toFixed(2)));
      }
      const currentScale = value * previewBaseScale;
      const nextScale = clampNumber(Number((currentScale + delta).toFixed(2)), EDITOR_PREVIEW_MIN_SCALE, EDITOR_PREVIEW_MAX_SCALE);
      return previewBaseScale > 0 ? nextScale / previewBaseScale : nextScale;
    });
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
  }, [activeImage?.id, editorComposerPreviews.length, editorError, materialPickerOpen]);

  useEffect(() => {
    setPreviewPan((value) => {
      const next = clampPreviewPan(value);
      return next.x === value.x && next.y === value.y ? value : next;
    });
  }, [previewPanBounds.x.min, previewPanBounds.x.max, previewPanBounds.y.min, previewPanBounds.y.max]);

  const drawSelectionOverlay = () => {
    const canvas = canvasRef.current;
    if (!canvas || displaySize.width <= 0 || displaySize.height <= 0) return;
    if (canvas.width !== displaySize.width) canvas.width = displaySize.width;
    if (canvas.height !== displaySize.height) canvas.height = displaySize.height;
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
      renderSelectionOverlay(ctx, selectionSnapshotRef.current.snapshot, dashOffsetRef.current);
    }
  };

  function hideBrushCursor() {
    const cursor = brushCursorRef.current;
    if (cursor) cursor.style.display = "none";
  }

  useEffect(() => setActiveId(activeImageId), [activeImageId]);

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
    setSelectionMode(false);
    resetPreviewTransform();
    hideBrushCursor();
    setStrokes([]);
    setRedoStrokes([]);
    setLiveStrokeActive(false);
    strokesRef.current = [];
    currentStrokeRef.current = null;
    pointerStartRef.current = null;
    selectionSnapshotRef.current = null;
    setEditorError("");
  }, [activeImage?.id]);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const updateSize = () => {
      setDisplaySize({
        width: Math.max(0, Math.round(image.offsetWidth)),
        height: Math.max(0, Math.round(image.offsetHeight))
      });
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
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
  }, [activeImageOriginalUrl, selectionMode]);

  useEffect(() => {
    strokesRef.current = strokes;
    drawSelectionOverlay();
  }, [displaySize, strokes]);

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
  }, [selectionMode, hasSelection, displaySize, strokes]);

  useEffect(() => {
    if (!selectionMode || isSubmitting) return;

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
  }, [isSubmitting, selectionMode]);

  useEffect(() => {
    if (images.length <= 1 || selectionMode || isSubmitting) return;

    function isTypingTarget(target: EventTarget | null) {
      const element = target instanceof HTMLElement ? target : null;
      return Boolean(element?.closest("input, textarea, select, [contenteditable='true'], .editor-size-picker"));
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
  }, [activeIndex, images, isSubmitting, selectionMode]);

  useEffect(() => {
    if (images.length <= 1 || selectionMode) return;
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
  }, [activeImage?.id, images.length, selectionMode]);

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
    if (images.length <= 1 || selectionMode || isSubmitting) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable='true'], .editor-size-picker, .material-picker")) return;
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
    if (selectionMode || isSubmitting) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(delta) < 1) return;
    adjustPreviewZoom(delta < 0 ? EDITOR_PREVIEW_SCALE_STEP : -EDITOR_PREVIEW_SCALE_STEP);
  };
  const handlePreviewPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (selectionMode || isSubmitting || !canPreviewPan || event.button !== 0) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("button, input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    event.stopPropagation();
    previewDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPan: previewPan
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreviewDragging(true);
  };
  const handlePreviewPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setPreviewPan(
      clampPreviewPan({
        x: drag.startPan.x + event.clientX - drag.startX,
        y: drag.startPan.y + event.clientY - drag.startY
      })
    );
  };
  const finishPreviewDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (previewDragRef.current?.pointerId !== event.pointerId) return;
    previewDragRef.current = null;
    setPreviewDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handlePreviewNavigatorPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (selectionMode || isSubmitting || !previewNavigatorMetrics || !canPreviewPan || event.button !== 0) return;
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
  const enterSelectionMode = () => {
    resetPreviewTransform();
    setSelectionMode(true);
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
  const exitSelectionMode = () => {
    setSelectionMode(false);
    clearSelection();
  };
  const mapClientPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clampRatio((clientX - rect.left) / rect.width),
      y: clampRatio((clientY - rect.top) / rect.height),
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      sizeRatio: brushSize / Math.min(rect.width, rect.height)
    };
  };
  const updateBrushCursor = (clientX: number, clientY: number) => {
    const point = mapClientPoint(clientX, clientY);
    if (!point) {
      hideBrushCursor();
      return null;
    }
    const cursor = brushCursorRef.current;
    if (cursor) {
      cursor.style.display = "block";
      cursor.style.width = `${brushSize}px`;
      cursor.style.height = `${brushSize}px`;
      cursor.style.transform = `translate(${point.offsetX - brushSize / 2}px, ${point.offsetY - brushSize / 2}px)`;
    }
    return point;
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!selectionMode || isSubmitting) return;
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
    if (!selectionMode || isSubmitting) return;
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
    if (Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) * Math.min(displaySize.width, displaySize.height) < 1.5) return;
    currentStrokeRef.current.points.push({ x: point.x, y: point.y });
    drawSelectionOverlay();
  };
  const finishStroke = (hideCursor = false) => {
    pointerActiveRef.current = false;
    pointerStartRef.current = null;
    if (hideCursor) hideBrushCursor();
    const stroke = currentStrokeRef.current;
    currentStrokeRef.current = null;
    setLiveStrokeActive(false);
    if (!stroke || stroke.points.length < 2) {
      drawSelectionOverlay();
      return;
    }
    const next = [...strokesRef.current, stroke];
    strokesRef.current = next;
    setStrokes(next);
    drawSelectionOverlay();
  };
  const undoStroke = () => {
    if (isSubmitting) return;
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
    if (isSubmitting) return;
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
      (stroke) => stroke.points.length > 1
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
  const submitFromEditor = () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setEditorError(t("imageEditor.error.promptRequired"));
      return;
    }
    try {
      const maskDataUrl = selectionMode ? buildMaskDataUrl() : undefined;
      setEditorError("");
      onSubmitEdit({
        image: activeImage,
        prompt: trimmedPrompt,
        maskDataUrl,
        sourceAssetIds: selectedAssets.map((asset) => asset.id),
        sourceCaseItemIds: selectedCaseMaterials.map((item) => item.caseItemId)
      });
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : t("imageEditor.error.submitFailed"));
    }
  };
  const shareImage = async () => {
    const url = new URL(activeImageOriginalUrl, window.location.origin).toString();
    if (navigator.share) {
      await navigator.share({ title: activeImage.prompt || t("imageEditor.shareTitle"), url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
  };
  return (
    <div
      className={cx(
        "image-editor-shell",
        selectionMode && "selecting",
        images.length <= 1 && "single-image",
        previewDragging && "is-preview-dragging"
      )}
      onWheel={handleEditorWheel}
    >
      <ImageEditorTopbar
        activeImage={activeImage}
        brushRangeStyle={brushRangeStyle}
        brushSize={brushSize}
        hasSelection={hasSelection}
        isSubmitting={isSubmitting}
        redoStrokeCount={redoStrokes.length}
        selectedSize={selectedSize}
        selectionMode={selectionMode}
        sizeOptions={sizeOptions}
        strokeCount={strokes.length}
        previewOriginalSizeLabel={previewOriginalSizeLabel}
        previewZoomLabel={previewZoomLabel}
        showPreviewControls={!selectionMode}
        onAdjustBrushSize={adjustBrushSize}
        onBrushSizeChange={(value) => setBrushSize(Math.max(BRUSH_MIN_SIZE, Math.min(BRUSH_MAX_SIZE, value)))}
        onClearSelection={clearSelection}
        onClose={onClose}
        onEnterSelectionMode={enterSelectionMode}
        onExitSelectionMode={exitSelectionMode}
        onPickSize={(option) => onPickSize(activeImage, option)}
        onPreviewOriginalSize={showPreviewOriginalSize}
        onPreviewReset={resetPreviewTransform}
        onPreviewRotateLeft={() => setPreviewRotation((value) => value - 90)}
        onPreviewRotateRight={() => setPreviewRotation((value) => value + 90)}
        onPreviewZoomIn={() => adjustPreviewZoom(EDITOR_PREVIEW_SCALE_STEP)}
        onPreviewZoomOut={() => adjustPreviewZoom(-EDITOR_PREVIEW_SCALE_STEP)}
        onRedoStroke={redoStroke}
        onShareImage={() => void shareImage()}
        onUndoStroke={undoStroke}
      />
      <div className="image-editor-body">
        {!selectionMode && images.length > 1 ? (
          <ImageEditorRail
            activeImage={activeImage}
            activeIndex={activeIndex}
            activeThumbRef={activeThumbRef}
            images={images}
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
            previewDragging && "is-dragging"
          )}
          onPointerDown={handlePreviewPointerDown}
          onPointerMove={handlePreviewPointerMove}
          onPointerUp={finishPreviewDrag}
          onPointerCancel={finishPreviewDrag}
          onWheel={handlePreviewWheel}
        >
          <div ref={viewportRef} className="image-editor-viewport">
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
                src={activeImageOriginalUrl}
                alt={activeImage.prompt}
                className="image-editor-image"
                style={originalSizeImageStyle}
                onLoad={(event) => {
                  const target = event.currentTarget;
                  setNaturalSize({ width: target.naturalWidth, height: target.naturalHeight });
                  setDisplaySize({ width: Math.round(target.offsetWidth), height: Math.round(target.offsetHeight) });
                }}
              />
              <canvas
                ref={canvasRef}
                className={cx("image-editor-mask-canvas", selectionMode && "enabled")}
                style={{
                  width: displaySize.width,
                  height: displaySize.height
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerEnter={(event) => {
                  if (selectionMode && !isSubmitting) updateBrushCursor(event.clientX, event.clientY);
                }}
                onPointerUp={() => finishStroke()}
                onPointerCancel={() => finishStroke(true)}
                onPointerLeave={() => finishStroke(true)}
              />
              {selectionMode ? (
                <span
                  ref={brushCursorRef}
                  className="image-editor-brush-cursor"
                  style={{
                    width: brushSize,
                    height: brushSize
                  }}
                />
              ) : null}
            </div>
          </div>
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
      <ImageEditorComposer
        assets={assets}
        composerWrapRef={composerWrapRef}
        editorError={editorError}
        isSubmitting={isSubmitting}
        materialPickerOpen={materialPickerOpen}
        previews={editorComposerPreviews}
        prompt={prompt}
        selectedAssets={selectedAssets}
        onPromptChange={setPrompt}
        onSelectedAssetsChange={setSelectedAssets}
        onSubmit={(event) => {
          event.preventDefault();
          submitFromEditor();
        }}
        onOpenCasePicker={onOpenCasePicker}
        onToggleAsset={toggleAsset}
        onToggleMaterialPicker={onToggleMaterialPicker}
      />
    </div>
  );
}
