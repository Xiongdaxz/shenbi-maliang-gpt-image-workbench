import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useVirtualRange } from "../hooks/useVirtualRange";

type RenderContext = { index: number; eager: boolean; highPriority: boolean };
const RESPONSIVE_LAYOUT_SETTLE_MS = 48;

function columnsForWidth(width: number, minColumnWidth: number, gap: number, mobileColumns: number) {
  if (width <= 640) return mobileColumns;
  return Math.max(1, Math.floor((Math.max(1, width) + gap) / (minColumnWidth + gap)));
}

function MeasuredRow({
  children,
  className,
  index,
  rowKey,
  onHeight,
  style
}: {
  children: ReactNode;
  className?: string;
  index: number;
  rowKey: string;
  onHeight: (index: number, rowKey: string, height: number) => void;
  style: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => onHeight(index, rowKey, Math.ceil(element.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [index, onHeight, rowKey]);

  return <div ref={ref} className={className} style={style}>{children}</div>;
}

export function VirtualizedResponsiveGrid<T>({
  items,
  getKey,
  renderItem,
  minColumnWidth,
  estimateCardHeight,
  gap = 16,
  mobileGap = 10,
  mobileColumns = 2,
  className,
  rowClassName,
  scrollRootRef
}: {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T, context: RenderContext) => ReactNode;
  minColumnWidth: number;
  estimateCardHeight: (columnWidth: number) => number;
  gap?: number;
  mobileGap?: number;
  mobileColumns?: number;
  className?: string;
  rowClassName?: string;
  scrollRootRef?: RefObject<HTMLElement | null>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [layoutSettling, setLayoutSettling] = useState(false);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const layoutSettlingRef = useRef(false);
  const measuredHeightsRef = useRef<Record<string, number>>({});
  const metricsRef = useRef<Array<{ top: number; height: number }>>([]);
  const estimatedHeightRef = useRef(1);
  const activeRowKeysRef = useRef<Set<string>>(new Set());
  const pendingHeightsRef = useRef(new Map<string, { index: number; height: number }>());
  const heightFrameRef = useRef(0);
  const resolvedLayoutWidth = layoutWidth || 840;
  const mobile = layoutWidth > 0 && layoutWidth <= 640;
  const activeGap = mobile ? mobileGap : gap;
  const columns = columnsForWidth(resolvedLayoutWidth, minColumnWidth, activeGap, mobileColumns);
  const columnWidth = Math.max(1, (resolvedLayoutWidth - activeGap * (columns - 1)) / columns);
  const layoutKey = `${columns}:${Math.round(columnWidth)}`;
  const estimatedHeight = Math.max(1, Math.ceil(estimateCardHeight(columnWidth)));
  const rowCount = Math.ceil(items.length / columns);
  const rowKeys = useMemo(
    () => Array.from({ length: rowCount }, (_, index) => {
      const keys = items.slice(index * columns, index * columns + columns).map(getKey);
      return `${layoutKey}:${keys.join("\u0000")}`;
    }),
    [columns, getKey, items, layoutKey, rowCount]
  );
  const activeRowKeys = useMemo(() => new Set(rowKeys), [rowKeys]);
  activeRowKeysRef.current = activeRowKeys;

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let frame = 0;
    let layoutTimer = 0;
    let initialized = false;
    let lastObservedWidth = -1;
    const measure = () => {
      frame = 0;
      const nextWidth = Math.round(element.getBoundingClientRect().width);
      if (nextWidth === lastObservedWidth) return;
      lastObservedWidth = nextWidth;
      window.clearTimeout(layoutTimer);
      if (!initialized) {
        initialized = true;
        setLayoutWidth(nextWidth);
        return;
      }
      if (!layoutSettlingRef.current) {
        layoutSettlingRef.current = true;
        setLayoutSettling(true);
      }
      layoutTimer = window.setTimeout(() => {
        setLayoutWidth((current) => current === lastObservedWidth ? current : lastObservedWidth);
        layoutSettlingRef.current = false;
        setLayoutSettling(false);
      }, RESPONSIVE_LAYOUT_SETTLE_MS);
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(layoutTimer);
      layoutSettlingRef.current = false;
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const activeKeys = new Set(rowKeys);
    const current = measuredHeightsRef.current;
    const next = Object.fromEntries(Object.entries(current).filter(([key]) => activeKeys.has(key)));
    if (Object.keys(next).length === Object.keys(current).length) return;
    measuredHeightsRef.current = next;
    setMeasuredHeights(next);
  }, [rowKeys]);

  const metrics = useMemo(() => {
    let top = 0;
    return rowKeys.map((rowKey) => {
      const height = measuredHeights[rowKey] ?? estimatedHeight;
      const metric = { top, height };
      top += height + activeGap;
      return metric;
    });
  }, [activeGap, estimatedHeight, measuredHeights, rowKeys]);
  metricsRef.current = metrics;
  estimatedHeightRef.current = estimatedHeight;
  const totalHeight = metrics.length ? metrics.at(-1)!.top + metrics.at(-1)!.height : 0;
  const range = useVirtualRange(metrics, containerRef, `${layoutKey}:${items.length}`, scrollRootRef);
  const flushPendingHeights = useCallback(() => {
    heightFrameRef.current = 0;
    const pending = Array.from(pendingHeightsRef.current.entries());
    pendingHeightsRef.current.clear();
    if (pending.length === 0) return;

    const current = measuredHeightsRef.current;
    let next = current;
    let changed = false;
    let scrollAnchorDelta = 0;
    const container = containerRef.current;
    const scrollRoot = scrollRootRef?.current ?? null;
    let viewportTop = Number.NEGATIVE_INFINITY;
    if (container) {
      const containerTop = scrollRoot
        ? container.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top + scrollRoot.scrollTop
        : container.getBoundingClientRect().top + window.scrollY;
      viewportTop = (scrollRoot ? scrollRoot.scrollTop : window.scrollY) - containerTop;
    }

    for (const [rowKey, measurement] of pending) {
      if (!activeRowKeysRef.current.has(rowKey)) continue;
      const previousHeight = current[rowKey] ?? estimatedHeightRef.current;
      if (previousHeight === measurement.height) continue;
      if (!changed) next = { ...current };
      next[rowKey] = measurement.height;
      changed = true;
      const metric = metricsRef.current[measurement.index];
      if (metric && metric.top + previousHeight <= viewportTop) {
        scrollAnchorDelta += measurement.height - previousHeight;
      }
    }
    if (!changed) return;
    if (scrollAnchorDelta !== 0) {
      const scrollingElement = scrollRoot ?? document.scrollingElement;
      if (scrollingElement) scrollingElement.scrollTop += scrollAnchorDelta;
    }
    measuredHeightsRef.current = next;
    setMeasuredHeights(next);
  }, [scrollRootRef]);

  const onHeight = useCallback((index: number, rowKey: string, height: number) => {
    const currentHeight = pendingHeightsRef.current.get(rowKey)?.height
      ?? measuredHeightsRef.current[rowKey]
      ?? estimatedHeightRef.current;
    if (currentHeight === height) return;
    pendingHeightsRef.current.set(rowKey, { index, height });
    if (heightFrameRef.current) return;
    heightFrameRef.current = window.requestAnimationFrame(flushPendingHeights);
  }, [flushPendingHeights]);

  useEffect(() => () => {
    window.cancelAnimationFrame(heightFrameRef.current);
    pendingHeightsRef.current.clear();
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      data-layout-settling={layoutSettling || undefined}
      style={{ position: "relative", height: totalHeight, overflowX: layoutSettling ? "clip" : undefined }}
    >
      {metrics.slice(range.start, range.end).map((metric, visibleIndex) => {
        const rowIndex = range.start + visibleIndex;
        const rowItems = items.slice(rowIndex * columns, rowIndex * columns + columns);
        const rowKey = rowKeys[rowIndex];
        return (
          <MeasuredRow
            className={rowClassName}
            index={rowIndex}
            key={`virtual-row-${rowKey}`}
            onHeight={onHeight}
            rowKey={rowKey}
            style={{
              position: "absolute",
              top: metric.top,
              left: 0,
              width: layoutWidth > 0 ? layoutWidth : "100%",
              display: "grid",
              alignItems: "start",
              gap: activeGap,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
            }}
          >
            {rowItems.map((item, itemIndex) => {
              const index = rowIndex * columns + itemIndex;
              return renderItem(item, { index, eager: rowIndex === 0, highPriority: index === 0 });
            })}
          </MeasuredRow>
        );
      })}
    </div>
  );
}
