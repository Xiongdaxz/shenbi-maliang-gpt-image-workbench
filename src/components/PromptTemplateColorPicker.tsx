import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cx } from "../lib/cx";
import {
  normalizePromptTemplateColorValue,
  normalizePromptTemplateHex,
  promptTemplateColorOptions,
  promptTemplateGradientOptions
} from "../lib/promptTemplates";
import type {
  PromptTemplateColorValue,
  PromptTemplateComponent,
  PromptTemplateGradientOption
} from "../types";

type PromptTemplateColorPickerProps = {
  component: PromptTemplateComponent;
  value: unknown;
  onChange: (value: PromptTemplateColorValue) => void;
};

type SelectedColorPreviewItem = {
  id: string;
  style: CSSProperties;
};

function gradientStyle(option: PromptTemplateGradientOption): CSSProperties {
  return {
    background: `linear-gradient(90deg, ${option.colors.join(", ")})`
  };
}

function removeValue(values: string[] | undefined, value: string) {
  return (values ?? []).filter((item) => item !== value);
}

export function PromptTemplateColorPicker({ component, value, onChange }: PromptTemplateColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [customColor, setCustomColor] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const normalized = useMemo(() => normalizePromptTemplateColorValue(value, component), [component, value]);
  const colorOptions = useMemo(() => promptTemplateColorOptions(component), [component]);
  const gradientOptions = useMemo(() => promptTemplateGradientOptions(component), [component]);
  const colorById = useMemo(() => new Map(colorOptions.map((option) => [option.id, option])), [colorOptions]);
  const gradientById = useMemo(() => new Map(gradientOptions.map((option) => [option.id, option])), [gradientOptions]);
  const selectedColors = normalized.colors ?? [];
  const selectedGradients = normalized.gradients ?? [];
  const customColors = normalized.customColors ?? [];
  const allowCustomColor = component.allowCustomColor !== false;
  const normalizedCustomColor = normalizePromptTemplateHex(customColor);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function emit(next: PromptTemplateColorValue) {
    onChange(normalizePromptTemplateColorValue(next, component));
  }

  function toggleColor(id: string) {
    emit({
      ...normalized,
      colors: selectedColors.includes(id)
        ? selectedColors.filter((item) => item !== id)
        : [...selectedColors, id]
    });
  }

  function toggleGradient(id: string) {
    emit({
      ...normalized,
      gradients: selectedGradients.includes(id)
        ? selectedGradients.filter((item) => item !== id)
        : [...selectedGradients, id]
    });
  }

  function addCustomColor() {
    if (!normalizedCustomColor) return;
    emit({
      ...normalized,
      customColors: customColors.includes(normalizedCustomColor)
        ? customColors
        : [...customColors, normalizedCustomColor]
    });
    setCustomColor("");
  }

  const hasSelected = selectedColors.length > 0 || selectedGradients.length > 0 || customColors.length > 0;
  const selectedLabels = [
    ...selectedColors.map((id) => colorById.get(id)?.name).filter(Boolean),
    ...selectedGradients.map((id) => gradientById.get(id)?.name).filter(Boolean),
    ...customColors
  ];
  const selectedSummary = selectedLabels.length > 0 ? selectedLabels.join("、") : "选择色卡或渐变组合";
  const selectedPreviewItems: SelectedColorPreviewItem[] = [
    ...selectedColors
      .flatMap((id): SelectedColorPreviewItem[] => {
        const option = colorById.get(id);
        return option ? [{ id: `color-${id}`, style: { background: option.hex } }] : [];
      }),
    ...selectedGradients
      .flatMap((id): SelectedColorPreviewItem[] => {
        const option = gradientById.get(id);
        return option ? [{ id: `gradient-${id}`, style: gradientStyle(option) }] : [];
      }),
    ...customColors.map((hex): SelectedColorPreviewItem => ({ id: `custom-${hex}`, style: { background: hex } }))
  ];

  return (
    <div className="prompt-template-color-picker" ref={wrapRef}>
      <button
        type="button"
        className="prompt-template-color-trigger custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <span className="custom-select-value">
          {selectedPreviewItems.length > 0 ? (
            <span className="prompt-template-color-preview-stack" aria-hidden="true">
              {selectedPreviewItems.map((item) => (
                <i key={item.id} style={item.style} />
              ))}
            </span>
          ) : null}
          <span className={cx("prompt-template-color-summary", !hasSelected && "placeholder")}>
            {selectedSummary}
          </span>
        </span>
        <ChevronDown size={15} />
      </button>

      {open ? (
        <div className="prompt-template-color-menu" role="listbox" aria-multiselectable="true">
          <div className="prompt-template-color-section">
            <span>单色</span>
            <div className="prompt-template-color-option-list">
              {colorOptions.map((option) => {
                const active = selectedColors.includes(option.id);
                return (
                  <button
                    type="button"
                    key={option.id}
                    className={cx("prompt-template-color-option", active && "active")}
                    role="option"
                    aria-selected={active}
                    onClick={() => toggleColor(option.id)}
                  >
                    <i className="prompt-template-color-swatch" style={{ background: option.hex }} />
                    <span>
                      <strong>{option.name}</strong>
                      <small>{option.role} · {option.hex}</small>
                    </span>
                    {active ? <Check size={14} /> : null}
                  </button>
                );
              })}
              {colorOptions.length === 0 ? <small className="prompt-template-color-empty">暂无单色色卡</small> : null}
            </div>
          </div>

          <div className="prompt-template-color-section">
            <span>渐变</span>
            <div className="prompt-template-color-option-list">
              {gradientOptions.map((option) => {
                const active = selectedGradients.includes(option.id);
                return (
                  <button
                    type="button"
                    key={option.id}
                    className={cx("prompt-template-gradient-option", active && "active")}
                    role="option"
                    aria-selected={active}
                    onClick={() => toggleGradient(option.id)}
                  >
                    <i className="prompt-template-gradient-swatch" style={gradientStyle(option)} />
                    <span>
                      <strong>{option.name}</strong>
                      <small>{option.role} · {option.colors.join(" -> ")}</small>
                    </span>
                    {active ? <Check size={14} /> : null}
                  </button>
                );
              })}
              {gradientOptions.length === 0 ? <small className="prompt-template-color-empty">暂无渐变组合</small> : null}
            </div>
          </div>

          {customColors.length > 0 ? (
            <div className="prompt-template-color-section">
              <span>自定义</span>
              <div className="prompt-template-color-option-list">
                {customColors.map((hex) => (
                  <button
                    type="button"
                    key={hex}
                    className="prompt-template-color-option active"
                    role="option"
                    aria-selected="true"
                    onClick={() => emit({ ...normalized, customColors: removeValue(customColors, hex) })}
                  >
                    <i className="prompt-template-color-swatch" style={{ background: hex }} />
                    <span>
                      <strong>{hex}</strong>
                      <small>自定义色 · {hex}</small>
                    </span>
                    <Check size={14} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {allowCustomColor ? (
            <div className="prompt-template-color-custom">
              <input
                value={customColor}
                placeholder="#151517"
                onChange={(event) => setCustomColor(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustomColor();
                  }
                }}
              />
              <button type="button" onClick={addCustomColor} disabled={!normalizedCustomColor}>
                添加
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
