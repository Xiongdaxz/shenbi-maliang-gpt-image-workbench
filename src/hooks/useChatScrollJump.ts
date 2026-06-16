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
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scrollToCurrentTarget = (behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth") => {
      const frame = requestAnimationFrame(() => {
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
      const timer = window.setTimeout(() => scrollToCurrentTarget(behavior), delay);
      timers.push(timer);
    };
    const baseDelay = loadingTitle ? 180 : 120;
    scheduleScroll(baseDelay);
    scheduleScroll(baseDelay + 300);
    scheduleScroll(baseDelay + 680, reduceMotion ? "auto" : "smooth");
    scheduleScroll(baseDelay + 1200, "auto");

    let resizeSettledTimer = 0;
    let resizeObserver: ResizeObserver | null = null;
    const messageArea = messageEndRef.current?.parentElement;
    if (messageArea && typeof ResizeObserver !== "undefined") {
      const startedAt = performance.now();
      resizeObserver = new ResizeObserver(() => {
        if (performance.now() - startedAt > 2200) return;
        if (resizeSettledTimer) window.clearTimeout(resizeSettledTimer);
        resizeSettledTimer = window.setTimeout(() => scrollToCurrentTarget(reduceMotion ? "auto" : "smooth"), 80);
      });
      resizeObserver.observe(messageArea);
    }

    return () => {
      if (resizeSettledTimer) window.clearTimeout(resizeSettledTimer);
      resizeObserver?.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
      frames.forEach((frame) => cancelAnimationFrame(frame));
    };
  }, [imageEditorOpen, loadingTitle, messageListLength, renderItemCount, visiblePendingMessageId, sessionId, showStarter]);

  return { jumpToLoadingOrScrollEdge, loadingMessageRef, messageEndRef, scrollJump };
}
