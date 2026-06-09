export type StrokePoint = {
  x: number;
  y: number;
};

export type Stroke = {
  points: StrokePoint[];
  sizeRatio: number;
};

export type SelectionOverlaySnapshot = {
  fillCanvas: HTMLCanvasElement;
  contours: Array<Array<{ x: number; y: number }>>;
};

export const BRUSH_MIN_SIZE = 14;
export const BRUSH_MAX_SIZE = 120;
export const BRUSH_SIZE_STEP = 10;
export const SELECTION_DASH_PATTERN = [4, 5];
export const SELECTION_DASH_PATTERN_LENGTH = SELECTION_DASH_PATTERN.reduce((total, value) => total + value, 0);
export const SELECTION_DASH_SPEED_MS = 120;

const CONTOUR_SIMPLIFY_EPSILON = 2.5;

export function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function renderMaskStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
  color: string
) {
  if (stroke.points.length === 0) return;
  const lineWidth = Math.max(4, stroke.sizeRatio * Math.min(width, height));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
  for (const point of stroke.points.slice(1)) {
    ctx.lineTo(point.x * width, point.y * height);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSmoothSelectionPath(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) {
  if (stroke.points.length === 0) return;
  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, ctx.lineWidth / 2, 0, Math.PI * 2);
    return;
  }

  const points = stroke.points;
  ctx.beginPath();
  ctx.moveTo(points[0].x * width, points[0].y * height);
  if (points.length === 2) {
    ctx.lineTo(points[1].x * width, points[1].y * height);
    return;
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = ((current.x + next.x) / 2) * width;
    const midY = ((current.y + next.y) / 2) * height;
    ctx.quadraticCurveTo(current.x * width, current.y * height, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x * width, last.y * height);
}

function contourArea(points: Array<{ x: number; y: number }>) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function pointLineDistance(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy);
}

function simplifyPolyline(points: Array<{ x: number; y: number }>, epsilon: number): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;
  let farthestIndex = 0;
  let farthestDistance = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointLineDistance(points[index], first, last);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }
  if (farthestDistance <= epsilon) return [first, last];
  const left = simplifyPolyline(points.slice(0, farthestIndex + 1), epsilon);
  const right = simplifyPolyline(points.slice(farthestIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

function simplifyContour(points: Array<{ x: number; y: number }>) {
  if (points.length < 3) return;
  const withoutCollinear: Array<{ x: number; y: number }> = [];
  const direction = (from: { x: number; y: number }, to: { x: number; y: number }) => ({
    x: Math.sign(to.x - from.x),
    y: Math.sign(to.y - from.y)
  });
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const incoming = direction(previous, current);
    const outgoing = direction(current, next);
    if (incoming.x === outgoing.x && incoming.y === outgoing.y) continue;
    withoutCollinear.push(current);
  }
  if (withoutCollinear.length < 3) return points;
  const simplified = simplifyPolyline([...withoutCollinear, withoutCollinear[0]], CONTOUR_SIMPLIFY_EPSILON).slice(0, -1);
  return simplified.length >= 3 ? simplified : withoutCollinear;
}

function drawClosedContourPath(ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) {
  const contour = simplifyContour(points);
  if (!contour || contour.length < 3) return;
  const first = contour[0];
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const point of contour.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

function extractMaskContours(maskCanvas: HTMLCanvasElement) {
  const width = maskCanvas.width;
  const height = maskCanvas.height;
  const step = 2;
  const cols = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) return [];
  const alpha = maskCtx.getImageData(0, 0, width, height).data;
  const inside = new Uint8Array(cols * rows);
  const isInsideCell = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
    return inside[row * cols + col] === 1;
  };
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = Math.min(width - 1, Math.round(col * step + step / 2));
      const y = Math.min(height - 1, Math.round(row * step + step / 2));
      inside[row * cols + col] = alpha[(y * width + x) * 4 + 3] > 16 ? 1 : 0;
    }
  }

  type Segment = { from: string; to: string; points: [{ x: number; y: number }, { x: number; y: number }] };
  const segments: Segment[] = [];
  const outgoing = new Map<string, number[]>();
  const key = (x: number, y: number) => `${x},${y}`;
  const addSegment = (fromPoint: { x: number; y: number }, toPoint: { x: number; y: number }) => {
    const from = key(fromPoint.x, fromPoint.y);
    const to = key(toPoint.x, toPoint.y);
    const index = segments.length;
    segments.push({ from, to, points: [fromPoint, toPoint] });
    const items = outgoing.get(from) ?? [];
    items.push(index);
    outgoing.set(from, items);
  };

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!isInsideCell(col, row)) continue;
      const x0 = col * step;
      const y0 = row * step;
      const x1 = Math.min(width, x0 + step);
      const y1 = Math.min(height, y0 + step);
      if (!isInsideCell(col, row - 1)) addSegment({ x: x1, y: y0 }, { x: x0, y: y0 });
      if (!isInsideCell(col + 1, row)) addSegment({ x: x1, y: y1 }, { x: x1, y: y0 });
      if (!isInsideCell(col, row + 1)) addSegment({ x: x0, y: y1 }, { x: x1, y: y1 });
      if (!isInsideCell(col - 1, row)) addSegment({ x: x0, y: y0 }, { x: x0, y: y1 });
    }
  }

  const used = new Uint8Array(segments.length);
  const contours: Array<Array<{ x: number; y: number }>> = [];
  for (let index = 0; index < segments.length; index += 1) {
    if (used[index]) continue;
    const segment = segments[index];
    const contour = [segment.points[0], segment.points[1]];
    used[index] = 1;
    let currentKey = segment.to;
    while (currentKey !== segment.from) {
      const nextIndex = (outgoing.get(currentKey) ?? []).find((item) => !used[item]);
      if (nextIndex === undefined) break;
      const nextSegment = segments[nextIndex];
      used[nextIndex] = 1;
      contour.push(nextSegment.points[1]);
      currentKey = nextSegment.to;
    }
    if (contour.length > 8) {
      contours.push(contourArea(contour) > 0 ? contour.reverse() : contour);
    }
  }
  return contours;
}

export function selectionOverlayKey(strokes: Stroke[], width: number, height: number) {
  return `${width}x${height}|${strokes
    .map((stroke) => `${stroke.sizeRatio.toFixed(5)}:${stroke.points.map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`).join("/")}`)
    .join("|")}`;
}

export function buildSelectionOverlaySnapshot(strokes: Stroke[], width: number, height: number): SelectionOverlaySnapshot | null {
  const selectedStrokes = strokes.filter((stroke) => stroke.points.length > 1);
  if (selectedStrokes.length === 0) return null;
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) return null;

  maskCtx.lineCap = "round";
  maskCtx.lineJoin = "round";
  maskCtx.strokeStyle = "#000";
  maskCtx.fillStyle = "#000";
  for (const stroke of selectedStrokes) {
    maskCtx.lineWidth = Math.max(4, stroke.sizeRatio * Math.min(width, height));
    drawSmoothSelectionPath(maskCtx, stroke, width, height);
    maskCtx.stroke();
  }

  const fillCanvas = document.createElement("canvas");
  fillCanvas.width = width;
  fillCanvas.height = height;
  const fillCtx = fillCanvas.getContext("2d");
  if (!fillCtx) return null;
  fillCtx.fillStyle = "rgba(91, 121, 239, 0.66)";
  fillCtx.fillRect(0, 0, width, height);
  fillCtx.globalCompositeOperation = "destination-in";
  fillCtx.drawImage(maskCanvas, 0, 0);

  const contours = extractMaskContours(maskCanvas);
  return { fillCanvas, contours };
}

export function renderSelectionOverlay(ctx: CanvasRenderingContext2D, snapshot: SelectionOverlaySnapshot, dashOffset: number) {
  ctx.drawImage(snapshot.fillCanvas, 0, 0);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.setLineDash(SELECTION_DASH_PATTERN);
  ctx.lineDashOffset = -dashOffset;
  for (const contour of snapshot.contours) {
    drawClosedContourPath(ctx, contour);
    ctx.stroke();
  }
  ctx.restore();
}
