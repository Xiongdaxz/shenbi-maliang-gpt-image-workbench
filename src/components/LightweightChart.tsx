import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";

type ChartTone = "primary" | "muted" | "danger" | "success";

export type LightweightLineSeries<TData> = {
  id: string;
  label: string;
  tone?: ChartTone;
  value: (item: TData) => number;
};

type LightweightLineChartProps<TData extends { label: string }> = {
  title?: string;
  data: TData[];
  series: Array<LightweightLineSeries<TData>>;
  valueLabel?: (value: number) => string;
  ariaLabel?: string;
};

function safeValue(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const controlX = previous.x + (point.x - previous.x) / 2;
    return `${path} C ${controlX.toFixed(1)} ${previous.y.toFixed(1)}, ${controlX.toFixed(1)} ${point.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }, `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`);
}

function chartAxisLabelIndexes(count: number, plotWidth: number) {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const minLabelGap = 46;
  const maxLabels = Math.max(2, Math.floor(plotWidth / minLabelGap) + 1);
  if (count <= maxLabels) return Array.from({ length: count }, (_, index) => index);
  const step = Math.ceil((count - 1) / (maxLabels - 1));
  const indexes = new Set<number>();
  for (let index = 0; index < count; index += step) {
    indexes.add(index);
  }
  indexes.add(count - 1);
  return [...indexes].sort((left, right) => left - right);
}

export function LightweightLineChart<TData extends { label: string }>({
  title,
  data,
  series,
  valueLabel = (value) => String(value),
  ariaLabel
}: LightweightLineChartProps<TData>) {
  const { t } = useI18n();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [viewBoxWidth, setViewBoxWidth] = useState(720);
  const [hiddenSeriesIds, setHiddenSeriesIds] = useState<Set<string>>(() => new Set());
  const svgRef = useRef<SVGSVGElement>(null);
  const visibleSeries = series.filter((item) => !hiddenSeriesIds.has(item.id));
  const values = visibleSeries.flatMap((item) => data.map((row) => safeValue(item.value(row))));
  const max = Math.max(1, ...values);
  const height = 240;
  const width = viewBoxWidth;
  const plot = { left: 44, right: 18, top: 18, bottom: 38 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const baselineY = height - plot.bottom;
  const xForIndex = (index: number) => (data.length <= 1 ? plot.left + plotWidth / 2 : plot.left + (index / (data.length - 1)) * plotWidth);
  const pointRows = visibleSeries.map((item) => ({
    ...item,
    tone: item.tone ?? "primary",
    points: data.map((row, index) => {
      const value = safeValue(item.value(row));
      return {
        x: xForIndex(index),
        y: plot.top + (1 - value / max) * plotHeight,
        value
      };
    })
  }));
  const axisLabels = chartAxisLabelIndexes(data.length, plotWidth);
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const value = Math.round(max * ratio);
    const y = plot.top + (1 - ratio) * plotHeight;
    return { value, y };
  });
  const hoverPoint = hoverIndex === null ? null : pointRows[0]?.points[hoverIndex] ?? null;
  const hoverRow = hoverIndex === null ? null : data[hoverIndex] ?? null;

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const syncWidth = () => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nextWidth = Math.max(360, Math.round((rect.width * height) / rect.height));
      setViewBoxWidth((current) => (current === nextWidth ? current : nextWidth));
    };
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  function updateHover(event: PointerEvent<SVGSVGElement>) {
    if (data.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const svgX = ratio * width;
    const plotRatio = Math.min(1, Math.max(0, (svgX - plot.left) / plotWidth));
    const nextIndex = data.length <= 1 ? 0 : Math.round(plotRatio * (data.length - 1));
    setHoverIndex((current) => (current === nextIndex ? current : nextIndex));
  }

  function toggleSeries(seriesId: string) {
    setHiddenSeriesIds((current) => {
      const next = new Set(current);
      if (next.has(seriesId)) next.delete(seriesId);
      else next.add(seriesId);
      return next;
    });
  }

  return (
    <div className="light-chart">
      <div className="light-chart-head">
        {title ? <h4>{title}</h4> : null}
        <div className="light-chart-legend">
          {series.map((item) => {
            const hidden = hiddenSeriesIds.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                className={cx(item.tone ?? "primary", hidden && "hidden")}
                onClick={() => toggleSeries(item.id)}
                aria-pressed={!hidden}
                title={hidden ? t("chart.showSeries", { label: item.label }) : t("chart.hideSeries", { label: item.label })}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel ?? t("chart.trend")}
        onPointerMove={updateHover}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {gridLines.map((line) => (
          <g key={`${line.value}-${line.y}`}>
            <line className="light-chart-grid-line" x1={plot.left} y1={line.y} x2={width - plot.right} y2={line.y} />
            <text className="light-chart-axis-label" x={plot.left - 10} y={line.y + 4} textAnchor="end">
              {valueLabel(line.value)}
            </text>
          </g>
        ))}
        <line className="light-chart-axis-line" x1={plot.left} y1={baselineY} x2={width - plot.right} y2={baselineY} />
        {pointRows.map((item) => (
          <g key={item.id}>
            <path className={cx("light-chart-line", item.tone)} d={smoothPath(item.points)} fill="none" />
            {item.points.map((point, index) => (
              <circle
                key={`${item.id}-${index}`}
                className={cx("light-chart-point", item.tone, hoverIndex === index && "active")}
                cx={point.x}
                cy={point.y}
                r={hoverIndex === index ? 4.5 : 3}
              />
            ))}
          </g>
        ))}
        {hoverPoint ? (
          <line
            className="light-chart-hover-line"
            x1={hoverPoint.x}
            y1={plot.top}
            x2={hoverPoint.x}
            y2={baselineY}
          />
        ) : null}
        {hoverIndex !== null
          ? pointRows.map((item) => {
              const point = item.points[hoverIndex];
              if (!point) return null;
              return (
                <circle
                  key={`${item.id}-hover`}
                  className={cx("light-chart-hover-point", item.tone)}
                  cx={point.x}
                  cy={point.y}
                  r={5}
                />
              );
            })
          : null}
        {axisLabels.map((index) => (
          <g key={index}>
            <line
              className="light-chart-axis-tick"
              x1={xForIndex(index)}
              y1={baselineY}
              x2={xForIndex(index)}
              y2={baselineY + 5}
            />
            <text
              className="light-chart-axis-label x-axis"
              x={xForIndex(index)}
              y={height - 10}
              textAnchor="middle"
            >
              {data[index]?.label ?? "-"}
            </text>
          </g>
        ))}
      </svg>
      {hoverRow && hoverPoint ? (
        <div
          className={cx("light-chart-tooltip", hoverPoint.x > width * 0.72 && "left")}
          style={{ left: `${(hoverPoint.x / width) * 100}%` }}
        >
          <strong>{hoverRow.label}</strong>
          {pointRows.map((item) => {
            const point = item.points[hoverIndex ?? 0];
            return (
              <span key={item.id} className="light-chart-tooltip-row">
                <i className={item.tone} />
                {item.label}
                <b>{valueLabel(point?.value ?? 0)}</b>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
