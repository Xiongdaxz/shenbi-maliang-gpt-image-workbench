import { describe, expect, test } from "bun:test";
import {
  RENDERING_SNAKE_GRID_SIZE,
  advanceRenderingSnake,
  createRenderingSnakeState,
  findRenderingSnakeFood,
  queueRenderingSnakeDirection,
  renderingSnakeDirectionForDrag,
  renderingSnakeDirectionForKey,
  toggleRenderingSnakePause,
  type RenderingSnakeState
} from "./renderingSnake";

describe("rendering snake", () => {
  test("starts centered and grows after reaching the first food", () => {
    let state = createRenderingSnakeState();
    expect(state.snake).toHaveLength(5);
    state = advanceRenderingSnake(state, () => 0);
    state = advanceRenderingSnake(state, () => 0);
    state = advanceRenderingSnake(state, () => 0);
    expect(state.score).toBe(1);
    expect(state.snake).toHaveLength(6);
    expect(state.status).toBe("running");
  });

  test("restores saved score as snake length without overlapping itself or food", () => {
    const boardSize = RENDERING_SNAKE_GRID_SIZE;
    for (const score of [1, 13, 17, 18, 100, 501, 10_000]) {
      const state = createRenderingSnakeState(score);
      expect(state.score).toBe(score);
      expect(state.snake).toHaveLength(Math.min(5 + score, boardSize * (boardSize - 1)));
      const occupied = new Set(state.snake.map(({ x, y }) => `${x}:${y}`));
      expect(occupied.size).toBe(state.snake.length);
      expect(occupied.has(`${state.food.x}:${state.food.y}`)).toBe(false);
      for (let index = 1; index < state.snake.length; index += 1) {
        const previous = state.snake[index - 1]!;
        const current = state.snake[index]!;
        const dx = Math.min(Math.abs(previous.x - current.x), boardSize - Math.abs(previous.x - current.x));
        const dy = Math.min(Math.abs(previous.y - current.y), boardSize - Math.abs(previous.y - current.y));
        expect(dx + dy).toBe(1);
      }
      expect(advanceRenderingSnake(state).status).toBe("running");
    }
    const resumed = createRenderingSnakeState(13);
    expect(resumed.snake).toHaveLength(18);
    expect(resumed.snake[0]).toEqual({ x: 17, y: 11 });
    expect(resumed.snake.at(-1)).toEqual({ x: 0, y: 11 });
  });

  test("supports arrows and WASD while rejecting an immediate reverse", () => {
    const initial = createRenderingSnakeState();
    expect(renderingSnakeDirectionForKey("ArrowUp")).toBe("up");
    expect(renderingSnakeDirectionForKey("a")).toBe("left");
    expect(renderingSnakeDirectionForKey("Enter")).toBeNull();
    expect(queueRenderingSnakeDirection(initial, "left")).toBe(initial);
    const queuedUp = queueRenderingSnakeDirection(initial, "up");
    expect(queuedUp.queuedDirection).toBe("up");
    expect(queueRenderingSnakeDirection(queuedUp, "left")).toBe(queuedUp);
  });

  test("maps a held pointer drag after it crosses the movement threshold", () => {
    expect(renderingSnakeDirectionForDrag(21, 0)).toBeNull();
    expect(renderingSnakeDirectionForDrag(24, 4)).toBe("right");
    expect(renderingSnakeDirectionForDrag(-30, 8)).toBe("left");
    expect(renderingSnakeDirectionForDrag(6, -26)).toBe("up");
    expect(renderingSnakeDirectionForDrag(4, 28)).toBe("down");
  });

  test("pauses without advancing and restarts from game over", () => {
    const paused = toggleRenderingSnakePause(createRenderingSnakeState());
    expect(paused.status).toBe("paused");
    expect(advanceRenderingSnake(paused)).toBe(paused);
    const restarted = toggleRenderingSnakePause({ ...paused, status: "game-over" });
    expect(restarted).toEqual(createRenderingSnakeState());
    expect(toggleRenderingSnakePause({ ...paused, score: 7, status: "game-over" }, true)).toEqual(createRenderingSnakeState(7));
  });

  test("wraps through every board edge without ending the game", () => {
    let state: RenderingSnakeState = {
      ...createRenderingSnakeState(),
      snake: [{ x: RENDERING_SNAKE_GRID_SIZE - 1, y: 4 }],
      food: { x: 0, y: 0 }
    };
    state = advanceRenderingSnake(state);
    expect(state.status).toBe("running");
    expect(state.snake[0]).toEqual({ x: 0, y: 4 });

    state = {
      ...state,
      direction: "up",
      queuedDirection: "up",
      snake: [{ x: 7, y: 0 }],
      food: { x: 0, y: 0 }
    };
    state = advanceRenderingSnake(state);
    expect(state.snake[0]).toEqual({ x: 7, y: RENDERING_SNAKE_GRID_SIZE - 1 });
  });

  test("still ends after colliding with itself", () => {
    const state = advanceRenderingSnake({
      ...createRenderingSnakeState(13),
      direction: "down",
      queuedDirection: "down",
      snake: [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 2 }],
      food: { x: 8, y: 8 }
    });
    expect(state.status).toBe("game-over");
    expect(state.score).toBe(0);
  });

  test("places food only on an available cell", () => {
    const onlyFree = { x: RENDERING_SNAKE_GRID_SIZE - 1, y: RENDERING_SNAKE_GRID_SIZE - 1 };
    const snake = Array.from({ length: RENDERING_SNAKE_GRID_SIZE * RENDERING_SNAKE_GRID_SIZE - 1 }, (_, index) => ({
      x: index % RENDERING_SNAKE_GRID_SIZE,
      y: Math.floor(index / RENDERING_SNAKE_GRID_SIZE)
    }));
    expect(findRenderingSnakeFood(snake, () => 0.5)).toEqual(onlyFree);
  });

  test("stops with a win after the final free cell is eaten", () => {
    const lastFood = { x: 1, y: 0 };
    const snake = [{ x: 0, y: 0 }];
    for (let y = 0; y < RENDERING_SNAKE_GRID_SIZE; y += 1) {
      for (let x = 0; x < RENDERING_SNAKE_GRID_SIZE; x += 1) {
        if ((x === 0 && y === 0) || (x === lastFood.x && y === lastFood.y)) continue;
        snake.push({ x, y });
      }
    }
    const won = advanceRenderingSnake({
      ...createRenderingSnakeState(),
      snake,
      food: lastFood
    });
    expect(won.status).toBe("won");
    expect(won.snake).toHaveLength(RENDERING_SNAKE_GRID_SIZE ** 2);
    expect(advanceRenderingSnake(won)).toBe(won);
    expect(toggleRenderingSnakePause(won, true)).toEqual(createRenderingSnakeState(won.score));
  });
});
