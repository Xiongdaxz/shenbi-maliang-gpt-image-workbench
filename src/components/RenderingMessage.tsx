import { RefreshCw } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import { RENDERING_MOTION_PAUSE_EVENT, getRenderingMotionPauseUntil } from "../lib/renderingMotion";

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

const RENDERING_DOT_COUNT = 15;
const RENDERING_FRAME_INTERVAL_MS = 1000 / 30;
const RENDERING_CANVAS_MAX_DPR = 1.5;
const RENDERING_DOT_LAYER_INSET = 0.03;
const RENDERING_DOT_LAYER_SCALE = 1.14;
const RENDERING_DOT_FILL_SCALE = 0.82;
const RENDERING_DOT_IDLE_SCALE = 0.86;
const RENDERING_DOT_CENTER = (RENDERING_DOT_COUNT - 1) / 2;
const RENDERING_DOTS = Array.from({ length: RENDERING_DOT_COUNT * RENDERING_DOT_COUNT }, (_, index) => {
  const row = Math.floor(index / RENDERING_DOT_COUNT);
  const col = index % RENDERING_DOT_COUNT;
  const distance = Math.hypot(row - RENDERING_DOT_CENTER, col - RENDERING_DOT_CENTER);
  const centerWeight = Math.max(0, 1 - distance / 8.8);
  const centerCurve = centerWeight * centerWeight * (3 - 2 * centerWeight);
  const edgeProgress = Math.max(0.42, Math.min(1, 1 - (distance - 7.2) / 3.2));
  const edgeCurve = edgeProgress * edgeProgress * (3 - 2 * edgeProgress);
  const ring = Math.min(7, Math.round(distance));
  return {
    id: index,
    x: (col / (RENDERING_DOT_COUNT - 1)) * 100,
    y: (row / (RENDERING_DOT_COUNT - 1)) * 100,
    ring,
    centerCurve,
    edgeCurve,
    size: 5,
    opacity: (0.2 + centerCurve * 0.66) * edgeCurve
  };
});

type RenderingFocusSpot = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  duration: number;
  pulse: number;
  phaseOffset: number;
};

type RenderingFocusState = {
  a: RenderingFocusSpot;
  b: RenderingFocusSpot;
};

type RenderingDotVisual = {
  opacity: number;
  scale: number;
  tone: number;
};

type RenderingRgb = [number, number, number];

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);
const randomInteger = (min: number, max: number) => Math.round(randomBetween(min, max));
const clampMotionPercent = (value: number) => Math.max(-6, Math.min(106, value));
const createMotionPulse = (now: number, spot: RenderingFocusSpot) => {
  const period = Math.max(1, spot.duration);
  const wave = 0.5 - Math.cos((now / period) * Math.PI * 2 + spot.phaseOffset) * 0.5;
  return smoothStep(wave);
};
const createMotionSpeed = (pulse: number) => 0.28 + smoothStep(Math.sin(pulse * Math.PI)) * 0.72;
const createMotionPace = (pulse: number) => 1 + Math.sin(pulse * Math.PI) * 0.42;

const createRandomFocusSize = () => {
  const mode = Math.random();
  if (mode < 0.34) return randomInteger(56, 68);
  if (mode < 0.82) return randomInteger(68, 84);
  return randomInteger(84, 96);
};

const createRandomFocusPosition = () => {
  const mode = Math.random();
  if (mode < 0.34) {
    const side = randomInteger(0, 3);
    const alongEdge = randomBetween(-2, 102);
    const edgeBand = randomBetween(5, 20);
    if (side === 0) return { x: alongEdge, y: edgeBand };
    if (side === 1) return { x: 100 - edgeBand, y: alongEdge };
    if (side === 2) return { x: alongEdge, y: 100 - edgeBand };
    return { x: edgeBand, y: alongEdge };
  }
  return {
    x: randomBetween(-2, 102),
    y: randomBetween(-2, 102)
  };
};

const createRandomFocusSpot = (avoid?: RenderingFocusSpot, minDistance = 38): RenderingFocusSpot => {
  let candidate: RenderingFocusSpot | null = null;
  for (let index = 0; index < 8; index += 1) {
    const position = createRandomFocusPosition();
    candidate = {
      x: position.x,
      y: position.y,
      size: createRandomFocusSize(),
      opacity: randomBetween(0.58, 0.86),
      duration: randomInteger(3200, 5600),
      pulse: 0.5,
      phaseOffset: randomBetween(0, Math.PI * 2)
    };
    if (!avoid || Math.hypot(candidate.x - avoid.x, candidate.y - avoid.y) >= minDistance) break;
  }
  const fallbackPosition = createRandomFocusPosition();
  return candidate ?? {
    x: fallbackPosition.x,
    y: fallbackPosition.y,
    size: createRandomFocusSize(),
    opacity: randomBetween(0.58, 0.86),
    duration: randomInteger(3200, 5600),
    pulse: 0.5,
    phaseOffset: randomBetween(0, Math.PI * 2)
  };
};

const createInitialFocusState = (): RenderingFocusState => {
  const a = createRandomFocusSpot();
  return {
    a,
    b: createRandomFocusSpot(a, 46)
  };
};

const smoothStep = (value: number) => {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
};

const addWithOverlapLift = (a: number, b: number, cap = 3) => Math.min(cap, a + b + Math.min(a, b));

const getFocusWave = (dot: (typeof RENDERING_DOTS)[number], focus: RenderingFocusSpot) => {
  const centerX = focus.x;
  const centerY = focus.y;
  const radius = Math.max(1, focus.size / 2);
  const distance = Math.hypot(dot.x - centerX, dot.y - centerY);
  const radial = Math.max(0, distance / radius);
  const clampedRadial = Math.min(1, radial);
  const mask = radial <= 0.48 ? 1 : smoothStep(1 - (radial - 0.48) / 0.64);
  const center = smoothStep(1 - clampedRadial / 0.96) * mask;
  const rim = smoothStep(1 - Math.abs(clampedRadial - 0.76) / 0.34) * mask * 0.22;
  return {
    center,
    mask,
    value: mask * focus.opacity,
    pulse: focus.pulse,
    speed: createMotionSpeed(focus.pulse),
    radial: clampedRadial,
    rim
  };
};

const getDotVisual = (dot: (typeof RENDERING_DOTS)[number], focusState: RenderingFocusState): RenderingDotVisual => {
  const waveA = getFocusWave(dot, focusState.a);
  const waveB = getFocusWave(dot, focusState.b);
  const focusCircle = Math.min(1, waveA.mask + waveB.mask);
  const centerBulge = addWithOverlapLift(waveA.center, waveB.center);
  const circularRim = addWithOverlapLift(waveA.rim, waveB.rim) * focusCircle;
  const focusEnergy = addWithOverlapLift(waveA.value, waveB.value);
  const motionEnergy = addWithOverlapLift(waveA.speed * waveA.mask, waveB.speed * waveB.mask);
  const mergeMask = smoothStep((Math.min(waveA.mask, waveB.mask) - 0.18) / 0.82);
  const mergeCore = smoothStep((Math.min(waveA.center, waveB.center) - 0.04) / 0.96);
  const scale = RENDERING_DOT_IDLE_SCALE + mergeMask * 0.92 + mergeCore * 0.36;
  const activeOpacity = 0.44 + focusCircle * 0.08 + Math.min(1.6, centerBulge) * 0.14 + motionEnergy * 0.1;
  const opacity = Math.min(0.96, activeOpacity * Math.pow(focusCircle, 1.22));
  const tone = Math.round(188 - Math.min(1, focusEnergy * 0.48 + motionEnergy * 0.42 + circularRim * 0.1) * 38);
  return {
    opacity,
    scale,
    tone
  };
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
  focusState: RenderingFocusState,
  themeRgb: RenderingRgb | null
) => {
  context.clearRect(0, 0, width, height);
  const innerWidth = width * (1 - RENDERING_DOT_LAYER_INSET * 2);
  const innerHeight = height * (1 - RENDERING_DOT_LAYER_INSET * 2);
  const cellWidth = innerWidth / RENDERING_DOT_COUNT;
  const cellHeight = innerHeight / RENDERING_DOT_COUNT;
  const centerX = width / 2;
  const centerY = height / 2;

  for (const dot of RENDERING_DOTS) {
    const row = Math.floor(dot.id / RENDERING_DOT_COUNT);
    const col = dot.id % RENDERING_DOT_COUNT;
    const gridX = width * RENDERING_DOT_LAYER_INSET + (col + 0.5) * cellWidth;
    const gridY = height * RENDERING_DOT_LAYER_INSET + (row + 0.5) * cellHeight;
    const x = centerX + (gridX - centerX) * RENDERING_DOT_LAYER_SCALE;
    const y = centerY + (gridY - centerY) * RENDERING_DOT_LAYER_SCALE;
    const visual = getDotVisual(dot, focusState);
    const radius = (dot.size * visual.scale * RENDERING_DOT_LAYER_SCALE * RENDERING_DOT_FILL_SCALE) / 2;
    const rgb = themeRgb ?? [visual.tone, visual.tone, visual.tone];

    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${visual.opacity})`;
    context.fill();
  }
};

export const RenderingMessage = memo(function RenderingMessage({ mode }: { mode: RenderingMode }) {
  const { t } = useI18n();
  const titles = useMemo(
    () => (mode === "edit" ? EDIT_LOADING_TITLE_KEYS : GENERATION_LOADING_TITLE_KEYS).map((key) => t(key)),
    [mode, t]
  );
  const [renderSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [titleIndex, setTitleIndex] = useState(0);
  const [titleSettled, setTitleSettled] = useState(true);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionPauseUntilRef = useRef(getRenderingMotionPauseUntil());
  const focusMotionRef = useRef<{
    current: RenderingFocusState;
    target: RenderingFocusState;
    lastFrameAt: number;
    retargetAt: {
      a: number;
      b: number;
    };
  } | null>(null);
  const variant = renderSeed % 3;

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
    const now = performance.now();
    const initial = createInitialFocusState();
    focusMotionRef.current = {
      current: initial,
      target: {
        a: createRandomFocusSpot(initial.b, 42),
        b: createRandomFocusSpot(initial.a, 42)
      },
      lastFrameAt: now,
      retargetAt: {
        a: now + randomInteger(3800, 6200),
        b: now + randomInteger(3800, 6200)
      }
    };

    const paint = (state: RenderingFocusState) => {
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
      drawRenderingDots(context, rect.width, rect.height, state, themeRgb);
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
      const motion = focusMotionRef.current;
      if (!motion) return;
      prefersReducedMotion = reducedMotionQuery.matches;
      if (prefersReducedMotion) {
        paint(motion.current);
        return;
      }
      if (!isIntersecting || document.visibilityState === "hidden") return;
      const currentTime = performance.now();
      if (currentTime < motionPauseUntilRef.current) {
        scheduleResume(motionPauseUntilRef.current);
        return;
      }
      motion.lastFrameAt = currentTime;
      scheduleLoop();
    }

    const updateSpot = (
      current: RenderingFocusSpot,
      target: RenderingFocusSpot,
      deltaMs: number,
      nowMs: number,
      avoid?: RenderingFocusSpot
    ) => {
      const dx = target.x - current.x;
      const dy = target.y - current.y;
      const distance = Math.hypot(current.x - target.x, current.y - target.y);
      const pulse = createMotionPulse(nowMs, current);
      if (distance < 9) {
        return {
          current: {
            ...current,
            pulse
          },
          target: createRandomFocusSpot(avoid, 38)
        };
      }
      const pace = createMotionPace(pulse);
      const progress = 1 - Math.exp((-deltaMs * pace) / (target.duration * 0.34));
      return {
        current: {
          x: clampMotionPercent(current.x + dx * progress),
          y: clampMotionPercent(current.y + dy * progress),
          size: current.size + (target.size - current.size) * progress,
          opacity: current.opacity + (target.opacity - current.opacity) * progress,
          duration: target.duration,
          pulse,
          phaseOffset: current.phaseOffset
        },
        target
      };
    };

    function tick(now: number) {
      animationFrame = 0;
      const motion = focusMotionRef.current;
      if (!mounted || !motion) return;
      prefersReducedMotion = reducedMotionQuery.matches;
      if (prefersReducedMotion || !isIntersecting || document.visibilityState === "hidden") {
        wake();
        return;
      }
      if (now < motionPauseUntilRef.current) {
        motion.lastFrameAt = now;
        scheduleResume(motionPauseUntilRef.current);
        return;
      }
      const elapsed = now - motion.lastFrameAt;
      if (elapsed < RENDERING_FRAME_INTERVAL_MS) {
        scheduleLoop();
        return;
      }
      const deltaMs = Math.min(80, Math.max(16, elapsed));
      motion.lastFrameAt = now;
      if (now >= motion.retargetAt.a) {
        motion.target.a = createRandomFocusSpot(motion.current.b, 38);
        motion.retargetAt.a = now + randomInteger(3800, 6200);
      }
      if (now >= motion.retargetAt.b) {
        motion.target.b = createRandomFocusSpot(motion.current.a, 38);
        motion.retargetAt.b = now + randomInteger(3800, 6200);
      }
      const previousTargetA = motion.target.a;
      const previousTargetB = motion.target.b;
      const nextA = updateSpot(motion.current.a, previousTargetA, deltaMs, now, motion.current.b);
      const nextB = updateSpot(motion.current.b, previousTargetB, deltaMs, now, motion.current.a);
      const aReachedTarget = nextA.target !== previousTargetA;
      const bReachedTarget = nextB.target !== previousTargetB;
      motion.current = {
        a: nextA.current,
        b: nextB.current
      };
      motion.target = {
        a: nextA.target,
        b: nextB.target
      };
      if (aReachedTarget) {
        motion.retargetAt.a = now + randomInteger(3800, 6200);
      }
      if (bReachedTarget) {
        motion.retargetAt.b = now + randomInteger(3800, 6200);
      }
      paint(motion.current);
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
      const motion = focusMotionRef.current;
      if (motion) paint(motion.current);
    };

    const intersectionObserver = new IntersectionObserver((entries) => {
      isIntersecting = entries.some((entry) => entry.isIntersecting);
      wake();
    });
    intersectionObserver.observe(card);

    const resizeObserver = new ResizeObserver(() => {
      const motion = focusMotionRef.current;
      if (motion && isIntersecting) paint(motion.current);
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

    paint(initial);
    wake();
    return () => {
      mounted = false;
      stopLoop();
      window.clearTimeout(resumeTimer);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      appearanceObserver.disconnect();
      window.removeEventListener(RENDERING_MOTION_PAUSE_EVENT, handleMotionPause);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      reducedMotionQuery.removeEventListener("change", handleReducedMotionChange);
    };
  }, [mode]);

  return (
    <article className="message assistant-message rendering-message" aria-live="polite">
      <span key={`${mode}-${titleIndex}`} className={cx("rendering-title", titleSettled && "settled")}>
        {titles[titleIndex] ?? titles[0]}
      </span>
      <div ref={cardRef} className={`rendering-card rendering-card-variant-${variant}`}>
        <div className="rendering-dot-field" aria-hidden="true">
          <canvas ref={canvasRef} className="rendering-dot-canvas" />
        </div>
      </div>
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
