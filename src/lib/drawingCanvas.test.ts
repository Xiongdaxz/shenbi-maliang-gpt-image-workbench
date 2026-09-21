import { describe, expect, test } from "bun:test";
import {
  DRAWING_DEFAULT_ERASER_WIDTH,
  DRAWING_DEFAULT_STROKE_WIDTH,
  DRAWING_DEFAULT_TEXT_SIZE,
  DRAWING_EXPORT_PADDING,
  DRAWING_EXPORT_SIZE,
  DRAWING_MAX_ERASER_WIDTH,
  DRAWING_MAX_STROKE_WIDTH,
  DRAWING_MAX_TEXT_SIZE,
  DRAWING_MIN_STROKE_WIDTH,
  DRAWING_MIN_TEXT_SIZE,
  clampDrawingPoint,
  drawDrawingElements,
  drawingContentPixelBounds,
  drawingElementBounds,
  drawingTextLineWidth,
  eraseDrawingElements,
  hitTestDrawingElement,
  moveDrawingElement,
  nextDrawingElementId,
  resizeDrawingElement,
  topDrawingElementAt,
  type DrawingElement
} from "./drawingCanvas";

function stroke(id = "stroke-1"): DrawingElement {
  return {
    id,
    type: "stroke",
    color: "#000000",
    width: 12,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.3 },
      { x: 0.5, y: 0.5 },
      { x: 0.7, y: 0.7 },
      { x: 0.9, y: 0.9 }
    ]
  };
}

describe("drawing canvas geometry", () => {
  test("uses the verified working scale and official content padding", () => {
    expect(DRAWING_EXPORT_SIZE).toBe(832);
    expect(DRAWING_EXPORT_PADDING).toBe(36);
  });

  test("finds the visible pixel bounds used for automatic export cropping", () => {
    const pixels = new Uint8ClampedArray(5 * 4 * 4);
    pixels[(1 * 5 + 1) * 4 + 3] = 255;
    pixels[(2 * 5 + 3) * 4 + 3] = 64;
    expect(drawingContentPixelBounds(pixels, 5, 4)).toEqual({ left: 1, top: 1, right: 3, bottom: 2 });
    expect(drawingContentPixelBounds(pixels, 5, 4, 64)).toEqual({ left: 1, top: 1, right: 1, bottom: 1 });
    expect(drawingContentPixelBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });

  test("matches the official independent drawing tool size ranges", () => {
    expect([DRAWING_MIN_STROKE_WIDTH, DRAWING_DEFAULT_STROKE_WIDTH, DRAWING_MAX_STROKE_WIDTH]).toEqual([2, 12, 48]);
    expect([DRAWING_MIN_TEXT_SIZE, DRAWING_DEFAULT_TEXT_SIZE, DRAWING_MAX_TEXT_SIZE]).toEqual([8, 24, 128]);
    expect([DRAWING_DEFAULT_ERASER_WIDTH, DRAWING_MAX_ERASER_WIDTH]).toEqual([32, 96]);
  });

  test("allows the eraser to use the larger official maximum", () => {
    const erased = eraseDrawingElements([], [{ x: 0.5, y: 0.5 }], 200, () => "erase-1");
    expect(erased).toEqual([
      { id: "erase-1", type: "erase", points: [{ x: 0.5, y: 0.5 }], width: DRAWING_MAX_ERASER_WIDTH }
    ]);
  });

  test("normalizes points and finds the topmost element", () => {
    expect(clampDrawingPoint({ x: -1, y: 2 })).toEqual({ x: 0, y: 1 });
    const bottom = stroke("bottom");
    const top: DrawingElement = {
      id: "top",
      type: "shape",
      shape: "rectangle",
      start: { x: 0.2, y: 0.2 },
      end: { x: 0.6, y: 0.6 },
      color: "#ff0000",
      width: 8
    };
    expect(topDrawingElementAt([bottom, top], { x: 0.4, y: 0.4 })?.id).toBe("top");
    expect(hitTestDrawingElement(bottom, { x: 0.5, y: 0.5 })).toBe(true);
  });

  test("skips restored element ids when a drawing is edited again", () => {
    const restored = [
      stroke("drawing-1"),
      stroke("drawing-3")
    ];
    expect(nextDrawingElementId(restored, 0)).toEqual({ id: "drawing-2", index: 2 });
    expect(nextDrawingElementId(restored, 2)).toEqual({ id: "drawing-4", index: 4 });
  });

  test("uses full-em widths for Chinese text selection bounds", () => {
    expect(drawingTextLineWidth("你好", 0.05)).toBeCloseTo(0.1);
    expect(drawingTextLineWidth("Hi", 0.05)).toBeCloseTo(0.062);
    const bounds = drawingElementBounds({
      id: "chinese-text",
      type: "text",
      x: 0.2,
      y: 0.2,
      text: "你好",
      color: "#000000",
      fontSize: 0.05
    });
    expect(bounds.right - bounds.left).toBeCloseTo(0.1);
    expect(bounds.bottom - bounds.top).toBeCloseTo(0.054);
  });

  test("keeps an explicit text frame after editing finishes", () => {
    const bounds = drawingElementBounds({
      id: "framed-text",
      type: "text",
      x: 0.2,
      y: 0.3,
      text: "你好",
      color: "#000000",
      fontSize: 0.05,
      boxWidth: 0.32,
      boxHeight: 0.09
    });
    expect(bounds.left).toBe(0.2);
    expect(bounds.top).toBe(0.3);
    expect(bounds.right - bounds.left).toBeCloseTo(0.32);
    expect(bounds.bottom - bounds.top).toBeCloseTo(0.09);
  });

  test("moves an element without allowing it outside the canvas", () => {
    const element: DrawingElement = {
      id: "box",
      type: "shape",
      shape: "rectangle",
      start: { x: 0.7, y: 0.7 },
      end: { x: 0.9, y: 0.9 },
      color: "#000000",
      width: 8
    };
    const moved = moveDrawingElement(element, 0.5, 0.5);
    const bounds = drawingElementBounds(moved);
    expect(bounds.left).toBeGreaterThan(0.79);
    expect(bounds.top).toBeGreaterThan(0.79);
    expect(bounds.right).toBe(1);
    expect(bounds.bottom).toBe(1);
  });

  test("resizes text and preserves its content", () => {
    const element: DrawingElement = {
      id: "text",
      type: "text",
      x: 0.1,
      y: 0.1,
      text: "草图",
      color: "#2563eb",
      fontSize: 0.05
    };
    const original = drawingElementBounds(element);
    const resized = resizeDrawingElement(element, original, { left: 0.2, top: 0.2, right: 0.6, bottom: 0.4 });
    expect(resized.type).toBe("text");
    if (resized.type !== "text") throw new Error("Expected text element");
    expect(resized.text).toBe("草图");
    expect(resized.x).toBe(0.2);
    expect(resized.fontSize).toBeGreaterThan(element.fontSize);
    expect(resized.boxWidth).toBeCloseTo(0.4);
    expect(resized.boxHeight).toBeCloseTo(0.2);
  });

  test("preserves vector sizes created by the previous tool ranges", () => {
    const legacyStroke: DrawingElement = {
      id: "legacy-stroke",
      type: "stroke",
      color: "#000000",
      width: 64,
      points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }]
    };
    const legacyShape: DrawingElement = {
      id: "legacy-shape",
      type: "shape",
      shape: "rectangle",
      start: { x: 0.2, y: 0.2 },
      end: { x: 0.8, y: 0.8 },
      color: "#000000",
      width: 64
    };
    const legacyText: DrawingElement = {
      id: "legacy-text",
      type: "text",
      x: 0.1,
      y: 0.1,
      text: "旧文字",
      color: "#000000",
      fontSize: 0.2,
      boxWidth: 0.7,
      boxHeight: 0.25
    };

    for (const element of [legacyStroke, legacyShape, legacyText]) {
      const bounds = drawingElementBounds(element);
      const resized = resizeDrawingElement(element, bounds, bounds);
      if (resized.type === "text") expect(resized.fontSize).toBe(0.2);
      else expect(resized.width).toBe(64);
    }
  });

  test("keeps line and arrow direction stable during non-uniform corner resizing", () => {
    for (const shape of ["line", "arrow"] as const) {
      const element: DrawingElement = {
        id: shape,
        type: "shape",
        shape,
        start: { x: 0.2, y: 0.46 },
        end: { x: 0.8, y: 0.48 },
        color: "#000000",
        width: 16
      };
      const originalBounds = drawingElementBounds(element);
      const resized = resizeDrawingElement(element, originalBounds, {
        left: 0.08,
        top: 0.12,
        right: 0.92,
        bottom: 0.76
      });
      expect(resized.type).toBe("shape");
      if (resized.type !== "shape") throw new Error("Expected shape element");
      const originalDx = element.end.x - element.start.x;
      const originalDy = element.end.y - element.start.y;
      const resizedDx = resized.end.x - resized.start.x;
      const resizedDy = resized.end.y - resized.start.y;
      expect(originalDx * resizedDy - originalDy * resizedDx).toBeCloseTo(0, 10);
      expect(resizedDx * originalDx + resizedDy * originalDy).toBeGreaterThan(0);
    }
  });

  test("includes both arrowhead wings in selection bounds and hit testing", () => {
    const arrow: DrawingElement = {
      id: "arrow",
      type: "shape",
      shape: "arrow",
      start: { x: 0.2, y: 0.5 },
      end: { x: 0.8, y: 0.5 },
      color: "#000000",
      width: 16
    };
    const bounds = drawingElementBounds(arrow);
    expect(bounds.top).toBeLessThan(0.47);
    expect(bounds.bottom).toBeGreaterThan(0.53);
    expect(hitTestDrawingElement(arrow, { x: 0.747, y: 0.531 }, 0.004)).toBe(true);
  });

  test("records a circular eraser mask without deleting the source vector", () => {
    let id = 0;
    const erased = eraseDrawingElements([stroke()], [{ x: 0.5, y: 0.5 }], 64, () => `split-${++id}`);
    expect(erased).toHaveLength(2);
    expect(erased[0]).toEqual(stroke());
    expect(erased[1]).toEqual({
      id: "split-1",
      type: "erase",
      points: [{ x: 0.5, y: 0.5 }],
      width: 64
    });
  });

  test("keeps the selection bounds outside a shape's full stroke", () => {
    const element: DrawingElement = {
      id: "ellipse",
      type: "shape",
      shape: "ellipse",
      start: { x: 0.2, y: 0.2 },
      end: { x: 0.8, y: 0.8 },
      color: "#000000",
      width: 64
    };
    const bounds = drawingElementBounds(element);
    expect(bounds.left).toBeLessThan(0.2);
    expect(bounds.top).toBeLessThan(0.2);
    expect(bounds.right).toBeGreaterThan(0.8);
    expect(bounds.bottom).toBeGreaterThan(0.8);
  });
});

describe("drawing canvas rendering", () => {
  test("renders the white background, strokes, text, rectangles, and ellipses", () => {
    const calls: string[] = [];
    const textPlacements: Array<[number, number]> = [];
    const context = {
      fillStyle: "",
      strokeStyle: "",
      lineCap: "butt",
      lineJoin: "miter",
      lineWidth: 1,
      font: "",
      textBaseline: "alphabetic",
      textAlign: "start",
      globalCompositeOperation: "source-over",
      save() { calls.push("save"); },
      restore() { calls.push("restore"); },
      clearRect() { calls.push("clearRect"); },
      fillRect() { calls.push("fillRect"); },
      beginPath() { calls.push("beginPath"); },
      moveTo() {},
      lineTo() {},
      quadraticCurveTo() {},
      bezierCurveTo() {},
      closePath() { calls.push("closePath"); },
      stroke() { calls.push("stroke"); },
      measureText() {
        return {
          actualBoundingBoxAscent: 40,
          actualBoundingBoxDescent: 10
        } as ReturnType<CanvasRenderingContext2D["measureText"]>;
      },
      fillText(_text: string, x: number, y: number) {
        calls.push("fillText");
        textPlacements.push([x, y]);
      },
      drawImage() { calls.push("drawImage"); },
      strokeRect() { calls.push("strokeRect"); },
      ellipse() { calls.push("ellipse"); }
    } as unknown as CanvasRenderingContext2D;
    const elements: DrawingElement[] = [
      stroke(),
      {
        id: "text",
        type: "text",
        x: 0.2,
        y: 0.2,
        text: "文字",
        color: "#000000",
        fontSize: 0.05,
        boxWidth: 0.3,
        boxHeight: 0.1
      },
      { id: "rect", type: "shape", shape: "rectangle", start: { x: 0.1, y: 0.1 }, end: { x: 0.3, y: 0.3 }, color: "#000000", width: 8 },
      { id: "ellipse", type: "shape", shape: "ellipse", start: { x: 0.4, y: 0.4 }, end: { x: 0.7, y: 0.7 }, color: "#000000", width: 8 },
      { id: "rounded", type: "shape", shape: "roundedRectangle", start: { x: 0.1, y: 0.1 }, end: { x: 0.3, y: 0.3 }, color: "#000000", width: 8 },
      { id: "triangle", type: "shape", shape: "triangle", start: { x: 0.1, y: 0.1 }, end: { x: 0.3, y: 0.3 }, color: "#000000", width: 8 },
      { id: "diamond", type: "shape", shape: "diamond", start: { x: 0.1, y: 0.1 }, end: { x: 0.3, y: 0.3 }, color: "#000000", width: 8 },
      { id: "star", type: "shape", shape: "star", start: { x: 0.1, y: 0.1 }, end: { x: 0.3, y: 0.3 }, color: "#000000", width: 8 },
      { id: "hexagon", type: "shape", shape: "hexagon", start: { x: 0.1, y: 0.1 }, end: { x: 0.3, y: 0.3 }, color: "#000000", width: 8 },
      { id: "heart", type: "shape", shape: "heart", start: { x: 0.1, y: 0.1 }, end: { x: 0.3, y: 0.3 }, color: "#000000", width: 8 },
      { id: "erase", type: "erase", points: [{ x: 0.2, y: 0.2 }], width: 24 }
    ];
    drawDrawingElements(context, elements, 1024, 1024);
    expect(calls[1]).toBe("clearRect");
    expect(calls).toContain("fillRect");
    expect(calls).toContain("stroke");
    expect(calls).toContain("fillText");
    expect(textPlacements[0][0]).toBeGreaterThan(0.2 * 1024);
    expect(textPlacements[0][0]).toBeLessThan(0.21 * 1024);
    expect(context.textAlign).toBe("left");
    expect(calls).toContain("strokeRect");
    expect(calls).toContain("ellipse");
    expect(calls.filter((call) => call === "closePath")).toHaveLength(6);

    calls.length = 0;
    drawDrawingElements(context, elements, 1024, 1024, { background: null });
    expect(calls).not.toContain("fillRect");

    calls.length = 0;
    drawDrawingElements(context, elements, 1024, 1024, {
      background: null,
      backgroundImage: {} as CanvasImageSource
    });
    expect(calls).toContain("drawImage");
    expect(calls).not.toContain("fillRect");
  });
});
