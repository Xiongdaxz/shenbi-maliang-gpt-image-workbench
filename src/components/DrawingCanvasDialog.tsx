import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Brush,
  Check,
  Circle,
  Diamond,
  Eraser,
  Heart,
  Hexagon,
  Minus,
  MousePointer2,
  RectangleHorizontal,
  Redo2,
  Shapes,
  Square,
  Star,
  Triangle,
  Type,
  Undo2,
  X
} from "lucide-react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import {
  DRAWING_DEFAULT_ERASER_WIDTH,
  DRAWING_DEFAULT_STROKE_WIDTH,
  DRAWING_DEFAULT_TEXT_SIZE,
  DRAWING_EXPORT_SIZE,
  DRAWING_MAX_ERASER_WIDTH,
  DRAWING_MAX_STROKE_WIDTH,
  DRAWING_MAX_TEXT_SIZE,
  DRAWING_MIN_ERASER_WIDTH,
  DRAWING_MIN_STROKE_WIDTH,
  DRAWING_MIN_TEXT_SIZE,
  DRAWING_TEXT_HORIZONTAL_PADDING,
  clampDrawingNumber,
  drawDrawingElements,
  drawingElementBounds,
  drawingTextLineWidth,
  drawingTextSizeFromRatio,
  drawingTextSizeRatio,
  eraseDrawingElements,
  exportDrawingBlob,
  moveDrawingElement,
  nextDrawingElementId,
  resizeDrawingElement,
  topDrawingElementAt,
  type DrawingBounds,
  type DrawingElement,
  type DrawingPoint,
  type DrawingShapeType,
  type DrawingTextElement
} from "../lib/drawingCanvas";
import { wheelSizeDelta } from "../lib/editorInput";
import { ConfirmDialog, ModalPortal } from "../ui";

type DrawingTool = "select" | "brush" | "text" | "shape" | "eraser";
type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type DrawingHoverMode = ResizeHandle | "move" | null;
const TEXT_DRAFT_RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const DRAWING_WHEEL_SIZE_STEP = 2;

type DrawingCanvasDialogProps = {
  open: boolean;
  embedded?: boolean;
  embeddedBounds?: { left: number; top: number; width: number; height: number } | null;
  wheelAdjustsSize?: boolean;
  initialElements?: DrawingElement[];
  onClose: () => void;
  onConfirm?: (result: DrawingCanvasResult) => Promise<void> | void;
  onElementsChange?: (elements: DrawingElement[]) => void;
};

export type DrawingCanvasResult = {
  file: File;
  elements: DrawingElement[];
};

type TextDraft = {
  temporaryId: string;
  editingElementId?: string;
  x: number;
  y: number;
  value: string;
  color: string;
  fontSize: number;
  boxWidth: number;
  boxHeight: number;
};

type TextDraftResizeInteraction = {
  pointerId: number;
  handle: ResizeHandle;
  startX: number;
  startY: number;
  canvasWidth: number;
  canvasHeight: number;
  x: number;
  y: number;
  boxWidth: number;
  boxHeight: number;
  fontSize: number;
};

type DrawingInteraction = {
  pointerId: number;
  kind: "brush" | "shape" | "erase" | "move" | "resize";
  before: DrawingElement[];
  start: DrawingPoint;
  path?: DrawingPoint[];
  elementId?: string;
  originalElement?: DrawingElement;
  originalBounds?: DrawingBounds;
  resizeHandle?: ResizeHandle;
};

const PRESET_COLORS = [
  "#000000",
  "#6B7280",
  "#92400E",
  "#DC2626",
  "#F97316",
  "#F59E0B",
  "#16A34A",
  "#0F766E",
  "#06B6D4",
  "#2563EB",
  "#4F46E5",
  "#7C3AED",
  "#DB2777"
];
const EMPTY_DRAWING_ELEMENTS: DrawingElement[] = [];
const DRAWING_ELEMENT_MIN_SCALE = 0.04;
const DRAWING_ELEMENT_MAX_SCALE = 0.92;
const DRAWING_ELEMENT_SLIDER_MIN = 4;
const DRAWING_ELEMENT_SLIDER_MAX = 64;
const DRAWING_TEXT_DEFAULT_INPUT_WIDTH = 220;
const DRAWING_TEXT_FRAME_HEIGHT_FACTOR = 1.2;

const SHAPE_OPTIONS: Array<{ value: DrawingShapeType; icon: typeof Minus; labelKey: string }> = [
  { value: "line", icon: Minus, labelKey: "drawing.shape.line" },
  { value: "arrow", icon: ArrowRight, labelKey: "drawing.shape.arrow" },
  { value: "rectangle", icon: Square, labelKey: "drawing.shape.rectangle" },
  { value: "roundedRectangle", icon: RectangleHorizontal, labelKey: "drawing.shape.roundedRectangle" },
  { value: "ellipse", icon: Circle, labelKey: "drawing.shape.ellipse" },
  { value: "triangle", icon: Triangle, labelKey: "drawing.shape.triangle" },
  { value: "diamond", icon: Diamond, labelKey: "drawing.shape.diamond" },
  { value: "star", icon: Star, labelKey: "drawing.shape.star" },
  { value: "hexagon", icon: Hexagon, labelKey: "drawing.shape.hexagon" },
  { value: "heart", icon: Heart, labelKey: "drawing.shape.heart" }
];

function elementsEqual(left: DrawingElement[], right: DrawingElement[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneDrawingElements(elements: DrawingElement[]) {
  return elements.map((element): DrawingElement => {
    if (element.type === "stroke" || element.type === "erase") {
      return { ...element, points: element.points.map((point) => ({ ...point })) };
    }
    if (element.type === "shape") {
      return { ...element, start: { ...element.start }, end: { ...element.end } };
    }
    return { ...element };
  });
}

function drawingPointFromEvent(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    point: {
      x: clampDrawingNumber((event.clientX - rect.left) / rect.width),
      y: clampDrawingNumber((event.clientY - rect.top) / rect.height)
    },
    rect
  };
}

function replaceElement(elements: DrawingElement[], nextElement: DrawingElement) {
  return elements.map((element) => element.id === nextElement.id ? nextElement : element);
}

function selectionHandles(bounds: DrawingBounds): Array<{ value: ResizeHandle; point: DrawingPoint }> {
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  return [
    { value: "nw", point: { x: bounds.left, y: bounds.top } },
    { value: "n", point: { x: centerX, y: bounds.top } },
    { value: "ne", point: { x: bounds.right, y: bounds.top } },
    { value: "e", point: { x: bounds.right, y: centerY } },
    { value: "se", point: { x: bounds.right, y: bounds.bottom } },
    { value: "s", point: { x: centerX, y: bounds.bottom } },
    { value: "sw", point: { x: bounds.left, y: bounds.bottom } },
    { value: "w", point: { x: bounds.left, y: centerY } }
  ];
}

function selectionHandleAt(point: DrawingPoint, bounds: DrawingBounds, tolerance: number): ResizeHandle | null {
  return selectionHandles(bounds).find((handle) => Math.hypot(handle.point.x - point.x, handle.point.y - point.y) <= tolerance)?.value ?? null;
}

function drawSelectionFrame(
  ctx: CanvasRenderingContext2D,
  bounds: DrawingBounds,
  width: number,
  height: number,
  pixelRatio: number
) {
  const left = bounds.left * width;
  const top = bounds.top * height;
  const right = bounds.right * width;
  const bottom = bounds.bottom * height;
  const handleHalfSize = 5 * pixelRatio;
  ctx.save();
  ctx.strokeStyle = "#2563eb";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1.5 * pixelRatio;
  ctx.setLineDash([5 * pixelRatio, 4 * pixelRatio]);
  ctx.strokeRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
  ctx.setLineDash([]);
  for (const handle of selectionHandles(bounds)) {
    const point = [handle.point.x * width, handle.point.y * height];
    ctx.fillRect(point[0] - handleHalfSize, point[1] - handleHalfSize, handleHalfSize * 2, handleHalfSize * 2);
    ctx.strokeRect(point[0] - handleHalfSize, point[1] - handleHalfSize, handleHalfSize * 2, handleHalfSize * 2);
  }
  ctx.restore();
}

function resizedBounds(original: DrawingBounds, handle: ResizeHandle, point: DrawingPoint): DrawingBounds {
  const minimum = DRAWING_ELEMENT_MIN_SCALE;
  let left = original.left;
  let top = original.top;
  let right = original.right;
  let bottom = original.bottom;
  if (handle.includes("n")) top = Math.min(point.y, bottom - minimum);
  if (handle.includes("s")) bottom = Math.max(point.y, top + minimum);
  if (handle.includes("w")) left = Math.min(point.x, right - minimum);
  if (handle.includes("e")) right = Math.max(point.x, left + minimum);
  return {
    left: clampDrawingNumber(left, 0, 1 - minimum),
    top: clampDrawingNumber(top, 0, 1 - minimum),
    right: clampDrawingNumber(right, minimum, 1),
    bottom: clampDrawingNumber(bottom, minimum, 1)
  };
}

function drawingElementSliderValue(element: DrawingElement) {
  const bounds = drawingElementBounds(element);
  const scale = Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top);
  const progress = (
    clampDrawingNumber(scale, DRAWING_ELEMENT_MIN_SCALE, DRAWING_ELEMENT_MAX_SCALE) - DRAWING_ELEMENT_MIN_SCALE
  ) / (DRAWING_ELEMENT_MAX_SCALE - DRAWING_ELEMENT_MIN_SCALE);
  return DRAWING_ELEMENT_SLIDER_MIN + progress * (DRAWING_ELEMENT_SLIDER_MAX - DRAWING_ELEMENT_SLIDER_MIN);
}

function resizeDrawingElementFromSlider(element: DrawingElement, value: number) {
  const bounds = drawingElementBounds(element);
  const width = Math.max(0.0001, bounds.right - bounds.left);
  const height = Math.max(0.0001, bounds.bottom - bounds.top);
  const currentScale = Math.max(width, height);
  const progress = (
    clampDrawingNumber(value, DRAWING_ELEMENT_SLIDER_MIN, DRAWING_ELEMENT_SLIDER_MAX) - DRAWING_ELEMENT_SLIDER_MIN
  ) / (DRAWING_ELEMENT_SLIDER_MAX - DRAWING_ELEMENT_SLIDER_MIN);
  const targetScale = DRAWING_ELEMENT_MIN_SCALE + progress * (DRAWING_ELEMENT_MAX_SCALE - DRAWING_ELEMENT_MIN_SCALE);
  const factor = targetScale / currentScale;
  const targetWidth = width * factor;
  const targetHeight = height * factor;
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const left = clampDrawingNumber(centerX - targetWidth / 2, 0, 1 - targetWidth);
  const top = clampDrawingNumber(centerY - targetHeight / 2, 0, 1 - targetHeight);
  return resizeDrawingElement(element, bounds, {
    left,
    top,
    right: left + targetWidth,
    bottom: top + targetHeight
  });
}

export function DrawingCanvasDialog({
  open,
  embedded = false,
  embeddedBounds,
  wheelAdjustsSize = true,
  initialElements,
  onClose,
  onConfirm,
  onElementsChange
}: DrawingCanvasDialogProps) {
  const { t } = useI18n();
  const startingElements = initialElements ?? EMPTY_DRAWING_ELEMENTS;
  const [tool, setTool] = useState<DrawingTool>("brush");
  const [shapeType, setShapeType] = useState<DrawingShapeType>("rectangle");
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [color, setColor] = useState(embedded ? "#DC2626" : "#000000");
  const [strokeWidth, setStrokeWidth] = useState(DRAWING_DEFAULT_STROKE_WIDTH);
  const [textSize, setTextSize] = useState(DRAWING_DEFAULT_TEXT_SIZE);
  const [eraserWidth, setEraserWidth] = useState(DRAWING_DEFAULT_ERASER_WIDTH);
  const [elements, setElementsState] = useState<DrawingElement[]>([]);
  const [undoStack, setUndoStack] = useState<DrawingElement[][]>([]);
  const [redoStack, setRedoStack] = useState<DrawingElement[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverMode, setHoverMode] = useState<DrawingHoverMode>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [embeddedToolbarHost, setEmbeddedToolbarHost] = useState<HTMLElement | null>(null);
  const [embeddedSizeControlHost, setEmbeddedSizeControlHost] = useState<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const toolCursorRef = useRef<HTMLSpanElement | null>(null);
  const toolCursorPointRef = useRef<{ clientX: number; clientY: number; inside: boolean } | null>(null);
  const textInputRef = useRef<HTMLDivElement | null>(null);
  const sizeInputRef = useRef<HTMLInputElement | null>(null);
  const textDraftFrameRef = useRef<HTMLDivElement | null>(null);
  const textDraftRef = useRef<TextDraft | null>(null);
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const elementsRef = useRef<DrawingElement[]>([]);
  const initialElementsRef = useRef<DrawingElement[]>([]);
  const interactionRef = useRef<DrawingInteraction | null>(null);
  const sizeAdjustmentBeforeRef = useRef<DrawingElement[] | null>(null);
  const sizeWheelBeforeRef = useRef<DrawingElement[] | null>(null);
  const sizeWheelCommitTimerRef = useRef<number | null>(null);
  const textDraftResizeRef = useRef<TextDraftResizeInteraction | null>(null);
  const preserveTextDraftFocusRef = useRef(false);
  const idRef = useRef(0);

  const nextId = useCallback(() => {
    const next = nextDrawingElementId(elementsRef.current, idRef.current);
    idRef.current = next.index;
    return next.id;
  }, []);

  const replaceElements = useCallback((next: DrawingElement[]) => {
    elementsRef.current = next;
    setElementsState(next);
  }, []);

  const notifyElementsChange = useCallback((next: DrawingElement[]) => {
    onElementsChange?.(cloneDrawingElements(next));
  }, [onElementsChange]);

  const commitElements = useCallback((next: DrawingElement[], before = elementsRef.current) => {
    if (elementsEqual(before, next)) return false;
    setUndoStack((current) => [...current, before]);
    setRedoStack([]);
    replaceElements(next);
    notifyElementsChange(next);
    return true;
  }, [notifyElementsChange, replaceElements]);

  const finishWheelSizeAdjustment = useCallback(() => {
    if (sizeWheelCommitTimerRef.current !== null) {
      window.clearTimeout(sizeWheelCommitTimerRef.current);
      sizeWheelCommitTimerRef.current = null;
    }
    const before = sizeWheelBeforeRef.current;
    sizeWheelBeforeRef.current = null;
    if (!before || elementsEqual(before, elementsRef.current)) return;
    setUndoStack((items) => [...items, before]);
    setRedoStack([]);
  }, []);

  const syncToolCursor = useCallback((clientX: number, clientY: number, inside = true) => {
    toolCursorPointRef.current = { clientX, clientY, inside };
    const cursor = toolCursorRef.current;
    const canvas = canvasRef.current;
    if (!cursor || !canvas || !inside || (tool !== "brush" && tool !== "eraser")) {
      if (cursor) cursor.style.opacity = "0";
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const activeWidth = tool === "eraser" ? eraserWidth : strokeWidth;
    const diameter = Math.max(6, (activeWidth / DRAWING_EXPORT_SIZE) * Math.min(rect.width, rect.height));
    cursor.style.left = `${clientX - rect.left}px`;
    cursor.style.top = `${clientY - rect.top}px`;
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.setProperty("--drawing-tool-cursor-color", tool === "brush" ? color : "rgba(255, 255, 255, 0.86)");
    cursor.style.opacity = "1";
  }, [color, eraserWidth, strokeWidth, tool]);

  const resetDialog = useCallback(() => {
    if (sizeWheelCommitTimerRef.current !== null) {
      window.clearTimeout(sizeWheelCommitTimerRef.current);
      sizeWheelCommitTimerRef.current = null;
    }
    sizeWheelBeforeRef.current = null;
    const restoredElements = cloneDrawingElements(startingElements);
    initialElementsRef.current = restoredElements;
    replaceElements(restoredElements);
    notifyElementsChange(restoredElements);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedId(null);
    setHoverMode(null);
    setTextDraft(null);
    textDraftRef.current = null;
    textDraftFrameRef.current = null;
    setDiscardOpen(false);
    setConfirming(false);
    setError("");
    setTool("brush");
    setShapeType("rectangle");
    setShapeMenuOpen(false);
    setColorMenuOpen(false);
    setColor(embedded ? "#DC2626" : "#000000");
    setStrokeWidth(DRAWING_DEFAULT_STROKE_WIDTH);
    setTextSize(DRAWING_DEFAULT_TEXT_SIZE);
    setEraserWidth(DRAWING_DEFAULT_ERASER_WIDTH);
    interactionRef.current = null;
    sizeAdjustmentBeforeRef.current = null;
    textDraftResizeRef.current = null;
    preserveTextDraftFocusRef.current = false;
    toolCursorPointRef.current = null;
    idRef.current = 0;
  }, [embedded, notifyElementsChange, replaceElements, startingElements]);

  useEffect(() => {
    if (!open) return;
    resetDialog();
    if (embedded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [embedded, open, resetDialog]);

  useEffect(() => {
    const point = toolCursorPointRef.current;
    if (!point) return;
    syncToolCursor(point.clientX, point.clientY, point.inside);
  }, [
    embeddedBounds?.height,
    embeddedBounds?.left,
    embeddedBounds?.top,
    embeddedBounds?.width,
    syncToolCursor
  ]);

  useEffect(() => () => {
    if (sizeWheelCommitTimerRef.current !== null) {
      window.clearTimeout(sizeWheelCommitTimerRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    if (!open || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const observer = new ResizeObserver(() => setCanvasRevision((value) => value + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [open]);

  useLayoutEffect(() => {
    setEmbeddedToolbarHost(
      open && embedded ? document.querySelector<HTMLElement>(".image-editor-topbar") : null
    );
    setEmbeddedSizeControlHost(
      open && embedded ? canvasRef.current?.closest<HTMLElement>(".image-editor-viewport") ?? null : null
    );
  }, [embedded, open]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!open || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const selected = selectedId ? elements.find((element) => element.id === selectedId) : null;
    const draftElement: DrawingTextElement | null = textDraft
      ? {
          id: textDraft.editingElementId ?? textDraft.temporaryId,
          type: "text",
          x: textDraft.x,
          y: textDraft.y,
          text: textDraft.value,
          color: textDraft.color,
          fontSize: textDraft.fontSize,
          boxWidth: textDraft.boxWidth,
          boxHeight: textDraft.boxHeight
        }
      : null;
    const renderedElements = draftElement?.id
      ? textDraft?.editingElementId
        ? elements.map((element) => element.id === textDraft.editingElementId ? draftElement : element)
        : [...elements, draftElement]
      : elements;
    drawDrawingElements(ctx, renderedElements, width, height, { background: embedded ? null : "#ffffff" });
    const selectionBounds = textDraft
      ? {
          left: textDraft.x,
          top: textDraft.y,
          right: clampDrawingNumber(textDraft.x + textDraft.boxWidth),
          bottom: clampDrawingNumber(textDraft.y + textDraft.boxHeight)
        }
      : selected
        ? drawingElementBounds(selected)
        : null;
    if (selectionBounds) drawSelectionFrame(ctx, selectionBounds, width, height, pixelRatio);
  }, [
    canvasRevision,
    elements,
    embedded,
    open,
    selectedId,
    textDraft?.boxHeight,
    textDraft?.boxWidth,
    textDraft?.color,
    textDraft?.editingElementId,
    textDraft?.fontSize,
    textDraft?.temporaryId,
    textDraft?.value,
    textDraft?.x,
    textDraft?.y
  ]);

  useEffect(() => {
    if (!textDraft) return;
    const frame = window.requestAnimationFrame(() => {
      const input = textInputRef.current;
      if (input && input.textContent !== textDraft.value) input.textContent = textDraft.value;
      input?.focus();
      if (textDraft.editingElementId && input) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [textDraft?.editingElementId, textDraft?.temporaryId]);

  useEffect(() => {
    textDraftRef.current = textDraft;
  }, [textDraft]);

  const requestClose = useCallback(() => {
    if (confirming) return;
    finishWheelSizeAdjustment();
    if (!elementsEqual(initialElementsRef.current, elementsRef.current) || textDraft?.value.trim()) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }, [confirming, finishWheelSizeAdjustment, onClose, textDraft?.value]);

  const undo = useCallback(() => {
    finishWheelSizeAdjustment();
    if (textDraft) {
      textDraftRef.current = null;
      setTextDraft(null);
      if (textDraft.editingElementId) {
        setSelectedId(textDraft.editingElementId);
        setTool("select");
      }
      return;
    }
    setUndoStack((current) => {
      const previous = current[current.length - 1];
      if (!previous) return current;
      setRedoStack((redo) => [...redo, elementsRef.current]);
      replaceElements(previous);
      notifyElementsChange(previous);
      setSelectedId(null);
      return current.slice(0, -1);
    });
  }, [finishWheelSizeAdjustment, notifyElementsChange, replaceElements, textDraft]);

  const redo = useCallback(() => {
    finishWheelSizeAdjustment();
    setRedoStack((current) => {
      const next = current[current.length - 1];
      if (!next) return current;
      setUndoStack((undoItems) => [...undoItems, elementsRef.current]);
      replaceElements(next);
      notifyElementsChange(next);
      setSelectedId(null);
      return current.slice(0, -1);
    });
  }, [finishWheelSizeAdjustment, notifyElementsChange, replaceElements]);

  const deleteSelected = useCallback(() => {
    finishWheelSizeAdjustment();
    if (!selectedId) return;
    const next = elementsRef.current.filter((element) => element.id !== selectedId);
    if (commitElements(next)) setSelectedId(null);
  }, [commitElements, finishWheelSizeAdjustment, selectedId]);

  const updateTextSize = (value: number) => {
    const nextSize = clampDrawingNumber(value, DRAWING_MIN_TEXT_SIZE, DRAWING_MAX_TEXT_SIZE);
    const nextFontSize = drawingTextSizeRatio(nextSize);
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    setTextSize(nextSize);
    setTextDraft((current) => {
      if (!current) {
        textDraftRef.current = null;
        return null;
      }
      const next = {
        ...current,
        fontSize: nextFontSize,
        boxWidth: canvasRect && canvasRect.width > 0
          ? Math.min(
              Math.max(0.012, 1 - current.x - 8 / canvasRect.width),
              Math.max(
                current.boxWidth,
                drawingTextLineWidth(current.value || "M", nextFontSize) + DRAWING_TEXT_HORIZONTAL_PADDING * 2
              )
            )
          : current.boxWidth,
        boxHeight: Math.max(current.boxHeight, nextFontSize * DRAWING_TEXT_FRAME_HEIGHT_FACTOR)
      };
      textDraftRef.current = next;
      return next;
    });
  };

  const updateActiveToolSize = (value: number) => {
    if (tool === "text") {
      updateTextSize(value);
      return;
    }
    if (tool === "eraser") {
      setEraserWidth(clampDrawingNumber(value, DRAWING_MIN_ERASER_WIDTH, DRAWING_MAX_ERASER_WIDTH));
      return;
    }
    setStrokeWidth(clampDrawingNumber(value, DRAWING_MIN_STROKE_WIDTH, DRAWING_MAX_STROKE_WIDTH));
  };

  const beginSizeAdjustment = () => {
    finishWheelSizeAdjustment();
    if (textDraftRef.current) preserveTextDraftFocusRef.current = true;
    if (!selectedId) return;
    sizeAdjustmentBeforeRef.current = elementsRef.current;
  };

  const updateSizeAdjustment = (value: number) => {
    if (!selectedId) {
      updateActiveToolSize(value);
      return;
    }
    const selected = elementsRef.current.find((element) => element.id === selectedId);
    if (!selected) return;
    const resized = resizeDrawingElementFromSlider(selected, value);
    const next = replaceElement(elementsRef.current, resized);
    if (sizeAdjustmentBeforeRef.current) replaceElements(next);
    else commitElements(next);
  };

  const finishSizeAdjustment = () => {
    const before = sizeAdjustmentBeforeRef.current;
    sizeAdjustmentBeforeRef.current = null;
    if (before && !elementsEqual(before, elementsRef.current)) {
      setUndoStack((items) => [...items, before]);
      setRedoStack([]);
      notifyElementsChange(elementsRef.current);
    }
    if (preserveTextDraftFocusRef.current) {
      preserveTextDraftFocusRef.current = false;
      window.requestAnimationFrame(() => textInputRef.current?.focus());
    }
  };

  const handleSizeControlBlur = (event: ReactFocusEvent<HTMLInputElement>) => {
    const shouldCommitText = Boolean(textDraftRef.current)
      && !preserveTextDraftFocusRef.current
      && event.relatedTarget !== textInputRef.current;
    finishSizeAdjustment();
    if (shouldCommitText) commitTextDraft();
  };

  const handleSizeWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!wheelAdjustsSize || event.defaultPrevented) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("input, textarea, select, button, [contenteditable='true']")) return;
    const sizeDelta = wheelSizeDelta(event.deltaX, event.deltaY, DRAWING_WHEEL_SIZE_STEP);
    if (!sizeDelta) return;
    event.preventDefault();
    event.stopPropagation();
    if (!selectedId) {
      const currentSize = tool === "text" ? textSize : tool === "eraser" ? eraserWidth : strokeWidth;
      updateActiveToolSize(currentSize + sizeDelta);
      return;
    }
    const selected = elementsRef.current.find((element) => element.id === selectedId);
    if (!selected) return;
    if (!sizeWheelBeforeRef.current) sizeWheelBeforeRef.current = elementsRef.current;
    const resized = resizeDrawingElementFromSlider(selected, drawingElementSliderValue(selected) + sizeDelta);
    const next = replaceElement(elementsRef.current, resized);
    replaceElements(next);
    notifyElementsChange(next);
    if (sizeWheelCommitTimerRef.current !== null) {
      window.clearTimeout(sizeWheelCommitTimerRef.current);
    }
    sizeWheelCommitTimerRef.current = window.setTimeout(finishWheelSizeAdjustment, 180);
  };

  const handleTextDraftResizeStart = (event: ReactPointerEvent<HTMLSpanElement>, handle: ResizeHandle) => {
    const draft = textDraftRef.current;
    const frame = event.currentTarget.parentElement?.getBoundingClientRect();
    const canvas = canvasRef.current?.getBoundingClientRect();
    if (!draft || !frame || !canvas || canvas.width <= 0 || canvas.height <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    textDraftResizeRef.current = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      x: draft.x,
      y: draft.y,
      boxWidth: frame.width / canvas.width,
      boxHeight: frame.height / canvas.height,
      fontSize: draft.fontSize
    };
  };

  const handleTextDraftResizeMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const interaction = textDraftResizeRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = (event.clientX - interaction.startX) / interaction.canvasWidth;
    const dy = (event.clientY - interaction.startY) / interaction.canvasHeight;
    const originalBounds: DrawingBounds = {
      left: interaction.x,
      top: interaction.y,
      right: interaction.x + interaction.boxWidth,
      bottom: interaction.y + interaction.boxHeight
    };
    const point = {
      x: interaction.handle.includes("e") ? originalBounds.right + dx : originalBounds.left + dx,
      y: interaction.handle.includes("s") ? originalBounds.bottom + dy : originalBounds.top + dy
    };
    const bounds = resizedBounds(originalBounds, interaction.handle, point);
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    const scaleX = width / Math.max(0.0001, interaction.boxWidth);
    const scaleY = height / Math.max(0.0001, interaction.boxHeight);
    const scale = interaction.handle === "e" || interaction.handle === "w"
      ? scaleX
      : interaction.handle === "n" || interaction.handle === "s"
        ? scaleY
        : (scaleX + scaleY) / 2;
    const fontSize = clampDrawingNumber(
      interaction.fontSize * Math.max(0.2, scale),
      drawingTextSizeRatio(DRAWING_MIN_TEXT_SIZE),
      drawingTextSizeRatio(DRAWING_MAX_TEXT_SIZE)
    );
    setTextDraft((current) => {
      const next = current ? {
        ...current,
        x: bounds.left,
        y: bounds.top,
        boxWidth: width,
        boxHeight: height,
        fontSize
      } : null;
      textDraftRef.current = next;
      return next;
    });
  };

  const finishTextDraftResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const interaction = textDraftResizeRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    textDraftResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    window.requestAnimationFrame(() => textInputRef.current?.focus());
  };

  useEffect(() => {
    if (!open || discardOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const editingText = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
      if (editingText) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (colorMenuOpen) setColorMenuOpen(false);
        else if (shapeMenuOpen) setShapeMenuOpen(false);
        else if (selectedId) setSelectedId(null);
        else requestClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [colorMenuOpen, deleteSelected, discardOpen, open, redo, requestClose, selectedId, shapeMenuOpen, undo]);

  const setActiveTool = (nextTool: DrawingTool) => {
    finishWheelSizeAdjustment();
    if (textDraftRef.current?.value.trim()) commitTextDraft();
    else {
      textDraftRef.current = null;
      setTextDraft(null);
    }
    setTool(nextTool);
    setSelectedId(null);
    setHoverMode(null);
    toolCursorPointRef.current = null;
    setColorMenuOpen(false);
    if (toolCursorRef.current) toolCursorRef.current.style.opacity = "0";
    setShapeMenuOpen(nextTool === "shape" ? (current) => !current : false);
    setError("");
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || confirming) return;
    finishWheelSizeAdjustment();
    const mapped = drawingPointFromEvent(event.currentTarget, event);
    if (!mapped) return;
    syncToolCursor(event.clientX, event.clientY);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const before = elementsRef.current;
    const tolerance = 11 / Math.max(1, Math.min(mapped.rect.width, mapped.rect.height));
    if (tool === "text") {
      if (textDraftRef.current) {
        commitTextDraft();
        return;
      }
      const minimumWidth = 32 / mapped.rect.width;
      const fontSize = drawingTextSizeRatio(textSize);
      const boxHeight = Math.max(fontSize * DRAWING_TEXT_FRAME_HEIGHT_FACTOR, 24 / mapped.rect.height);
      const x = Math.min(mapped.point.x, Math.max(0, 1 - minimumWidth));
      const y = Math.min(mapped.point.y, Math.max(0, 1 - boxHeight));
      const availableWidth = Math.max(minimumWidth, 1 - x - 8 / mapped.rect.width);
      const draft = {
        temporaryId: nextId(),
        x,
        y,
        value: "",
        color,
        fontSize,
        boxWidth: Math.min(availableWidth, Math.max(minimumWidth, DRAWING_TEXT_DEFAULT_INPUT_WIDTH / mapped.rect.width)),
        boxHeight
      };
      textDraftRef.current = draft;
      setTextDraft(draft);
      return;
    }
    if (tool === "select") {
      const selected = selectedId ? before.find((element) => element.id === selectedId) : null;
      const selectedBounds = selected ? drawingElementBounds(selected) : null;
      const handle = selectedBounds ? selectionHandleAt(mapped.point, selectedBounds, tolerance * 1.2) : null;
      if (selected && selectedBounds && handle) {
        setHoverMode(handle);
        interactionRef.current = {
          pointerId: event.pointerId,
          kind: "resize",
          before,
          start: mapped.point,
          elementId: selected.id,
          originalElement: selected,
          originalBounds: selectedBounds,
          resizeHandle: handle
        };
        return;
      }
      const hit = topDrawingElementAt(before, mapped.point, tolerance);
      setSelectedId(hit?.id ?? null);
      setHoverMode(hit ? "move" : null);
      if (hit) {
        interactionRef.current = {
          pointerId: event.pointerId,
          kind: "move",
          before,
          start: mapped.point,
          elementId: hit.id,
          originalElement: hit
        };
      }
      return;
    }
    setSelectedId(null);
    if (tool === "brush") {
      const element: DrawingElement = {
        id: nextId(),
        type: "stroke",
        points: [mapped.point],
        color,
        width: strokeWidth
      };
      interactionRef.current = { pointerId: event.pointerId, kind: "brush", before, start: mapped.point, elementId: element.id };
      replaceElements([...before, element]);
      return;
    }
    if (tool === "shape") {
      const element: DrawingElement = {
        id: nextId(),
        type: "shape",
        shape: shapeType,
        start: mapped.point,
        end: mapped.point,
        color,
        width: strokeWidth
      };
      interactionRef.current = { pointerId: event.pointerId, kind: "shape", before, start: mapped.point, elementId: element.id };
      replaceElements([...before, element]);
      setShapeMenuOpen(false);
      return;
    }
    const path = [mapped.point];
    if (!before.some((element) => element.type !== "erase")) return;
    interactionRef.current = { pointerId: event.pointerId, kind: "erase", before, start: mapped.point, path };
    replaceElements(eraseDrawingElements(before, path, eraserWidth, nextId));
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const mapped = drawingPointFromEvent(event.currentTarget, event);
    if (!mapped) return;
    syncToolCursor(event.clientX, event.clientY);
    const interaction = interactionRef.current;
    if (!interaction) {
      if (tool === "select") {
        const selected = selectedId ? elementsRef.current.find((element) => element.id === selectedId) : null;
        const selectedBounds = selected ? drawingElementBounds(selected) : null;
        const tolerance = 11 / Math.max(1, Math.min(mapped.rect.width, mapped.rect.height));
        const handle = selectedBounds ? selectionHandleAt(mapped.point, selectedBounds, tolerance * 1.2) : null;
        const hit = handle ? null : topDrawingElementAt(elementsRef.current, mapped.point, tolerance);
        const nextHoverMode: DrawingHoverMode = handle ?? (hit ? "move" : null);
        setHoverMode((current) => current === nextHoverMode ? current : nextHoverMode);
      }
      return;
    }
    if (interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (interaction.kind === "brush") {
      const current = elementsRef.current.find((element) => element.id === interaction.elementId);
      if (!current || current.type !== "stroke") return;
      const last = current.points[current.points.length - 1];
      if (Math.hypot(mapped.point.x - last.x, mapped.point.y - last.y) * Math.min(mapped.rect.width, mapped.rect.height) < 1.5) return;
      replaceElements(replaceElement(elementsRef.current, { ...current, points: [...current.points, mapped.point] }));
      return;
    }
    if (interaction.kind === "shape") {
      const current = elementsRef.current.find((element) => element.id === interaction.elementId);
      if (!current || current.type !== "shape") return;
      replaceElements(replaceElement(elementsRef.current, { ...current, end: mapped.point }));
      return;
    }
    if (interaction.kind === "erase") {
      const path = [...(interaction.path ?? []), mapped.point];
      interaction.path = path;
      replaceElements(eraseDrawingElements(interaction.before, path, eraserWidth, nextId));
      return;
    }
    if (!interaction.originalElement || !interaction.elementId) return;
    if (interaction.kind === "move") {
      const moved = moveDrawingElement(
        interaction.originalElement,
        mapped.point.x - interaction.start.x,
        mapped.point.y - interaction.start.y
      );
      replaceElements(replaceElement(interaction.before, moved));
      return;
    }
    if (interaction.originalBounds && interaction.resizeHandle) {
      const bounds = resizedBounds(interaction.originalBounds, interaction.resizeHandle, mapped.point);
      const resized = resizeDrawingElement(interaction.originalElement, interaction.originalBounds, bounds);
      replaceElements(replaceElement(interaction.before, resized));
    }
  };

  const finishInteraction = (event: ReactPointerEvent<HTMLCanvasElement>, cancelled = false) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (!cancelled) handlePointerMove(event);
    interactionRef.current = null;
    setHoverMode(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled) {
      replaceElements(interaction.before);
      return;
    }
    const current = elementsRef.current;
    if (interaction.kind === "shape") {
      const shape = current.find((element) => element.id === interaction.elementId);
      if (shape?.type === "shape" && Math.hypot(shape.end.x - shape.start.x, shape.end.y - shape.start.y) < 0.006) {
        replaceElements(interaction.before);
        return;
      }
    }
    if (!elementsEqual(interaction.before, current)) {
      setUndoStack((items) => [...items, interaction.before]);
      setRedoStack([]);
      notifyElementsChange(current);
    }
    if (interaction.kind === "shape" && interaction.elementId) {
      setSelectedId(interaction.elementId);
      setTool("select");
      setHoverMode(null);
      toolCursorPointRef.current = null;
      if (toolCursorRef.current) toolCursorRef.current.style.opacity = "0";
    }
  };

  const handleCanvasDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (confirming || textDraftRef.current || tool !== "select") return;
    const mapped = drawingPointFromEvent(event.currentTarget, event);
    if (!mapped) return;
    const tolerance = 11 / Math.max(1, Math.min(mapped.rect.width, mapped.rect.height));
    const hit = topDrawingElementAt(elementsRef.current, mapped.point, tolerance);
    if (!hit || hit.type !== "text") return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = drawingElementBounds(hit);
    const minimumWidth = 32 / mapped.rect.width;
    const availableWidth = Math.max(minimumWidth, 1 - hit.x - 8 / mapped.rect.width);
    const defaultWidth = Math.min(availableWidth, DRAWING_TEXT_DEFAULT_INPUT_WIDTH / mapped.rect.width);
    const draft: TextDraft = {
      temporaryId: hit.id,
      editingElementId: hit.id,
      x: hit.x,
      y: hit.y,
      value: hit.text,
      color: hit.color,
      fontSize: hit.fontSize,
      boxWidth: Math.min(availableWidth, Math.max(bounds.right - bounds.left, hit.boxWidth ?? defaultWidth)),
      boxHeight: Math.max(bounds.bottom - bounds.top, hit.boxHeight ?? hit.fontSize * DRAWING_TEXT_FRAME_HEIGHT_FACTOR)
    };
    interactionRef.current = null;
    textDraftRef.current = draft;
    setTextDraft(draft);
    setSelectedId(null);
    setHoverMode(null);
    setTool("text");
    setColor(hit.color);
    setTextSize(drawingTextSizeFromRatio(hit.fontSize));
  };

  const commitTextDraft = () => {
    const draft = textDraftRef.current ?? textDraft;
    if (!draft) return;
    const frameRect = textDraftFrameRef.current?.getBoundingClientRect();
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    textDraftRef.current = null;
    setTextDraft(null);
    if (!draft.value.trim()) {
      if (draft.editingElementId) {
        commitElements(elementsRef.current.filter((element) => element.id !== draft.editingElementId));
        setSelectedId(null);
        setTool("select");
      }
      return;
    }
    const measuredWidth = frameRect && canvasRect && canvasRect.width > 0
      ? frameRect.width / canvasRect.width
      : draft.boxWidth;
    const measuredHeight = frameRect && canvasRect && canvasRect.height > 0
      ? frameRect.height / canvasRect.height
      : draft.boxHeight;
    const boxWidth = Math.max(0.012, Math.min(1 - draft.x, measuredWidth));
    const boxHeight = Math.max(0.012, Math.min(1 - draft.y, measuredHeight));
    const element: DrawingElement = {
      id: draft.editingElementId ?? draft.temporaryId,
      type: "text",
      x: draft.x,
      y: draft.y,
      text: draft.value,
      color: draft.color,
      fontSize: draft.fontSize,
      boxWidth,
      boxHeight
    };
    const next = draft.editingElementId
      ? replaceElement(elementsRef.current, element)
      : [...elementsRef.current, element];
    commitElements(next);
    setSelectedId(element.id);
    setTool("select");
  };

  const handleTextKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      const draft = textDraftRef.current;
      textDraftRef.current = null;
      setTextDraft(null);
      if (draft?.editingElementId) {
        setSelectedId(draft.editingElementId);
        setTool("select");
      }
      return;
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      commitTextDraft();
    }
  };

  const confirmDrawing = async () => {
    if (confirming || elementsRef.current.length === 0 || !onConfirm) return;
    finishWheelSizeAdjustment();
    setConfirming(true);
    setError("");
    try {
      const blob = await exportDrawingBlob(elementsRef.current, DRAWING_EXPORT_SIZE);
      const file = new File([blob], `${t("drawing.fileName")}-${Date.now()}.png`, { type: "image/png" });
      await onConfirm({ file, elements: cloneDrawingElements(elementsRef.current) });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("drawing.error.export"));
    } finally {
      setConfirming(false);
    }
  };

  if (!open) return null;
  const selectedColorIsPreset = PRESET_COLORS.includes(color.toUpperCase());
  const selectedElement = selectedId ? elements.find((element) => element.id === selectedId) : null;
  const activeSizeControl = tool === "text"
    ? { min: DRAWING_MIN_TEXT_SIZE, max: DRAWING_MAX_TEXT_SIZE, value: textSize, label: t("drawing.textSize") }
    : tool === "eraser"
      ? { min: DRAWING_MIN_ERASER_WIDTH, max: DRAWING_MAX_ERASER_WIDTH, value: eraserWidth, label: t("drawing.eraserSize") }
      : { min: DRAWING_MIN_STROKE_WIDTH, max: DRAWING_MAX_STROKE_WIDTH, value: strokeWidth, label: t("drawing.size") };
  const sizeControl = selectedElement
    ? {
        min: DRAWING_ELEMENT_SLIDER_MIN,
        max: DRAWING_ELEMENT_SLIDER_MAX,
        value: drawingElementSliderValue(selectedElement),
        label: t("drawing.elementSize")
      }
    : activeSizeControl;
  const sizeProgress = ((sizeControl.value - sizeControl.min) / (sizeControl.max - sizeControl.min)) * 100;
  const chooseColor = (nextColor: string) => {
    setColor(nextColor);
    setTextDraft((current) => {
      const next = current ? { ...current, color: nextColor } : null;
      textDraftRef.current = next;
      return next;
    });
  };
  const textEditorStyle = textDraft && canvasRef.current
    ? (() => {
        const canvasRect = canvasRef.current!.getBoundingClientRect();
        const fontSizeRatio = textDraft.fontSize;
        const fontSize = Math.max(DRAWING_MIN_TEXT_SIZE, canvasRect.height * fontSizeRatio);
        const availableWidth = Math.max(32, canvasRect.width * (1 - textDraft.x) - 8);
        const availableHeight = Math.max(24, canvasRect.height * (1 - textDraft.y));
        return {
          left: `${textDraft.x * 100}%`,
          top: `${textDraft.y * 100}%`,
          width: `${Math.min(availableWidth, textDraft.boxWidth * canvasRect.width)}px`,
          height: `${Math.min(availableHeight, textDraft.boxHeight * canvasRect.height)}px`,
          color: textDraft.color,
          fontSize: `${fontSize}px`,
          "--drawing-text-inline-padding": `${DRAWING_TEXT_HORIZONTAL_PADDING * canvasRect.width}px`
        } as CSSProperties;
      })()
    : undefined;
  const drawingToolbar = (
    <div className={cx("drawing-toolbar", embedded && "drawing-toolbar-embedded")} role="toolbar" aria-label={t("drawing.tools")}>
      <button type="button" className={cx(tool === "select" && "active")} aria-label={t("drawing.tool.select")} title={t("drawing.tool.select")} onClick={() => setActiveTool("select")}>
        <MousePointer2 size={20} />
      </button>
      <button type="button" className={cx(tool === "brush" && "active")} aria-label={t("drawing.tool.brush")} title={t("drawing.tool.brush")} onClick={() => setActiveTool("brush")}>
        <Brush size={20} />
      </button>
      <button type="button" className={cx(tool === "text" && "active")} aria-label={t("drawing.tool.text")} title={t("drawing.tool.text")} onClick={() => setActiveTool("text")}>
        <Type size={20} />
      </button>
      <div className="drawing-shape-tool">
        <button type="button" className={cx(tool === "shape" && "active")} aria-label={t("drawing.tool.shape")} title={t("drawing.tool.shape")} aria-expanded={shapeMenuOpen} onClick={() => setActiveTool("shape")}>
          <Shapes size={20} />
        </button>
        {shapeMenuOpen ? (
          <div className="drawing-shape-menu" role="menu" aria-label={t("drawing.shapes")}>
            {SHAPE_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitem"
                  className={cx(shapeType === option.value && "active")}
                  aria-label={t(option.labelKey)}
                  title={t(option.labelKey)}
                  onClick={() => {
                    setShapeType(option.value);
                    setTool("shape");
                    setShapeMenuOpen(false);
                  }}
                >
                  <Icon size={18} />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {embedded ? (
        <div className="drawing-color-tool">
          <button
            type="button"
            aria-label={t("drawing.colors")}
            title={t("drawing.colors")}
            aria-expanded={colorMenuOpen}
            onClick={() => {
              setShapeMenuOpen(false);
              setColorMenuOpen((open) => !open);
            }}
          >
            <span className="drawing-color-trigger-dot" style={{ "--drawing-swatch": color } as CSSProperties} />
          </button>
          {colorMenuOpen ? (
            <div className="drawing-color-menu" role="menu" aria-label={t("drawing.colors")}>
              <label className={cx("drawing-color-swatch custom", !selectedColorIsPreset && "active")} title={t("drawing.color.custom")}>
                <input
                  ref={colorInputRef}
                  type="color"
                  value={color}
                  aria-label={t("drawing.color.custom")}
                  onChange={(event) => chooseColor(event.currentTarget.value.toUpperCase())}
                />
                <span aria-hidden="true" />
              </label>
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={cx("drawing-color-swatch", color.toUpperCase() === preset && "active")}
                  style={{ "--drawing-swatch": preset } as CSSProperties}
                  aria-label={t("drawing.color.choose", { color: preset })}
                  title={preset}
                  onClick={() => chooseColor(preset)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <button type="button" className={cx(tool === "eraser" && "active")} aria-label={t("drawing.tool.eraser")} title={t("drawing.tool.eraser")} onClick={() => setActiveTool("eraser")}>
        <Eraser size={20} />
      </button>
      {embedded ? (
        <>
          <span className="drawing-toolbar-divider" aria-hidden="true" />
          <button type="button" aria-label={t("drawing.undo")} title={t("drawing.undo")} disabled={undoStack.length === 0 && !textDraft} onClick={undo}>
            <Undo2 size={20} />
          </button>
          <button type="button" aria-label={t("drawing.redo")} title={t("drawing.redo")} disabled={redoStack.length === 0} onClick={redo}>
            <Redo2 size={20} />
          </button>
          <span className="drawing-toolbar-divider" aria-hidden="true" />
          <button type="button" aria-label={t("common.close")} title={t("common.close")} onClick={requestClose}>
            <X size={20} />
          </button>
        </>
      ) : null}
    </div>
  );
  const drawingSizeControl = (
    <label
      className={cx("drawing-size-control", embedded && "drawing-size-control-embedded")}
      style={{ "--drawing-size-progress": `${sizeProgress}%` } as CSSProperties}
    >
      <span className="visually-hidden">{sizeControl.label}</span>
      <span className="drawing-size-rail" aria-hidden="true">
        <span className="drawing-size-fill" />
        <span className="drawing-size-thumb" />
      </span>
      <input
        ref={sizeInputRef}
        type="range"
        min={sizeControl.min}
        max={sizeControl.max}
        step={1}
        value={sizeControl.value}
        aria-label={sizeControl.label}
        aria-orientation="vertical"
        onPointerDown={beginSizeAdjustment}
        onPointerUp={finishSizeAdjustment}
        onPointerCancel={finishSizeAdjustment}
        onBlur={handleSizeControlBlur}
        onChange={(event) => updateSizeAdjustment(Number(event.currentTarget.value))}
      />
    </label>
  );
  const DrawingContainer = embedded ? Fragment : ModalPortal;
  return (
    <DrawingContainer>
      <div
        className={cx("drawing-dialog-backdrop", embedded && "drawing-dialog-embedded-host")}
        style={embedded && embeddedBounds
          ? {
              left: embeddedBounds.left,
              top: embeddedBounds.top,
              right: "auto",
              bottom: "auto",
              width: embeddedBounds.width,
              height: embeddedBounds.height
            }
          : undefined}
      >
        <section className={cx("drawing-dialog", embedded && "drawing-dialog-embedded")} role="dialog" aria-modal={!embedded} aria-label={t(embedded ? "imageEditor.markupTitle" : "drawing.title")}>
          {!embedded ? <button
            type="button"
            className="drawing-close"
            aria-label={t("common.close")}
            disabled={confirming}
            onClick={requestClose}
          >
            <X size={22} />
          </button> : null}

          {embedded ? (embeddedToolbarHost ? createPortal(drawingToolbar, embeddedToolbarHost) : null) : drawingToolbar}

          {embedded
            ? (embeddedSizeControlHost ? createPortal(drawingSizeControl, embeddedSizeControlHost) : null)
            : drawingSizeControl}

          {!embedded ? <div className="drawing-history-actions">
            <button type="button" aria-label={t("drawing.undo")} title={t("drawing.undo")} disabled={undoStack.length === 0 && !textDraft} onClick={undo}>
              <Undo2 size={20} />
            </button>
            <button type="button" aria-label={t("drawing.redo")} title={t("drawing.redo")} disabled={redoStack.length === 0} onClick={redo}>
              <Redo2 size={20} />
            </button>
          </div> : null}

          <div className={cx(
            "drawing-canvas-shell",
            `tool-${tool}`,
            selectedElement && "has-selection",
            hoverMode === "move" && "cursor-move",
            hoverMode && hoverMode !== "move" && `resize-${hoverMode}`
          )} onWheel={handleSizeWheel}>
            <canvas
              ref={canvasRef}
              className="drawing-canvas"
              aria-label={t("drawing.canvas")}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onDoubleClick={handleCanvasDoubleClick}
              onPointerEnter={(event) => syncToolCursor(event.clientX, event.clientY)}
              onPointerLeave={(event) => {
                syncToolCursor(event.clientX, event.clientY, false);
                setHoverMode(null);
                if (
                  interactionRef.current?.pointerId === event.pointerId
                  && !event.currentTarget.hasPointerCapture(event.pointerId)
                ) {
                  finishInteraction(event);
                }
              }}
              onPointerUp={(event) => finishInteraction(event)}
              onPointerCancel={(event) => finishInteraction(event, true)}
              onLostPointerCapture={(event) => finishInteraction(event)}
            />
            <span
              ref={toolCursorRef}
              className={cx("drawing-tool-cursor", tool === "eraser" && "is-eraser")}
              aria-hidden="true"
            />
            {textDraft ? (
              <div ref={textDraftFrameRef} className="drawing-text-draft-frame" style={textEditorStyle}>
                {!textDraft.value ? (
                  <span className="drawing-text-content drawing-text-draft-value is-placeholder" aria-hidden="true">
                    {t("drawing.text.placeholder")}
                  </span>
                ) : null}
                <div
                  ref={textInputRef}
                  className="drawing-text-editor"
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-label={t("drawing.text.placeholder")}
                  aria-multiline="false"
                  spellCheck={false}
                  onInput={(event) => {
                    const value = event.currentTarget.textContent ?? "";
                    const canvasRect = canvasRef.current?.getBoundingClientRect();
                    setTextDraft((current) => {
                      if (!current) {
                        textDraftRef.current = null;
                        return null;
                      }
                      const availableWidth = canvasRect && canvasRect.width > 0
                        ? Math.max(0.012, 1 - current.x - 8 / canvasRect.width)
                        : Math.max(0.012, 1 - current.x);
                      const naturalWidth = drawingTextLineWidth(value || "M", current.fontSize)
                        + DRAWING_TEXT_HORIZONTAL_PADDING * 2;
                      const next = {
                        ...current,
                        value,
                        boxWidth: Math.min(availableWidth, Math.max(current.boxWidth, naturalWidth))
                      };
                      textDraftRef.current = next;
                      return next;
                    });
                  }}
                  onKeyDown={handleTextKeyDown}
                  onBlur={(event) => {
                    if (
                      !preserveTextDraftFocusRef.current
                      && event.relatedTarget !== sizeInputRef.current
                    ) commitTextDraft();
                  }}
                />
                {TEXT_DRAFT_RESIZE_HANDLES.map((handle) => (
                  <span
                    key={handle}
                    className={`drawing-text-draft-handle is-${handle}`}
                    aria-hidden="true"
                    onPointerDown={(event) => handleTextDraftResizeStart(event, handle)}
                    onPointerMove={handleTextDraftResizeMove}
                    onPointerUp={finishTextDraftResize}
                    onPointerCancel={finishTextDraftResize}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {!embedded ? <div className="drawing-color-palette" role="toolbar" aria-label={t("drawing.colors")}>
            <label className={cx("drawing-color-swatch custom", !selectedColorIsPreset && "active")} title={t("drawing.color.custom")}>
              <input
                ref={colorInputRef}
                type="color"
                value={color}
                aria-label={t("drawing.color.custom")}
                onChange={(event) => chooseColor(event.currentTarget.value.toUpperCase())}
              />
              <span aria-hidden="true" />
            </label>
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={cx("drawing-color-swatch", color.toUpperCase() === preset && "active")}
                style={{ "--drawing-swatch": preset } as CSSProperties}
                aria-label={t("drawing.color.choose", { color: preset })}
                title={preset}
                onClick={() => chooseColor(preset)}
              />
            ))}
          </div> : null}

          {error ? <div className="drawing-error" role="alert">{error}</div> : null}

          {!embedded ? <button
            type="button"
            className="drawing-confirm"
            aria-label={t("drawing.confirm")}
            title={t("drawing.confirm")}
            disabled={elements.length === 0 || confirming}
            onClick={confirmDrawing}
          >
            {confirming ? <span className="drawing-confirm-spinner" aria-hidden="true" /> : <Check size={22} />}
          </button> : null}
        </section>
        <ConfirmDialog
          open={discardOpen}
          title={t(embedded ? "imageEditor.markupDiscardTitle" : "drawing.discard.title")}
          description={t(embedded ? "imageEditor.markupDiscardDescription" : "drawing.discard.description")}
          confirmText={t(embedded ? "imageEditor.markupDiscardConfirm" : "drawing.discard.confirm")}
          cancelText={t("common.cancel")}
          destructive
          backdropClassName="modal-backdrop-top"
          onConfirm={() => {
            setDiscardOpen(false);
            onClose();
          }}
          onCancel={() => setDiscardOpen(false)}
        />
      </div>
    </DrawingContainer>
  );
}
