import { useMemo, type CSSProperties } from "react";
import type { ChatRenderItem, MessageRevision } from "../../lib/chatRender";
import type { Message, WorkImage } from "../../types";
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
    assistants.forEach(append);
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
  retryingJobId,
  itemStyle,
  onOpenEditor,
  onAddAsset,
  onRetryJob,
  onSelectVersion,
  onSubmitEdit
}: ConversationViewProps) {
  const sharedResultMessages = useMemo(
    () => (mode === "shared-readonly" ? visibleAssistantImages(items) : []),
    [items, mode]
  );

  return items.map((item, index) =>
    item.type === "thread" ? (
      <div key={`${item.branchId}:${item.rootId}`} className="message-enter-thread" style={itemStyle?.(index)}>
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
          retryingJobId={retryingJobId}
          onRetryJob={onRetryJob}
          onSelectVersion={
            onSelectVersion && item.activeVersionIndex !== undefined
              ? (revision) => onSelectVersion(revision)
              : undefined
          }
          onSubmitEdit={onSubmitEdit ? (payload) => onSubmitEdit({ branchId: item.branchId, rootId: item.rootId }, payload) : ignoreEdit}
        />
      </div>
    ) : (
      <div key={item.message.id} className="message-enter-row" style={itemStyle?.(index)}>
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
    )
  );
}
