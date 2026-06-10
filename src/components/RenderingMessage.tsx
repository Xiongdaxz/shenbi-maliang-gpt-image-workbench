import { RefreshCw } from "lucide-react";
import { memo, type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "../lib/cx";

type RenderingMode = "generation" | "edit";

const GENERATION_LOADING_TITLES = [
  "正在理解你的描述",
  "正在构思画面结构",
  "正在铺设光影和色彩",
  "正在打磨主体细节",
  "正在调整整体质感",
  "正在处理边缘与层次",
  "正在让画面更自然",
  "正在完成最后润色"
];

const EDIT_LOADING_TITLES = [
  "正在分析原图内容",
  "正在理解修改意图",
  "正在融合参考元素",
  "正在重绘局部细节",
  "正在统一光影和色调",
  "正在修整过渡边缘",
  "正在检查画面一致性",
  "正在完成最后润色"
];

const RENDERING_DOT_COUNT = 15;
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

type RenderingDotStyle = CSSProperties & {
  "--dot-breath-delay": string;
  "--dot-breath-low": string;
  "--dot-breath-mid": string;
  "--dot-breath-peak": string;
  "--dot-breath-duration": string;
  "--dot-fill": string;
};

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

const getDotStyle = (dot: (typeof RENDERING_DOTS)[number], focusState: RenderingFocusState): RenderingDotStyle => {
  const waveA = getFocusWave(dot, focusState.a);
  const waveB = getFocusWave(dot, focusState.b);
  const dominant = waveA.value >= waveB.value ? { ...waveA, phaseDelay: 120 } : { ...waveB, phaseDelay: 520 };
  const focusCircle = Math.min(1, waveA.mask + waveB.mask);
  const centerBulge = addWithOverlapLift(waveA.center, waveB.center);
  const circularRim = addWithOverlapLift(waveA.rim, waveB.rim) * focusCircle;
  const focusEnergy = addWithOverlapLift(waveA.value, waveB.value);
  const motionEnergy = addWithOverlapLift(waveA.speed * waveA.mask, waveB.speed * waveB.mask);
  const focused = focusCircle > 0.08;
  const softMask = Math.pow(focusCircle, 1.28);
  const activeScale = Math.min(3.12, 0.74 + centerBulge * 0.24 + focusEnergy * 0.08 + motionEnergy * 0.74);
  const scale = 0.4 + (activeScale - 0.4) * softMask + circularRim * 0.03;
  const activeOpacity = 0.44 + focusCircle * 0.08 + Math.min(1.6, centerBulge) * 0.14 + motionEnergy * 0.1;
  const opacity = Math.min(0.96, activeOpacity * Math.pow(focusCircle, 1.22));
  const innerDotScale = focused ? 0.82 + Math.min(1.8, motionEnergy) * 0.1 : 0.72;
  const baseDelay = Math.round((7 - dot.ring) * 92);
  const breathDelay = focused ? dominant.phaseDelay : baseDelay;
  const tone = Math.round(188 - Math.min(1, focusEnergy * 0.48 + motionEnergy * 0.42 + circularRim * 0.1) * 38);
  return {
    width: dot.size,
    height: dot.size,
    opacity,
    transform: `scale(${scale})`,
    "--dot-breath-delay": `-${breathDelay}ms`,
    "--dot-breath-low": `${innerDotScale}`,
    "--dot-breath-mid": `${innerDotScale}`,
    "--dot-breath-peak": `${innerDotScale}`,
    "--dot-breath-duration": "2600ms",
    "--dot-fill": `rgb(var(--rendering-dot-rgb, ${tone}, ${tone}, ${tone}))`
  };
};

const applyDotStyle = (element: HTMLSpanElement | null, style: RenderingDotStyle) => {
  if (!element) return;
  element.style.width = `${style.width}px`;
  element.style.height = `${style.height}px`;
  element.style.opacity = String(style.opacity);
  element.style.transform = String(style.transform ?? "");
  element.style.setProperty("--dot-breath-delay", style["--dot-breath-delay"]);
  element.style.setProperty("--dot-breath-low", style["--dot-breath-low"]);
  element.style.setProperty("--dot-breath-mid", style["--dot-breath-mid"]);
  element.style.setProperty("--dot-breath-peak", style["--dot-breath-peak"]);
  element.style.setProperty("--dot-breath-duration", style["--dot-breath-duration"]);
  element.style.setProperty("--dot-fill", style["--dot-fill"]);
};

export const RenderingMessage = memo(function RenderingMessage({ mode }: { mode: RenderingMode }) {
  const titles = mode === "edit" ? EDIT_LOADING_TITLES : GENERATION_LOADING_TITLES;
  const initialFocusState = useMemo(createInitialFocusState, [mode]);
  const [renderSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [titleIndex, setTitleIndex] = useState(0);
  const [titleSettled, setTitleSettled] = useState(true);
  const dotStyles = useMemo(() => RENDERING_DOTS.map((dot) => getDotStyle(dot, initialFocusState)), [initialFocusState]);
  const dotRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const focusMotionRef = useRef<{
    current: RenderingFocusState;
    target: RenderingFocusState;
    lastFrameAt: number;
    lastPaintAt: number;
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
    let animationFrame = 0;
    let mounted = true;
    const now = performance.now();
    const initial = createInitialFocusState();
    focusMotionRef.current = {
      current: initial,
      target: {
        a: createRandomFocusSpot(initial.b, 42),
        b: createRandomFocusSpot(initial.a, 42)
      },
      lastFrameAt: now,
      lastPaintAt: 0,
      retargetAt: {
        a: now + randomInteger(3800, 6200),
        b: now + randomInteger(3800, 6200)
      }
    };

    const paint = (state: RenderingFocusState) => {
      for (const dot of RENDERING_DOTS) {
        applyDotStyle(dotRefs.current[dot.id] ?? null, getDotStyle(dot, state));
      }
    };

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

    const tick = (now: number) => {
      const motion = focusMotionRef.current;
      if (!mounted || !motion) return;
      const deltaMs = Math.min(80, Math.max(16, now - motion.lastFrameAt));
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
      if (now - motion.lastPaintAt > 33) {
        motion.lastPaintAt = now;
        paint(motion.current);
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    paint(initial);
    animationFrame = window.requestAnimationFrame(tick);
    return () => {
      mounted = false;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [mode]);

  return (
    <article className="message assistant-message rendering-message" aria-live="polite">
      <span key={`${mode}-${titleIndex}`} className={cx("rendering-title", titleSettled && "settled")}>
        {titles[titleIndex] ?? titles[0]}
      </span>
      <div className={`rendering-card rendering-card-variant-${variant}`}>
        <div className="rendering-dot-field" aria-hidden="true">
          <div className="rendering-dot-layer rendering-dot-layer-focus">
            {RENDERING_DOTS.map((dot, index) => (
              <span
                key={dot.id}
                ref={(element) => {
                  dotRefs.current[index] = element;
                }}
                style={dotStyles[index]}
              />
            ))}
          </div>
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
  const displayMessage = message.trim().endsWith("请稍候重试。")
    ? message.trim()
    : `${message.trim() || "图片任务失败"} 请稍候重试。`;
  return (
    <article className="message assistant-message rendering-message rendering-error-message" aria-live="polite">
      <span className="rendering-title settled">{mode === "edit" ? "图片编辑失败" : "图片生成失败"}</span>
      <div className="rendering-error-card">
        <strong>接口返回错误</strong>
        <p>{displayMessage}</p>
        {canRetry ? (
          <div className="rendering-error-actions">
            <button
              type="button"
              className={cx("rendering-error-retry-button", retrying && "retrying")}
              onClick={() => onRetry?.()}
              disabled={retrying}
              aria-label="重试此任务"
              title="重试"
            >
              <RefreshCw size={14} />
              <span>{retrying ? "重试中..." : "重试"}</span>
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
