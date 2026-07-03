import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, RotateCw, WandSparkles, X } from "lucide-react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import {
  normalizePromptOptimizeStyle,
  promptOptimizeStyleFullLabel,
  promptOptimizeStyleGroups,
  promptOptimizeStyleOption,
  visiblePromptOptimizeStyleGroups,
  type PromptOptimizeStyleGroup,
  type PromptTemplateOptimizeStyle
} from "../lib/promptOptimizeStyles";

type PromptOptimizeStyleSelectProps = {
  value: PromptTemplateOptimizeStyle;
  onChange: (value: PromptTemplateOptimizeStyle) => void;
  groups?: PromptOptimizeStyleGroup[];
  customInstruction?: string;
  onCustomInstructionChange?: (value: string) => void;
  onCustomInstructionSubmit?: () => void;
  customInstructionSubmitDisabled?: boolean;
  customInstructionSubmitPending?: boolean;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  menuPlacement?: "top" | "bottom";
  menuWidth?: number;
  submenuWidth?: number;
};

export function PromptOptimizeStyleSelect({
  value,
  onChange,
  groups = promptOptimizeStyleGroups,
  customInstruction = "",
  onCustomInstructionChange,
  onCustomInstructionSubmit,
  customInstructionSubmitDisabled,
  customInstructionSubmitPending,
  disabled,
  className,
  menuClassName,
  menuPlacement = "top",
  menuWidth = 260,
  submenuWidth = 260
}: PromptOptimizeStyleSelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [menuStyle, setMenuStyle] = useState(() => ({
    top: -10000,
    left: -10000,
    width: Math.max(1, Number(menuWidth ?? 0))
  }));
  const [submenuSide, setSubmenuSide] = useState<"left" | "right">("right");
  const [submenuOffsets, setSubmenuOffsets] = useState<Record<string, number>>({});
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const customInstructionRef = useRef<HTMLTextAreaElement | null>(null);
  const labelId = useId();
  const styleGroups = useMemo(() => visiblePromptOptimizeStyleGroups(groups), [groups]);
  const hasStyleGroups = styleGroups.length > 0;
  const normalizedValue = hasStyleGroups ? normalizePromptOptimizeStyle(value, styleGroups) : "";
  const selected = hasStyleGroups
    ? promptOptimizeStyleOption(normalizedValue, styleGroups)
    : { label: t("promptOptimizeStyle.custom"), description: t("promptOptimizeStyle.customDesc"), value: "", prompt: "", visible: true };
  const hasCustomInstruction = customInstruction.trim().length > 0;

  function childrenForGroup(groupValue: string) {
    const group = styleGroups.find((item) => item.value === groupValue);
    return group?.children ?? [];
  }

  function selectedChildGroupValue() {
    const group = styleGroups.find((item) => item.children?.some((child) => child.value === normalizedValue));
    return group?.value ?? "";
  }

  function rowForGroup(groupValue: string) {
    const rows = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(".prompt-style-picker-row") ?? []);
    return rows.find((row) => row.dataset.styleGroup === groupValue) ?? null;
  }

  function updateSubmenuOffset(groupValue: string, row: HTMLElement, childCount: number) {
    const rowRect = row.getBoundingClientRect();
    const submenu = row.querySelector<HTMLElement>(".prompt-style-picker-submenu");
    const viewportPadding = 12;
    const maxHeight = Math.max(140, window.innerHeight - viewportPadding * 2);
    const estimatedHeight = Math.min(maxHeight, submenu?.scrollHeight || childCount * 48 + 12);
    const maxTop = Math.max(viewportPadding, window.innerHeight - viewportPadding - estimatedHeight);
    const nextTop = Math.min(Math.max(viewportPadding, rowRect.top), maxTop);
    const nextOffset = Math.round(nextTop - rowRect.top);
    setSubmenuOffsets((current) => (
      current[groupValue] === nextOffset ? current : { ...current, [groupValue]: nextOffset }
    ));
  }

  function updateVisibleSubmenuOffset() {
    const groupValue = activeGroup === null ? selectedChildGroupValue() : activeGroup;
    if (!groupValue) return;
    const children = childrenForGroup(groupValue);
    const row = rowForGroup(groupValue);
    if (!row || children.length === 0) return;
    updateSubmenuOffset(groupValue, row, children.length);
  }

  function openSubmenu(groupValue: string, row: HTMLElement, childCount: number) {
    updateSubmenuOffset(groupValue, row, childCount);
    setActiveGroup(groupValue);
  }

  function resizeCustomInstructionInput(input = customInstructionRef.current) {
    if (!input) return;
    const minHeight = Number.parseFloat(window.getComputedStyle(input).minHeight) || 40;
    if (!input.value) {
      input.style.height = `${minHeight}px`;
      return;
    }
    input.style.height = "auto";
    input.style.height = `${Math.max(input.scrollHeight, minHeight)}px`;
  }

  function updateMenuPosition() {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, Number(menuWidth ?? 0));
    const maxLeft = Math.max(12, window.innerWidth - width - 12);
    const left = Math.min(Math.max(12, rect.left), maxLeft);
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const minTop = 12;
    const maxTop = Math.max(minTop, window.innerHeight - menuHeight - 12);
    const preferredTop = menuPlacement === "top" ? rect.top - menuHeight - 6 : rect.bottom + 6;
    const top = menuHeight > 0 ? Math.min(Math.max(minTop, preferredTop), maxTop) : preferredTop;
    setMenuStyle({ top, left, width });
    setSubmenuSide(left + width + submenuWidth + 18 > window.innerWidth ? "left" : "right");
    window.requestAnimationFrame(updateVisibleSubmenuOffset);
  }

  useLayoutEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    resizeCustomInstructionInput();
    updateMenuPosition();
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    const positionFrame = window.requestAnimationFrame(() => {
      resizeCustomInstructionInput();
      updateMenuPosition();
    });
    const frame = window.requestAnimationFrame(updateVisibleSubmenuOffset);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.cancelAnimationFrame(positionFrame);
      window.cancelAnimationFrame(frame);
    };
  }, [menuPlacement, menuWidth, open, submenuWidth, styleGroups]);

  useLayoutEffect(() => {
    if (!open) return;
    resizeCustomInstructionInput();
    updateMenuPosition();
  }, [customInstruction, open]);

  useEffect(() => {
    if (!open) {
      setActiveGroup(null);
      setSubmenuOffsets({});
      return;
    }
    const frame = window.requestAnimationFrame(updateVisibleSubmenuOffset);
    return () => window.cancelAnimationFrame(frame);
  }, [activeGroup, normalizedValue, open, styleGroups]);

  function selectStyle(nextValue: string) {
    onChange(normalizePromptOptimizeStyle(nextValue, styleGroups));
    setOpen(false);
  }

  function renderOptionText(label: string, description?: string) {
    return (
      <span className="prompt-style-picker-copy">
        <span className="prompt-style-picker-title">{label}</span>
        {description ? <span className="prompt-style-picker-description">{description}</span> : null}
      </span>
    );
  }

  return (
    <div className={cx("custom-select prompt-style-picker", className)} ref={wrapRef}>
      <button
        id={labelId}
        type="button"
        className="custom-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={hasStyleGroups ? promptOptimizeStyleFullLabel(normalizedValue, styleGroups) : t("promptOptimizeStyle.custom")}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="custom-select-value">
          <span className="custom-select-label">{selected.label}</span>
        </span>
        <ChevronDown size={16} className={open ? "open" : ""} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={cx(
                "custom-select-menu prompt-style-picker-menu",
                submenuSide === "left" && "submenu-left",
                menuClassName
              )}
              role="listbox"
              aria-labelledby={labelId}
              style={{
                top: menuStyle.top,
                left: menuStyle.left,
                width: menuStyle.width || Math.max(1, Number(menuWidth ?? 0)),
                "--prompt-style-submenu-width": `${submenuWidth}px`
              } as CSSProperties}
              onMouseLeave={() => setActiveGroup(null)}
            >
              {styleGroups.map((group) => {
                const children = group.children ?? [];
                const groupActive = normalizedValue === group.value;
                const childActive = children.some((child) => child.value === normalizedValue);
                const rowOpen = activeGroup === null ? childActive : activeGroup === group.value;
                return (
                  <div
                    className={cx("prompt-style-picker-row", children.length > 0 && "has-children", rowOpen && "open")}
                    key={group.value}
                    data-style-group={group.value}
                    style={{ "--prompt-style-submenu-top": `${submenuOffsets[group.value] ?? 0}px` } as CSSProperties}
                    onMouseEnter={(event) => children.length > 0 && openSubmenu(group.value, event.currentTarget, children.length)}
                    onFocus={(event) => children.length > 0 && openSubmenu(group.value, event.currentTarget, children.length)}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={groupActive}
                      title={`${group.label} / ${group.description}`}
                      className={cx("prompt-style-picker-option", (groupActive || childActive) && "active")}
                      onClick={() => selectStyle(group.value)}
                    >
                      <span className="custom-select-option-main">
                        <span className="custom-select-option-text">
                          {renderOptionText(group.label, group.description)}
                        </span>
                      </span>
                      <span className="prompt-style-picker-row-action">
                        {groupActive ? <Check size={15} /> : null}
                        {children.length > 0 ? <ChevronRight size={15} /> : null}
                      </span>
                    </button>
                    {children.length > 0 ? (
                      <div className="prompt-style-picker-submenu" role="group" aria-label={t("promptOptimizeStyle.substylesFor", { label: group.label })}>
                        {children.map((child) => {
                          const active = child.value === normalizedValue;
                          return (
                            <button
                              type="button"
                              key={child.value}
                              role="option"
                              aria-selected={active}
                              title={`${child.label} / ${child.description}`}
                              className={cx("prompt-style-picker-child", active && "active")}
                              onClick={() => selectStyle(child.value)}
                            >
                              <span className="custom-select-option-main">
                                <span className="custom-select-option-text">
                                  {renderOptionText(child.label, child.description)}
                                </span>
                              </span>
                              {active ? <Check size={15} /> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {onCustomInstructionChange ? (
                <div className="prompt-style-picker-custom" onMouseEnter={() => setActiveGroup("")}>
                  <label>
                    <span className="prompt-style-picker-custom-control">
                      <textarea
                        ref={customInstructionRef}
                        value={customInstruction}
                        rows={1}
                        maxLength={500}
                        placeholder={t("promptOptimizeStyle.customPlaceholder")}
                        onFocus={() => setActiveGroup("")}
                        onChange={(event) => {
                          onCustomInstructionChange(event.target.value);
                          resizeCustomInstructionInput(event.currentTarget);
                        }}
                      />
                      {hasCustomInstruction ? (
                        <button
                          className="prompt-style-picker-custom-clear"
                          type="button"
                          onClick={() => {
                            onCustomInstructionChange("");
                            window.requestAnimationFrame(() => {
                              resizeCustomInstructionInput();
                              customInstructionRef.current?.focus();
                            });
                          }}
                          aria-label={t("promptOptimizeStyle.clearCustom")}
                          title={t("common.clear")}
                        >
                          <X size={14} />
                        </button>
                      ) : null}
                      {onCustomInstructionSubmit ? (
                        <button
                          className="prompt-style-picker-custom-submit"
                          type="button"
                          onClick={() => {
                            onCustomInstructionSubmit();
                            setOpen(false);
                          }}
                          disabled={customInstructionSubmitDisabled || customInstructionSubmitPending}
                          aria-label={t("promptOptimizeStyle.submitCustom")}
                          title={t("promptOptimizeStyle.submitCustom")}
                        >
                          {customInstructionSubmitPending ? (
                            <RotateCw size={14} className="spin" />
                          ) : (
                            <WandSparkles size={14} />
                          )}
                        </button>
                      ) : null}
                    </span>
                  </label>
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
