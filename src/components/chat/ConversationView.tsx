import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { messageThreadRenderKey, type ChatRenderItem, type MessageRevision } from "../../lib/chatRender";
import { formatImageAnnotationMessageDisplayText } from "../../lib/imageAnnotations";
import type { ImageJob, Message, WorkImage } from "../../types";
import { ChatMessage, ChatMessageThread } from "./ChatMessages";

type MessageEditPayload = {
  rootId: string;
  userMessage: Message;
  assistantMessage: Message | null;
  prompt: string;
};

type ConversationViewProps = {
  items: ChatRenderItem[];
  mode?: "workspace" | "shared-readonly";
  sharedToken?: string;
  downloadBaseName?: string;
  isSubmitting?: boolean;
  failedJobIds?: ReadonlySet<string>;
  jobStatuses?: ReadonlyMap<string, ImageJob["status"]>;
  retryingJobId?: string;
  itemStyle?: (index: number) => CSSProperties | undefined;
  onOpenEditor?: (image: WorkImage) => void;
  onAddAsset?: (image: WorkImage) => void;
  onRetryJob?: (jobId: string) => void;
  onSelectVersion?: (revision: MessageRevision) => void;
  onSubmitEdit?: (context: { branchId: string; rootId: string }, payload: MessageEditPayload) => void;
};

const ignoreImage = (_image: WorkImage) => undefined;
const ignoreEdit = (_payload: MessageEditPayload) => undefined;

type ConversationNavigatorEntry = {
  itemIndex: number;
  message: Message;
  preview: string;
};

function selectedUserMessage(item: ChatRenderItem) {
  if (item.type === "message") return item.message.role === "user" ? item.message : null;
  const maxIndex = Math.max(0, item.versions.length - 1);
  const activeIndex = typeof item.activeVersionIndex === "number"
    ? Math.max(0, Math.min(item.activeVersionIndex, maxIndex))
    : maxIndex;
  return item.versions[activeIndex]?.user ?? item.versions[maxIndex]?.user ?? null;
}

function navigatorMessagePreview(message: Message) {
  const content = formatImageAnnotationMessageDisplayText(message.content, message.metadata);
  return content.replace(/\s+/g, " ").trim();
}

function visibleAssistantImages(items: ChatRenderItem[]) {
  const messages: Message[] = [];
  const seen = new Set<string>();
  const append = (message: Message | null | undefined) => {
    if (!message || message.role !== "assistant" || !message.imageId || !message.imageUrl || seen.has(message.id)) return;
    seen.add(message.id);
    messages.push(message);
  };

  for (const item of items) {
    if (item.type === "message") {
      append(item.message);
      continue;
    }
    const maxIndex = Math.max(0, item.versions.length - 1);
    const activeIndex = typeof item.activeVersionIndex === "number"
      ? Math.max(0, Math.min(item.activeVersionIndex, maxIndex))
      : maxIndex;
    const revision = item.versions[activeIndex] ?? item.versions[maxIndex];
    if (!revision) continue;
    const assistants = revision.assistants.length > 0
      ? revision.assistants
      : revision.assistant
        ? [revision.assistant]
        : [];
    [...assistants]
      .sort((left, right) => {
        const leftIndex = Math.trunc(Number(left.metadata?.imageIndex)) || Number.MAX_SAFE_INTEGER;
        const rightIndex = Math.trunc(Number(right.metadata?.imageIndex)) || Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
      })
      .forEach(append);
  }
  return messages;
}

export function ConversationView({
  items,
  mode = "workspace",
  sharedToken,
  downloadBaseName,
  isSubmitting = false,
  failedJobIds,
  jobStatuses,
  retryingJobId,
  itemStyle,
  onOpenEditor,
  onAddAsset,
  onRetryJob,
  onSelectVersion,
  onSubmitEdit
}: ConversationViewProps) {
  const { t } = useI18n();
  const turnElementsRef = useRef(new Map<string, HTMLDivElement>());
  const navigatorRailRef = useRef<HTMLDivElement>(null);
  const navigatorCardRef = useRef<HTMLDivElement>(null);
  const navigatorRailButtonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const navigatorCardButtonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const navigatorJumpTargetRef = useRef("");
  const navigatorJumpFallbackTimerRef = useRef<number | null>(null);
  const navigatorJumpSettleTimerRef = useRef<number | null>(null);
  const [activeTurnId, setActiveTurnId] = useState("");
  const sharedResultMessages = useMemo(
    () => (mode === "shared-readonly" ? visibleAssistantImages(items) : []),
    [items, mode]
  );
  const navigatorEntries = useMemo(
    () =>
      items
        .map((item, itemIndex) => {
          const message = selectedUserMessage(item);
          return message
            ? { itemIndex, message, preview: navigatorMessagePreview(message) }
            : null;
        })
        .filter((entry): entry is ConversationNavigatorEntry => Boolean(entry)),
    [items]
  );
  const navigatorEntriesByItemIndex = useMemo(
    () => new Map(navigatorEntries.map((entry) => [entry.itemIndex, entry])),
    [navigatorEntries]
  );
  const showNavigator = navigatorEntries.length > 4;
  const activeNavigatorIndex = Math.max(
    0,
    navigatorEntries.findIndex((entry) => entry.message.id === activeTurnId)
  );

  const centerNavigatorItem = useCallback((index: number, behavior: ScrollBehavior = "auto") => {
    const centerInContainer = (container: HTMLDivElement | null, button: HTMLButtonElement | null) => {
      if (!container || !button) return;
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const targetScrollTop = Math.max(
        0,
        Math.min(maxScrollTop, button.offsetTop + button.offsetHeight / 2 - container.clientHeight / 2)
      );
      if (Math.abs(container.scrollTop - targetScrollTop) < 1) return;
      container.scrollTo({ top: targetScrollTop, behavior });
    };

    centerInContainer(navigatorRailRef.current, navigatorRailButtonsRef.current[index]);
    centerInContainer(navigatorCardRef.current, navigatorCardButtonsRef.current[index]);
  }, []);

  const clearNavigatorJump = useCallback((messageId?: string) => {
    if (messageId && navigatorJumpTargetRef.current !== messageId) return;
    navigatorJumpTargetRef.current = "";
    if (navigatorJumpFallbackTimerRef.current !== null) {
      window.clearTimeout(navigatorJumpFallbackTimerRef.current);
      navigatorJumpFallbackTimerRef.current = null;
    }
    if (navigatorJumpSettleTimerRef.current !== null) {
      window.clearTimeout(navigatorJumpSettleTimerRef.current);
      navigatorJumpSettleTimerRef.current = null;
    }
  }, []);

  const updateActiveTurn = useCallback(() => {
    if (!showNavigator) return;
    const viewportCenter = window.innerHeight / 2;
    const jumpTargetId = navigatorJumpTargetRef.current;
    if (jumpTargetId) {
      const jumpTarget = turnElementsRef.current.get(jumpTargetId);
      if (jumpTarget) {
        const rect = jumpTarget.getBoundingClientRect();
        setActiveTurnId((current) => (current === jumpTargetId ? current : jumpTargetId));
        if (Math.abs(rect.top + rect.height / 2 - viewportCenter) <= 2) {
          clearNavigatorJump(jumpTargetId);
        }
        return;
      }
      clearNavigatorJump(jumpTargetId);
    }
    let closestId = navigatorEntries[0]?.message.id ?? "";
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const entry of navigatorEntries) {
      const element = turnElementsRef.current.get(entry.message.id);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const distance =
        rect.top <= viewportCenter && rect.bottom >= viewportCenter
          ? 0
          : Math.min(Math.abs(rect.top - viewportCenter), Math.abs(rect.bottom - viewportCenter));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestId = entry.message.id;
      }
    }

    setActiveTurnId((current) => (current === closestId ? current : closestId));
  }, [clearNavigatorJump, navigatorEntries, showNavigator]);

  useEffect(() => {
    if (!showNavigator) {
      clearNavigatorJump();
      setActiveTurnId("");
      return;
    }

    let animationFrame = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateActiveTurn);
    };
    const handleScroll = () => {
      scheduleUpdate();
      const jumpTargetId = navigatorJumpTargetRef.current;
      if (!jumpTargetId) return;
      if (navigatorJumpSettleTimerRef.current !== null) {
        window.clearTimeout(navigatorJumpSettleTimerRef.current);
      }
      navigatorJumpSettleTimerRef.current = window.setTimeout(() => {
        navigatorJumpSettleTimerRef.current = null;
        if (navigatorJumpTargetRef.current !== jumpTargetId) return;
        clearNavigatorJump(jumpTargetId);
        scheduleUpdate();
      }, 120);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    navigatorEntries.forEach((entry) => {
      const element = turnElementsRef.current.get(entry.message.id);
      if (element) resizeObserver?.observe(element);
    });
    scheduleUpdate();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (navigatorJumpSettleTimerRef.current !== null) {
        window.clearTimeout(navigatorJumpSettleTimerRef.current);
        navigatorJumpSettleTimerRef.current = null;
      }
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [clearNavigatorJump, navigatorEntries, showNavigator, updateActiveTurn]);

  useEffect(() => () => clearNavigatorJump(), [clearNavigatorJump]);

  useEffect(() => {
    if (
      !showNavigator ||
      !activeTurnId ||
      navigatorEntries[activeNavigatorIndex]?.message.id !== activeTurnId
    ) {
      return;
    }

    if (navigatorJumpTargetRef.current !== activeTurnId) {
      centerNavigatorItem(activeNavigatorIndex);
    }
    const handleResize = () => centerNavigatorItem(activeNavigatorIndex);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeNavigatorIndex, activeTurnId, centerNavigatorItem, navigatorEntries, showNavigator]);

  const scrollToTurn = (messageId: string, navigatorIndex: number) => {
    const element = turnElementsRef.current.get(messageId);
    if (!element) return;
    clearNavigatorJump();
    navigatorJumpTargetRef.current = messageId;
    setActiveTurnId((current) => (current === messageId ? current : messageId));
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const behavior = prefersReducedMotion ? "auto" : "smooth";
    centerNavigatorItem(navigatorIndex, behavior);
    element.scrollIntoView({ behavior, block: "center" });
    if (behavior === "auto") {
      window.requestAnimationFrame(() => {
        clearNavigatorJump(messageId);
        updateActiveTurn();
      });
      return;
    }
    navigatorJumpFallbackTimerRef.current = window.setTimeout(() => {
      navigatorJumpFallbackTimerRef.current = null;
      if (navigatorJumpTargetRef.current !== messageId) return;
      clearNavigatorJump(messageId);
      updateActiveTurn();
    }, 1_200);
  };

  return (
    <>
      {items.map((item, index) => {
        const navigatorEntry = navigatorEntriesByItemIndex.get(index);
        const setTurnElement = navigatorEntry
          ? (element: HTMLDivElement | null) => {
              if (element) turnElementsRef.current.set(navigatorEntry.message.id, element);
              else turnElementsRef.current.delete(navigatorEntry.message.id);
            }
          : undefined;
        return item.type === "thread" ? (
          <div
            key={messageThreadRenderKey(item.branchId, item.rootId, item.versions[0]?.user)}
            ref={setTurnElement}
            className="message-enter-thread"
            style={itemStyle?.(index)}
            data-conversation-turn={navigatorEntry?.message.id}
          >
            <ChatMessageThread
              mode={mode}
              sharedToken={sharedToken}
              downloadBaseName={downloadBaseName}
              sharedResultMessages={sharedResultMessages}
              rootId={item.rootId}
              versions={item.versions}
              activeVersionIndex={item.activeVersionIndex}
              isSubmitting={isSubmitting}
              onOpenEditor={onOpenEditor ?? ignoreImage}
              onAddAsset={onAddAsset ?? ignoreImage}
              failedJobIds={failedJobIds}
              jobStatuses={jobStatuses}
              retryingJobId={retryingJobId}
              onRetryJob={onRetryJob}
              onSelectVersion={
                onSelectVersion && item.activeVersionIndex !== undefined
                  ? (revision) => onSelectVersion(revision)
                  : undefined
              }
              onSubmitEdit={
                onSubmitEdit
                  ? (payload) => onSubmitEdit({ branchId: item.branchId, rootId: item.rootId }, payload)
                  : ignoreEdit
              }
            />
          </div>
        ) : (
          <div
            key={item.message.id}
            ref={setTurnElement}
            className="message-enter-row"
            style={itemStyle?.(index)}
            data-conversation-turn={navigatorEntry?.message.id}
          >
            <ChatMessage
              mode={mode}
              sharedToken={sharedToken}
              downloadBaseName={downloadBaseName}
              sharedResultMessages={sharedResultMessages}
              message={item.message}
              onOpenEditor={onOpenEditor ?? ignoreImage}
              onAddAsset={onAddAsset ?? ignoreImage}
            />
          </div>
        );
      })}
      {showNavigator ? (
        <nav className="conversation-navigator" aria-label={t("chatMessages.conversationNavigator")}>
          <div ref={navigatorRailRef} className="conversation-navigator-rail">
            <span
              className="conversation-navigator-rail-indicator"
              style={{ transform: `translate3d(0, ${activeNavigatorIndex * 10}px, 0)` }}
              aria-hidden="true"
            />
            {navigatorEntries.map((entry, index) => (
              <button
                key={entry.message.id}
                ref={(element) => {
                  navigatorRailButtonsRef.current[index] = element;
                }}
                type="button"
                className={activeTurnId === entry.message.id ? "active" : undefined}
                aria-label={t("chatMessages.jumpToMessage", { index: index + 1 })}
                aria-current={activeTurnId === entry.message.id ? "true" : undefined}
                onClick={() => scrollToTurn(entry.message.id, index)}
              />
            ))}
          </div>
          <div ref={navigatorCardRef} className="conversation-navigator-card">
            <span
              className="conversation-navigator-card-indicator"
              style={{ transform: `translate3d(0, ${activeNavigatorIndex * 39}px, 0)` }}
              aria-hidden="true"
            />
            {navigatorEntries.map((entry, index) => (
              <button
                key={entry.message.id}
                ref={(element) => {
                  navigatorCardButtonsRef.current[index] = element;
                }}
                type="button"
                className={activeTurnId === entry.message.id ? "active" : undefined}
                title={entry.preview}
                aria-label={t("chatMessages.jumpToMessage", { index: index + 1 })}
                aria-current={activeTurnId === entry.message.id ? "true" : undefined}
                onClick={() => scrollToTurn(entry.message.id, index)}
              >
                {entry.preview || t("chatMessages.emptyMessage")}
              </button>
            ))}
          </div>
        </nav>
      ) : null}
    </>
  );
}
