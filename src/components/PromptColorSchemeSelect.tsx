import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Palette, X } from "lucide-react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import {
  normalizePromptColorSchemeHex,
  normalizePromptColorSchemeIds,
  promptColorSchemeValueText,
  type PromptColorScheme,
  type PromptColorSchemeGradient
} from "../lib/promptColorSchemes";

type PromptColorSchemeSelectProps = {
  value: string[] | string;
  schemes: PromptColorScheme[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  menuPlacement?: "top" | "bottom";
  menuWidth?: number;
  customColorHex?: string;
  onCustomColorSelect?: (hex: string) => void;
};

function gradientStyle(gradient: PromptColorSchemeGradient): CSSProperties {
  return { background: `linear-gradient(90deg, ${gradient.colors.join(", ")})` };
}

function schemePreviewItems(scheme: PromptColorScheme | null) {
  if (!scheme) return [];
  return [
    ...scheme.colors.slice(0, 3).map((color) => ({ id: `color-${color.id}`, style: { background: color.hex } })),
    ...scheme.gradients.slice(0, 1).map((gradient) => ({ id: `gradient-${gradient.id}`, style: gradientStyle(gradient) }))
  ];
}

function selectedPreviewItems(schemes: PromptColorScheme[]) {
  return schemes.flatMap(schemePreviewItems).slice(0, 4);
}

export function PromptColorSchemeSelect({
  value,
  schemes,
  onChange,
  disabled,
  className,
  menuClassName,
  menuPlacement = "top",
  menuWidth = 280,
  customColorHex,
  onCustomColorSelect
}: PromptColorSchemeSelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [menuScrolling, setMenuScrolling] = useState(false);
  const [customColorPickerOpen, setCustomColorPickerOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({ top: -10000, left: -10000, width: Math.max(1, menuWidth), height: 0 });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const actionRef = useRef<HTMLDivElement | null>(null);
  const customColorInputRef = useRef<HTMLInputElement | null>(null);
  const scrollHideTimerRef = useRef<number | null>(null);
  const labelId = useId();
  const visibleSchemes = useMemo(() => schemes.filter((scheme) => scheme.visible), [schemes]);
  const selectedIds = normalizePromptColorSchemeIds(value, visibleSchemes).slice(0, 1);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedSchemes = selectedIds.flatMap((id) => visibleSchemes.find((scheme) => scheme.id === id) ?? []);
  const normalizedCustomColorHex = selectedSchemes.length === 0 ? normalizePromptColorSchemeHex(customColorHex) : "";
  const categories = useMemo(() => {
    const map = new Map<string, PromptColorScheme[]>();
    for (const scheme of visibleSchemes) {
      const key = scheme.category || t("promptColorScheme.customCategory");
      map.set(key, [...(map.get(key) ?? []), scheme]);
    }
    return Array.from(map.entries());
  }, [t, visibleSchemes]);
  const showCustomColorOnly = categories.length === 0 && Boolean(onCustomColorSelect);
  const previewItems = selectedSchemes.length > 0
    ? selectedPreviewItems(selectedSchemes)
    : normalizedCustomColorHex
      ? [{ id: "custom-color", style: { background: normalizedCustomColorHex } }]
      : [];
  const triggerLabel = selectedSchemes.length === 0
    ? normalizedCustomColorHex || t("promptColorScheme.label")
    : selectedSchemes[0].name;
  const hasSelection = selectedIds.length > 0 || Boolean(normalizedCustomColorHex);
  const showTriggerLabel = previewItems.length === 0 || Boolean(normalizedCustomColorHex);
  const triggerTitle = selectedSchemes.length > 0
    ? selectedSchemes.map((scheme) => scheme.name).join(t("common.listSeparator"))
    : normalizedCustomColorHex
      ? t("promptColorScheme.customColorTitle", { color: normalizedCustomColorHex })
      : t("promptColorScheme.noSelection");
  const customColorInputValue = normalizedCustomColorHex || "#2563EB";

  function closeCustomColorPicker() {
    customColorInputRef.current?.blur();
    setCustomColorPickerOpen(false);
  }

  function closeMenu() {
    closeCustomColorPicker();
    setOpen(false);
  }

  function toggleMenu() {
    if (open) {
      closeMenu();
      return;
    }
    setOpen(true);
  }

  function updateMenuPosition() {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuHeight = showCustomColorOnly ? actionRef.current?.offsetHeight ?? 34 : menuRef.current?.offsetHeight ?? 0;
    const width = showCustomColorOnly ? rect.width : Math.max(rect.width, menuWidth);
    const actionWidth = showCustomColorOnly ? actionRef.current?.offsetWidth ?? 96 : 0;
    const minActionCenter = 12 + actionWidth / 2;
    const maxActionCenter = window.innerWidth - 12 - actionWidth / 2;
    const anchorCenter = Math.min(Math.max(rect.left + rect.width / 2, minActionCenter), maxActionCenter);
    const maxLeft = Math.max(12, window.innerWidth - width - 12);
    const left = showCustomColorOnly
      ? anchorCenter - width / 2
      : Math.min(Math.max(12, rect.left), maxLeft);
    const preferredTop = menuPlacement === "top" ? rect.top - menuHeight - 6 : rect.bottom + 6;
    const minTop = 12;
    const maxTop = Math.max(minTop, window.innerHeight - menuHeight - 12);
    const top = menuHeight > 0 ? Math.min(Math.max(minTop, preferredTop), maxTop) : preferredTop;
    setMenuStyle({ top, left, width, height: menuHeight });
  }

  useLayoutEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !wrapRef.current?.contains(target)
        && !menuRef.current?.contains(target)
        && !actionRef.current?.contains(target)
      ) {
        closeMenu();
      }
    }
    updateMenuPosition();
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    const frame = window.requestAnimationFrame(updateMenuPosition);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.cancelAnimationFrame(frame);
      if (scrollHideTimerRef.current) window.clearTimeout(scrollHideTimerRef.current);
    };
  }, [open, menuPlacement, menuWidth, showCustomColorOnly, visibleSchemes]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !onCustomColorSelect) return;
    const currentMenu = menuRef.current;
    currentMenu.addEventListener("scroll", handleMenuScroll, { passive: true });
    return () => currentMenu.removeEventListener("scroll", handleMenuScroll);
  }, [open, onCustomColorSelect]);

  function handleMenuScroll() {
    if (!onCustomColorSelect) return;
    setMenuScrolling(true);
    if (scrollHideTimerRef.current) window.clearTimeout(scrollHideTimerRef.current);
    scrollHideTimerRef.current = window.setTimeout(() => setMenuScrolling(false), 260);
  }

  function toggleScheme(nextValue: string) {
    const nextIds = selectedIdSet.has(nextValue) ? [] : [nextValue];
    onChange(normalizePromptColorSchemeIds(nextIds, visibleSchemes));
    closeMenu();
  }

  function clearSelection() {
    onChange([]);
    closeMenu();
  }

  function openCustomColorPicker() {
    if (customColorPickerOpen) {
      closeCustomColorPicker();
      return;
    }
    setMenuScrolling(false);
    setCustomColorPickerOpen(true);
    customColorInputRef.current?.click();
  }

  function handleCustomColorChange(value: string) {
    const hex = normalizePromptColorSchemeHex(value);
    if (!hex) return;
    onCustomColorSelect?.(hex);
    closeCustomColorPicker();
  }

  return (
    <div
      className={cx(
        "custom-select prompt-color-scheme-picker",
        hasSelection && "has-value",
        normalizedCustomColorHex && "has-custom-color",
        className
      )}
      ref={wrapRef}
    >
      <div
        className={cx("custom-select-trigger", hasSelection && "has-value", normalizedCustomColorHex && "has-custom-color")}
        aria-expanded={open}
        aria-disabled={disabled ? "true" : undefined}
        title={triggerTitle}
      >
        <button
          id={labelId}
          type="button"
          className="prompt-color-scheme-trigger-main"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={toggleMenu}
        >
          <span className="custom-select-value">
            {previewItems.length > 0 ? (
            <span className="prompt-color-scheme-preview-stack" aria-hidden="true">
              {previewItems.map((item) => <i key={item.id} style={item.style} />)}
            </span>
          ) : (
            <Palette size={15} aria-hidden="true" />
          )}
            {showTriggerLabel ? <span className="custom-select-label">{triggerLabel}</span> : null}
          </span>
        </button>
        {hasSelection ? (
          <button
            type="button"
            className="prompt-color-scheme-clear"
            disabled={disabled}
            aria-label={t("promptColorScheme.clear")}
            title={t("promptColorScheme.clear")}
            onClick={clearSelection}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="prompt-color-scheme-caret"
            disabled={disabled}
            aria-label={open ? t("promptColorScheme.collapse") : t("promptColorScheme.expand")}
            title={open ? t("promptColorScheme.collapse") : t("promptColorScheme.expand")}
            onClick={toggleMenu}
          >
            <ChevronDown size={16} className={open ? "open" : ""} aria-hidden="true" />
          </button>
        )}
      </div>
      {open ? createPortal(
        <>
          {showCustomColorOnly ? null : (
            <div
              ref={menuRef}
              className={cx("custom-select-menu prompt-color-scheme-menu", menuClassName)}
              role="listbox"
              aria-labelledby={labelId}
              style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width } as CSSProperties}
              onScroll={handleMenuScroll}
            >
              {categories.map(([category, items]) => (
                <div className="prompt-color-scheme-group" key={category}>
                  <span>{category}</span>
                  {items.map((scheme) => {
                    const active = selectedIdSet.has(scheme.id);
                    const optionPreview = schemePreviewItems(scheme);
                    return (
                      <button
                        type="button"
                        key={scheme.id}
                        role="option"
                        aria-selected={active}
                        title={`${scheme.name} / ${promptColorSchemeValueText(scheme)}`}
                        className={cx("prompt-color-scheme-option", active && "active")}
                        onClick={() => toggleScheme(scheme.id)}
                      >
                        <span className="prompt-color-scheme-option-preview" aria-hidden="true">
                          {optionPreview.map((item) => <i key={item.id} style={item.style} />)}
                        </span>
                        <span className="prompt-color-scheme-option-copy">
                          <strong>{scheme.name}</strong>
                          <small>{scheme.description}</small>
                        </span>
                        <span className={cx("prompt-color-scheme-option-check", active && "active")} aria-hidden="true">
                          {active ? <Check size={14} /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {onCustomColorSelect ? (
            <div
              ref={actionRef}
              className={cx("prompt-color-scheme-floating-action", showCustomColorOnly && "standalone", !showCustomColorOnly && menuScrolling && "is-hidden")}
              style={{
                top: showCustomColorOnly ? menuStyle.top : menuStyle.height > 0 ? menuStyle.top + menuStyle.height - 48 : -10000,
                left: menuStyle.left + menuStyle.width / 2
              } as CSSProperties}
            >
              <input
                ref={customColorInputRef}
                className="prompt-color-scheme-custom-input"
                type="color"
                value={customColorInputValue}
                aria-label={t("promptColorScheme.pickCustom")}
                tabIndex={-1}
                onChange={(event) => handleCustomColorChange(event.currentTarget.value)}
                onBlur={() => setCustomColorPickerOpen(false)}
              />
              <button
                type="button"
                className="prompt-color-scheme-custom-button"
                onClick={openCustomColorPicker}
              >
                <Palette size={14} aria-hidden="true" />
                <span>{t("promptColorScheme.customButton")}</span>
              </button>
            </div>
          ) : null}
        </>,
        document.body
      ) : null}
    </div>
  );
}
