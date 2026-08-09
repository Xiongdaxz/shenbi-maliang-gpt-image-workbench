import { useEffect, useRef, useState, type CSSProperties, type FormEventHandler, type RefObject } from "react";
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Eraser,
  ImageIcon,
  Lightbulb,
  Maximize2,
  Minimize2,
  MessageCircleMore,
  MessageCirclePlus,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { ImageDownloadMenu } from "./ImageDownloadMenu";
import { ImageLightbox, type ImageLightboxState } from "./ImageLightbox";
import { EditorSizePicker } from "./ImageOptionPickers";
import { ImageZoomSlider } from "./ImageZoomSlider";
import { MaterialPickerDrawer } from "./MaterialPicker";
import { CheckerboardImage } from "./CheckerboardImage";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import type { SizeOption } from "../lib/imageOptions";
import { formatImageAnnotationDisplayText, type ImageEditIntent } from "../lib/imageAnnotations";
import {
  BRUSH_MAX_SIZE,
  BRUSH_MIN_SIZE,
  BRUSH_SIZE_STEP
} from "../lib/selectionMask";
import type { AssetItem, WorkImage } from "../types";

export type EditorComposerPreview = {
  id: string;
  url: string;
  previewUrl?: string;
  name: string;
  title: string;
  onRemove: () => void;
};

type ImageEditorTopbarProps = {
  activeImage: WorkImage;
  downloadBaseName?: string;
  brushRangeStyle: CSSProperties;
  brushSize: number;
  hasSelection: boolean;
  isSubmitting: boolean;
  mode: ImageEditIntent;
  redoStrokeCount: number;
  selectedSize: string;
  sizeOptions: SizeOption[];
  strokeCount: number;
  previewOriginalSizeLabel?: string;
  previewResetActive?: boolean;
  previewZoomLabel?: string;
  previewZoomMax?: number;
  previewZoomMin?: number;
  previewZoomValue?: number;
  showPreviewControls?: boolean;
  onAdjustBrushSize: (delta: number) => void;
  onBrushSizeChange: (value: number) => void;
  onClearSelection: () => void;
  onClose: () => void;
  onEnterMode: (mode: "annotation" | "remove") => void;
  onExitMode: () => void;
  onRemoveSubmit: () => void;
  onBrushPreviewChange: (active: boolean) => void;
  onPickSize: (option: SizeOption) => void;
  onPreviewOriginalSize?: () => void;
  onPreviewReset?: () => void;
  onPreviewRotateLeft?: () => void;
  onPreviewRotateRight?: () => void;
  onPreviewZoomIn?: () => void;
  onPreviewZoomOut?: () => void;
  onPreviewZoomChange?: (value: number) => void;
  onRedoStroke: () => void;
  onUndoStroke: () => void;
};

export function ImageEditorTopbar({
  activeImage,
  downloadBaseName,
  brushRangeStyle,
  brushSize,
  hasSelection,
  isSubmitting,
  mode,
  redoStrokeCount,
  selectedSize,
  sizeOptions,
  strokeCount,
  previewOriginalSizeLabel,
  previewResetActive,
  previewZoomLabel,
  previewZoomMax,
  previewZoomMin,
  previewZoomValue,
  showPreviewControls,
  onAdjustBrushSize,
  onBrushSizeChange,
  onClearSelection,
  onClose,
  onEnterMode,
  onExitMode,
  onRemoveSubmit,
  onBrushPreviewChange,
  onPickSize,
  onPreviewOriginalSize,
  onPreviewReset,
  onPreviewRotateLeft,
  onPreviewRotateRight,
  onPreviewZoomIn,
  onPreviewZoomOut,
  onPreviewZoomChange,
  onRedoStroke,
  onUndoStroke
}: ImageEditorTopbarProps) {
  const { t } = useI18n();
  const annotationMode = mode === "annotation";
  const removeMode = mode === "remove";
  const modeActive = mode !== "standard";
  const activeImageDisplayPrompt = formatImageAnnotationDisplayText(activeImage.prompt);
  return (
    <header className="image-editor-topbar">
      <div className="image-editor-title">
        <button type="button" className="editor-icon-btn" onClick={modeActive ? onExitMode : onClose} aria-label={modeActive ? t("common.cancel") : t("common.close")}>
          <X size={20} />
        </button>
        <span>
          {annotationMode
            ? t("imageEditor.annotationTitle")
            : removeMode
              ? t("imageEditor.removeTitle")
              : activeImageDisplayPrompt || t("imageEditor.title")}
        </span>
      </div>
      {!modeActive && showPreviewControls ? (
        <div className="image-editor-preview-tools" aria-label={t("imagePreview.tools")}>
          <button type="button" className="image-editor-preview-tool" onClick={onPreviewRotateLeft} disabled={isSubmitting} aria-label={t("imagePreview.rotateLeft")} title={t("imagePreview.rotateLeft")}>
            <RotateCcw size={20} />
          </button>
          <button type="button" className="image-editor-preview-tool" onClick={onPreviewRotateRight} disabled={isSubmitting} aria-label={t("imagePreview.rotateRight")} title={t("imagePreview.rotateRight")}>
            <RotateCw size={20} />
          </button>
          <button type="button" className="image-editor-preview-tool" onClick={onPreviewZoomOut} disabled={isSubmitting} aria-label={t("imagePreview.zoomOut")} title={t("imagePreview.zoomOut")}>
            <ZoomOut size={20} />
          </button>
          <ImageZoomSlider
            min={previewZoomMin ?? 10}
            max={previewZoomMax ?? 300}
            value={previewZoomValue ?? 100}
            label={previewZoomLabel ?? "100%"}
            disabled={isSubmitting}
            onChange={(value) => onPreviewZoomChange?.(value)}
          />
          <button type="button" className="image-editor-preview-tool" onClick={onPreviewZoomIn} disabled={isSubmitting} aria-label={t("imagePreview.zoomIn")} title={t("imagePreview.zoomIn")}>
            <ZoomIn size={20} />
          </button>
          <button
            type="button"
            className="image-editor-preview-tool"
            onClick={previewResetActive ? onPreviewReset : onPreviewOriginalSize}
            disabled={isSubmitting}
            aria-label={previewResetActive
              ? t("imagePreview.reset")
              : previewOriginalSizeLabel
                ? t("imagePreview.originalSizeWithLabel", { label: previewOriginalSizeLabel })
                : t("imagePreview.originalSize")}
            title={previewResetActive
              ? t("imagePreview.reset")
              : previewOriginalSizeLabel
                ? t("imagePreview.originalSizeWithLabel", { label: previewOriginalSizeLabel })
                : t("imagePreview.originalSize")}
          >
            {previewResetActive ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
          </button>
        </div>
      ) : null}
      {removeMode ? (
        <div className="image-editor-actions">
          <button type="button" className="editor-icon-btn" onClick={onUndoStroke} disabled={strokeCount === 0 || isSubmitting} aria-label={t("imageEditor.undo")}>
            <Undo2 size={20} />
          </button>
          <button type="button" className="editor-icon-btn" onClick={onRedoStroke} disabled={redoStrokeCount === 0 || isSubmitting} aria-label={t("imageEditor.redo")}>
            <Redo2 size={20} />
          </button>
          <button type="button" className="editor-icon-btn" onClick={onClearSelection} disabled={!hasSelection || isSubmitting} aria-label={t("common.clear")}>
            <Trash2 size={20} />
          </button>
          <label className="brush-size-control">
            <button
              type="button"
              className="brush-step-btn"
              onClick={() => onAdjustBrushSize(-BRUSH_SIZE_STEP)}
              disabled={brushSize <= BRUSH_MIN_SIZE || isSubmitting}
              aria-label={t("imageEditor.decreaseBrush")}
            >
              <Minus size={20} />
            </button>
            <input
              type="range"
              min={BRUSH_MIN_SIZE}
              max={BRUSH_MAX_SIZE}
              step={BRUSH_SIZE_STEP}
              value={brushSize}
              style={brushRangeStyle}
              onChange={(event) => onBrushSizeChange(Number(event.target.value))}
              onPointerDown={() => onBrushPreviewChange(true)}
              onPointerUp={() => onBrushPreviewChange(false)}
              onPointerCancel={() => onBrushPreviewChange(false)}
              onLostPointerCapture={() => onBrushPreviewChange(false)}
              onBlur={() => onBrushPreviewChange(false)}
              aria-label={t("imageEditor.brushSize")}
            />
            <button
              type="button"
              className="brush-step-btn"
              onClick={() => onAdjustBrushSize(BRUSH_SIZE_STEP)}
              disabled={brushSize >= BRUSH_MAX_SIZE || isSubmitting}
              aria-label={t("imageEditor.increaseBrush")}
            >
              <Plus size={20} />
            </button>
            <span>{brushSize}px</span>
          </label>
          <button type="button" className="editor-primary-btn" onClick={onRemoveSubmit} disabled={!hasSelection || isSubmitting}>
            {t("composer.send")}
          </button>
          <button type="button" className="editor-text-btn" onClick={onExitMode} disabled={isSubmitting}>
            {t("common.cancel")}
          </button>
        </div>
      ) : annotationMode ? (
        <div className="image-editor-actions">
          <button type="button" className="editor-text-btn" onClick={onExitMode} disabled={isSubmitting}>
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <div className="image-editor-actions">
          <button type="button" className="editor-text-btn" onClick={() => onEnterMode("annotation")} disabled={isSubmitting}>
            <MessageCirclePlus size={20} />
            {t("imageEditor.annotation")}
          </button>
          <button type="button" className="editor-text-btn" onClick={() => onEnterMode("remove")} disabled={isSubmitting}>
            <Eraser size={20} />
            {t("imageEditor.remove")}
          </button>
          <EditorSizePicker value={selectedSize} options={sizeOptions} onSelect={onPickSize} />
          <ImageDownloadMenu
            source={{ type: "image", id: activeImage.id, downloadBaseName }}
            className="editor-round-btn"
            iconSize={20}
            ariaLabel={t("imageEditor.download")}
            title={t("imageEditor.download")}
            placement="bottom-end"
          />
        </div>
      )}
    </header>
  );
}

type ImageEditorRailProps = {
  activeImage: WorkImage;
  activeIndex: number;
  activeThumbRef: RefObject<HTMLButtonElement | null>;
  images: WorkImage[];
  totalImageCount?: number;
  thumbListRef: RefObject<HTMLDivElement | null>;
  onSelectByOffset: (offset: number) => void;
  onSelectImage: (image: WorkImage) => void;
};

export function ImageEditorRail({
  activeImage,
  activeIndex,
  activeThumbRef,
  images,
  totalImageCount,
  thumbListRef,
  onSelectByOffset,
  onSelectImage
}: ImageEditorRailProps) {
  const { t } = useI18n();
  const firstVisibleIndex = Math.max(0, activeIndex - 8);
  const visibleImages = images.slice(firstVisibleIndex, activeIndex + 9);
  const resolvedTotalImageCount = Math.max(images.length, totalImageCount ?? images.length);
  return (
    <aside className="image-editor-rail">
      <button type="button" className="thumb-step-btn" onClick={() => onSelectByOffset(-1)} disabled={activeIndex <= 0} aria-label={t("imagePreview.previous")}>
        <ChevronUp size={17} />
      </button>
      <div className="image-editor-thumbs" ref={thumbListRef}>
        {visibleImages.map((image, visibleIndex) => {
          const distance = Math.abs(firstVisibleIndex + visibleIndex - activeIndex);
          return (
            <button
              key={image.id}
              type="button"
              ref={image.id === activeImage.id ? activeThumbRef : undefined}
              className={cx(image.id === activeImage.id && "active")}
              onClick={() => onSelectImage(image)}
              aria-label={t("imageEditor.selectImage")}
            >
              <img
                src={image.thumbnailUrl || image.previewUrl || image.url}
                alt={formatImageAnnotationDisplayText(image.prompt)}
                loading={distance <= 1 ? "eager" : "lazy"}
                fetchPriority={distance === 0 ? "high" : "auto"}
                decoding="async"
              />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="thumb-step-btn"
        onClick={() => onSelectByOffset(1)}
        disabled={activeIndex >= images.length - 1}
        aria-label={t("imagePreview.next")}
      >
        <ChevronDown size={17} />
      </button>
      <span className="image-editor-count">{t("pages.images.count", { count: resolvedTotalImageCount })}</span>
    </aside>
  );
}

type ImageEditorComposerProps = {
  annotationCount?: number;
  annotationMode?: boolean;
  annotationTooltipsVisible?: boolean;
  assets?: { assets: AssetItem[] };
  composerWrapRef?: RefObject<HTMLElement | null>;
  editorError: string;
  isSubmitting: boolean;
  materialPickerOpen: boolean;
  previews: EditorComposerPreview[];
  prompt: string;
  selectedAssets: AssetItem[];
  onPromptChange: (value: string) => void;
  onClearAnnotations: () => void;
  onToggleAnnotationTooltips: () => void;
  onSelectedAssetsChange: (assets: AssetItem[]) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onOpenCasePicker: () => void;
  onToggleAsset: (asset: AssetItem) => void;
  onToggleMaterialPicker: () => void;
};

export function ImageEditorComposer({
  annotationCount = 0,
  annotationMode = false,
  annotationTooltipsVisible = false,
  assets,
  composerWrapRef,
  editorError,
  isSubmitting,
  materialPickerOpen,
  previews,
  prompt,
  selectedAssets,
  onPromptChange,
  onClearAnnotations,
  onToggleAnnotationTooltips,
  onSelectedAssetsChange,
  onSubmit,
  onOpenCasePicker,
  onToggleAsset,
  onToggleMaterialPicker
}: ImageEditorComposerProps) {
  const { t } = useI18n();
  const [previewState, setPreviewState] = useState<ImageLightboxState | null>(null);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const quickMenuRef = useRef<HTMLDivElement | null>(null);
  const previewItems = previews.map((preview) => ({
    url: preview.previewUrl ?? preview.url,
    thumbnailUrl: preview.url,
    name: preview.name
  }));

  useEffect(() => {
    if (!quickMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!quickMenuRef.current?.contains(target)) setQuickMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setQuickMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [quickMenuOpen]);

  function closeMaterialPickerWithMotion() {
    if (!materialPickerOpen) return;
    onToggleMaterialPicker();
  }

  function toggleMaterialPickerWithMotion() {
    if (materialPickerOpen) {
      closeMaterialPickerWithMotion();
      return;
    }
    onToggleMaterialPicker();
  }

  function selectMaterialPicker() {
    setQuickMenuOpen(false);
    toggleMaterialPickerWithMotion();
  }

  function selectCasePicker() {
    setQuickMenuOpen(false);
    onOpenCasePicker();
  }

  function focusEditorInput() {
    if (materialPickerOpen && selectedAssets.length > 0) closeMaterialPickerWithMotion();
  }

  return (
    <footer ref={composerWrapRef} className="image-editor-composer-wrap">
      {editorError ? <div className="form-error">{editorError}</div> : null}
      <form
        className={cx(
          "image-editor-composer",
          previews.length > 0 && "has-preview",
          annotationMode && "is-annotation",
          annotationMode && annotationCount > 0 && "has-annotations"
        )}
        onSubmit={onSubmit}
      >
        {annotationMode && annotationCount > 0 ? (
          <div className="image-editor-annotation-summary">
            <button
              type="button"
              className="image-editor-annotation-toggle"
              aria-expanded={annotationTooltipsVisible}
              onClick={onToggleAnnotationTooltips}
            >
              <MessageCircleMore size={16} />
              <span className="image-editor-annotation-count">{t("imageEditor.annotationCount", { count: annotationCount })}</span>
            </button>
            <button
              type="button"
              className="image-editor-annotation-clear"
              disabled={isSubmitting}
              aria-label={t("imageEditor.clearAnnotations")}
              title={t("imageEditor.clearAnnotations")}
              onClick={onClearAnnotations}
            >
              <X size={17} />
            </button>
          </div>
        ) : null}
        {previews.length > 0 ? (
          <div className="image-editor-composer-preview-row composer-preview-row">
            {previews.map((preview, index) => (
              <figure key={preview.id} className="composer-preview-card" title={preview.title}>
                <button
                  type="button"
                  className="composer-preview-open"
                  onClick={() => setPreviewState({ items: previewItems, index })}
                  aria-label={t("composer.previewNamed", { name: preview.name })}
                >
                  <CheckerboardImage src={preview.url} alt={preview.name} />
                </button>
                <button type="button" className="composer-preview-remove" onClick={preview.onRemove} aria-label={t("composer.removeNamed", { name: preview.name })}>
                  <X size={15} />
                </button>
              </figure>
            ))}
          </div>
        ) : null}
        <div className="image-editor-composer-tools">
          <div className="composer-quick-wrap editor-composer-quick-wrap" ref={quickMenuRef}>
            <button
              type="button"
              className="editor-composer-tool composer-tool-btn"
              onClick={() => setQuickMenuOpen((open) => !open)}
              aria-label={t("imageEditor.addMaterial")}
              aria-expanded={quickMenuOpen}
              data-tooltip={t("imageEditor.addMaterial")}
            >
              <Plus size={24} strokeWidth={2} />
            </button>
            {quickMenuOpen ? (
              <div className="composer-quick-menu editor-composer-quick-menu" role="menu" aria-label={t("imageEditor.materialOptions")}>
                <button type="button" role="menuitem" onClick={selectMaterialPicker}>
                  <ImageIcon size={17} />
                  <strong>{t("composer.assets")}</strong>
                </button>
                <button type="button" role="menuitem" onClick={selectCasePicker}>
                  <Lightbulb size={17} />
                  <strong>{t("composer.inspiration")}</strong>
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <input
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onFocus={focusEditorInput}
          placeholder={annotationMode ? t("imageEditor.annotationExtraPlaceholder") : t("imageEditor.promptPlaceholder")}
        />
        <button type="submit" className="editor-send-btn" disabled={isSubmitting || (annotationMode ? annotationCount === 0 : !prompt.trim())} aria-label={t("composer.send")}>
          <ArrowUp size={22} />
        </button>
      </form>
      <MaterialPickerDrawer
        open={materialPickerOpen}
        assets={assets}
        selectedAssets={selectedAssets}
        onToggleAsset={onToggleAsset}
        onSelectedAssetsChange={onSelectedAssetsChange}
        onClose={closeMaterialPickerWithMotion}
      />
      <ImageLightbox
        state={previewState}
        onClose={() => setPreviewState(null)}
        onChangeIndex={(index) => setPreviewState((state) => (state ? { ...state, index } : state))}
      />
    </footer>
  );
}
