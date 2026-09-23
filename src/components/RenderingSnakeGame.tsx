import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { Translate } from "../i18n";
import {
  RENDERING_SNAKE_GRID_SIZE,
  advanceRenderingSnake,
  createRenderingSnakeState,
  queueRenderingSnakeDirection,
  renderingSnakeDirectionForDrag,
  renderingSnakeDirectionForKey,
  toggleRenderingSnakePause,
  type RenderingSnakeDirection,
  type RenderingSnakeState
} from "../lib/renderingSnake";
import type { SnakeProgress } from "../api/workbench";
import { normalizeSnakeScoreMode } from "../lib/snakeScoreMode";
import { clearPendingSnakeScore, discardPendingSnakeScoreBeforeRevision, pendingSnakeScore, rememberPendingSnakeScore } from "../lib/snakePendingScore";
import { useToast } from "../ui";

const SNAKE_STEP_MS = 190;
const SNAKE_CANVAS_MAX_DPR = 1.5;
const SNAKE_VISUAL_INSET_RATIO = 0.008;

async function retrySnakeProgressRequest(request: () => Promise<SnakeProgress>): Promise<SnakeProgress> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 408 && error.status !== 429) throw error;
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw new Error("Snake score save failed");
}

const saveSnakeScoreWithRetry = (score: number, revision: number, userId: string) =>
  retrySnakeProgressRequest(() => api.saveSnakeProgress(score, revision, userId));

const resetSnakeScoreWithRetry = (userId: string) => retrySnakeProgressRequest(() => api.resetSnakeProgress(userId));

type Rgb = [number, number, number];

function readSnakeRgb(element: HTMLElement): Rgb {
  const values = getComputedStyle(element)
    .getPropertyValue("--rendering-dot-rgb")
    .split(",")
    .map((value) => Number(value.trim()));
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) return [47, 113, 235];
  return values.map((value) => Math.max(0, Math.min(255, value))) as Rgb;
}

function drawRenderingSnake(canvas: HTMLCanvasElement, state: RenderingSnakeState) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), SNAKE_CANVAS_MAX_DPR);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  const [red, green, blue] = readSnakeRgb(canvas);
  const insetX = rect.width * SNAKE_VISUAL_INSET_RATIO;
  const insetY = rect.height * SNAKE_VISUAL_INSET_RATIO;
  const cellWidth = (rect.width - insetX * 2) / (RENDERING_SNAKE_GRID_SIZE - 1);
  const cellHeight = (rect.height - insetY * 2) / (RENDERING_SNAKE_GRID_SIZE - 1);
  const cellSize = Math.min(cellWidth, cellHeight);
  const centerFor = (point: { x: number; y: number }) => ({
    x: insetX + point.x * cellWidth,
    y: insetY + point.y * cellHeight
  });

  context.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.14)`;
  for (let y = 0; y < RENDERING_SNAKE_GRID_SIZE; y += 1) {
    for (let x = 0; x < RENDERING_SNAKE_GRID_SIZE; x += 1) {
      context.beginPath();
      context.arc(insetX + x * cellWidth, insetY + y * cellHeight, Math.max(0.85, cellSize * 0.065), 0, Math.PI * 2);
      context.fill();
    }
  }

  if (state.status !== "won") {
    const foodCenter = centerFor(state.food);
    const foodGlow = context.createRadialGradient(foodCenter.x, foodCenter.y, 0, foodCenter.x, foodCenter.y, cellSize * 0.62);
    foodGlow.addColorStop(0, `rgba(${red}, ${green}, ${blue}, 0.32)`);
    foodGlow.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
    context.fillStyle = foodGlow;
    context.beginPath();
    context.arc(foodCenter.x, foodCenter.y, cellSize * 0.62, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    context.beginPath();
    context.arc(foodCenter.x, foodCenter.y, cellSize * 0.31, 0, Math.PI * 2);
    context.fill();
  }

  state.snake.forEach((point, index) => {
    const center = centerFor(point);
    const tailProgress = state.snake.length <= 1 ? 0 : index / (state.snake.length - 1);
    const radiusScale = Math.max(0.14, 0.36 - tailProgress * 0.2);
    context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${Math.max(0.58, 1 - index * 0.055)})`;
    context.beginPath();
    context.arc(center.x, center.y, cellSize * radiusScale, 0, Math.PI * 2);
    context.fill();
  });

  const head = centerFor(state.snake[0]);
  const eyeOffset = cellSize * 0.13;
  const eyeRadius = Math.max(1.05, cellSize * 0.055);
  const direction = state.direction;
  const horizontal = direction === "left" || direction === "right";
  const forward = direction === "left" || direction === "up" ? -1 : 1;
  const eyePoints = horizontal
    ? [{ x: head.x + forward * eyeOffset, y: head.y - eyeOffset }, { x: head.x + forward * eyeOffset, y: head.y + eyeOffset }]
    : [{ x: head.x - eyeOffset, y: head.y + forward * eyeOffset }, { x: head.x + eyeOffset, y: head.y + forward * eyeOffset }];
  context.fillStyle = "rgba(255, 255, 255, 0.94)";
  eyePoints.forEach((eye) => {
    context.beginPath();
    context.arc(eye.x, eye.y, eyeRadius, 0, Math.PI * 2);
    context.fill();
  });
}

export function RenderingSnakeGame({ onExit, onScoreChange, t }: {
  onExit: () => void;
  onScoreChange: (score: number | null) => void;
  t: Translate;
}) {
  const [game, setGame] = useState(createRenderingSnakeState);
  const previousGameStatusRef = useRef(game.status);
  const restartRequestedRef = useRef(false);
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 30_000 });
  const userId = me.data?.user?.id ?? "";
  const keepScore = Boolean(userId) && normalizeSnakeScoreMode(me.data?.user?.preferences.snakeScoreMode) === "keep";
  const progressKey = useMemo(() => ["snake-progress", userId] as const, [userId]);
  const progress = useQuery({
    queryKey: progressKey,
    queryFn: ({ signal }) => api.snakeProgress({ signal }),
    enabled: Boolean(userId) && keepScore,
    refetchOnWindowFocus: "always"
  });
  const ready = me.isSuccess && (!keepScore || progress.isSuccess);
  const [saveRound, setSaveRound] = useState(0);
  const [resetPending, setResetPending] = useState(false);
  const [resetFailed, setResetFailed] = useState(false);
  const previousKeepScoreRef = useRef(keepScore);
  const previousUserIdRef = useRef(userId);
  const handledGameOverRef = useRef(false);
  const resetPendingRef = useRef(false);
  const appliedProgressRef = useRef<{ userId: string; revision: number } | null>(null);
  const lastSubmittedScoreRef = useRef(0);
  const savingRef = useRef(false);
  const saveRetryTimerRef = useRef<number | null>(null);
  const saveRetryDelayRef = useRef(5_000);
  const saveFailureNotifiedRef = useRef(false);
  const saveBlockedRef = useRef(false);
  const saveScopeRef = useRef(0);
  const gameRef = useRef(game);
  const inputRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const headerScore = !ready ? null
    : previousKeepScoreRef.current !== keepScore ? 0
      : keepScore && progress.data && (appliedProgressRef.current?.userId !== userId || appliedProgressRef.current.revision !== progress.data.revision)
        ? progress.data.score
        : game.score;

  useEffect(() => { onScoreChange(headerScore); }, [headerScore, onScoreChange]);

  useEffect(() => {
    saveScopeRef.current += 1;
    savingRef.current = false;
    saveRetryDelayRef.current = 5_000;
    saveFailureNotifiedRef.current = false;
    saveBlockedRef.current = false;
    resetPendingRef.current = false;
    setResetPending(false);
    setResetFailed(false);
    return () => {
      saveScopeRef.current += 1;
      if (saveRetryTimerRef.current !== null) window.clearTimeout(saveRetryTimerRef.current);
      saveRetryTimerRef.current = null;
    };
  }, [keepScore, userId]);

  useEffect(() => {
    if (previousUserIdRef.current === userId) return;
    previousUserIdRef.current = userId;
    appliedProgressRef.current = null;
    lastSubmittedScoreRef.current = 0;
    setGame(createRenderingSnakeState());
  }, [userId]);

  useLayoutEffect(() => {
    const previousStatus = previousGameStatusRef.current;
    previousGameStatusRef.current = game.status;
    if (previousStatus === game.status) return;
    const shouldFocus = restartRequestedRef.current
      && (previousStatus === "game-over" || previousStatus === "won")
      && game.status === "running";
    restartRequestedRef.current = false;
    if (shouldFocus) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [game.status]);

  useEffect(() => {
    if (previousKeepScoreRef.current === keepScore) return;
    previousKeepScoreRef.current = keepScore;
    if (!keepScore) {
      appliedProgressRef.current = null;
      lastSubmittedScoreRef.current = 0;
      setGame(createRenderingSnakeState());
    }
  }, [keepScore]);

  useEffect(() => {
    if (!keepScore || !ready || !progress.data) return;
    if (appliedProgressRef.current?.userId !== userId || appliedProgressRef.current.revision !== progress.data.revision) {
      appliedProgressRef.current = { userId, revision: progress.data.revision };
      lastSubmittedScoreRef.current = progress.data.score;
      saveBlockedRef.current = false;
      saveRetryDelayRef.current = 5_000;
      if (saveRetryTimerRef.current !== null) window.clearTimeout(saveRetryTimerRef.current);
      saveRetryTimerRef.current = null;
      const pending = pendingSnakeScore(userId);
      discardPendingSnakeScoreBeforeRevision(userId, progress.data.revision);
      if (pending?.revision === progress.data.revision) clearPendingSnakeScore(userId, progress.data);
      const resumedScore = pending?.revision === progress.data.revision
        ? Math.max(progress.data.score, pending.score) : progress.data.score;
      setGame((current) => current.status === "game-over"
        ? { ...current, score: progress.data!.score }
        : createRenderingSnakeState(resumedScore));
    }
  }, [keepScore, progress.data, ready, userId]);

  useEffect(() => {
    if (!keepScore || !ready || !progress.data || game.status === "game-over") return;
    if (game.score > progress.data.score) rememberPendingSnakeScore(userId, game.score, progress.data.revision);
  }, [game.score, game.status, keepScore, progress.data, ready, userId]);

  useEffect(() => {
    if (
      !keepScore || !ready || !progress.data || savingRef.current || saveBlockedRef.current
      || saveRetryTimerRef.current !== null || game.score <= lastSubmittedScoreRef.current
    ) return;
    const revision = progress.data.revision;
    const score = game.score;
    const confirmedScore = progress.data.score;
    const scope = saveScopeRef.current;
    lastSubmittedScoreRef.current = score;
    savingRef.current = true;
    let deferred = false;
    saveSnakeScoreWithRetry(score, revision, userId)
      .then((saved) => {
        if (scope !== saveScopeRef.current) return;
        saveRetryDelayRef.current = 5_000;
        saveFailureNotifiedRef.current = false;
        clearPendingSnakeScore(userId, saved);
        queryClient.setQueryData<SnakeProgress>(progressKey, (current) =>
          current?.revision === saved.revision ? { ...current, score: Math.max(current.score, saved.score) } : current
        );
      })
      .catch((error) => {
        if (scope !== saveScopeRef.current) return;
        deferred = true;
        lastSubmittedScoreRef.current = Math.min(lastSubmittedScoreRef.current, confirmedScore);
        if (error instanceof ApiError && error.status === 409) {
          saveBlockedRef.current = true;
          void queryClient.invalidateQueries({ queryKey: progressKey });
          return;
        }
        if (!saveFailureNotifiedRef.current) {
          saveFailureNotifiedRef.current = true;
          showToast(t("rendering.snake.saveScoreFailed"), "error");
        }
        if (error instanceof ApiError && error.status < 500 && error.status !== 408 && error.status !== 429) {
          saveBlockedRef.current = true;
          return;
        }
        const delay = saveRetryDelayRef.current;
        saveRetryDelayRef.current = Math.min(delay * 2, 60_000);
        saveRetryTimerRef.current = window.setTimeout(() => {
          saveRetryTimerRef.current = null;
          setSaveRound((round) => round + 1);
        }, delay);
      })
      .finally(() => {
        if (scope !== saveScopeRef.current) return;
        savingRef.current = false;
        if (!deferred) setSaveRound((round) => round + 1);
      });
  }, [game.score, keepScore, ready, progress.data, progressKey, queryClient, saveRound, showToast, t, userId]);

  const resetAfterFailure = useCallback(async () => {
    if (!keepScore || resetPendingRef.current) return;
    const scope = saveScopeRef.current;
    resetPendingRef.current = true;
    setResetPending(true);
    setResetFailed(false);
    try {
      await queryClient.cancelQueries({ queryKey: progressKey });
      const reset = await resetSnakeScoreWithRetry(userId);
      if (scope !== saveScopeRef.current) return;
      const cached = queryClient.getQueryData<SnakeProgress>(progressKey);
      const current = cached && cached.revision > reset.revision ? cached : reset;
      appliedProgressRef.current = { userId, revision: current.revision };
      lastSubmittedScoreRef.current = current.score;
      saveBlockedRef.current = false;
      saveRetryDelayRef.current = 5_000;
      saveFailureNotifiedRef.current = false;
      if (saveRetryTimerRef.current !== null) window.clearTimeout(saveRetryTimerRef.current);
      saveRetryTimerRef.current = null;
      discardPendingSnakeScoreBeforeRevision(userId, current.revision);
      queryClient.setQueryData(progressKey, current);
    } catch {
      if (scope !== saveScopeRef.current) return;
      setResetFailed(true);
      showToast(t("rendering.snake.resetScoreFailed"), "error");
    } finally {
      if (scope !== saveScopeRef.current) return;
      resetPendingRef.current = false;
      setResetPending(false);
    }
  }, [keepScore, progressKey, queryClient, showToast, t, userId]);

  useEffect(() => {
    if (game.status !== "game-over") {
      handledGameOverRef.current = false;
      return;
    }
    if (handledGameOverRef.current) return;
    handledGameOverRef.current = true;
    if (keepScore) void resetAfterFailure();
  }, [game.status, keepScore, resetAfterFailure]);

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(focusFrame);
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const timer = window.setInterval(() => setGame((current) => advanceRenderingSnake(current)), SNAKE_STEP_MS);
    return () => window.clearInterval(timer);
  }, [ready]);

  useEffect(() => {
    gameRef.current = game;
    if (canvasRef.current) drawRenderingSnake(canvasRef.current, game);
  }, [game]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const paint = () => drawRenderingSnake(canvas, gameRef.current);
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => observer.disconnect();
  }, []);

  const queueDirection = useCallback((direction: RenderingSnakeDirection) => {
    setGame((current) => queueRenderingSnakeDirection(current, direction));
  }, []);

  const pauseOrRestart = () => {
    if (game.status === "game-over" && keepScore) {
      if (resetPendingRef.current) return;
      if (resetFailed || !handledGameOverRef.current) {
        handledGameOverRef.current = true;
        void resetAfterFailure();
        return;
      }
    }
    if (game.status === "game-over" || game.status === "won") restartRequestedRef.current = true;
    setGame((current) => toggleRenderingSnakePause(current, keepScore));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = renderingSnakeDirectionForKey(event.key);
    if (direction) {
      event.preventDefault();
      queueDirection(direction);
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      pauseOrRestart();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onExit();
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest(".rendering-snake-status-action")) return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start || (event.pointerType === "mouse" && event.buttons === 0)) return;
    const direction = renderingSnakeDirectionForDrag(event.clientX - start.x, event.clientY - start.y);
    if (!direction) return;
    queueDirection(direction);
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!start) return;
    const direction = renderingSnakeDirectionForDrag(event.clientX - start.x, event.clientY - start.y);
    if (direction) queueDirection(direction);
  };

  const statusLabel = game.status === "paused"
    ? t("rendering.snake.paused")
    : game.status === "game-over"
      ? t("rendering.snake.gameOver")
      : game.status === "won"
        ? t("rendering.snake.won")
      : "";
  const finished = game.status === "game-over" || game.status === "won";
  const resettingScore = game.status === "game-over" && keepScore && (resetPending || !handledGameOverRef.current);
  const statusHint = resettingScore
    ? t("rendering.snake.resettingScore")
    : game.status === "game-over" && keepScore && resetFailed
      ? t("rendering.snake.retryResetScore")
      : finished ? t("rendering.snake.restart") : "";

  return (
    <div
      ref={inputRef}
      className="rendering-snake-game"
      role="application"
      tabIndex={0}
      aria-label={t("rendering.snake.instructions")}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { pointerStartRef.current = null; }}
    >
      <canvas ref={canvasRef} className="rendering-snake-canvas" aria-hidden="true" />
      {!ready ? (
        <span className="rendering-snake-status">
          <strong>{t(progress.isError || me.isError ? "rendering.snake.loadScoreFailed" : "rendering.snake.loadingScore")}</strong>
        </span>
      ) : null}
      {ready && statusLabel ? finished ? (
        <button
          type="button"
          className="rendering-snake-status rendering-snake-status-action"
          disabled={resettingScore}
          onClick={pauseOrRestart}
        >
          <strong>{statusLabel}</strong>
          <small>{statusHint}</small>
        </button>
      ) : (
        <span className="rendering-snake-status"><strong>{statusLabel}</strong></span>
      ) : null}
      <span className="visually-hidden" aria-live="polite">
        {t("rendering.snake.score", { score: game.score })}
      </span>
    </div>
  );
}
