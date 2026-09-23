export const RENDERING_SNAKE_GRID_SIZE = 23;

export type RenderingSnakeDirection = "up" | "down" | "left" | "right";
export type RenderingSnakeStatus = "running" | "paused" | "game-over" | "won";

export type RenderingSnakePoint = {
  x: number;
  y: number;
};

export type RenderingSnakeState = {
  direction: RenderingSnakeDirection;
  food: RenderingSnakePoint;
  queuedDirection: RenderingSnakeDirection;
  score: number;
  snake: RenderingSnakePoint[];
  status: RenderingSnakeStatus;
};

const DIRECTION_VECTORS: Record<RenderingSnakeDirection, RenderingSnakePoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

const OPPOSITE_DIRECTIONS: Record<RenderingSnakeDirection, RenderingSnakeDirection> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left"
};

const samePoint = (left: RenderingSnakePoint, right: RenderingSnakePoint) => (
  left.x === right.x && left.y === right.y
);

export function createRenderingSnakeState(initialScore = 0): RenderingSnakeState {
  const center = Math.floor(RENDERING_SNAKE_GRID_SIZE / 2);
  const score = Number.isSafeInteger(initialScore) && initialScore > 0 ? initialScore : 0;
  if (score === 0) {
    return {
      direction: "right",
      queuedDirection: "right",
      snake: Array.from({ length: 5 }, (_, index) => ({ x: center - index, y: center })),
      food: { x: center + 3, y: center },
      score: 0,
      status: "running"
    };
  }

  // Leave one whole row free so even a high saved score starts with a safe move and food cell.
  const length = Math.min(5 + score, RENDERING_SNAKE_GRID_SIZE * (RENDERING_SNAKE_GRID_SIZE - 1));
  const headX = Math.max(center, Math.min(length - 1, RENDERING_SNAKE_GRID_SIZE - 1));
  const snake: RenderingSnakePoint[] = [];
  for (let row = 0; row < RENDERING_SNAKE_GRID_SIZE - 1 && snake.length < length; row += 1) {
    const y = (center + row) % RENDERING_SNAKE_GRID_SIZE;
    for (let offset = 0; offset < RENDERING_SNAKE_GRID_SIZE && snake.length < length; offset += 1) {
      const column = row % 2 === 0 ? offset : RENDERING_SNAKE_GRID_SIZE - 1 - offset;
      snake.push({ x: (headX - column + RENDERING_SNAKE_GRID_SIZE) % RENDERING_SNAKE_GRID_SIZE, y });
    }
  }
  const direction: RenderingSnakeDirection = length < RENDERING_SNAKE_GRID_SIZE ? "right" : "up";
  const forward = direction === "right"
    ? { x: (headX + 1) % RENDERING_SNAKE_GRID_SIZE, y: center }
    : { x: headX, y: (center - 1 + RENDERING_SNAKE_GRID_SIZE) % RENDERING_SNAKE_GRID_SIZE };
  const preferredFood = direction === "right"
    ? { x: (headX + 3) % RENDERING_SNAKE_GRID_SIZE, y: center }
    : { x: headX, y: (center - 3 + RENDERING_SNAKE_GRID_SIZE) % RENDERING_SNAKE_GRID_SIZE };
  return {
    direction,
    queuedDirection: direction,
    snake,
    food: snake.some((point) => samePoint(point, preferredFood)) ? forward : preferredFood,
    score,
    status: "running"
  };
}

export function renderingSnakeDirectionForKey(key: string): RenderingSnakeDirection | null {
  switch (key.toLowerCase()) {
    case "arrowup":
    case "w":
      return "up";
    case "arrowdown":
    case "s":
      return "down";
    case "arrowleft":
    case "a":
      return "left";
    case "arrowright":
    case "d":
      return "right";
    default:
      return null;
  }
}

export function renderingSnakeDirectionForDrag(
  deltaX: number,
  deltaY: number,
  threshold = 22
): RenderingSnakeDirection | null {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < threshold) return null;
  if (Math.abs(deltaX) > Math.abs(deltaY)) return deltaX > 0 ? "right" : "left";
  return deltaY > 0 ? "down" : "up";
}

export function queueRenderingSnakeDirection(
  state: RenderingSnakeState,
  direction: RenderingSnakeDirection
): RenderingSnakeState {
  if (
    state.status === "game-over"
    || state.status === "won"
    || state.queuedDirection === direction
    || state.queuedDirection !== state.direction
    || OPPOSITE_DIRECTIONS[state.direction] === direction
  ) return state;
  return { ...state, queuedDirection: direction };
}

export function toggleRenderingSnakePause(state: RenderingSnakeState, keepScore = false): RenderingSnakeState {
  if (state.status === "game-over" || state.status === "won") return createRenderingSnakeState(keepScore ? state.score : 0);
  return { ...state, status: state.status === "paused" ? "running" : "paused" };
}

export function findRenderingSnakeFood(
  snake: RenderingSnakePoint[],
  random: () => number = Math.random
): RenderingSnakePoint {
  const occupied = new Set(snake.map((point) => `${point.x}:${point.y}`));
  const available: RenderingSnakePoint[] = [];
  for (let y = 0; y < RENDERING_SNAKE_GRID_SIZE; y += 1) {
    for (let x = 0; x < RENDERING_SNAKE_GRID_SIZE; x += 1) {
      if (!occupied.has(`${x}:${y}`)) available.push({ x, y });
    }
  }
  if (available.length === 0) return snake[0] ?? { x: 0, y: 0 };
  const randomIndex = Math.floor(Math.max(0, Math.min(0.999999, random())) * available.length);
  return available[randomIndex] ?? available[0];
}

export function advanceRenderingSnake(
  state: RenderingSnakeState,
  random: () => number = Math.random
): RenderingSnakeState {
  if (state.status !== "running") return state;

  const direction = state.queuedDirection;
  const vector = DIRECTION_VECTORS[direction];
  const currentHead = state.snake[0];
  const nextHead = {
    x: (currentHead.x + vector.x + RENDERING_SNAKE_GRID_SIZE) % RENDERING_SNAKE_GRID_SIZE,
    y: (currentHead.y + vector.y + RENDERING_SNAKE_GRID_SIZE) % RENDERING_SNAKE_GRID_SIZE
  };
  const ateFood = samePoint(nextHead, state.food);
  const collisionBody = ateFood ? state.snake : state.snake.slice(0, -1);
  const hitSelf = collisionBody.some((point) => samePoint(point, nextHead));

  if (hitSelf) return { ...state, direction, score: 0, status: "game-over" };

  const snake = [nextHead, ...state.snake];
  if (!ateFood) snake.pop();
  const filledBoard = ateFood && snake.length === RENDERING_SNAKE_GRID_SIZE * RENDERING_SNAKE_GRID_SIZE;
  return {
    ...state,
    direction,
    snake,
    food: ateFood && !filledBoard ? findRenderingSnakeFood(snake, random) : state.food,
    score: ateFood ? state.score + 1 : state.score,
    status: filledBoard ? "won" : state.status
  };
}
