import { LayoutGrid, Rows3 } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";

export type LibraryFilterDisplayMode = "compact" | "tiled";

const FILTER_DISPLAY_MODE_STORAGE_KEY = "gpt-image.libraryFilter.displayMode";

type HorizontalScrollHint = {
  overflow: boolean;
  atStart: boolean;
  atEnd: boolean;
};

const NO_SCROLL_HINT: HorizontalScrollHint = { overflow: false, atStart: true, atEnd: true };
const FILTER_TAB_EDGE_PADDING_PX = 18;
const FILTER_TAB_CENTER_THRESHOLD = 0.58;

function storedFilterDisplayMode(): LibraryFilterDisplayMode {
  if (typeof window === "undefined") return "compact";
  try {
    const value = window.localStorage.getItem(FILTER_DISPLAY_MODE_STORAGE_KEY);
    return value === "tiled" ? "tiled" : "compact";
  } catch {
    return "compact";
  }
}

export function useLibraryFilterDisplayMode() {
  const [mode, setModeState] = useState<LibraryFilterDisplayMode>(storedFilterDisplayMode);

  const setMode = useCallback((nextMode: LibraryFilterDisplayMode) => {
    setModeState(nextMode);
    try {
      window.localStorage.setItem(FILTER_DISPLAY_MODE_STORAGE_KEY, nextMode);
    } catch {
      // Keep the in-memory mode even when browser storage is unavailable.
    }
  }, []);

  return [mode, setMode] as const;
}

function useHorizontalScroller(dependencyKey: string, enabled = true) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollHint, setScrollHint] = useState<HorizontalScrollHint>(NO_SCROLL_HINT);

  useLayoutEffect(() => {
    if (!enabled) {
      if (scrollRef.current) scrollRef.current.scrollLeft = 0;
      setScrollHint((value) =>
        value.overflow === NO_SCROLL_HINT.overflow && value.atStart === NO_SCROLL_HINT.atStart && value.atEnd === NO_SCROLL_HINT.atEnd
          ? value
          : NO_SCROLL_HINT
      );
      return;
    }

    const element = scrollRef.current;
    if (!element) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
        const overflow = maxScrollLeft > 1;
        const atStart = !overflow || element.scrollLeft <= 1;
        const atEnd = !overflow || element.scrollLeft >= maxScrollLeft - 1;
        setScrollHint((value) =>
          value.overflow === overflow && value.atStart === atStart && value.atEnd === atEnd ? value : { overflow, atStart, atEnd }
        );
      });
    };

    const handleWheel = (event: WheelEvent) => {
      const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      if (maxScrollLeft <= 1) return;

      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? element.clientWidth : 1;
      const deltaX = event.deltaX * unit;
      const deltaY = event.deltaY * unit;
      const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
      if (!delta) return;

      const atStart = element.scrollLeft <= 1;
      const atEnd = element.scrollLeft >= maxScrollLeft - 1;
      if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return;

      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      element.scrollLeft = Math.max(0, Math.min(maxScrollLeft, element.scrollLeft + delta));
    };

    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(element);
    Array.from(element.children).forEach((child) => resizeObserver.observe(child));
    element.addEventListener("scroll", sync, { passive: true });
    element.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("resize", sync);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      element.removeEventListener("scroll", sync);
      element.removeEventListener("wheel", handleWheel);
      window.removeEventListener("resize", sync);
    };
  }, [dependencyKey, enabled]);

  return { scrollRef, scrollHint };
}

export function AssetTagScroller({ names }: { names: string[] }) {
  const { t } = useI18n();
  const tagKey = names.join("\u0000");
  const { scrollRef, scrollHint } = useHorizontalScroller(tagKey);

  return (
    <div className={cx("asset-card-tags-wrap", scrollHint.overflow && !scrollHint.atEnd && "has-overflow")}>
      <div className="asset-card-tags" ref={scrollRef}>
        {names.length > 0 ? names.map((name) => <span key={name}>{name}</span>) : <span className="muted">{t("assetTags.untagged")}</span>}
      </div>
    </div>
  );
}

export function FilterTabLabel({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <>
      <span>{children}</span>
      {typeof count === "number" && count > 0 ? <span className="filter-tab-count">{count}</span> : null}
    </>
  );
}

export function FilterTabsScroller({
  className,
  ariaLabel,
  hintKey,
  mode = "compact",
  children
}: {
  className?: string;
  ariaLabel?: string;
  hintKey: string;
  mode?: LibraryFilterDisplayMode;
  children: ReactNode;
}) {
  const { scrollRef, scrollHint } = useHorizontalScroller(hintKey, mode === "compact");
  const scrollClickedTabIntoView = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (mode !== "compact") return;
      const scroller = scrollRef.current;
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("button");
      if (!scroller || !button || !scroller.contains(button)) return;

      const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      if (maxScrollLeft <= 1) return;

      const scrollerRect = scroller.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const buttonLeft = scroller.scrollLeft + buttonRect.left - scrollerRect.left;
      const buttonRight = scroller.scrollLeft + buttonRect.right - scrollerRect.left;
      const buttonCenter = (buttonLeft + buttonRight) / 2;
      const visibleLeft = scroller.scrollLeft;
      const visibleRight = visibleLeft + scroller.clientWidth;
      const centerTriggerLeft = visibleLeft + scroller.clientWidth * (1 - FILTER_TAB_CENTER_THRESHOLD);
      const centerTriggerRight = visibleLeft + scroller.clientWidth * FILTER_TAB_CENTER_THRESHOLD;

      let nextLeft = visibleLeft;
      if (
        buttonLeft < visibleLeft + FILTER_TAB_EDGE_PADDING_PX ||
        buttonRight > visibleRight - FILTER_TAB_EDGE_PADDING_PX ||
        buttonCenter < centerTriggerLeft ||
        buttonCenter > centerTriggerRight
      ) {
        nextLeft = buttonCenter - scroller.clientWidth / 2;
      }

      const clampedLeft = Math.max(0, Math.min(maxScrollLeft, nextLeft));
      if (Math.abs(clampedLeft - visibleLeft) <= 1) return;
      window.requestAnimationFrame(() => scroller.scrollTo({ left: clampedLeft, behavior: "smooth" }));
    },
    [mode, scrollRef]
  );

  return (
    <div
      className={cx(
        "pill-tabs-scroll-wrap",
        `pill-tabs-scroll-wrap-${mode}`,
        scrollHint.overflow && "has-overflow",
        scrollHint.overflow && !scrollHint.atStart && "has-start-overflow",
        scrollHint.overflow && !scrollHint.atEnd && "has-end-overflow"
      )}
    >
      <div className={cx("pill-tabs", className)} ref={scrollRef} aria-label={ariaLabel} onClickCapture={scrollClickedTabIntoView}>
        {children}
      </div>
    </div>
  );
}

type PageHeaderViewToggleOption<T extends string> = {
  value: T;
  label: string;
  title?: string;
  ariaLabel?: string;
  icon: ReactNode;
};

export function PageHeaderViewToggle<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className
}: {
  value: T;
  options: Array<PageHeaderViewToggleOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const [slider, setSlider] = useState({ left: 2, width: 0 });
  const [sliderAnimated, setSliderAnimated] = useState(false);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let frame = 0;
    const measure = () => {
      const activeButton = Array.from(wrap.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.dataset.toggleValue === value);
      if (!activeButton) return;
      const next = {
        left: activeButton.offsetLeft,
        width: activeButton.offsetWidth
      };
      setSlider((current) => (Math.abs(current.left - next.left) <= 0.5 && Math.abs(current.width - next.width) <= 0.5 ? current : next));
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(wrap);
    Array.from(wrap.children).forEach((child) => resizeObserver.observe(child));
    window.addEventListener("resize", sync);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [options, value]);

  const style = {
    "--view-toggle-slider-left": `${slider.left}px`,
    "--view-toggle-slider-width": `${slider.width}px`
  } as CSSProperties;

  return (
    <span
      className={cx("page-header-view-toggle", className)}
      ref={wrapRef}
      role="group"
      aria-label={ariaLabel}
      style={style}
      data-slider-ready={slider.width > 0 ? "true" : "false"}
      data-slider-animated={sliderAnimated ? "true" : "false"}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            type="button"
            key={option.value}
            className={cx(active && "active")}
            data-toggle-value={option.value}
            onClick={() => {
              if (!active) {
                setSliderAnimated(true);
                onChange(option.value);
              }
            }}
            aria-label={option.ariaLabel ?? option.label}
            aria-pressed={active}
            title={option.title ?? option.label}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </span>
  );
}

export function FilterModeToggle({
  value,
  onChange
}: {
  value: LibraryFilterDisplayMode;
  onChange: (mode: LibraryFilterDisplayMode) => void;
}) {
  const { t } = useI18n();
  return (
    <PageHeaderViewToggle
      className="filter-mode-toggle"
      value={value}
      onChange={onChange}
      ariaLabel={t("filterDisplay.aria")}
      options={[
        { value: "compact", label: t("filterDisplay.compact"), icon: <Rows3 size={15} /> },
        { value: "tiled", label: t("filterDisplay.tiled"), icon: <LayoutGrid size={15} /> }
      ]}
    />
  );
}
