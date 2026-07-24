import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Play } from "lucide-react";
import { useI18n } from "../../i18n";
import type { ImageTaskSoundId } from "../../lib/imageTaskSounds";

type ImageTaskSoundOption = {
  value: ImageTaskSoundId;
  label: string;
};

type ImageTaskSoundSelectProps = {
  value: ImageTaskSoundId;
  options: ReadonlyArray<ImageTaskSoundOption>;
  playingSoundId: ImageTaskSoundId | null;
  disabled?: boolean;
  onChange: (value: ImageTaskSoundId) => void;
  onPreviewToggle: (value: ImageTaskSoundId) => void;
};

export function ImageTaskSoundSelect({
  value,
  options,
  playingSoundId,
  disabled,
  onChange,
  onPreviewToggle
}: ImageTaskSoundSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({ top: 0, left: 0, width: 240, maxHeight: 320, above: false });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const labelId = useId();
  const { t } = useI18n();
  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 12;
      const maxWidth = Math.max(window.innerWidth - viewportPadding * 2, 1);
      const width = Math.min(Math.max(rect.width, 240), maxWidth);
      const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
      const left = Math.min(Math.max(viewportPadding, rect.left), maxLeft);
      const gap = 6;
      const availableBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportPadding);
      const availableAbove = Math.max(0, rect.top - gap - viewportPadding);
      const desiredHeight = Math.min(menuRef.current?.scrollHeight ?? 320, 320);
      const above = availableBelow < desiredHeight && availableAbove > availableBelow;
      setMenuStyle({
        top: above ? rect.top - gap : rect.bottom + gap,
        left,
        width,
        maxHeight: Math.max(1, Math.min(320, above ? availableAbove : availableBelow)),
        above
      });
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const inMenu = target instanceof Element && target.closest(".settings-sound-tone-menu");
      if (!wrapRef.current?.contains(target) && !inMenu) setOpen(false);
    }
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, options]);

  return (
    <div className="custom-select settings-sound-tone-select" ref={wrapRef}>
      <button
        id={labelId}
        type="button"
        className="custom-select-trigger"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="custom-select-value">
          <span className="custom-select-label">{selected?.label ?? t("settings.sound.select")}</span>
        </span>
        <ChevronDown size={16} className={open ? "open" : ""} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={`custom-select-menu settings-sound-tone-menu${menuStyle.above ? " custom-select-menu-top" : ""}`}
              role="menu"
              aria-labelledby={labelId}
              style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width, maxHeight: menuStyle.maxHeight }}
            >
              {options.map((option) => {
                const active = option.value === value;
                const playing = option.value === playingSoundId;
                return (
                  <div
                    key={option.value}
                    className={`settings-sound-tone-option${active ? " active" : ""}`}
                  >
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      title={option.label}
                      className="settings-sound-tone-option-choice"
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                    >
                      <span className="custom-select-option-main">
                        <span className="custom-select-option-text">
                          <strong>{option.label}</strong>
                        </span>
                      </span>
                    </button>
                    {active ? (
                      <span className="settings-sound-tone-selected" aria-hidden="true">
                        <Check size={16} />
                      </span>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        className={`settings-sound-tone-preview${playing ? " playing" : ""}`}
                        aria-label={t(playing ? "settings.sound.stopPreview" : "settings.sound.preview", { name: option.label })}
                        aria-pressed={playing}
                        title={t(playing ? "settings.sound.stopPreview" : "settings.sound.preview", { name: option.label })}
                        onClick={() => onPreviewToggle(option.value)}
                      >
                        {playing ? (
                          <span className="settings-sound-tone-stop-icon" aria-hidden="true" />
                        ) : (
                          <Play
                            size={16}
                            className="settings-sound-tone-play-icon"
                            fill="currentColor"
                            stroke="none"
                            shapeRendering="geometricPrecision"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
