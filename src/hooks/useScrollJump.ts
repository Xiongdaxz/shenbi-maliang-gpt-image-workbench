import { useCallback, useEffect, useRef, useState } from "react";

export type ScrollJumpTarget = "top" | "bottom";

export type ScrollJumpState = {
  canScroll: boolean;
  target: ScrollJumpTarget;
  settled: boolean;
};

const HIDDEN_SCROLL_JUMP: ScrollJumpState = {
  canScroll: false,
  target: "bottom",
  settled: true
};

const MIN_SCROLL_JUMP_DISTANCE = 240;
const EDGE_SETTLE_DELAY_MS = 680;
const EDGE_SETTLE_MIN_DURATION_MS = 1_800;
const EDGE_SETTLE_STABLE_DURATION_MS = 360;
const EDGE_SETTLE_MAX_DURATION_MS = 3_000;

type UseScrollJumpOptions = {
  disabled?: boolean;
  loadToBottom?: {
    hasNextPage: boolean;
    isFetchNextPageError?: boolean;
    isFetchingNextPage: boolean;
  };
  syncKey?: string;
};

const USER_SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);

export function useScrollJump({ disabled = false, loadToBottom, syncKey = "" }: UseScrollJumpOptions = {}) {
  const lastScrollTopRef = useRef(0);
  const scrollStopTimerRef = useRef<number | null>(null);
  const loadingToBottomRef = useRef(false);
  const edgeSettleFrameRef = useRef<number | null>(null);
  const edgeSettleTimerRef = useRef<number | null>(null);
  const [scrollJump, setScrollJump] = useState<ScrollJumpState>(HIDDEN_SCROLL_JUMP);
  const [loadingToBottom, setLoadingToBottom] = useState(false);
  const stopLoadingToBottom = useCallback(() => {
    if (!loadingToBottomRef.current) return;
    loadingToBottomRef.current = false;
    setLoadingToBottom(false);
  }, []);
  const stopSettlingToEdge = useCallback(() => {
    if (edgeSettleTimerRef.current !== null) window.clearTimeout(edgeSettleTimerRef.current);
    if (edgeSettleFrameRef.current !== null) window.cancelAnimationFrame(edgeSettleFrameRef.current);
    edgeSettleTimerRef.current = null;
    edgeSettleFrameRef.current = null;
  }, []);
  const settleAtEdge = useCallback((target: ScrollJumpTarget) => {
    stopSettlingToEdge();
    edgeSettleTimerRef.current = window.setTimeout(() => {
      edgeSettleTimerRef.current = null;
      const startedAt = Date.now();
      let lastBoundary = -1;
      let lastBoundaryChangeAt = startedAt;
      const settle = () => {
        const root = document.documentElement;
        const boundary = target === "top" ? 0 : Math.max(0, root.scrollHeight - window.innerHeight);
        const now = Date.now();
        if (boundary !== lastBoundary) {
          lastBoundary = boundary;
          lastBoundaryChangeAt = now;
        }
        window.scrollTo({
          top: boundary,
          behavior: "auto"
        });

        const elapsed = now - startedAt;
        const boundaryStableFor = now - lastBoundaryChangeAt;
        if (
          elapsed >= EDGE_SETTLE_MAX_DURATION_MS
          || (elapsed >= EDGE_SETTLE_MIN_DURATION_MS && boundaryStableFor >= EDGE_SETTLE_STABLE_DURATION_MS)
        ) {
          edgeSettleFrameRef.current = null;
          return;
        }
        edgeSettleFrameRef.current = window.requestAnimationFrame(settle);
      };
      settle();
    }, EDGE_SETTLE_DELAY_MS);
  }, [stopSettlingToEdge]);

  useEffect(() => () => stopSettlingToEdge(), [stopSettlingToEdge]);

  useEffect(() => {
    if (disabled) {
      stopLoadingToBottom();
      stopSettlingToEdge();
      setScrollJump((value) => ({ ...value, canScroll: false, settled: true }));
      return;
    }

    const readScroll = () => {
      const root = document.documentElement;
      const scrollTop = window.scrollY || root.scrollTop;
      const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
      return {
        scrollTop,
        maxScroll,
        bottomDistance: Math.max(0, maxScroll - scrollTop),
        canScroll: maxScroll > MIN_SCROLL_JUMP_DISTANCE
      };
    };

    const syncScrollJump = (settled: boolean, direction?: "up" | "down") => {
      const state = readScroll();
      setScrollJump((current) => {
        let target = current.target;
        if (!state.canScroll || state.scrollTop <= 24) {
          target = "bottom";
        } else if (state.bottomDistance <= 24) {
          target = "top";
        } else if (direction === "up") {
          target = "top";
        } else if (direction === "down") {
          target = "bottom";
        }

        if (current.canScroll === state.canScroll && current.target === target && current.settled === settled) {
          return current;
        }
        return { canScroll: state.canScroll, target, settled };
      });
    };

    const handleScroll = () => {
      const { scrollTop } = readScroll();
      const previous = lastScrollTopRef.current;
      const direction = scrollTop > previous + 1 ? "down" : scrollTop < previous - 1 ? "up" : undefined;
      lastScrollTopRef.current = scrollTop;
      syncScrollJump(false, direction);

      if (scrollStopTimerRef.current) window.clearTimeout(scrollStopTimerRef.current);
      scrollStopTimerRef.current = window.setTimeout(() => {
        syncScrollJump(true);
      }, 320);
    };

    const handleResize = () => syncScrollJump(true);
    const handleUserScrollIntent = () => {
      stopLoadingToBottom();
      stopSettlingToEdge();
    };
    const handleUserScrollKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return;
      if (USER_SCROLL_KEYS.has(event.key)) handleUserScrollIntent();
    };
    let layoutSyncFrame: number | null = null;
    const scheduleLayoutSync = () => {
      if (layoutSyncFrame !== null) return;
      layoutSyncFrame = requestAnimationFrame(() => {
        layoutSyncFrame = null;
        syncScrollJump(true);
      });
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleLayoutSync);
    resizeObserver?.observe(document.documentElement);
    resizeObserver?.observe(document.body);

    lastScrollTopRef.current = readScroll().scrollTop;
    const frame = requestAnimationFrame(() => syncScrollJump(true));
    const lateSyncTimer = window.setTimeout(() => syncScrollJump(true), 520);

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    window.addEventListener("wheel", handleUserScrollIntent, { passive: true });
    window.addEventListener("touchstart", handleUserScrollIntent, { passive: true });
    window.addEventListener("pointerdown", handleUserScrollIntent, { passive: true });
    window.addEventListener("keydown", handleUserScrollKey);

    return () => {
      cancelAnimationFrame(frame);
      if (layoutSyncFrame !== null) cancelAnimationFrame(layoutSyncFrame);
      resizeObserver?.disconnect();
      window.clearTimeout(lateSyncTimer);
      if (scrollStopTimerRef.current) window.clearTimeout(scrollStopTimerRef.current);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("wheel", handleUserScrollIntent);
      window.removeEventListener("touchstart", handleUserScrollIntent);
      window.removeEventListener("pointerdown", handleUserScrollIntent);
      window.removeEventListener("keydown", handleUserScrollKey);
    };
  }, [disabled, stopLoadingToBottom, stopSettlingToEdge, syncKey]);

  useEffect(() => {
    if (!loadingToBottom) return;
    if (disabled || loadToBottom?.isFetchNextPageError) {
      stopLoadingToBottom();
      return;
    }

    let settleFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
      if (!loadToBottom?.hasNextPage && !loadToBottom?.isFetchingNextPage) {
        settleFrame = window.requestAnimationFrame(() => {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
          stopLoadingToBottom();
          settleAtEdge("bottom");
        });
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
    };
  }, [
    disabled,
    loadingToBottom,
    loadToBottom?.hasNextPage,
    loadToBottom?.isFetchNextPageError,
    loadToBottom?.isFetchingNextPage,
    settleAtEdge,
    stopLoadingToBottom,
    syncKey
  ]);

  const jumpToScrollEdge = () => {
    stopSettlingToEdge();
    if (scrollJump.target === "bottom" && loadToBottom?.hasNextPage) {
      loadingToBottomRef.current = true;
      setLoadingToBottom(true);
    } else {
      stopLoadingToBottom();
    }
    window.scrollTo({
      top: scrollJump.target === "top" ? 0 : document.documentElement.scrollHeight,
      behavior: "smooth"
    });
    settleAtEdge(scrollJump.target);
  };

  return { jumpToScrollEdge, loadingToBottom, scrollJump };
}
