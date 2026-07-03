import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import type { CaseCategory } from "../types";

export function CaseCategoryMultiSelect({
  categories,
  value,
  onChange,
  labelName,
  placeholder,
  pendingSelectionLabel
}: {
  categories: CaseCategory[];
  value: string[];
  onChange: (value: string[]) => void;
  labelName?: string;
  placeholder?: string;
  pendingSelectionLabel?: string;
}) {
  const { t } = useI18n();
  const resolvedLabelName = labelName ?? t("common.category");
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const selectedCategories = categories.filter((category) => value.includes(category.id));
  const summary =
    selectedCategories.length === 0
      ? value.length > 0
        ? pendingSelectionLabel ?? t("multiSelect.selectedCount", { count: value.length, label: resolvedLabelName })
        : placeholder ?? t("multiSelect.placeholder", { label: resolvedLabelName })
      : selectedCategories.length <= 2
        ? selectedCategories.map((category) => category.name).join("、")
        : t("multiSelect.summaryMore", { names: selectedCategories.slice(0, 2).map((category) => category.name).join("、"), count: selectedCategories.length });
  const normalizedKeyword = keyword.trim().toLowerCase();
  const filteredCategories = useMemo(() => {
    if (!normalizedKeyword) return categories;
    return categories.filter((category) => {
      const searchableText = [category.name, category.slug].join(" ").toLowerCase();
      return searchableText.includes(normalizedKeyword);
    });
  }, [categories, normalizedKeyword]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setKeyword("");
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const syncMenuPosition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const trigger = wrapRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const viewportGap = 12;
        const below = window.innerHeight - rect.bottom - viewportGap;
        const above = rect.top - viewportGap;
        const openUp = below < 140 && above > below;
        const maxHeight = Math.max(120, Math.min(220, openUp ? above : below));
        setMenuStyle({
          position: "fixed",
          left: rect.left,
          top: openUp ? rect.top - maxHeight - 6 : rect.bottom + 6,
          width: rect.width,
          maxHeight
        });
      });
    };
    syncMenuPosition();
    window.addEventListener("resize", syncMenuPosition);
    window.addEventListener("scroll", syncMenuPosition, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", syncMenuPosition);
      window.removeEventListener("scroll", syncMenuPosition, true);
    };
  }, [open, categories.length, filteredCategories.length, summary]);

  const toggleCategory = (categoryId: string) => {
    onChange(value.includes(categoryId) ? value.filter((item) => item !== categoryId) : [...value, categoryId]);
  };

  const menu = open ? (
    <div
      className="case-category-select-menu"
      ref={menuRef}
      role="listbox"
      aria-multiselectable="true"
      style={menuStyle ?? undefined}
    >
      <label className="case-category-search">
        <Search size={15} />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t("multiSelect.search", { label: resolvedLabelName })}
          aria-label={t("multiSelect.search", { label: resolvedLabelName })}
          autoComplete="off"
        />
      </label>
      <div className="case-category-select-options">
        {filteredCategories.map((category) => {
          const selected = value.includes(category.id);
          return (
            <button
              key={category.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={cx(selected && "active")}
              onClick={() => toggleCategory(category.id)}
            >
              <span>{category.name}</span>
              {selected ? <Check size={15} /> : <span className="case-category-check-spacer" />}
            </button>
          );
        })}
        {categories.length === 0 ? <span className="case-category-empty">{t("multiSelect.empty", { label: resolvedLabelName })}</span> : null}
        {categories.length > 0 && filteredCategories.length === 0 ? <span className="case-category-empty">{t("multiSelect.noMatch", { label: resolvedLabelName })}</span> : null}
      </div>
    </div>
  ) : null;

  return (
    <div className="case-category-select" ref={wrapRef}>
      <button
        type="button"
        className="case-category-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <span className={selectedCategories.length === 0 && value.length === 0 ? "placeholder" : ""}>{summary}</span>
        <ChevronDown size={16} className={open ? "open" : ""} />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
