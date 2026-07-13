import { useEffect, useRef, useState } from "react";

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

type UseScrollJumpOptions = {
  disabled?: boolean;
  syncKey?: string;
};

export function useScrollJump({ disabled = false, syncKey = "" }: UseScrollJumpOptions = {}) {
  const lastScrollTopRef = useRef(0);
  const scrollStopTimerRef = useRef<number | null>(null);
  const [scrollJump, setScrollJump] = useState<ScrollJumpState>(HIDDEN_SCROLL_JUMP);

  useEffect(() => {
    if (disabled) {
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

    return () => {
      cancelAnimationFrame(frame);
      if (layoutSyncFrame !== null) cancelAnimationFrame(layoutSyncFrame);
      resizeObserver?.disconnect();
      window.clearTimeout(lateSyncTimer);
      if (scrollStopTimerRef.current) window.clearTimeout(scrollStopTimerRef.current);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [disabled, syncKey]);

  const jumpToScrollEdge = () => {
    window.scrollTo({
      top: scrollJump.target === "top" ? 0 : document.documentElement.scrollHeight,
      behavior: "smooth"
    });
  };

  return { jumpToScrollEdge, scrollJump };
}
