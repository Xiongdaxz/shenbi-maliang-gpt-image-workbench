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
    if (showStarter) return;
    const frame = requestAnimationFrame(() => {
      messageEndRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [loadingTitle, messageListLength, visiblePendingMessageId, sessionId, showStarter]);

  return { jumpToLoadingOrScrollEdge, loadingMessageRef, messageEndRef, scrollJump };
}
