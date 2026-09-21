export const DRAWING_EXPORT_SIZE = 832;
export const DRAWING_EXPORT_PADDING = 36;
export const DRAWING_MIN_STROKE_WIDTH = 2;
export const DRAWING_MAX_STROKE_WIDTH = 48;
export const DRAWING_DEFAULT_STROKE_WIDTH = 12;
export const DRAWING_MIN_ERASER_WIDTH = 4;
export const DRAWING_MAX_ERASER_WIDTH = 96;
export const DRAWING_DEFAULT_ERASER_WIDTH = 32;
export const DRAWING_MIN_TEXT_SIZE = 8;
export const DRAWING_MAX_TEXT_SIZE = 128;
export const DRAWING_DEFAULT_TEXT_SIZE = 24;
const DRAWING_COMPATIBLE_MAX_STROKE_WIDTH = 64;
const DRAWING_COMPATIBLE_MAX_TEXT_FONT_SIZE = 0.2;

export type DrawingPoint = {
  x: number;
  y: number;
};

export type DrawingShapeType =
  | "line"
  | "arrow"
  | "rectangle"
  | "roundedRectangle"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "star"
  | "hexagon"
  | "heart";

export type DrawingStrokeElement = {
  id: string;
  type: "stroke";
  points: DrawingPoint[];
  color: string;
  width: number;
};

export type DrawingTextElement = {
  id: string;
  type: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
  boxWidth?: number;
  boxHeight?: number;
};

export type DrawingShapeElement = {
  id: string;
  type: "shape";
  shape: DrawingShapeType;
  start: DrawingPoint;
  end: DrawingPoint;
  color: string;
  width: number;
};

export type DrawingEraseElement = {
  id: string;
  type: "erase";
  points: DrawingPoint[];
  width: number;
};

export type DrawingElement = DrawingStrokeElement | DrawingTextElement | DrawingShapeElement | DrawingEraseElement;

export type DrawingBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type DrawingPixelBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const MIN_ELEMENT_SIZE = 0.012;
const DRAWING_TEXT_LINE_HEIGHT = 1.08;
export const DRAWING_TEXT_HORIZONTAL_PADDING = 6 / DRAWING_EXPORT_SIZE;

export function nextDrawingElementId(elements: DrawingElement[], afterIndex = 0) {
  let index = Math.max(0, Math.floor(afterIndex));
  let id = "";
  do {
    index += 1;
    id = `drawing-${index}`;
  } while (elements.some((element) => element.id === id));
  return { id, index };
}

export function clampDrawingNumber(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function drawingContentPixelBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 0
): DrawingPixelBounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) <= alphaThreshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right >= left && bottom >= top ? { left, top, right, bottom } : null;
}

export function clampDrawingPoint(point: DrawingPoint): DrawingPoint {
  return {
    x: clampDrawingNumber(point.x),
    y: clampDrawingNumber(point.y)
  };
}

export function strokeWidthRatio(width: number) {
  return clampDrawingNumber(width, DRAWING_MIN_STROKE_WIDTH, DRAWING_MAX_ERASER_WIDTH) / DRAWING_EXPORT_SIZE;
}

export function drawingTextSizeRatio(size: number) {
  return clampDrawingNumber(size, DRAWING_MIN_TEXT_SIZE, DRAWING_MAX_TEXT_SIZE) / DRAWING_EXPORT_SIZE;
}

export function drawingTextSizeFromRatio(ratio: number) {
  return Math.round(clampDrawingNumber(
    ratio * DRAWING_EXPORT_SIZE,
    DRAWING_MIN_TEXT_SIZE,
    DRAWING_MAX_TEXT_SIZE
  ));
}

function pointDistance(left: DrawingPoint, right: DrawingPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function pointToSegmentDistance(point: DrawingPoint, start: DrawingPoint, end: DrawingPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return pointDistance(point, start);
  const progress = clampDrawingNumber(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)
  );
  return pointDistance(point, { x: start.x + progress * dx, y: start.y + progress * dy });
}

function polylineDistance(point: DrawingPoint, points: DrawingPoint[]) {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return pointDistance(point, points[0]);
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, pointToSegmentDistance(point, points[index - 1], points[index]));
  }
  return distance;
}

function normalizedTextLines(element: DrawingTextElement) {
  return element.text.replace(/\r\n/g, "\n").split("\n");
}

function drawingCharacterWidth(character: string) {
  if (/^[\u2E80-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF\uFF01-\uFF60]$/u.test(character)) return 1;
  if (/^\s$/u.test(character)) return 0.36;
  return 0.62;
}

export function drawingTextLineWidth(text: string, fontSize: number) {
  return Array.from(text).reduce((width, character) => width + drawingCharacterWidth(character), 0) * fontSize;
}

function drawingArrowHeadPoints(start: DrawingPoint, end: DrawingPoint, width: number) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = Math.max(12, clampDrawingNumber(width, DRAWING_MIN_STROKE_WIDTH, DRAWING_COMPATIBLE_MAX_STROKE_WIDTH) * 3.2)
    / DRAWING_EXPORT_SIZE;
  return [
    {
      x: end.x - Math.cos(angle - Math.PI / 6) * headLength,
      y: end.y - Math.sin(angle - Math.PI / 6) * headLength
    },
    {
      x: end.x - Math.cos(angle + Math.PI / 6) * headLength,
      y: end.y - Math.sin(angle + Math.PI / 6) * headLength
    }
  ] as const;
}

export function drawingElementBounds(element: DrawingElement): DrawingBounds {
  if (element.type === "stroke" || element.type === "erase") {
    const padding = strokeWidthRatio(element.width) / 2;
    const xs = element.points.map((point) => point.x);
    const ys = element.points.map((point) => point.y);
    if (xs.length === 0 || ys.length === 0) {
      return { left: 0, top: 0, right: 0, bottom: 0 };
    }
    return {
      left: clampDrawingNumber(Math.min(...xs) - padding),
      top: clampDrawingNumber(Math.min(...ys) - padding),
      right: clampDrawingNumber(Math.max(...xs) + padding),
      bottom: clampDrawingNumber(Math.max(...ys) + padding)
    };
  }
  if (element.type === "text") {
    const lines = normalizedTextLines(element);
    const naturalWidth = Math.max(...lines.map((line) => drawingTextLineWidth(line, element.fontSize)), element.fontSize * 0.62);
    const naturalHeight = Math.max(1, lines.length) * element.fontSize * DRAWING_TEXT_LINE_HEIGHT;
    const width = Math.max(
      naturalWidth + (element.boxWidth === undefined ? 0 : DRAWING_TEXT_HORIZONTAL_PADDING * 2),
      element.boxWidth ?? 0
    );
    const height = Math.max(naturalHeight, element.boxHeight ?? 0);
    return {
      left: clampDrawingNumber(element.x),
      top: clampDrawingNumber(element.y),
      right: clampDrawingNumber(element.x + width),
      bottom: clampDrawingNumber(element.y + height)
    };
  }
  const padding = strokeWidthRatio(element.width) / 2;
  const shapePoints = element.shape === "arrow"
    ? [element.start, element.end, ...drawingArrowHeadPoints(element.start, element.end, element.width)]
    : [element.start, element.end];
  const xs = shapePoints.map((point) => point.x);
  const ys = shapePoints.map((point) => point.y);
  return {
    left: clampDrawingNumber(Math.min(...xs) - padding),
    top: clampDrawingNumber(Math.min(...ys) - padding),
    right: clampDrawingNumber(Math.max(...xs) + padding),
    bottom: clampDrawingNumber(Math.max(...ys) + padding)
  };
}

function pointInBounds(point: DrawingPoint, bounds: DrawingBounds, tolerance: number) {
  return point.x >= bounds.left - tolerance
    && point.x <= bounds.right + tolerance
    && point.y >= bounds.top - tolerance
    && point.y <= bounds.bottom + tolerance;
}

export function hitTestDrawingElement(element: DrawingElement, point: DrawingPoint, tolerance = 0.012) {
  if (element.type === "erase") return false;
  if (element.type === "stroke") {
    return polylineDistance(point, element.points) <= tolerance + strokeWidthRatio(element.width) / 2;
  }
  if (element.type === "text") {
    return pointInBounds(point, drawingElementBounds(element), tolerance);
  }
  if (element.shape === "line" || element.shape === "arrow") {
    const maximumDistance = tolerance + strokeWidthRatio(element.width) / 2;
    if (pointToSegmentDistance(point, element.start, element.end) <= maximumDistance) return true;
    if (element.shape === "arrow") {
      const [headLeft, headRight] = drawingArrowHeadPoints(element.start, element.end, element.width);
      return pointToSegmentDistance(point, element.end, headLeft) <= maximumDistance
        || pointToSegmentDistance(point, element.end, headRight) <= maximumDistance;
    }
    return false;
  }
  return pointInBounds(point, drawingElementBounds(element), tolerance);
}

export function topDrawingElementAt(elements: DrawingElement[], point: DrawingPoint, tolerance = 0.012) {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    if (hitTestDrawingElement(elements[index], point, tolerance)) return elements[index];
  }
  return null;
}

export function moveDrawingElement(element: DrawingElement, requestedDx: number, requestedDy: number): DrawingElement {
  const bounds = drawingElementBounds(element);
  const dx = clampDrawingNumber(requestedDx, -bounds.left, 1 - bounds.right);
  const dy = clampDrawingNumber(requestedDy, -bounds.top, 1 - bounds.bottom);
  const movePoint = (point: DrawingPoint) => ({ x: point.x + dx, y: point.y + dy });
  if (element.type === "stroke" || element.type === "erase") {
    return { ...element, points: element.points.map(movePoint) };
  }
  if (element.type === "text") {
    return { ...element, x: element.x + dx, y: element.y + dy };
  }
  return { ...element, start: movePoint(element.start), end: movePoint(element.end) };
}

function safeBounds(bounds: DrawingBounds): DrawingBounds {
  const right = Math.max(bounds.left + MIN_ELEMENT_SIZE, bounds.right);
  const bottom = Math.max(bounds.top + MIN_ELEMENT_SIZE, bounds.bottom);
  return {
    left: clampDrawingNumber(Math.min(bounds.left, 1 - MIN_ELEMENT_SIZE)),
    top: clampDrawingNumber(Math.min(bounds.top, 1 - MIN_ELEMENT_SIZE)),
    right: clampDrawingNumber(right, MIN_ELEMENT_SIZE, 1),
    bottom: clampDrawingNumber(bottom, MIN_ELEMENT_SIZE, 1)
  };
}

export function resizeDrawingElement(element: DrawingElement, originalBounds: DrawingBounds, requestedBounds: DrawingBounds): DrawingElement {
  const source = safeBounds(originalBounds);
  const target = safeBounds(requestedBounds);
  const sourceWidth = Math.max(MIN_ELEMENT_SIZE, source.right - source.left);
  const sourceHeight = Math.max(MIN_ELEMENT_SIZE, source.bottom - source.top);
  const targetWidth = Math.max(MIN_ELEMENT_SIZE, target.right - target.left);
  const targetHeight = Math.max(MIN_ELEMENT_SIZE, target.bottom - target.top);
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  const scale = Math.max(0.25, (scaleX + scaleY) / 2);
  const mapPoint = (point: DrawingPoint) => clampDrawingPoint({
    x: target.left + ((point.x - source.left) / sourceWidth) * targetWidth,
    y: target.top + ((point.y - source.top) / sourceHeight) * targetHeight
  });
  if (element.type === "stroke" || element.type === "erase") {
    return {
      ...element,
      points: element.points.map(mapPoint),
      width: clampDrawingNumber(
        element.width * scale,
        element.type === "erase" ? DRAWING_MIN_ERASER_WIDTH : DRAWING_MIN_STROKE_WIDTH,
        element.type === "erase" ? DRAWING_MAX_ERASER_WIDTH : DRAWING_COMPATIBLE_MAX_STROKE_WIDTH
      )
    };
  }
  if (element.type === "text") {
    return {
      ...element,
      x: target.left,
      y: target.top,
      fontSize: clampDrawingNumber(
        element.fontSize * scale,
        drawingTextSizeRatio(DRAWING_MIN_TEXT_SIZE),
        DRAWING_COMPATIBLE_MAX_TEXT_FONT_SIZE
      ),
      boxWidth: targetWidth,
      boxHeight: targetHeight
    };
  }
  if (element.shape === "line" || element.shape === "arrow") {
    const sourceCenter = {
      x: (source.left + source.right) / 2,
      y: (source.top + source.bottom) / 2
    };
    const targetCenter = {
      x: (target.left + target.right) / 2,
      y: (target.top + target.bottom) / 2
    };
    const directionX = Math.abs(element.end.x - element.start.x);
    const directionY = Math.abs(element.end.y - element.start.y);
    const directionWeight = directionX + directionY;
    const linearScale = Math.max(
      0.25,
      directionWeight > 0
        ? (directionX * scaleX + directionY * scaleY) / directionWeight
        : scale
    );
    const resizePoint = (point: DrawingPoint) => ({
      x: targetCenter.x + (point.x - sourceCenter.x) * linearScale,
      y: targetCenter.y + (point.y - sourceCenter.y) * linearScale
    });
    const resizedStart = resizePoint(element.start);
    const resizedEnd = resizePoint(element.end);
    const minimumX = Math.min(resizedStart.x, resizedEnd.x);
    const maximumX = Math.max(resizedStart.x, resizedEnd.x);
    const minimumY = Math.min(resizedStart.y, resizedEnd.y);
    const maximumY = Math.max(resizedStart.y, resizedEnd.y);
    const translateX = minimumX < 0 ? -minimumX : maximumX > 1 ? 1 - maximumX : 0;
    const translateY = minimumY < 0 ? -minimumY : maximumY > 1 ? 1 - maximumY : 0;
    return {
      ...element,
      start: { x: resizedStart.x + translateX, y: resizedStart.y + translateY },
      end: { x: resizedEnd.x + translateX, y: resizedEnd.y + translateY },
      width: clampDrawingNumber(element.width * linearScale, DRAWING_MIN_STROKE_WIDTH, DRAWING_COMPATIBLE_MAX_STROKE_WIDTH)
    };
  }
  return {
    ...element,
    start: mapPoint(element.start),
    end: mapPoint(element.end),
    width: clampDrawingNumber(element.width * scale, DRAWING_MIN_STROKE_WIDTH, DRAWING_COMPATIBLE_MAX_STROKE_WIDTH)
  };
}

export function eraseDrawingElements(
  elements: DrawingElement[],
  eraserPath: DrawingPoint[],
  eraserWidth: number,
  nextId: () => string
) {
  if (eraserPath.length === 0) return elements;
  return [
    ...elements,
    {
      id: nextId(),
      type: "erase",
      points: eraserPath.map(clampDrawingPoint),
      width: clampDrawingNumber(eraserWidth, DRAWING_MIN_ERASER_WIDTH, DRAWING_MAX_ERASER_WIDTH)
    } satisfies DrawingEraseElement
  ];
}

function drawSmoothStroke(ctx: CanvasRenderingContext2D, points: DrawingPoint[], width: number, height: number) {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x * width, points[0].y * height);
  if (points.length === 1) {
    ctx.lineTo(points[0].x * width + 0.01, points[0].y * height + 0.01);
    return;
  }
  if (points.length === 2) {
    ctx.lineTo(points[1].x * width, points[1].y * height);
    return;
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    ctx.quadraticCurveTo(
      current.x * width,
      current.y * height,
      ((current.x + next.x) / 2) * width,
      ((current.y + next.y) / 2) * height
    );
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x * width, last.y * height);
}

function drawArrowHead(ctx: CanvasRenderingContext2D, start: DrawingPoint, end: DrawingPoint, width: number, height: number, lineWidth: number) {
  const startX = start.x * width;
  const startY = start.y * height;
  const endX = end.x * width;
  const endY = end.y * height;
  const angle = Math.atan2(endY - startY, endX - startX);
  const headLength = Math.max(12, lineWidth * 3.2);
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - Math.cos(angle - Math.PI / 6) * headLength, endY - Math.sin(angle - Math.PI / 6) * headLength);
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - Math.cos(angle + Math.PI / 6) * headLength, endY - Math.sin(angle + Math.PI / 6) * headLength);
  ctx.stroke();
}

function drawClosedShape(ctx: CanvasRenderingContext2D, points: Array<[number, number]>) {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
  ctx.closePath();
  ctx.stroke();
}

function drawRoundedRectangle(ctx: CanvasRenderingContext2D, left: number, top: number, width: number, height: number) {
  const radius = Math.min(width, height) * 0.18;
  const right = left + width;
  const bottom = top + height;
  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.lineTo(right - radius, top);
  ctx.quadraticCurveTo(right, top, right, top + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(left + radius, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - radius);
  ctx.lineTo(left, top + radius);
  ctx.quadraticCurveTo(left, top, left + radius, top);
  ctx.closePath();
  ctx.stroke();
}

function regularPolygonPoints(centerX: number, centerY: number, radiusX: number, radiusY: number, sides: number, rotation = -Math.PI / 2) {
  return Array.from({ length: sides }, (_, index): [number, number] => {
    const angle = rotation + (index / sides) * Math.PI * 2;
    return [centerX + Math.cos(angle) * radiusX, centerY + Math.sin(angle) * radiusY];
  });
}

function starPoints(centerX: number, centerY: number, radiusX: number, radiusY: number) {
  return Array.from({ length: 10 }, (_, index): [number, number] => {
    const angle = -Math.PI / 2 + (index / 10) * Math.PI * 2;
    const scale = index % 2 === 0 ? 1 : 0.45;
    return [centerX + Math.cos(angle) * radiusX * scale, centerY + Math.sin(angle) * radiusY * scale];
  });
}

function fitPointsToBounds(points: Array<[number, number]>, left: number, top: number, width: number, height: number) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sourceWidth = Math.max(0.0001, maxX - minX);
  const sourceHeight = Math.max(0.0001, maxY - minY);
  return points.map((point): [number, number] => [
    left + ((point[0] - minX) / sourceWidth) * width,
    top + ((point[1] - minY) / sourceHeight) * height
  ]);
}

function drawHeart(ctx: CanvasRenderingContext2D, left: number, top: number, width: number, height: number) {
  const centerX = left + width / 2;
  const right = left + width;
  const bottom = top + height;
  ctx.beginPath();
  ctx.moveTo(centerX, bottom);
  ctx.bezierCurveTo(left + width * 0.16, top + height * 0.78, left, top + height * 0.53, left, top + height * 0.3);
  ctx.bezierCurveTo(left, top + height * 0.11, left + width * 0.1, top, left + width * 0.25, top);
  ctx.bezierCurveTo(left + width * 0.43, top, centerX, top + height * 0.34, centerX, top + height * 0.34);
  ctx.bezierCurveTo(centerX, top + height * 0.34, left + width * 0.57, top, left + width * 0.75, top);
  ctx.bezierCurveTo(left + width * 0.9, top, right, top + height * 0.11, right, top + height * 0.3);
  ctx.bezierCurveTo(right, top + height * 0.53, left + width * 0.84, top + height * 0.78, centerX, bottom);
  ctx.closePath();
  ctx.stroke();
}

export function drawDrawingElements(
  ctx: CanvasRenderingContext2D,
  elements: DrawingElement[],
  width: number,
  height: number,
  options: { background?: string | null; backgroundImage?: CanvasImageSource | null } = {}
) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const element of elements) {
    ctx.save();
    if (element.type === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(1, strokeWidthRatio(element.width) * Math.min(width, height));
      drawSmoothStroke(ctx, element.points, width, height);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    ctx.strokeStyle = element.color;
    ctx.fillStyle = element.color;
    if (element.type === "stroke") {
      ctx.lineWidth = Math.max(1, strokeWidthRatio(element.width) * Math.min(width, height));
      drawSmoothStroke(ctx, element.points, width, height);
      ctx.stroke();
    } else if (element.type === "text") {
      const fontSize = Math.max(DRAWING_MIN_TEXT_SIZE, element.fontSize * height);
      const lines = normalizedTextLines(element);
      const bounds = drawingElementBounds(element);
      const blockHeight = Math.max(1, lines.length) * DRAWING_TEXT_LINE_HEIGHT * fontSize;
      const boundsHeight = (bounds.bottom - bounds.top) * height;
      const contentTop = bounds.top * height + Math.max(0, (boundsHeight - blockHeight) / 2);
      const contentLeft = bounds.left * width + (element.boxWidth === undefined ? 0 : DRAWING_TEXT_HORIZONTAL_PADDING * width);
      ctx.font = `400 ${fontSize}px Inter, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      lines.forEach((line, index) => {
        const metrics = ctx.measureText(line || " ");
        const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
        const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
        const lineTop = contentTop + index * DRAWING_TEXT_LINE_HEIGHT * fontSize;
        const baselineY = lineTop + (DRAWING_TEXT_LINE_HEIGHT * fontSize - ascent - descent) / 2 + ascent;
        ctx.fillText(
          line || " ",
          contentLeft,
          baselineY
        );
      });
    } else {
      const startX = element.start.x * width;
      const startY = element.start.y * height;
      const endX = element.end.x * width;
      const endY = element.end.y * height;
      const left = Math.min(startX, endX);
      const top = Math.min(startY, endY);
      const shapeWidth = Math.abs(endX - startX);
      const shapeHeight = Math.abs(endY - startY);
      const centerX = (startX + endX) / 2;
      const centerY = (startY + endY) / 2;
      ctx.lineWidth = Math.max(1, strokeWidthRatio(element.width) * Math.min(width, height));
      if (element.shape === "rectangle") {
        ctx.strokeRect(left, top, shapeWidth, shapeHeight);
      } else if (element.shape === "roundedRectangle") {
        drawRoundedRectangle(ctx, left, top, shapeWidth, shapeHeight);
      } else if (element.shape === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(
          centerX,
          centerY,
          shapeWidth / 2,
          shapeHeight / 2,
          0,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      } else if (element.shape === "triangle") {
        drawClosedShape(ctx, [
          [centerX, top],
          [left + shapeWidth, top + shapeHeight],
          [left, top + shapeHeight]
        ]);
      } else if (element.shape === "diamond") {
        drawClosedShape(ctx, [
          [centerX, top],
          [left + shapeWidth, centerY],
          [centerX, top + shapeHeight],
          [left, centerY]
        ]);
      } else if (element.shape === "star") {
        drawClosedShape(ctx, fitPointsToBounds(
          starPoints(centerX, centerY, shapeWidth / 2, shapeHeight / 2),
          left,
          top,
          shapeWidth,
          shapeHeight
        ));
      } else if (element.shape === "hexagon") {
        drawClosedShape(ctx, fitPointsToBounds(
          regularPolygonPoints(centerX, centerY, shapeWidth / 2, shapeHeight / 2, 6),
          left,
          top,
          shapeWidth,
          shapeHeight
        ));
      } else if (element.shape === "heart") {
        drawHeart(ctx, left, top, shapeWidth, shapeHeight);
      } else {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        if (element.shape === "arrow") drawArrowHead(ctx, element.start, element.end, width, height, ctx.lineWidth);
      }
    }
    ctx.restore();
  }
  if (options.backgroundImage) {
    ctx.globalCompositeOperation = "destination-over";
    ctx.drawImage(options.backgroundImage, 0, 0, width, height);
  }
  if (options.background !== null) {
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = options.background ?? "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

export function exportDrawingBlob(elements: DrawingElement[], size = DRAWING_EXPORT_SIZE) {
  return new Promise<Blob>((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("绘图画布不可用"));
      return;
    }
    drawDrawingElements(ctx, elements, size, size, { background: null });
    const pixels = ctx.getImageData(0, 0, size, size).data;
    const bounds = drawingContentPixelBounds(pixels, size, size);
    if (!bounds) {
      reject(new Error("绘图内容为空"));
      return;
    }
    const contentWidth = bounds.right - bounds.left + 1;
    const contentHeight = bounds.bottom - bounds.top + 1;
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = contentWidth + DRAWING_EXPORT_PADDING * 2;
    outputCanvas.height = contentHeight + DRAWING_EXPORT_PADDING * 2;
    const outputContext = outputCanvas.getContext("2d");
    if (!outputContext) {
      reject(new Error("绘图画布不可用"));
      return;
    }
    outputContext.fillStyle = "#ffffff";
    outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    outputContext.drawImage(
      canvas,
      bounds.left,
      bounds.top,
      contentWidth,
      contentHeight,
      DRAWING_EXPORT_PADDING,
      DRAWING_EXPORT_PADDING,
      contentWidth,
      contentHeight
    );
    outputCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("绘图素材生成失败"));
    }, "image/png");
  });
}
