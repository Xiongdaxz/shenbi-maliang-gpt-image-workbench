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
const FILTER_SLIDER_ANIMATION_RESET_MS = 360;

type FilterSliderLayout = {
  left: number;
  top: number;
  width: number;
  height: number;
  ready: boolean;
};

const EMPTY_FILTER_SLIDER: FilterSliderLayout = { left: 0, top: 0, width: 0, height: 0, ready: false };

function filterSliderLayout(element: HTMLElement, activeValue: string | null | undefined, current: FilterSliderLayout) {
  if (!activeValue) return current.ready ? { ...current, ready: false } : current;
  const activeButton = Array.from(element.children).find(
    (child): child is HTMLButtonElement => child instanceof HTMLButtonElement && child.dataset.filterValue === activeValue
  );
  if (!activeButton) return current.ready ? { ...current, ready: false } : current;
  return {
    left: activeButton.offsetLeft,
    top: activeButton.offsetTop,
    width: activeButton.offsetWidth,
    height: activeButton.offsetHeight,
    ready: true
  };
}

function sameFilterSliderLayout(current: FilterSliderLayout, next: FilterSliderLayout) {
  return (
    current.ready === next.ready &&
    Math.abs(current.left - next.left) <= 0.5 &&
    Math.abs(current.top - next.top) <= 0.5 &&
    Math.abs(current.width - next.width) <= 0.5 &&
    Math.abs(current.height - next.height) <= 0.5
  );
}

function filterSliderStyle(slider: FilterSliderLayout) {
  return {
    "--filter-slider-left": `${slider.left}px`,
    "--filter-slider-top": `${slider.top}px`,
    "--filter-slider-width": `${slider.width}px`,
    "--filter-slider-height": `${slider.height}px`
  } as CSSProperties;
}

function useFilterSliderAnimation() {
  const [animated, setAnimated] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  const beginAnimation = useCallback(() => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    setAnimated(true);
    resetTimerRef.current = window.setTimeout(() => {
      setAnimated(false);
      resetTimerRef.current = null;
    }, FILTER_SLIDER_ANIMATION_RESET_MS);
  }, []);

  useLayoutEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    },
    []
  );

  return { animated, beginAnimation };
}

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

function useHorizontalScroller(dependencyKey: string, enabled = true, activeFilterValue?: string | null) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollHint, setScrollHint] = useState<HorizontalScrollHint>(NO_SCROLL_HINT);
  const [filterSlider, setFilterSlider] = useState<FilterSliderLayout>(EMPTY_FILTER_SLIDER);
  const { animated: filterSliderAnimated, beginAnimation: beginFilterSliderAnimation } = useFilterSliderAnimation();

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (!enabled) element.scrollLeft = 0;
    let frame = 0;
    const measure = () => {
      const maxScrollLeft = enabled ? Math.max(0, element.scrollWidth - element.clientWidth) : 0;
      const overflow = maxScrollLeft > 1;
      const atStart = !overflow || element.scrollLeft <= 1;
      const atEnd = !overflow || element.scrollLeft >= maxScrollLeft - 1;
      setScrollHint((value) =>
        value.overflow === overflow && value.atStart === atStart && value.atEnd === atEnd ? value : { overflow, atStart, atEnd }
      );
      if (activeFilterValue !== undefined) {
        setFilterSlider((current) => {
          const next = filterSliderLayout(element, activeFilterValue, current);
          return sameFilterSliderLayout(current, next) ? current : next;
        });
      }
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const handleWheel = (event: WheelEvent) => {
      if (!enabled) return;
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

    measure();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(element);
    Array.from(element.children).forEach((child) => {
      if (child instanceof HTMLButtonElement) resizeObserver.observe(child);
    });
    if (enabled) {
      element.addEventListener("scroll", sync, { passive: true });
      element.addEventListener("wheel", handleWheel, { passive: false });
    }
    window.addEventListener("resize", sync);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      if (enabled) {
        element.removeEventListener("scroll", sync);
        element.removeEventListener("wheel", handleWheel);
      }
      window.removeEventListener("resize", sync);
    };
  }, [activeFilterValue, dependencyKey, enabled]);

  return { scrollRef, scrollHint, filterSlider, filterSliderAnimated, beginFilterSliderAnimation };
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

export function FilterTabLabel({
  children,
  count,
  reserveCountSpace = false
}: {
  children: ReactNode;
  count?: number;
  reserveCountSpace?: boolean;
}) {
  return (
    <>
      <span>{children}</span>
      {typeof count === "number" && (count > 0 || reserveCountSpace) ? <span className="filter-tab-count">{count}</span> : null}
    </>
  );
}

export function FilterTabsScroller({
  className,
  ariaLabel,
  hintKey,
  activeValue,
  mode = "compact",
  children
}: {
  className?: string;
  ariaLabel?: string;
  hintKey: string;
  activeValue?: string | null;
  mode?: LibraryFilterDisplayMode;
  children: ReactNode;
}) {
  const { scrollRef, scrollHint, filterSlider, filterSliderAnimated, beginFilterSliderAnimation } = useHorizontalScroller(
    hintKey,
    mode === "compact",
    activeValue
  );
  const scrollClickedTabIntoView = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const scroller = scrollRef.current;
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("button");
      if (!scroller || !button || !scroller.contains(button)) return;
      if (activeValue !== undefined) beginFilterSliderAnimation();
      if (mode !== "compact") return;

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
    [activeValue, beginFilterSliderAnimation, mode, scrollRef]
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
      <div
        className={cx("pill-tabs", activeValue !== undefined && "sliding-filter-surface", className)}
        ref={scrollRef}
        role="group"
        aria-label={ariaLabel}
        style={activeValue !== undefined ? filterSliderStyle(filterSlider) : undefined}
        data-filter-slider-ready={filterSlider.ready ? "true" : "false"}
        data-filter-slider-animated={filterSliderAnimated ? "true" : "false"}
        onClickCapture={scrollClickedTabIntoView}
      >
        {activeValue !== undefined ? <span className="filter-selection-slider" aria-hidden="true" /> : null}
        {children}
      </div>
    </div>
  );
}

export function SlidingFilterGroup({
  className,
  ariaLabel,
  activeValue,
  countDigits,
  children
}: {
  className?: string;
  ariaLabel?: string;
  activeValue: string | null;
  countDigits?: number;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [slider, setSlider] = useState<FilterSliderLayout>(EMPTY_FILTER_SLIDER);
  const { animated, beginAnimation } = useFilterSliderAnimation();

  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      setSlider((current) => {
        const next = filterSliderLayout(element, activeValue, current);
        return sameFilterSliderLayout(current, next) ? current : next;
      });
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(element);
    Array.from(element.children).forEach((child) => {
      if (child instanceof HTMLButtonElement) resizeObserver.observe(child);
    });
    window.addEventListener("resize", sync);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [activeValue]);

  const handleClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("button");
      if (button && wrapRef.current?.contains(button)) beginAnimation();
    },
    [beginAnimation]
  );

  return (
    <div
      className={cx("sliding-filter-surface", className)}
      ref={wrapRef}
      role="group"
      aria-label={ariaLabel}
      style={{
        ...filterSliderStyle(slider),
        ...(countDigits ? { "--filter-count-width": `${countDigits}ch` } : {})
      } as CSSProperties}
      data-filter-slider-ready={slider.ready ? "true" : "false"}
      data-filter-slider-animated={animated ? "true" : "false"}
      onClickCapture={handleClickCapture}
    >
      <span className="filter-selection-slider" aria-hidden="true" />
      {children}
    </div>
  );
}

export function FilterResultTransition({ resultKey, children }: { resultKey: unknown; children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hasInitialResultRef = useRef(false);

  useLayoutEffect(() => {
    if (resultKey === null || resultKey === undefined) return;
    if (!hasInitialResultRef.current) {
      hasInitialResultRef.current = true;
      return;
    }
    const element = wrapRef.current;
    if (!element || typeof element.animate !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.getAnimations().forEach((animation) => animation.cancel());
    element.animate([{ opacity: 0.94 }, { opacity: 1 }], {
      duration: 140,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)"
    });
  }, [resultKey]);

  return (
    <div className="library-filter-results" ref={wrapRef}>
      {children}
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
