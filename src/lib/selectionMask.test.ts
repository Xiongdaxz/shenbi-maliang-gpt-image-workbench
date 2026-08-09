import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BRUSH_PREVIEW_ANCHOR,
  brushPreviewMetrics,
  brushSizeRatioFromDisplayPixels,
  renderMaskStroke,
  renderSelectionOverlay,
  selectionPreviewCanvasSize,
  selectionTapCircleOutlines
} from "./selectionMask";

describe("remove brush preview", () => {
  test("starts at the image center and uses the same diameter as the mask brush", () => {
    const ratio = brushSizeRatioFromDisplayPixels(96, 800, 600);
    expect(brushPreviewMetrics(DEFAULT_BRUSH_PREVIEW_ANCHOR, ratio, 800, 600)).toEqual({
      centerX: 400,
      centerY: 300,
      diameter: 96
    });
  });

  test("keeps the last normalized canvas anchor across layout sizes", () => {
    const anchor = { x: 0.75, y: 0.25 };
    expect(brushPreviewMetrics(anchor, 0.2, 800, 600)).toEqual({ centerX: 600, centerY: 150, diameter: 120 });
    expect(brushPreviewMetrics(anchor, 0.2, 400, 300)).toEqual({ centerX: 300, centerY: 75, diameter: 60 });
  });

  test("renders a click as one circular mask area", () => {
    const arcs: number[][] = [];
    const context = {
      lineCap: "butt",
      lineJoin: "miter",
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      save() {},
      restore() {},
      beginPath() {},
      arc(...values: number[]) {
        arcs.push(values);
      },
      fill() {}
    } as unknown as CanvasRenderingContext2D;

    renderMaskStroke(
      context,
      { points: [{ x: 0.5, y: 0.5 }], sizeRatio: 0.2 },
      100,
      80,
      "#000000"
    );

    expect(arcs).toEqual([[50, 40, 8, 0, Math.PI * 2]]);
  });

  test("renders a single-click border with an exact canvas circle", () => {
    const arcs: Array<Array<number | boolean>> = [];
    const context = {
      lineCap: "butt",
      lineJoin: "miter",
      lineWidth: 0,
      strokeStyle: "",
      lineDashOffset: 0,
      drawImage() {},
      save() {},
      restore() {},
      setLineDash() {},
      beginPath() {},
      arc(...values: number[]) {
        arcs.push(values);
      },
      stroke() {}
    } as unknown as CanvasRenderingContext2D;

    renderSelectionOverlay(
      context,
      {
        fillCanvas: {} as HTMLCanvasElement,
        contours: [],
        circles: [{ centerX: 50, centerY: 40, radius: 8 }]
      },
      0
    );

    expect(arcs).toEqual([[50, 40, 8, 0, -Math.PI * 2, true]]);
  });

  test("uses source-resolution sampling up to a two-times preview scale", () => {
    expect(selectionPreviewCanvasSize(641, 802, 1122, 1402)).toEqual({
      width: 1121,
      height: 1402,
      scale: 1402 / 802
    });
    expect(selectionPreviewCanvasSize(720, 720, 4096, 4096)).toEqual({
      width: 1440,
      height: 1440,
      scale: 2
    });
  });

  test("keeps multiple separated click borders as exact circles", () => {
    expect(selectionTapCircleOutlines([
      { points: [{ x: 0.25, y: 0.5 }], sizeRatio: 0.2 },
      { points: [{ x: 0.75, y: 0.5 }], sizeRatio: 0.2 }
    ], 100, 100)).toEqual([
      { centerX: 25, centerY: 50, radius: 10 },
      { centerX: 75, centerY: 50, radius: 10 }
    ]);
  });

  test("keeps a separated click border exact after a dragged stroke is added", () => {
    expect(selectionTapCircleOutlines([
      { points: [{ x: 0.2, y: 0.2 }], sizeRatio: 0.2 },
      { points: [{ x: 0.6, y: 0.7 }, { x: 0.8, y: 0.7 }], sizeRatio: 0.2 }
    ], 100, 100)).toEqual([
      { centerX: 20, centerY: 20, radius: 10 }
    ]);
  });

  test("merges a click border only when a dragged stroke touches it", () => {
    expect(selectionTapCircleOutlines([
      { points: [{ x: 0.2, y: 0.5 }], sizeRatio: 0.2 },
      { points: [{ x: 0.3, y: 0.5 }, { x: 0.8, y: 0.5 }], sizeRatio: 0.2 }
    ], 100, 100)).toEqual([]);
  });

  test("uses a merged contour when click circles overlap", () => {
    expect(selectionTapCircleOutlines([
      { points: [{ x: 0.45, y: 0.5 }], sizeRatio: 0.2 },
      { points: [{ x: 0.55, y: 0.5 }], sizeRatio: 0.2 }
    ], 100, 100)).toEqual([]);
  });
});
