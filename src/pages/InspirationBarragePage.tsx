import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import {
  DEFAULT_LOGIN_ASSETS,
  LOGIN_BACKGROUND_AUTO_INTERVAL_MS,
  loginBackgroundsFor,
  normalizeLoginAssets,
  readLoginThemePreference,
  type LoginTheme
} from "../lib/loginAssets";
import { useWorkbench } from "../store/workbench";
import { useToast } from "../ui";

const BARRAGE_LANE_COUNT = 7;
const MIN_BARRAGE_LANE_ITEMS = 8;
const MAX_BARRAGE_LANE_ITEMS = 8;
const BARRAGE_SPEED_MIN = 0.55;
const BARRAGE_SPEED_MAX = 1.75;
const DEFAULT_BARRAGE_SPEED = BARRAGE_SPEED_MIN;
const BARRAGE_BACKGROUND_FADE_MS = 1600;

type BarrageLane = {
  id: string;
  items: string[];
  duration: number;
  delay: number;
  top: number;
};

type BarrageBackgroundLayer = {
  id: number;
  src: string;
  state: "current" | "next" | "leaving" | "idle";
  ready: boolean;
};

function normalizeCopies(copies: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of copies) {
    const text = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function buildBarrageLanes(copies: string[], speed: number): BarrageLane[] {
  if (copies.length === 0) return [];
  const durationScale = 1 / Math.max(0.45, Math.min(1.8, speed));
  return Array.from({ length: BARRAGE_LANE_COUNT }, (_, laneIndex) => {
    const itemCount = Math.max(MIN_BARRAGE_LANE_ITEMS, Math.min(MAX_BARRAGE_LANE_ITEMS, copies.length));
    const items = Array.from({ length: itemCount }, (_, itemIndex) => copies[(laneIndex * 5 + itemIndex * 3) % copies.length]);
    const duration = Math.round((58 + laneIndex * 5) * durationScale);
    return {
      id: `lane-${laneIndex}`,
      items,
      duration,
      delay: -Math.round((duration / BARRAGE_LANE_COUNT) * laneIndex),
      top: 11 + laneIndex * (78 / Math.max(1, BARRAGE_LANE_COUNT - 1))
    };
  });
}

function pickRandomBackground(backgrounds: string[], previous?: string) {
  if (backgrounds.length === 0) return "";
  const candidates = backgrounds.length > 1 ? backgrounds.filter((item) => item !== previous) : backgrounds;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? backgrounds[0] ?? "";
}

export function InspirationBarragePage() {
  const navigate = useNavigate();
  const startNewChatPromptOptimize = useWorkbench((state) => state.startNewChatPromptOptimize);
  const { showToast } = useToast();
  const [speed, setSpeed] = useState(DEFAULT_BARRAGE_SPEED);
  const [pausedLaneId, setPausedLaneId] = useState<string | null>(null);
  const loginTheme = useMemo<LoginTheme>(() => readLoginThemePreference(), []);
  const initialBackground = useMemo(() => {
    const sameThemeBackgrounds = loginBackgroundsFor(DEFAULT_LOGIN_ASSETS, loginTheme);
    const otherThemeBackgrounds = loginBackgroundsFor(DEFAULT_LOGIN_ASSETS, loginTheme === "light" ? "dark" : "light");
    return pickRandomBackground(Array.from(new Set([...sameThemeBackgrounds, ...otherThemeBackgrounds])));
  }, [loginTheme]);
  const backgroundRef = useRef(initialBackground);
  const [backgroundLayers, setBackgroundLayers] = useState<BarrageBackgroundLayer[]>(() => [
    { id: 0, src: initialBackground, state: "current", ready: false },
    { id: 1, src: "", state: "idle", ready: false }
  ]);
  const backgroundFadeTimerRef = useRef<number | null>(null);
  const dailyCopies = useQuery({
    queryKey: ["starter-copies", "today"],
    queryFn: api.starterCopiesToday
  });
  const branding = useQuery({
    queryKey: ["branding"],
    queryFn: api.branding
  });
  const loginBackgrounds = useMemo(() => {
    const assets = normalizeLoginAssets(branding.data?.loginAssets ?? DEFAULT_LOGIN_ASSETS);
    const sameThemeBackgrounds = loginBackgroundsFor(assets, loginTheme);
    const otherThemeBackgrounds = loginBackgroundsFor(assets, loginTheme === "light" ? "dark" : "light");
    return Array.from(new Set([...sameThemeBackgrounds, ...otherThemeBackgrounds].filter(Boolean)));
  }, [branding.data, loginTheme]);
  const copies = useMemo(() => normalizeCopies(dailyCopies.data?.copies ?? []), [dailyCopies.data?.copies]);
  const barrageLanes = useMemo(() => buildBarrageLanes(copies, speed), [copies, speed]);

  const updateBackground = useCallback((nextBackground: string) => {
    const currentBackground = backgroundRef.current;
    if (!nextBackground || nextBackground === currentBackground) return;
    if (backgroundFadeTimerRef.current) window.clearTimeout(backgroundFadeTimerRef.current);
    backgroundRef.current = nextBackground;
    setBackgroundLayers((layers) => {
      const currentLayer = layers.find((layer) => layer.state === "current") ?? layers[0];
      const nextLayer = layers.find((layer) => layer.id !== currentLayer.id) ?? layers[1];
      return layers.map((layer) => {
        if (layer.id === nextLayer.id) return { ...layer, src: nextBackground, state: "next", ready: false };
        if (layer.id === currentLayer.id) return { ...layer, state: "current" };
        return { ...layer, state: "idle" };
      });
    });
  }, []);

  useEffect(() => {
    const currentBackground = backgroundRef.current;
    if (loginBackgrounds.includes(currentBackground)) return;
    const nextBackground = pickRandomBackground(loginBackgrounds, currentBackground);
    if (!nextBackground) return;
    updateBackground(nextBackground);
  }, [loginBackgrounds, updateBackground]);

  useEffect(() => {
    if (loginBackgrounds.length < 2) return;
    const timer = window.setInterval(() => {
      const nextBackground = pickRandomBackground(loginBackgrounds, backgroundRef.current);
      updateBackground(nextBackground);
    }, LOGIN_BACKGROUND_AUTO_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loginBackgrounds, updateBackground]);

  useEffect(
    () => () => {
      if (backgroundFadeTimerRef.current) window.clearTimeout(backgroundFadeTimerRef.current);
    },
    []
  );

  const speedProgress = `${((speed - BARRAGE_SPEED_MIN) / (BARRAGE_SPEED_MAX - BARRAGE_SPEED_MIN)) * 100}%`;

  const handleBackgroundLoad = (layerId: number) => {
    const startFade = backgroundLayers.some((layer) => layer.id === layerId && layer.state === "next");
    setBackgroundLayers((layers) =>
      layers.map((layer) => {
        if (layer.id !== layerId) {
          return layer.state === "current" && layers.some((item) => item.id === layerId && item.state === "next")
            ? { ...layer, state: "leaving" }
            : layer;
        }
        return { ...layer, state: "current", ready: true };
      })
    );
    if (!startFade) return;
    if (backgroundFadeTimerRef.current) window.clearTimeout(backgroundFadeTimerRef.current);
    backgroundFadeTimerRef.current = window.setTimeout(() => {
      setBackgroundLayers((layers) => layers.map((layer) => (layer.state === "leaving" ? { ...layer, state: "idle" } : layer)));
      backgroundFadeTimerRef.current = null;
    }, BARRAGE_BACKGROUND_FADE_MS);
  };

  const useCopy = (text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    startNewChatPromptOptimize(prompt);
    showToast("已带入新对话，正在优化");
    navigate("/");
  };

  return (
    <section className="inspiration-barrage-page">
      {backgroundLayers.map((layer) =>
        layer.src && layer.state !== "idle" ? (
          <span
            key={layer.id}
            className={`inspiration-barrage-bg is-${layer.state}${layer.ready ? " is-ready" : ""}`}
            aria-hidden="true"
          >
            <img src={layer.src} alt="" draggable={false} onLoad={() => handleBackgroundLoad(layer.id)} />
          </span>
        ) : null
      )}
      <header className="inspiration-barrage-header">
        <button className="secondary-btn inspiration-barrage-back" type="button" onClick={() => navigate("/cases")}>
          <ArrowLeft size={17} />
          返回灵感空间
        </button>
        <label className="inspiration-barrage-speed">
          <span>速度</span>
          <input
            type="range"
            min={BARRAGE_SPEED_MIN}
            max={BARRAGE_SPEED_MAX}
            step="0.05"
            value={speed}
            style={{ "--barrage-speed-progress": speedProgress } as CSSProperties}
            onInput={(event) => setSpeed(Number(event.currentTarget.value))}
            onChange={(event) => setSpeed(Number(event.target.value))}
            aria-label="弹幕速度"
          />
          <strong>{speed.toFixed(2)}x</strong>
        </label>
      </header>
      <div className="inspiration-barrage-sky" aria-label="灵感弹幕">
        {dailyCopies.isLoading ? <div className="inspiration-barrage-state">加载今日文案...</div> : null}
        {!dailyCopies.isLoading && dailyCopies.error ? (
          <div className="inspiration-barrage-state">今日文案加载失败</div>
        ) : null}
        {!dailyCopies.isLoading && !dailyCopies.error && barrageLanes.length === 0 ? (
          <div className="inspiration-barrage-state">
            <strong>今日暂无后台生成文案</strong>
            <button className="secondary-btn" type="button" onClick={() => navigate("/cases")}>
              返回灵感空间
            </button>
          </div>
        ) : null}
        {barrageLanes.map((lane) => {
          return (
            <div
              key={lane.id}
              className={`inspiration-barrage-lane${pausedLaneId === lane.id ? " is-paused" : ""}`}
              aria-hidden="false"
              style={
                {
                  "--barrage-top": `${lane.top}%`,
                  "--barrage-duration": `${lane.duration}s`,
                  "--barrage-delay": `${lane.delay}s`
                } as CSSProperties
              }
            >
              <div className="inspiration-barrage-track">
                {[0, 1].map((groupIndex) => (
                  <div className="inspiration-barrage-track-group" key={`${lane.id}-group-${groupIndex}`}>
                    {lane.items.map((text, itemIndex) => (
                      <button
                        key={`${lane.id}-${groupIndex}-${itemIndex}-${text}`}
                        className="inspiration-barrage-card"
                        type="button"
                        onClick={() => useCopy(text)}
                        onFocus={() => setPausedLaneId(lane.id)}
                        onBlur={() => setPausedLaneId((current) => (current === lane.id ? null : current))}
                        onMouseEnter={() => setPausedLaneId(lane.id)}
                        onMouseLeave={() => setPausedLaneId((current) => (current === lane.id ? null : current))}
                        aria-label={`使用文案：${text}`}
                      >
                        <span className="inspiration-barrage-copy">{text}</span>
                        <span className="inspiration-barrage-tip">点击使用</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
