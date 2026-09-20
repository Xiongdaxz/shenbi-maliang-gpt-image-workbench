import { ArrowLeft, RefreshCw } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import { RENDERING_MOTION_PAUSE_EVENT, getRenderingMotionPauseUntil } from "../lib/renderingMotion";
import { RenderingSnakeGame } from "./RenderingSnakeGame";

type RenderingMode = "generation" | "edit";

const GENERATION_LOADING_TITLE_KEYS = [
  "rendering.generation.understanding",
  "rendering.generation.composing",
  "rendering.generation.lighting",
  "rendering.generation.details",
  "rendering.generation.texture",
  "rendering.generation.edges",
  "rendering.generation.natural",
  "rendering.generation.finishing"
];

const EDIT_LOADING_TITLE_KEYS = [
  "rendering.edit.analyzing",
  "rendering.edit.intent",
  "rendering.edit.references",
  "rendering.edit.repainting",
  "rendering.edit.lighting",
  "rendering.edit.edges",
  "rendering.edit.consistency",
  "rendering.edit.finishing"
];

const RENDERING_DOT_COUNT = 35;
const RENDERING_FRAME_INTERVAL_MS = 1000 / 30;
const RENDERING_CANVAS_MAX_DPR = 1.5;
const RENDERING_DOT_STATIC_ELAPSED_MS = 9000;
const RENDERING_LIFEFORM_SPEED = 4.2;
const RENDERING_DOT_OPACITY_BUCKET_COUNT = 24;
const RENDERING_GAUSSIAN_LOOKUP_SIZE = 256;
const RENDERING_GAUSSIAN_MAX_DISTANCE = 8;
const renderingGaussianLookup = Array.from(
  { length: RENDERING_GAUSSIAN_LOOKUP_SIZE },
  (_, index) => Math.exp(-(index / (RENDERING_GAUSSIAN_LOOKUP_SIZE - 1)) * RENDERING_GAUSSIAN_MAX_DISTANCE)
);
const renderingDotBuckets = Array.from({ length: RENDERING_DOT_OPACITY_BUCKET_COUNT }, () => [] as number[]);
const smoothStep = (value: number) => {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
};
const RENDERING_DOTS = Array.from({ length: RENDERING_DOT_COUNT * RENDERING_DOT_COUNT }, (_, index) => {
  const row = Math.floor(index / RENDERING_DOT_COUNT);
  const col = index % RENDERING_DOT_COUNT;
  const x = col / (RENDERING_DOT_COUNT - 1);
  const y = row / (RENDERING_DOT_COUNT - 1);
  const edgeDistance = Math.min(x, y, 1 - x, 1 - y);
  return {
    x,
    y,
    edgeFade: 0.82 + smoothStep(edgeDistance / 0.16) * 0.18
  };
});

type RenderingRgb = [number, number, number];
type RenderingLifeform = {
  x: number;
  y: number;
  radius: number;
  scaleX: number;
  scaleY: number;
  cosTilt: number;
  sinTilt: number;
};

const renderingLifeformsAt = (elapsedMs: number): [RenderingLifeform, RenderingLifeform] => {
  const time = (elapsedMs / 1000) * RENDERING_LIFEFORM_SPEED;
  const tiltA = Math.sin(time * 0.17) * 0.38;
  const tiltB = Math.cos(time * 0.19 + 0.8) * 0.34;
  return [
    {
      x: 0.5 + Math.sin(time * 0.27) * 0.5,
      y: 0.5 + Math.cos(time * 0.23 + 1.9) * 0.5,
      radius: 0.35 + Math.sin(time * 0.39) * 0.03,
      scaleX: 1.08 + Math.sin(time * 0.31 + 0.2) * 0.08,
      scaleY: 0.94 + Math.cos(time * 0.29 + 0.6) * 0.06,
      cosTilt: Math.cos(tiltA),
      sinTilt: Math.sin(tiltA)
    },
    {
      x: 0.5 + Math.cos(time * 0.25 + 1.2) * 0.5,
      y: 0.5 + Math.sin(time * 0.29 + 0.4) * 0.5,
      radius: 0.36 + Math.cos(time * 0.37 + 0.7) * 0.03,
      scaleX: 0.95 + Math.cos(time * 0.27 + 0.9) * 0.06,
      scaleY: 1.09 + Math.sin(time * 0.33 + 0.5) * 0.08,
      cosTilt: Math.cos(tiltB),
      sinTilt: Math.sin(tiltB)
    }
  ];
};

const lifeformInfluence = (x: number, y: number, lifeform: RenderingLifeform) => {
  const dx = x - lifeform.x;
  const dy = y - lifeform.y;
  const inverseRadius = 1 / Math.max(0.01, lifeform.radius);
  const rotatedX = (dx * lifeform.cosTilt + dy * lifeform.sinTilt) / lifeform.scaleX;
  const rotatedY = (-dx * lifeform.sinTilt + dy * lifeform.cosTilt) / lifeform.scaleY;
  const scaledDistance = Math.min(
    RENDERING_GAUSSIAN_MAX_DISTANCE,
    (rotatedX * rotatedX + rotatedY * rotatedY) * inverseRadius * inverseRadius * 1.2
  );
  const lookupIndex = Math.round(
    (scaledDistance / RENDERING_GAUSSIAN_MAX_DISTANCE) * (RENDERING_GAUSSIAN_LOOKUP_SIZE - 1)
  );
  return renderingGaussianLookup[lookupIndex];
};

const readRenderingThemeRgb = (element: HTMLElement): RenderingRgb | null => {
  const channels = getComputedStyle(element)
    .getPropertyValue("--rendering-dot-rgb")
    .split(",")
    .map((value) => Number(value.trim()));
  if (channels.length !== 3 || channels.some((value) => !Number.isFinite(value))) return null;
  return channels.map((value) => Math.max(0, Math.min(255, value))) as RenderingRgb;
};

const drawRenderingDots = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  elapsedMs: number,
  themeRgb: RenderingRgb | null
) => {
  context.clearRect(0, 0, width, height);
  const cellWidth = width / (RENDERING_DOT_COUNT - 1);
  const cellHeight = height / (RENDERING_DOT_COUNT - 1);
  const cellSize = Math.min(cellWidth, cellHeight);
  const time = Math.max(0, elapsedMs);
  const [lifeformA, lifeformB] = renderingLifeformsAt(time);
  const rgb = themeRgb ?? [75, 139, 246];
  renderingDotBuckets.forEach((bucket) => { bucket.length = 0; });

  for (const dot of RENDERING_DOTS) {
    const x = dot.x * width;
    const y = dot.y * height;
    const influenceA = lifeformInfluence(dot.x, dot.y, lifeformA);
    const influenceB = lifeformInfluence(dot.x, dot.y, lifeformB);
    const lifeEnergy = 1 - (1 - influenceA) * (1 - influenceB);
    const radius = cellSize * (0.055 + lifeEnergy * 0.155);
    const opacity = Math.min(0.94, (0.18 + lifeEnergy * 0.76) * dot.edgeFade);
    const bucketIndex = Math.min(
      RENDERING_DOT_OPACITY_BUCKET_COUNT - 1,
      Math.max(0, Math.round((opacity / 0.94) * (RENDERING_DOT_OPACITY_BUCKET_COUNT - 1)))
    );
    renderingDotBuckets[bucketIndex].push(x, y, radius);
  }

  renderingDotBuckets.forEach((bucket, bucketIndex) => {
    if (bucket.length === 0) return;
    context.beginPath();
    for (let index = 0; index < bucket.length; index += 3) {
      const x = bucket[index];
      const y = bucket[index + 1];
      const radius = bucket[index + 2];
      context.moveTo(x + radius, y);
      context.arc(x, y, radius, 0, Math.PI * 2);
    }
    const opacity = (bucketIndex / (RENDERING_DOT_OPACITY_BUCKET_COUNT - 1)) * 0.94;
    context.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity})`;
    context.fill();
  });
};

export const RenderingMessage = memo(function RenderingMessage({
  mode,
  imageGroupLayout = false
}: {
  mode: RenderingMode;
  imageGroupLayout?: boolean;
}) {
  const { t } = useI18n();
  const titles = useMemo(
    () => (mode === "edit" ? EDIT_LOADING_TITLE_KEYS : GENERATION_LOADING_TITLE_KEYS).map((key) => t(key)),
    [mode, t]
  );
  const [titleIndex, setTitleIndex] = useState(0);
  const [titleSettled, setTitleSettled] = useState(true);
  const [snakeActive, setSnakeActive] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationElapsedRef = useRef(0);
  const motionPauseUntilRef = useRef(getRenderingMotionPauseUntil());

  useEffect(() => {
    animationElapsedRef.current = 0;
    setSnakeActive(false);
  }, [mode]);

  useEffect(() => {
    setTitleIndex(0);
    setTitleSettled(false);
    let timer = 0;
    let clearSettledTimer = 0;
    const scheduleNext = (index: number) => {
      if (index >= titles.length - 1) return;
      const delay = 5200 + Math.round(Math.random() * 4200);
      timer = window.setTimeout(() => {
        setTitleSettled(false);
        clearSettledTimer = window.setTimeout(() => setTitleSettled(true), 120);
        setTitleIndex((value) => {
          const nextIndex = Math.min(value + 1, titles.length - 1);
          scheduleNext(nextIndex);
          return nextIndex;
        });
      }, delay);
    };
    clearSettledTimer = window.setTimeout(() => setTitleSettled(true), 120);
    scheduleNext(0);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearSettledTimer);
    };
  }, [mode, titles.length]);

  useEffect(() => {
    if (snakeActive) return undefined;
    const card = cardRef.current;
    const canvas = canvasRef.current;
    if (!card || !canvas) return undefined;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return undefined;

    let animationFrame = 0;
    let resumeTimer = 0;
    let mounted = true;
    let isIntersecting = true;
    let canvasWidth = 0;
    let canvasHeight = 0;
    let canvasDpr = 0;
    let themeRgb = readRenderingThemeRgb(card);
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let prefersReducedMotion = reducedMotionQuery.matches;
    let animationClockStartedAt = performance.now();
    let animationClockRunning = false;
    let lastFrameAt = animationClockStartedAt;

    const currentAnimationElapsed = (now = performance.now()) => (
      animationElapsedRef.current
      + (animationClockRunning ? Math.max(0, now - animationClockStartedAt) : 0)
    );

    const stopAnimationClock = (now = performance.now()) => {
      if (!animationClockRunning) return;
      animationElapsedRef.current = currentAnimationElapsed(now);
      animationClockRunning = false;
    };

    const startAnimationClock = (now = performance.now()) => {
      animationClockStartedAt = now;
      animationClockRunning = true;
    };

    const paint = (elapsedMs = currentAnimationElapsed()) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), RENDERING_CANVAS_MAX_DPR);
      const nextWidth = Math.max(1, Math.round(rect.width * dpr));
      const nextHeight = Math.max(1, Math.round(rect.height * dpr));
      if (nextWidth !== canvasWidth || nextHeight !== canvasHeight || dpr !== canvasDpr) {
        canvasWidth = nextWidth;
        canvasHeight = nextHeight;
        canvasDpr = dpr;
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRenderingDots(
        context,
        rect.width,
        rect.height,
        prefersReducedMotion ? RENDERING_DOT_STATIC_ELAPSED_MS : elapsedMs,
        themeRgb
      );
    };

    const stopLoop = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    };

    const scheduleLoop = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(tick);
    };

    const scheduleResume = (until: number) => {
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(wake, Math.max(16, until - performance.now() + 16));
    };

    function wake() {
      if (!mounted) return;
      stopLoop();
      window.clearTimeout(resumeTimer);
      const currentTime = performance.now();
      stopAnimationClock(currentTime);
      prefersReducedMotion = reducedMotionQuery.matches;
      if (prefersReducedMotion) {
        paint(RENDERING_DOT_STATIC_ELAPSED_MS);
        return;
      }
      if (!isIntersecting || document.visibilityState === "hidden") return;
      if (currentTime < motionPauseUntilRef.current) {
        scheduleResume(motionPauseUntilRef.current);
        return;
      }
      startAnimationClock(currentTime);
      lastFrameAt = currentTime;
      scheduleLoop();
    }

    function tick(now: number) {
      animationFrame = 0;
      if (!mounted) return;
      prefersReducedMotion = reducedMotionQuery.matches;
      if (prefersReducedMotion || !isIntersecting || document.visibilityState === "hidden") {
        wake();
        return;
      }
      if (now < motionPauseUntilRef.current) {
        wake();
        return;
      }
      const elapsed = now - lastFrameAt;
      if (elapsed < RENDERING_FRAME_INTERVAL_MS) {
        scheduleLoop();
        return;
      }
      lastFrameAt = now;
      paint(currentAnimationElapsed(now));
      scheduleLoop();
    }

    const handleMotionPause = (event: Event) => {
      const detail = (event as CustomEvent<{ until?: number }>).detail;
      const until = typeof detail?.until === "number" ? detail.until : performance.now() + 800;
      motionPauseUntilRef.current = Math.max(motionPauseUntilRef.current, until);
      wake();
    };
    const handleVisibilityChange = () => wake();
    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      prefersReducedMotion = event.matches;
      wake();
    };
    const refreshTheme = () => {
      themeRgb = readRenderingThemeRgb(card);
      paint();
    };

    const intersectionObserver = new IntersectionObserver((entries) => {
      isIntersecting = entries.some((entry) => entry.isIntersecting);
      wake();
    });
    intersectionObserver.observe(card);

    const resizeObserver = new ResizeObserver(() => {
      if (isIntersecting) paint();
    });
    resizeObserver.observe(card);

    const appearanceObserver = new MutationObserver(refreshTheme);
    appearanceObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-appearance"]
    });

    window.addEventListener(RENDERING_MOTION_PAUSE_EVENT, handleMotionPause);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);

    paint(animationElapsedRef.current);
    wake();
    return () => {
      mounted = false;
      stopAnimationClock();
      stopLoop();
      window.clearTimeout(resumeTimer);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      appearanceObserver.disconnect();
      window.removeEventListener(RENDERING_MOTION_PAUSE_EVENT, handleMotionPause);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      reducedMotionQuery.removeEventListener("change", handleReducedMotionChange);
    };
  }, [mode, snakeActive]);

  const title = (
    <span
      key={`${mode}-${titleIndex}-${snakeActive ? "game" : "loading"}`}
      className={cx("rendering-title", snakeActive && "game-help", titleSettled && "settled")}
      aria-live={imageGroupLayout ? "polite" : undefined}
    >
        {snakeActive ? (
          <>
            <button
              type="button"
              className="rendering-game-back"
              onClick={() => setSnakeActive(false)}
              aria-label={t("rendering.snake.backToLoading")}
            >
              <ArrowLeft size={16} />
            </button>
            <span>{t("rendering.snake.shortInstructions")}</span>
          </>
        ) : titles[titleIndex] ?? titles[0]}
    </span>
  );
  const card = (
    <div ref={cardRef} className={cx("rendering-card", snakeActive && "is-snake-active")}>
      {snakeActive ? (
        <RenderingSnakeGame t={t} onExit={() => setSnakeActive(false)} />
      ) : (
        <>
          <div className="rendering-dot-field" aria-hidden="true">
            <canvas ref={canvasRef} className="rendering-dot-canvas" />
          </div>
          <button
            type="button"
            className="rendering-game-start"
            aria-label={t("rendering.playSnake")}
            onClick={() => setSnakeActive(true)}
          />
        </>
      )}
    </div>
  );

  if (imageGroupLayout) return <>{title}{card}</>;
  return (
    <article className="message assistant-message rendering-message" aria-live="polite">
      {title}
      {card}
    </article>
  );
});

export function RenderingErrorMessage({
  mode,
  message,
  canRetry = false,
  retrying = false,
  onRetry
}: {
  mode: RenderingMode;
  message: string;
  canRetry?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const retryHint = t("rendering.retryHint");
  const trimmedMessage = message.trim();
  const displayMessage = trimmedMessage.endsWith(retryHint)
    ? trimmedMessage
    : t("rendering.errorMessage", { message: trimmedMessage || t("rendering.taskFailed"), retryHint });
  return (
    <article className="message assistant-message rendering-message rendering-error-message" aria-live="polite">
      <span className="rendering-title settled">{mode === "edit" ? t("rendering.editFailed") : t("rendering.generationFailed")}</span>
      <div className="rendering-error-card">
        <strong>{t("rendering.apiError")}</strong>
        <p>{displayMessage}</p>
        {canRetry ? (
          <div className="rendering-error-actions">
            <button
              type="button"
              className={cx("rendering-error-retry-button", retrying && "retrying")}
              onClick={() => onRetry?.()}
              disabled={retrying}
              aria-label={t("rendering.retryTask")}
              title={t("chatMessages.retry")}
            >
              <RefreshCw size={14} />
              <span>{retrying ? t("rendering.retrying") : t("chatMessages.retry")}</span>
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
