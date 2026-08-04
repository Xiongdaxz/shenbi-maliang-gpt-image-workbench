import type { CSSProperties } from "react";
import { useI18n } from "../i18n";

type ImageZoomSliderProps = {
  disabled?: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
};

export function ImageZoomSlider({
  disabled = false,
  label,
  max,
  min,
  onChange,
  step = 1,
  value
}: ImageZoomSliderProps) {
  const { t } = useI18n();
  const boundedMax = Math.max(min, max);
  const boundedValue = Math.max(min, Math.min(boundedMax, value));
  const progress = boundedMax === min ? 0 : ((boundedValue - min) / (boundedMax - min)) * 100;

  return (
    <label className="image-zoom-slider" title={label}>
      <input
        type="range"
        min={min}
        max={boundedMax}
        step={step}
        value={boundedValue}
        disabled={disabled}
        aria-label={t("settings.general.imagePreview.wheel.zoom")}
        aria-valuetext={label}
        style={{ "--image-zoom-progress": `${progress}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="image-zoom-slider-label">{label}</output>
    </label>
  );
}
