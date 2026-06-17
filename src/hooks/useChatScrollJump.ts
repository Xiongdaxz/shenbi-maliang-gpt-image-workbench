import { useEffect, useMemo, useRef } from "react";
import { useScrollJump } from "./useScrollJump";

type UseChatScrollJumpOptions = {
  composerPreviewCount: number;
  imageEditorOpen: boolean;
  loadingTitle: string;
  messageListLength: number;
  renderItemCount: number;
  sessionId?: string;
  showStarter: boolean;
  visiblePendingMessageId?: string;
};

export function useChatScrollJump({
  composerPreviewCount,
  imageEditorOpen,
  loadingTitle,
  messageListLength,
  renderItemCount,
  sessionId,
  showStarter,
  visiblePendingMessageId
}: UseChatScrollJumpOptions) {
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const loadingMessageRef = useRef<HTMLDivElement | null>(null);
  const scrollJumpSyncKey = useMemo(
    () => [composerPreviewCount, loadingTitle, messageListLength, renderItemCount, sessionId ?? "", visiblePendingMessageId ?? ""].join("\u0000"),
    [composerPreviewCount, loadingTitle, messageListLength, renderItemCount, sessionId, visiblePendingMessageId]
  );
  const { jumpToScrollEdge, scrollJump } = useScrollJump({
    disabled: showStarter || imageEditorOpen,
    syncKey: scrollJumpSyncKey
  });
  const jumpToLoadingOrScrollEdge = () => {
    if (loadingTitle && loadingMessageRef.current) {
      loadingMessageRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    jumpToScrollEdge();
  };

  useEffect(() => {
    if (showStarter || imageEditorOpen) return;
    const frames: number[] = [];
    const timers: number[] = [];
    let userInterrupted = false;
    let resizeSettledTimer = 0;
    let resizeObserver: ResizeObserver | null = null;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clearScheduledScroll = () => {
      if (resizeSettledTimer) {
        window.clearTimeout(resizeSettledTimer);
        resizeSettledTimer = 0;
      }
      resizeObserver?.disconnect();
      resizeObserver = null;
      while (timers.length > 0) {
        const timer = timers.pop();
        if (timer) window.clearTimeout(timer);
      }
      while (frames.length > 0) {
        const frame = frames.pop();
        if (frame) cancelAnimationFrame(frame);
      }
    };
    const cancelAutoScroll = () => {
      userInterrupted = true;
      clearScheduledScroll();
    };
    const handleAutoScrollKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
        cancelAutoScroll();
      }
    };
    const scrollToCurrentTarget = (behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth") => {
      if (userInterrupted) return;
      const frame = requestAnimationFrame(() => {
        if (userInterrupted) return;
        const loadingTarget = loadingTitle ? loadingMessageRef.current : null;
        const target = loadingTarget ?? messageEndRef.current;
        target?.scrollIntoView({
          block: loadingTarget ? "center" : "end",
          behavior
        });
      });
      frames.push(frame);
    };
    const scheduleScroll = (delay: number, behavior?: ScrollBehavior) => {
      const timer = window.setTimeout(() => {
        if (!userInterrupted) scrollToCurrentTarget(behavior);
      }, delay);
      timers.push(timer);
    };
    const baseDelay = loadingTitle ? 180 : 120;
    scheduleScroll(baseDelay);
    scheduleScroll(baseDelay + 300);
    scheduleScroll(baseDelay + 680, reduceMotion ? "auto" : "smooth");
    scheduleScroll(baseDelay + 1200, "auto");

    const messageArea = messageEndRef.current?.parentElement;
    if (messageArea && typeof ResizeObserver !== "undefined") {
      const startedAt = performance.now();
      resizeObserver = new ResizeObserver(() => {
        if (userInterrupted) return;
        if (performance.now() - startedAt > 2200) return;
        if (resizeSettledTimer) window.clearTimeout(resizeSettledTimer);
        resizeSettledTimer = window.setTimeout(() => {
          if (!userInterrupted) scrollToCurrentTarget(reduceMotion ? "auto" : "smooth");
        }, 80);
      });
      resizeObserver.observe(messageArea);
    }
    window.addEventListener("wheel", cancelAutoScroll, { passive: true });
    window.addEventListener("touchmove", cancelAutoScroll, { passive: true });
    window.addEventListener("keydown", handleAutoScrollKey);

    return () => {
      window.removeEventListener("wheel", cancelAutoScroll);
      window.removeEventListener("touchmove", cancelAutoScroll);
      window.removeEventListener("keydown", handleAutoScrollKey);
      clearScheduledScroll();
    };
  }, [imageEditorOpen, loadingTitle, messageListLength, renderItemCount, visiblePendingMessageId, sessionId, showStarter]);

  return { jumpToLoadingOrScrollEdge, loadingMessageRef, messageEndRef, scrollJump };
}
