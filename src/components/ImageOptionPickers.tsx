import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Image as ImageIcon, Minus, Plus, Ratio } from "lucide-react";
import { sizeOptionFromValue, type QualityOption, type SizeOption } from "../lib/imageOptions";

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

export function EditorSizePicker({
  value,
  options,
  onSelect
}: {
  value: string;
  options: SizeOption[];
  onSelect: (option: SizeOption) => void;
}) {
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

  return (
    <div className="editor-size-picker" ref={wrapRef}>
      <button type="button" className="editor-text-btn" onClick={() => setOpen((next) => !next)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="size-trigger-icon" aria-hidden="true">
          {selected ? <span style={sizePreviewStyle(selected.previewRatio, 15)} /> : <Ratio size={15} />}
        </span>
        <span>{selected?.label ?? "宽高比"}</span>
        {selected ? <small>{selected.ratio}</small> : null}
        <ChevronDown size={15} className={open ? "open" : ""} />
      </button>
      {open ? (
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
                  {option.label} {option.ratio}
                </strong>
                <small>{option.description}</small>
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
        data-tooltip="尺寸：默认自动"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="size-trigger-icon" aria-hidden="true">
          {selected ? <span style={sizePreviewStyle(selected.previewRatio, 15)} /> : <Ratio size={15} />}
        </span>
        <span>{selected?.label ?? "宽高比"}</span>
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
                  {option.label} {option.ratio}
                </strong>
                <small>{option.description}</small>
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
  onChange
}: {
  value: string;
  options: QualityOption[];
  onChange: (value: string) => void;
}) {
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

  return (
    <div className="size-picker quality-picker" ref={wrapRef}>
      <button
        type="button"
        className="quality-picker-trigger"
        data-tooltip="质量：默认自动"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="size-trigger-icon quality-trigger-icon" aria-hidden="true">
          <ImageIcon size={15} />
        </span>
        <span>{selected?.label ?? "质量"}</span>
        <ChevronDown size={15} className={open ? "open" : ""} />
      </button>
      {open ? (
        <div className="size-picker-menu quality-picker-menu" role="listbox">
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
              <span className="quality-option-copy">
                <strong>{option.label}</strong>
                <small>{option.description}</small>
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
  min = 1,
  max = 10
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  const clamp = (nextValue: number) => (Number.isFinite(nextValue) ? Math.max(min, Math.min(max, nextValue)) : min);
  const update = (nextValue: number) => onChange(clamp(nextValue));

  return (
    <div className="image-count-stepper" aria-label="生成数量" data-tooltip="生成数量，也可以在提示词中写：分别生成几张">
      <span>数量</span>
      <button type="button" onClick={() => update(value - 1)} disabled={value <= min} aria-label="减少生成数量">
        <Minus size={15} />
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => update(Number.parseInt(event.target.value || String(min), 10))}
        aria-label="生成数量"
      />
      <button type="button" onClick={() => update(value + 1)} disabled={value >= max} aria-label="增加生成数量">
        <Plus size={15} />
      </button>
    </div>
  );
}
