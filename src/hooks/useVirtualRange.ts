import { useEffect, useState, type RefObject } from "react";

export type VirtualMetric = { top: number; height: number };

function lowerBound(metrics: VirtualMetric[], value: number, useEnd: boolean) {
  let low = 0;
  let high = metrics.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const metric = metrics[mid];
    const compare = useEnd ? metric.top + metric.height : metric.top;
    if (compare < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function useVirtualRange<T extends HTMLElement>(
  metrics: VirtualMetric[],
  containerRef: RefObject<T | null>,
  observeKey?: unknown,
  scrollRootRef?: RefObject<HTMLElement | null>
) {
  const [range, setRange] = useState({ start: 0, end: 0 });

  useEffect(() => {
    let frame = 0;
    const updateRange = () => {
      const container = containerRef.current;
      if (!container || metrics.length === 0) {
        setRange({ start: 0, end: 0 });
        return;
      }
      const scrollRoot = scrollRootRef?.current ?? null;
      const containerTop = scrollRoot
        ? container.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top + scrollRoot.scrollTop
        : container.getBoundingClientRect().top + window.scrollY;
      const viewportTop = (scrollRoot ? scrollRoot.scrollTop : window.scrollY) - containerTop;
      const viewportHeight = scrollRoot?.clientHeight ?? window.innerHeight;
      const viewportBottom = viewportTop + viewportHeight;
      const overscan = Math.min(1200, Math.max(600, viewportHeight));
      const startPx = Math.max(0, viewportTop - overscan);
      const endPx = viewportBottom + overscan;
      const start = Math.min(metrics.length - 1, Math.max(0, lowerBound(metrics, startPx, true)));
      const end = Math.max(start + 1, Math.min(metrics.length, lowerBound(metrics, endPx, false) + 1));
      setRange((current) => current.start === start && current.end === end ? current : { start, end });
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateRange);
    };
    updateRange();
    const scrollTarget = scrollRootRef?.current ?? window;
    scrollTarget.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    const rootObserver = scrollRootRef?.current ? new ResizeObserver(scheduleUpdate) : null;
    if (scrollRootRef?.current) rootObserver?.observe(scrollRootRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      scrollTarget.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      rootObserver?.disconnect();
    };
  }, [containerRef, metrics, observeKey, scrollRootRef]);

  return range;
}
