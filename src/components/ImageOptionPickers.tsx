import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Brain, BrainCircuit, Check, ChevronDown, Image as ImageIcon, ImagePlus, Layers2, Ratio } from "lucide-react";
import { useI18n, type Translate } from "../i18n";
import type { ImageBackgroundOption } from "../lib/imageBackground";
import {
  IMAGE_BACKGROUND_PICKER_OPTIONS,
  sizeOptionFromValue,
  type QualityOption,
  type SizeOption
} from "../lib/imageOptions";
import { MAX_IMAGE_COUNT, MIN_IMAGE_COUNT } from "../lib/imagePromptCount";
import {
  DEFAULT_GENERATION_IMAGE_MODEL, DEFAULT_IMAGE_QUALITY, GPT_IMAGE_26_COMPLEXITIES, IMAGE_MODEL_OPTIONS,
  imageModelDisplayName, isGptImage26Model, normalizeImageComplexity, normalizeImageModel,
  type ImageComplexity, type ImageModelId
} from "../lib/imageModels";

function sizePreviewStyle(previewRatio?: string, box = 22) {
  const match = previewRatio?.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return { width: box, height: box };
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return { width: box, height: box };
  if (width >= height) {
    return { width: box, height: Math.max(7, Math.round((box * height) / width)) };
  }
  return { width: Math.max(7, Math.round((box * width) / height)), height: box };
}

function sizeOptionLabel(option: SizeOption, t: Translate) {
  return option.labelKey ? t(option.labelKey) : option.label;
}

function sizeOptionDescription(option: SizeOption, t: Translate) {
  if (!option.descriptionKey) return option.description;
  if (option.descriptionKey === "picker.size.customDimensions") return t(option.descriptionKey, { size: option.value });
  return t(option.descriptionKey);
}

function qualityOptionLabel(option: QualityOption, t: Translate) {
  return option.labelKey ? t(option.labelKey) : option.label;
}

function qualityOptionDescription(option: QualityOption, t: Translate) {
  if (!option.descriptionKey) return option.description;
  if (option.descriptionKey === "picker.quality.custom") return t(option.descriptionKey, { quality: option.value });
  return t(option.descriptionKey);
}

export function ModelPicker({
  value,
  onChange
}: {
  value: ImageModelId;
  onChange: (value: ImageModelId) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selected = normalizeImageModel(value, DEFAULT_GENERATION_IMAGE_MODEL);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className="size-picker model-picker" ref={wrapRef}>
      <button
        type="button"
        className="model-picker-trigger"
        data-tooltip={t("picker.model.tooltip")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <span className="size-trigger-icon model-trigger-icon" aria-hidden="true">
          <Brain size={15} />
        </span>
        <span>{imageModelDisplayName(selected)}</span>
        <ChevronDown size={15} className={open ? "open" : ""} />
      </button>
      {open ? (
        <div className="size-picker-menu model-picker-menu" role="listbox">
          {IMAGE_MODEL_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "active" : ""}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="model-option-copy">
                <strong>{imageModelDisplayName(option.value)}</strong>
                <small>{t(option.descriptionKey)}</small>
              </span>
              {option.value === value ? <Check className="size-option-check" size={16} /> : <span />}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function EditorSizePicker({
  value,
  options,
  disabled = false,
  onDisabledClick,
  onSelect
}: {
  value: string;
  options: SizeOption[];
  disabled?: boolean;
  onDisabledClick?: () => void;
  onSelect: (option: SizeOption) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selected = value ? options.find((item) => item.value === value) : null;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="editor-size-picker" ref={wrapRef}>
      <button
        type="button"
        className="editor-text-btn"
        aria-disabled={disabled}
        onClick={() => {
          if (disabled) {
            onDisabledClick?.();
            return;
          }
          setOpen((next) => !next);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="size-trigger-icon" aria-hidden="true">
          {selected ? <span style={sizePreviewStyle(selected.previewRatio, 20)} /> : <Ratio size={20} />}
        </span>
        <span>{selected ? sizeOptionLabel(selected, t) : t("picker.aspectRatio")}</span>
        {selected ? <small>{selected.ratio}</small> : null}
        <ChevronDown size={20} className={open ? "open" : ""} />
      </button>
      {open && !disabled ? (
        <div className="editor-size-menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "active" : ""}
              onClick={() => {
                setOpen(false);
                onSelect(option);
              }}
            >
              <span className="size-option-icon" aria-hidden="true">
                <span style={sizePreviewStyle(option.previewRatio, 22)} />
              </span>
              <span className="size-option-copy">
                <strong>
                  {sizeOptionLabel(option, t)} {option.ratio}
                </strong>
                <small>{sizeOptionDescription(option, t)}</small>
              </span>
              {option.value === value ? <Check className="size-option-check" size={16} /> : <span />}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SizePicker({
  value,
  options,
  onChange
}: {
  value: string;
  options: SizeOption[];
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selected = value ? options.find((item) => item.value === value) ?? sizeOptionFromValue(value) : null;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className="size-picker" ref={wrapRef}>
      <button
        type="button"
        className="size-picker-trigger"
        data-tooltip={t("picker.sizeDefaultAuto")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="size-trigger-icon" aria-hidden="true">
          {selected ? <span style={sizePreviewStyle(selected.previewRatio, 15)} /> : <Ratio size={15} />}
        </span>
        <span>{selected ? sizeOptionLabel(selected, t) : t("picker.aspectRatio")}</span>
        {selected ? <small>{selected.ratio}</small> : null}
        <ChevronDown size={15} className={open ? "open" : ""} />
      </button>
      {open ? (
        <div className="size-picker-menu" role="listbox">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={value && option.value === value ? "active" : ""}
              onClick={() => {
                onChange(option.value === value ? "" : option.value);
                setOpen(false);
              }}
            >
              <span className="size-option-icon" aria-hidden="true">
                <span style={sizePreviewStyle(option.previewRatio, 22)} />
              </span>
              <span className="size-option-copy">
                <strong>
                  {sizeOptionLabel(option, t)} {option.ratio}
                </strong>
                <small>{sizeOptionDescription(option, t)}</small>
              </span>
              {option.value === value ? <Check className="size-option-check" size={16} /> : <span />}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function QualityPicker({
  value,
  options,
  onChange,
  model,
  complexity,
  onComplexityChange
}: {
  value: string;
  options: QualityOption[];
  onChange: (value: string) => void;
  model: ImageModelId;
  complexity?: ImageComplexity;
  onComplexityChange?: (value?: ImageComplexity) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState<"quality" | "complexity" | null>(null);
  const tab = selectedTab ?? "quality";
  const [cardStyle, setCardStyle] = useState<CSSProperties>();
  const id = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const panelsRef = useRef<HTMLDivElement | null>(null);
  const qualityTabRef = useRef<HTMLButtonElement | null>(null);
  const complexityTabRef = useRef<HTMLButtonElement | null>(null);
  const hasComplexity = isGptImage26Model(model) && Boolean(onComplexityChange);
  const selected = value ? options.find((item) => item.value === value) : null;
  const onComplexityTab = tab === "complexity";
  const complexityOptions: QualityOption[] = GPT_IMAGE_26_COMPLEXITIES.map(key => ({
    value: key, label: t(`picker.complexity.${key}`), description: t(`picker.complexity.${key}Desc`)
  }));

  function chooseQuality(next: string) {
    onChange(next === value ? DEFAULT_IMAGE_QUALITY : next);
  }

  function closeCard() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function switchTab(next: "quality" | "complexity") {
    if (next === tab) return;
    if (panelsRef.current) panelsRef.current.scrollTop = 0;
    setSelectedTab(next);
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !hasComplexity) return;
    function positionCard() {
      const anchor = wrapRef.current?.getBoundingClientRect();
      const card = cardRef.current;
      if (!anchor || !card) return;
      const gutter = 12;
      const gap = 8;
      const above = anchor.top - gap - gutter;
      const below = window.innerHeight - anchor.bottom - gap - gutter;
      const opensBelow = above < 300 && below > above;
      const left = Math.min(Math.max(gutter, anchor.left), Math.max(gutter, window.innerWidth - card.offsetWidth - gutter));
      setCardStyle({
        left: left - anchor.left,
        maxHeight: Math.max(0, opensBelow ? below : above),
        ...(opensBelow ? { top: `calc(100% + ${gap}px)`, bottom: "auto" } : {})
      });
    }
    positionCard();
    qualityTabRef.current?.focus({ preventScroll: true });
    window.addEventListener("resize", positionCard);
    window.addEventListener("scroll", positionCard, true);
    return () => {
      window.removeEventListener("resize", positionCard);
      window.removeEventListener("scroll", positionCard, true);
    };
  }, [open, hasComplexity]);

  function renderOptions(choices: QualityOption[], selectedValue: string, choose: (value: string) => void, showValue = false) {
    return choices.map(option => (
      <button
        type="button"
        key={option.value}
        role="option"
        aria-selected={option.value === selectedValue}
        className={option.value === selectedValue ? "active" : ""}
        onClick={() => choose(option.value)}
      >
        <span className="quality-option-copy">
          <strong>{qualityOptionLabel(option, t)}</strong>
          <small>{showValue ? `${option.value} · ` : ""}{qualityOptionDescription(option, t)}</small>
        </span>
        {option.value === selectedValue ? <Check className="size-option-check" size={16} aria-hidden="true" /> : <span />}
      </button>
    ));
  }

  return (
    <div className="size-picker quality-picker" ref={wrapRef} onKeyDown={(event) => {
      if (!open || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeCard();
    }}>
      <button
        type="button"
        ref={triggerRef}
        className="quality-picker-trigger"
        data-tooltip={t(hasComplexity ? "picker.quality.settings" : selected ? "picker.quality.tooltip" : "picker.qualityDefaultAuto")}
        aria-haspopup={hasComplexity ? "dialog" : "listbox"}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-expanded={open}
        onClick={() => {
          if (!open) setSelectedTab(null);
          setOpen(!open);
        }}
      >
        <span className="size-trigger-icon quality-trigger-icon" aria-hidden="true">
          <ImageIcon size={15} />
        </span>
        <span>{selected ? qualityOptionLabel(selected, t) : t("picker.quality")}</span>
        <ChevronDown size={15} className={open ? "open" : ""} />
      </button>
      {open && hasComplexity ? (
        <div id={`${id}-menu`} ref={cardRef} className="size-picker-menu quality-picker-menu quality-settings-card"
          role="dialog" aria-label={t("picker.quality.settings")} style={cardStyle}>
          <div className="quality-settings-tabs" data-tab={tab} role="tablist" aria-label={t("picker.quality.settings")} onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? "quality" : event.key === "End" ? "complexity" : onComplexityTab ? "quality" : "complexity";
            switchTab(next);
            (next === "quality" ? qualityTabRef : complexityTabRef).current?.focus();
          }}>
            <button type="button" id={`${id}-quality`} ref={qualityTabRef} role="tab" aria-controls={`${id}-quality-panel`}
              aria-selected={!onComplexityTab} tabIndex={onComplexityTab ? -1 : 0} onClick={() => switchTab("quality")}>
              <ImageIcon size={15} aria-hidden="true" />{t("picker.quality")}
            </button>
            <button type="button" id={`${id}-complexity`} ref={complexityTabRef} role="tab" aria-controls={`${id}-complexity-panel`}
              aria-selected={onComplexityTab} tabIndex={onComplexityTab ? 0 : -1} onClick={() => switchTab("complexity")}>
              <BrainCircuit size={15} aria-hidden="true" />{t("picker.complexity")}
            </button>
          </div>
          <div className="quality-settings-panels" ref={panelsRef}>
            <div id={`${id}-quality-panel`} className="quality-settings-panel" data-slide={selectedTab === "quality" ? "quality" : undefined}
              role="tabpanel" aria-labelledby={`${id}-quality`} aria-hidden={onComplexityTab} inert={onComplexityTab}>
              <div className="quality-settings-options" role="listbox" aria-labelledby={`${id}-quality`}>
                {renderOptions(options, value, chooseQuality)}
              </div>
            </div>
            <div id={`${id}-complexity-panel`} className="quality-settings-panel" data-slide={onComplexityTab ? "complexity" : undefined}
              role="tabpanel" aria-labelledby={`${id}-complexity`} aria-hidden={!onComplexityTab} inert={!onComplexityTab}>
              <div className="quality-settings-options" role="listbox" aria-labelledby={`${id}-complexity`}>
                {renderOptions(complexityOptions, complexity ?? "", (next) => {
                  onComplexityChange?.(next === complexity ? undefined : normalizeImageComplexity(model, next));
                })}
              </div>
            </div>
          </div>
        </div>
      ) : open ? (
        <div id={`${id}-menu`} className="size-picker-menu quality-picker-menu" role="listbox">
          {renderOptions(options, value, (next) => {
            chooseQuality(next);
            closeCard();
          }, true)}
        </div>
      ) : null}
    </div>
  );
}

export function BackgroundPicker({
  value,
  onChange
}: {
  value: ImageBackgroundOption;
  onChange: (value: ImageBackgroundOption) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selected = IMAGE_BACKGROUND_PICKER_OPTIONS.find((item) => item.value === value);
  const triggerLabel = selected ? t(selected.labelKey) : t("picker.background.trigger");
  const tooltip = t("picker.backgroundTooltip");

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className="size-picker background-picker" ref={wrapRef}>
      <button
        type="button"
        className="background-picker-trigger"
        data-tooltip={tooltip}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <span className="size-trigger-icon background-trigger-icon" aria-hidden="true">
          <Layers2 size={15} />
        </span>
        <span>{triggerLabel}</span>
        <ChevronDown size={15} className={open ? "open" : ""} />
      </button>
      {open ? (
        <div className="size-picker-menu background-picker-menu" role="listbox">
          {IMAGE_BACKGROUND_PICKER_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "active" : ""}
              onClick={() => {
                onChange(option.value === value ? "auto" : option.value);
                setOpen(false);
              }}
            >
              <span className="background-option-copy">
                <strong>{t(option.labelKey)}</strong>
                <small>{t(option.descriptionKey)}</small>
              </span>
              {option.value === value ? <Check className="size-option-check" size={16} /> : <span />}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ImageCountStepper({
  value,
  onChange,
  disabled = false,
  min = MIN_IMAGE_COUNT,
  max = MAX_IMAGE_COUNT
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  const { t } = useI18n();
  const clamp = (nextValue: number) => (Number.isFinite(nextValue) ? Math.max(min, Math.min(max, nextValue)) : min);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ top: -10000, left: -10000 });
  const selectedValue = clamp(value || min);
  const options = Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);

  function updateMenuPosition() {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.ceil(menuRef.current?.offsetWidth ?? rect.width);
    const menuHeight = menuRef.current?.offsetHeight ?? 272;
    const top = Math.max(12, rect.top - menuHeight - 8);
    const maxLeft = Math.max(12, window.innerWidth - width - 12);
    const left = Math.min(Math.max(12, rect.left), maxLeft);
    setMenuStyle({ top, left });
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    const frame = window.requestAnimationFrame(updateMenuPosition);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  return (
    <div className="size-picker image-count-stepper" ref={wrapRef}>
      <button
        type="button"
        className="image-count-trigger"
        data-tooltip={t("picker.imageCountTooltip")}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
      >
        <span className="size-trigger-icon image-count-trigger-icon" aria-hidden="true">
          <ImagePlus size={15} />
        </span>
        <span>{t("picker.imageCount", { count: selectedValue })}</span>
        <ChevronDown size={15} className={open ? "open" : ""} />
      </button>
      {open ? createPortal(
        <div ref={menuRef} className="size-picker-menu image-count-menu" role="listbox" style={menuStyle}>
          {options.map((option) => (
            <button
              type="button"
              key={option}
              role="option"
              aria-selected={option === selectedValue}
              className={option === selectedValue ? "active" : ""}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <span className="image-count-option-copy">
                <strong>{t("picker.imageCountOption", { count: option })}</strong>
              </span>
              {option === selectedValue ? <Check className="size-option-check" size={16} /> : <span />}
            </button>
          ))}
        </div>,
        document.body
      ) : null}
    </div>
  );
}
