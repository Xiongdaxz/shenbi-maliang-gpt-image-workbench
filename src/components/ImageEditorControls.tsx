import { useEffect, useRef, useState, type CSSProperties, type FormEventHandler, type RefObject } from "react";
import {
  ArrowUp,
  Brush,
  ChevronDown,
  ChevronUp,
  ImageIcon,
  Lightbulb,
  Maximize2,
  Minus,
  Plus,
  Redo2,
  RefreshCw,
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
import { MaterialPickerDrawer } from "./MaterialPicker";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import type { SizeOption } from "../lib/imageOptions";
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
  redoStrokeCount: number;
  selectedSize: string;
  selectionMode: boolean;
  sizeOptions: SizeOption[];
  strokeCount: number;
  previewOriginalSizeLabel?: string;
  previewZoomLabel?: string;
  showPreviewControls?: boolean;
  onAdjustBrushSize: (delta: number) => void;
  onBrushSizeChange: (value: number) => void;
  onClearSelection: () => void;
  onClose: () => void;
  onEnterSelectionMode: () => void;
  onExitSelectionMode: () => void;
  onPickSize: (option: SizeOption) => void;
  onPreviewOriginalSize?: () => void;
  onPreviewReset?: () => void;
  onPreviewRotateLeft?: () => void;
  onPreviewRotateRight?: () => void;
  onPreviewZoomIn?: () => void;
  onPreviewZoomOut?: () => void;
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
  redoStrokeCount,
  selectedSize,
  selectionMode,
  sizeOptions,
  strokeCount,
  previewOriginalSizeLabel,
  previewZoomLabel,
  showPreviewControls,
  onAdjustBrushSize,
  onBrushSizeChange,
  onClearSelection,
  onClose,
  onEnterSelectionMode,
  onExitSelectionMode,
  onPickSize,
  onPreviewOriginalSize,
  onPreviewReset,
  onPreviewRotateLeft,
  onPreviewRotateRight,
  onPreviewZoomIn,
  onPreviewZoomOut,
  onRedoStroke,
  onUndoStroke
}: ImageEditorTopbarProps) {
  const { t } = useI18n();
  return (
    <header className="image-editor-topbar">
      <div className="image-editor-title">
        <button type="button" className="editor-icon-btn" onClick={selectionMode ? onExitSelectionMode : onClose} aria-label={t("common.close")}>
          <X size={20} />
        </button>
        <span>{selectionMode ? t("imageEditor.selectionTitle") : activeImage.prompt || t("imageEditor.title")}</span>
      </div>
      {!selectionMode && showPreviewControls ? (
        <div className="image-editor-preview-tools" aria-label={t("imagePreview.tools")}>
          <button type="button" className="image-editor-preview-tool" onClick={onPreviewRotateLeft} disabled={isSubmitting} aria-label={t("imagePreview.rotateLeft")} title={t("imagePreview.rotateLeft")}>
            <RotateCcw size={16} />
          </button>
          <button type="button" className="image-editor-preview-tool" onClick={onPreviewRotateRight} disabled={isSubmitting} aria-label={t("imagePreview.rotateRight")} title={t("imagePreview.rotateRight")}>
            <RotateCw size={16} />
          </button>
          <button type="button" className="image-editor-preview-tool" onClick={onPreviewZoomOut} disabled={isSubmitting} aria-label={t("imagePreview.zoomOut")} title={t("imagePreview.zoomOut")}>
            <ZoomOut size={16} />
          </button>
          <span className="image-editor-preview-zoom">{previewZoomLabel ?? "100%"}</span>
          <button type="button" className="image-editor-preview-tool" onClick={onPreviewZoomIn} disabled={isSubmitting} aria-label={t("imagePreview.zoomIn")} title={t("imagePreview.zoomIn")}>
            <ZoomIn size={16} />
          </button>
          <button type="button" className="image-editor-preview-tool text" onClick={onPreviewReset} disabled={isSubmitting} aria-label={t("imagePreview.reset")} title={t("imagePreview.reset")}>
            <RefreshCw size={15} />
            {t("imagePreview.resetShort")}
          </button>
          <button type="button" className="image-editor-preview-tool text" onClick={onPreviewOriginalSize} disabled={isSubmitting} aria-label={t("imagePreview.originalSize")} title={t("imagePreview.originalSize")}>
            <Maximize2 size={15} />
            {previewOriginalSizeLabel ? t("imagePreview.originalSizeWithLabel", { label: previewOriginalSizeLabel }) : t("imagePreview.originalSize")}
          </button>
        </div>
      ) : null}
      {selectionMode ? (
        <div className="image-editor-actions">
          <button type="button" className="editor-icon-btn" onClick={onUndoStroke} disabled={strokeCount === 0 || isSubmitting} aria-label={t("imageEditor.undo")}>
            <Undo2 size={19} />
          </button>
          <button type="button" className="editor-icon-btn" onClick={onRedoStroke} disabled={redoStrokeCount === 0 || isSubmitting} aria-label={t("imageEditor.redo")}>
            <Redo2 size={19} />
          </button>
          <button type="button" className="editor-icon-btn" onClick={onClearSelection} disabled={!hasSelection || isSubmitting} aria-label={t("common.clear")}>
            <Trash2 size={18} />
          </button>
          <label className="brush-size-control">
            <Brush size={17} />
            <button
              type="button"
              className="brush-step-btn"
              onClick={() => onAdjustBrushSize(-BRUSH_SIZE_STEP)}
              disabled={brushSize <= BRUSH_MIN_SIZE || isSubmitting}
              aria-label={t("imageEditor.decreaseBrush")}
            >
              <Minus size={14} />
            </button>
            <input
              type="range"
              min={BRUSH_MIN_SIZE}
              max={BRUSH_MAX_SIZE}
              step="2"
              value={brushSize}
              style={brushRangeStyle}
              onChange={(event) => onBrushSizeChange(Number(event.target.value))}
            />
            <button
              type="button"
              className="brush-step-btn"
              onClick={() => onAdjustBrushSize(BRUSH_SIZE_STEP)}
              disabled={brushSize >= BRUSH_MAX_SIZE || isSubmitting}
              aria-label={t("imageEditor.increaseBrush")}
            >
              <Plus size={14} />
            </button>
            <span>{brushSize}px</span>
          </label>
          <button type="button" className="editor-text-btn" onClick={onExitSelectionMode} disabled={isSubmitting}>
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <div className="image-editor-actions">
          <button type="button" className="editor-text-btn" onClick={onEnterSelectionMode} disabled={isSubmitting}>
            <Brush size={17} />
            {t("imageEditor.select")}
          </button>
          <EditorSizePicker value={selectedSize} options={sizeOptions} onSelect={onPickSize} />
          <ImageDownloadMenu
            source={{ type: "image", id: activeImage.id, downloadBaseName }}
            className="editor-round-btn"
            iconSize={18}
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
                alt={image.prompt}
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
  assets?: { assets: AssetItem[] };
  composerWrapRef?: RefObject<HTMLElement | null>;
  editorError: string;
  isSubmitting: boolean;
  materialPickerOpen: boolean;
  previews: EditorComposerPreview[];
  prompt: string;
  selectedAssets: AssetItem[];
  onPromptChange: (value: string) => void;
  onSelectedAssetsChange: (assets: AssetItem[]) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onOpenCasePicker: () => void;
  onToggleAsset: (asset: AssetItem) => void;
  onToggleMaterialPicker: () => void;
};

export function ImageEditorComposer({
  assets,
  composerWrapRef,
  editorError,
  isSubmitting,
  materialPickerOpen,
  previews,
  prompt,
  selectedAssets,
  onPromptChange,
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
      <form className={cx("image-editor-composer", previews.length > 0 && "has-preview")} onSubmit={onSubmit}>
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
                  <img src={preview.url} alt={preview.name} />
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
        <input value={prompt} onChange={(event) => onPromptChange(event.target.value)} onFocus={focusEditorInput} placeholder={t("imageEditor.promptPlaceholder")} />
        <button type="submit" className="editor-send-btn" disabled={isSubmitting || !prompt.trim()} aria-label={t("composer.send")}>
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
