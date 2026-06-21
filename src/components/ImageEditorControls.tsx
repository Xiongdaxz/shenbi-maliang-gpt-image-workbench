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
  Share2,
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
  onShareImage: () => void;
  onUndoStroke: () => void;
};

export function ImageEditorTopbar({
  activeImage,
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
  onShareImage,
  onUndoStroke
}: ImageEditorTopbarProps) {
  return (
    <header className="image-editor-topbar">
      <div className="image-editor-title">
        <button type="button" className="editor-icon-btn" onClick={selectionMode ? onExitSelectionMode : onClose} aria-label="关闭">
          <X size={20} />
        </button>
        <span>{selectionMode ? "编辑选择" : activeImage.prompt || "图片编辑"}</span>
      </div>
      {!selectionMode && showPreviewControls ? (
        <div className="image-editor-preview-tools" aria-label="图片预览工具">
          <button type="button" className="image-editor-preview-tool" onClick={onPreviewRotateLeft} disabled={isSubmitting} aria-label="向左旋转" title="向左旋转">
            <RotateCcw size={16} />
          </button>
          <button type="button" className="image-editor-preview-tool" onClick={onPreviewRotateRight} disabled={isSubmitting} aria-label="向右旋转" title="向右旋转">
            <RotateCw size={16} />
          </button>
          <button type="button" className="image-editor-preview-tool" onClick={onPreviewZoomOut} disabled={isSubmitting} aria-label="缩小" title="缩小">
            <ZoomOut size={16} />
          </button>
          <span className="image-editor-preview-zoom">{previewZoomLabel ?? "100%"}</span>
          <button type="button" className="image-editor-preview-tool" onClick={onPreviewZoomIn} disabled={isSubmitting} aria-label="放大" title="放大">
            <ZoomIn size={16} />
          </button>
          <button type="button" className="image-editor-preview-tool text" onClick={onPreviewReset} disabled={isSubmitting} aria-label="重置预览" title="重置预览">
            <RefreshCw size={15} />
            重置
          </button>
          <button type="button" className="image-editor-preview-tool text" onClick={onPreviewOriginalSize} disabled={isSubmitting} aria-label="原始尺寸" title="原始尺寸">
            <Maximize2 size={15} />
            原始尺寸{previewOriginalSizeLabel ? ` ${previewOriginalSizeLabel}` : ""}
          </button>
        </div>
      ) : null}
      {selectionMode ? (
        <div className="image-editor-actions">
          <button type="button" className="editor-icon-btn" onClick={onUndoStroke} disabled={strokeCount === 0 || isSubmitting} aria-label="撤销">
            <Undo2 size={19} />
          </button>
          <button type="button" className="editor-icon-btn" onClick={onRedoStroke} disabled={redoStrokeCount === 0 || isSubmitting} aria-label="重做">
            <Redo2 size={19} />
          </button>
          <button type="button" className="editor-icon-btn" onClick={onClearSelection} disabled={!hasSelection || isSubmitting} aria-label="清空">
            <Trash2 size={18} />
          </button>
          <label className="brush-size-control">
            <Brush size={17} />
            <button
              type="button"
              className="brush-step-btn"
              onClick={() => onAdjustBrushSize(-BRUSH_SIZE_STEP)}
              disabled={brushSize <= BRUSH_MIN_SIZE || isSubmitting}
              aria-label="减小画笔"
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
              aria-label="增大画笔"
            >
              <Plus size={14} />
            </button>
            <span>{brushSize}px</span>
          </label>
          <button type="button" className="editor-text-btn" onClick={onExitSelectionMode} disabled={isSubmitting}>
            取消
          </button>
        </div>
      ) : (
        <div className="image-editor-actions">
          <button type="button" className="editor-text-btn" onClick={onEnterSelectionMode} disabled={isSubmitting}>
            <Brush size={17} />
            选择
          </button>
          <EditorSizePicker value={selectedSize} options={sizeOptions} onSelect={onPickSize} />
          <button type="button" className="editor-round-btn" onClick={onShareImage} aria-label="分享">
            <Share2 size={18} />
          </button>
          <ImageDownloadMenu
            source={{ type: "image", id: activeImage.id }}
            className="editor-round-btn"
            iconSize={18}
            ariaLabel="下载"
            title="下载"
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
  thumbListRef: RefObject<HTMLDivElement | null>;
  onSelectByOffset: (offset: number) => void;
  onSelectImage: (image: WorkImage) => void;
};

export function ImageEditorRail({
  activeImage,
  activeIndex,
  activeThumbRef,
  images,
  thumbListRef,
  onSelectByOffset,
  onSelectImage
}: ImageEditorRailProps) {
  return (
    <aside className="image-editor-rail">
      <button type="button" className="thumb-step-btn" onClick={() => onSelectByOffset(-1)} disabled={activeIndex <= 0} aria-label="上一张">
        <ChevronUp size={17} />
      </button>
      <div className="image-editor-thumbs" ref={thumbListRef}>
        {images.map((image) => (
          <button
            key={image.id}
            type="button"
            ref={image.id === activeImage.id ? activeThumbRef : undefined}
            className={cx(image.id === activeImage.id && "active")}
            onClick={() => onSelectImage(image)}
            aria-label="选择图片"
          >
            <img src={image.thumbnailUrl || image.previewUrl || image.url} alt={image.prompt} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="thumb-step-btn"
        onClick={() => onSelectByOffset(1)}
        disabled={activeIndex >= images.length - 1}
        aria-label="下一张"
      >
        <ChevronDown size={17} />
      </button>
      <span className="image-editor-count">共 {images.length} 张</span>
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
                  aria-label={`预览${preview.name}`}
                >
                  <img src={preview.url} alt={preview.name} />
                </button>
                <button type="button" className="composer-preview-remove" onClick={preview.onRemove} aria-label={`移除${preview.name}`}>
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
              aria-label="添加素材"
              aria-expanded={quickMenuOpen}
              data-tooltip="添加素材"
            >
              <Plus size={24} strokeWidth={2} />
            </button>
            {quickMenuOpen ? (
              <div className="composer-quick-menu editor-composer-quick-menu" role="menu" aria-label="编辑素材选项">
                <button type="button" role="menuitem" onClick={selectMaterialPicker}>
                  <ImageIcon size={17} />
                  <strong>素材库</strong>
                </button>
                <button type="button" role="menuitem" onClick={selectCasePicker}>
                  <Lightbulb size={17} />
                  <strong>灵感空间</strong>
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <input value={prompt} onChange={(event) => onPromptChange(event.target.value)} onFocus={focusEditorInput} placeholder="描述编辑" />
        <button type="submit" className="editor-send-btn" disabled={isSubmitting || !prompt.trim()} aria-label="发送">
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
