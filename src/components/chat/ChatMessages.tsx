import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, MoreHorizontal, RefreshCw } from "lucide-react";
import { AddCaseModal } from "../AddCaseModal";
import { ImageLightbox, type ImageLightboxState, type ImageLightboxTarget } from "../ImageLightbox";
import { ImageDownloadMenu, type ImageDownloadSource } from "../ImageDownloadMenu";
import { ImagePreviewModal, type ImagePreviewItem } from "../ImagePreviewModal";
import { EditReferenceArrowIcon, MessageEditIcon } from "../InlineIcons";
import { useI18n } from "../../i18n";
import { copyTextToClipboard } from "../../lib/clipboard";
import { sourceSnapshotFromMessage } from "../../lib/chatRequest";
import { type MessageRevision } from "../../lib/chatRender";
import { cx } from "../../lib/cx";
import { workImageFromMessage } from "../../lib/workImages";
import type { Message, MessageSourceReferenceImage, WorkImage } from "../../types";
import { useToast } from "../../ui";

const USER_MESSAGE_COLLAPSED_LINES = 10;
const ASSISTANT_LONG_IMAGE_RATIO = 1.8;
const MESSAGE_MORE_CARD_WIDTH = 172;
const MESSAGE_MORE_CARD_GAP = 8;
const MESSAGE_MORE_CARD_VIEWPORT_PADDING = 12;

type MessageMoreCardPlacement = "top-end" | "bottom-end";

export type ChatMessageMode = "workspace" | "shared-readonly";

export type ChatMessageCapabilities = {
  copyText: boolean;
  copyImage: boolean;
  editMessage: boolean;
  retry: boolean;
  editImage: boolean;
  addCase: boolean;
  addAsset: boolean;
  downloadResultImage: boolean;
};

const WORKSPACE_CHAT_MESSAGE_CAPABILITIES: ChatMessageCapabilities = {
  copyText: true,
  copyImage: true,
  editMessage: true,
  retry: true,
  editImage: true,
  addCase: true,
  addAsset: true,
  downloadResultImage: true
};

const SHARED_READONLY_CHAT_MESSAGE_CAPABILITIES: ChatMessageCapabilities = {
  copyText: false,
  copyImage: false,
  editMessage: false,
  retry: false,
  editImage: false,
  addCase: false,
  addAsset: false,
  downloadResultImage: true
};

function resolveChatMessageCapabilities(
  mode: ChatMessageMode,
  overrides: Partial<ChatMessageCapabilities> | undefined
): ChatMessageCapabilities {
  if (mode === "shared-readonly") {
    return {
      ...SHARED_READONLY_CHAT_MESSAGE_CAPABILITIES,
      downloadResultImage: overrides?.downloadResultImage ?? true
    };
  }
  return { ...WORKSPACE_CHAT_MESSAGE_CAPABILITIES, ...overrides };
}

function messagePreviewUrl(message: Message) {
  return message.imagePreviewUrl ?? message.imageUrl ?? "";
}

function messageThumbnailUrl(message: Message) {
  return message.imageThumbnailUrl ?? message.imagePreviewUrl ?? message.imageUrl ?? "";
}

function referencePreviewUrl(message: Message) {
  return message.referenceImagePreviewUrl ?? message.referenceImageUrl ?? "";
}

function referenceThumbnailUrl(message: Message) {
  return message.referenceImageThumbnailUrl ?? message.referenceImagePreviewUrl ?? message.referenceImageUrl ?? "";
}

function SharedResultImagePreview({
  messages,
  index,
  sharedToken,
  downloadBaseName,
  onIndexChange,
  onClose
}: {
  messages: Message[];
  index: number;
  sharedToken?: string;
  downloadBaseName?: string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const token = sharedToken?.trim() ?? "";
  const sharedTitle = downloadBaseName?.trim() ?? "";
  const items: ImagePreviewItem[] = messages
    .filter((message) => message.imageId && message.imageUrl)
    .map((message, itemIndex) => ({
      id: message.imageId!,
      title: sharedTitle || message.content.trim() || t("chatMessages.viewNthImage", { index: itemIndex + 1 }),
      description: message.imageOriginPrompt?.trim() || message.imagePrompt?.trim() || undefined,
      imageUrl: message.imageUrl!,
      originalUrl: message.imageOriginalUrl ?? message.imagePreviewUrl ?? message.imageUrl!,
      previewUrl: message.imagePreviewUrl ?? message.imageUrl!,
      thumbnailUrl: message.imageThumbnailUrl ?? message.imagePreviewUrl ?? message.imageUrl!,
      imageWidth: message.imageWidth ?? 0,
      imageHeight: message.imageHeight ?? 0,
      imageFileSize: message.imageFileSize ?? 0
    }));

  if (!token || items.length === 0) return null;
  const normalizedIndex = Math.max(0, Math.min(index, items.length - 1));

  return (
    <ImagePreviewModal
      items={items}
      index={normalizedIndex}
      ariaLabel={t("imageLightbox.preview")}
      initialZoomMode="contain"
      wheelMode="pan"
      showItemThumbnails
      suppressStableScrollbarGutter
      onIndexChange={onIndexChange}
      onClose={onClose}
      renderActions={(item) => (
        <ImageDownloadMenu
          source={{ type: "shared-image", id: item.id, token, downloadBaseName }}
          className="case-preview-tool"
          placement="top-end"
        />
      )}
    />
  );
}

function parseImageSize(size: string | null | undefined) {
  const match = size?.match(/(\d+)\s*[xX×]\s*(\d+)/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function isLongAssistantImage(message: Message | null | undefined) {
  const parsedSize = parseImageSize(message?.imageSize);
  const width = Number(message?.imageWidth || parsedSize?.width || 0);
  const height = Number(message?.imageHeight || parsedSize?.height || 0);
  return width > 0 && height / width >= ASSISTANT_LONG_IMAGE_RATIO;
}

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function messageTimeLabel(value: string, locale: string, t: (key: string, params?: Record<string, string | number>) => string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t("chatMessages.unknownTime");

  const now = new Date();
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  if (sameLocalDay(date, now)) return t("chatMessages.todayTime", { time });
  const dateText = new Intl.DateTimeFormat(locale, date.getFullYear() === now.getFullYear()
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" }
  ).format(date);
  return t("chatMessages.dateTime", { date: dateText, time });
}

function MessageMoreButton({ createdAt }: { createdAt: string }) {
  const { resolvedLanguage, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [cardStyle, setCardStyle] = useState<CSSProperties>({});
  const [placement, setPlacement] = useState<MessageMoreCardPlacement>("bottom-end");
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const visible = open && typeof document !== "undefined";

  const updatePosition = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const width = Math.min(MESSAGE_MORE_CARD_WIDTH, Math.max(1, viewportWidth - MESSAGE_MORE_CARD_VIEWPORT_PADDING * 2));
    const height = cardRef.current?.offsetHeight ?? 45;
    const spaceBelow = viewportHeight - rect.bottom - MESSAGE_MORE_CARD_VIEWPORT_PADDING;
    const spaceAbove = rect.top - MESSAGE_MORE_CARD_VIEWPORT_PADDING;
    const nextPlacement: MessageMoreCardPlacement =
      spaceBelow < height + MESSAGE_MORE_CARD_GAP && spaceAbove > spaceBelow ? "top-end" : "bottom-end";
    const rawTop = nextPlacement === "top-end"
      ? rect.top - height - MESSAGE_MORE_CARD_GAP
      : rect.bottom + MESSAGE_MORE_CARD_GAP;
    const maxTop = Math.max(MESSAGE_MORE_CARD_VIEWPORT_PADDING, viewportHeight - height - MESSAGE_MORE_CARD_VIEWPORT_PADDING);
    const left = Math.min(
      Math.max(MESSAGE_MORE_CARD_VIEWPORT_PADDING, rect.right - width),
      Math.max(MESSAGE_MORE_CARD_VIEWPORT_PADDING, viewportWidth - width - MESSAGE_MORE_CARD_VIEWPORT_PADDING)
    );
    const top = Math.min(Math.max(rawTop, MESSAGE_MORE_CARD_VIEWPORT_PADDING), maxTop);
    setPlacement(nextPlacement);
    setCardStyle({ left, top, width });
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [updatePosition, visible]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      if (rootRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span className="message-more-wrap" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t("common.more")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("common.more")}
      >
        <MoreHorizontal size={17} />
      </button>
      {visible
        ? createPortal(
            <div
              ref={cardRef}
              className="message-more-card ui-pop-motion"
              style={cardStyle}
              role="dialog"
              aria-label={t("chatMessages.messageTime")}
              data-state="open"
              data-placement={placement}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <time dateTime={createdAt || undefined}>{messageTimeLabel(createdAt, resolvedLanguage, t)}</time>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

async function convertImageBlobToPng(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas unavailable");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((pngBlob) => {
      if (pngBlob) {
        resolve(pngBlob);
        return;
      }
      reject(new Error("Image conversion failed"));
    }, "image/png");
  });
}

export function ChatMessageThread({
  rootId,
  versions,
  activeVersionIndex,
  isSubmitting = false,
  onOpenEditor,
  onAddAsset,
  onSelectVersion,
  failedJobIds,
  retryingJobId,
  onRetryJob,
  onSubmitEdit,
  mode = "workspace",
  capabilities: capabilityOverrides,
  sharedToken,
  sharedResultMessages,
  downloadBaseName
}: {
  rootId: string;
  versions: MessageRevision[];
  activeVersionIndex?: number;
  isSubmitting?: boolean;
  onOpenEditor?: (image: WorkImage) => void;
  onAddAsset?: (image: WorkImage) => void;
  onSelectVersion?: (revision: MessageRevision, index: number) => void;
  failedJobIds?: ReadonlySet<string>;
  retryingJobId?: string;
  onRetryJob?: (jobId: string) => void;
  onSubmitEdit?: (payload: { rootId: string; userMessage: Message; assistantMessage: Message | null; prompt: string }) => void;
  mode?: ChatMessageMode;
  capabilities?: Partial<ChatMessageCapabilities>;
  sharedToken?: string;
  sharedResultMessages?: Message[];
  downloadBaseName?: string;
}) {
  const [activeIndex, setActiveIndex] = useState(Math.max(0, versions.length - 1));
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [previewState, setPreviewState] = useState<ImageLightboxState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { showToast } = useToast();
  const { t } = useI18n();
  const maxIndex = Math.max(0, versions.length - 1);
  const controlledActiveIndex = typeof activeVersionIndex === "number";
  const currentIndex = Math.max(0, Math.min(controlledActiveIndex ? activeVersionIndex : activeIndex, maxIndex));
  const revision = versions[currentIndex] ?? versions[maxIndex];
  const hasVersions = versions.length > 1;
  const capabilities = resolveChatMessageCapabilities(mode, capabilityOverrides);
  const editingActive = editing && capabilities.editMessage && Boolean(onSubmitEdit);

  useEffect(() => {
    if (controlledActiveIndex) return;
    setActiveIndex(Math.max(0, versions.length - 1));
  }, [controlledActiveIndex, versions.length, versions[versions.length - 1]?.user.id]);

  useEffect(() => {
    if (!editingActive) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [editingActive]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !editingActive) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 190)}px`;
  }, [editValue, editingActive]);

  if (!revision) return null;

  const copyMessage = async () => {
    const copied = await copyTextToClipboard(revision.user.content);
    if (copied) {
      showToast(t("toast.contentCopied"));
      return;
    }
    showToast(t("toast.copyFailed"), "error");
  };
  const moveVersion = (offset: number) => {
    setEditing(false);
    const nextIndex = Math.max(0, Math.min(maxIndex, currentIndex + offset));
    const nextRevision = versions[nextIndex];
    if (nextRevision && onSelectVersion) {
      onSelectVersion(nextRevision, nextIndex);
      return;
    }
    setActiveIndex(nextIndex);
  };
  const startEditing = () => {
    setEditValue(revision.user.content);
    setEditing(true);
  };
  const submitEdit = () => {
    const prompt = editValue.trim();
    if (!prompt || isSubmitting) return;
    setEditing(false);
    onSubmitEdit?.({ rootId, userMessage: revision.user, assistantMessage: revision.assistant, prompt });
  };
  const assistantMessages = revision.assistants.length > 0 ? revision.assistants : revision.assistant ? [revision.assistant] : [];
  const assistantImageMessages = assistantMessages.filter((message) => message.imageUrl && message.imageId);
  const assistantTextMessages = assistantMessages.filter((message) => !message.imageUrl || !message.imageId);
  const shouldRenderImageGroup = assistantImageMessages.length > 1;
  const revisionJobId = typeof revision.user.metadata?.jobId === "string" ? revision.user.metadata.jobId.trim() : "";
  const canRetry = Boolean(capabilities.retry && revisionJobId && failedJobIds?.has(revisionJobId) && onRetryJob);
  const retrying = Boolean(revisionJobId && retryingJobId === revisionJobId);
  const editSourceSnapshot = sourceSnapshotFromMessage(revision.user);
  const editPreviewItems = editSourceSnapshot.references.map((reference) => ({
    url: reference.previewUrl ?? reference.url,
    thumbnailUrl: reference.thumbnailUrl ?? reference.previewUrl ?? reference.url,
    name: reference.name
  }));

  return (
    <div className="message-thread">
      <div className={cx("message-version-turn", editingActive && "editing")}>
        {editingActive ? (
          <form
            className="message-edit-panel"
            onSubmit={(event) => {
              event.preventDefault();
              submitEdit();
            }}
          >
            {editSourceSnapshot.references.length > 0 ? (
              <div className="message-edit-preview-row" aria-label={t("chatMessages.originalMaterials")}>
                {editSourceSnapshot.references.map((reference, index) => (
                  <button
                    key={`${reference.kind}-${reference.id}-${reference.url}`}
                    type="button"
                    className="message-edit-preview-card"
                    title={reference.name}
                    onClick={() => setPreviewState({ items: editPreviewItems, index })}
                    aria-label={t("composer.previewNamed", { name: reference.name })}
                  >
                    <img src={reference.thumbnailUrl ?? reference.previewUrl ?? reference.url} alt={reference.name} />
                  </button>
                ))}
              </div>
            ) : null}
            <textarea ref={textareaRef} value={editValue} onChange={(event) => setEditValue(event.target.value)} />
            <div className="message-edit-actions">
              <button type="button" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </button>
              <button type="submit" disabled={isSubmitting || !editValue.trim()}>
                {t("composer.send")}
              </button>
            </div>
          </form>
        ) : (
          <ChatMessage
            message={revision.user}
            onOpenEditor={onOpenEditor}
            onAddAsset={onAddAsset}
            mode={mode}
            capabilities={capabilities}
            sharedToken={sharedToken}
            sharedResultMessages={sharedResultMessages}
            downloadBaseName={downloadBaseName}
          />
        )}
        {!editingActive ? (
          <div className="message-version-actions">
            {capabilities.copyText ? (
              <button type="button" onClick={() => void copyMessage()} aria-label={t("chatMessages.copy")}>
                <Copy size={17} />
              </button>
            ) : null}
            {capabilities.editMessage && onSubmitEdit ? (
              <button type="button" onClick={startEditing} disabled={isSubmitting} aria-label={t("chatMessages.editMessage")} title={t("chatMessages.editMessage")}>
                <MessageEditIcon size={16} />
              </button>
            ) : null}
            {canRetry ? (
              <button
                type="button"
                className={cx("message-retry-button", retrying && "retrying")}
                onClick={() => onRetryJob?.(revisionJobId)}
                disabled={isSubmitting || retrying}
                aria-label={t("chatMessages.retryMessage")}
                title={t("chatMessages.retry")}
              >
                <RefreshCw size={16} />
              </button>
            ) : null}
            {hasVersions ? (
              <>
                <button type="button" onClick={() => moveVersion(-1)} disabled={currentIndex === 0} aria-label={t("chatMessages.previousVersion")}>
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {currentIndex + 1}/{versions.length}
                </span>
                <button type="button" onClick={() => moveVersion(1)} disabled={currentIndex === maxIndex} aria-label={t("chatMessages.nextVersion")}>
                  <ChevronRight size={17} />
                </button>
              </>
            ) : null}
            <MessageMoreButton createdAt={revision.user.createdAt} />
          </div>
        ) : null}
      </div>
      {shouldRenderImageGroup ? (
        <>
          <AssistantImageGroup
            messages={assistantImageMessages}
            onOpenEditor={onOpenEditor}
            onAddAsset={onAddAsset}
            mode={mode}
            capabilities={capabilities}
            sharedToken={sharedToken}
            sharedResultMessages={sharedResultMessages}
            downloadBaseName={downloadBaseName}
          />
          {assistantTextMessages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              onOpenEditor={onOpenEditor}
              onAddAsset={onAddAsset}
              mode={mode}
              capabilities={capabilities}
              sharedToken={sharedToken}
              sharedResultMessages={sharedResultMessages}
              downloadBaseName={downloadBaseName}
            />
          ))}
        </>
      ) : revision.assistant ? (
        <ChatMessage
          message={revision.assistant}
          onOpenEditor={onOpenEditor}
          onAddAsset={onAddAsset}
          mode={mode}
          capabilities={capabilities}
          sharedToken={sharedToken}
          sharedResultMessages={sharedResultMessages}
          downloadBaseName={downloadBaseName}
        />
      ) : null}
      <ImageLightbox
        state={previewState}
        onClose={() => setPreviewState(null)}
        onChangeIndex={(index) => setPreviewState((state) => (state ? { ...state, index } : state))}
      />
    </div>
  );
}

function AssistantImageGroup({
  messages,
  onOpenEditor,
  onAddAsset,
  mode = "workspace",
  capabilities: capabilityOverrides,
  sharedToken,
  sharedResultMessages,
  downloadBaseName
}: {
  messages: Message[];
  onOpenEditor?: (image: WorkImage) => void;
  onAddAsset?: (image: WorkImage) => void;
  mode?: ChatMessageMode;
  capabilities?: Partial<ChatMessageCapabilities>;
  sharedToken?: string;
  sharedResultMessages?: Message[];
  downloadBaseName?: string;
}) {
  const imageMessages = messages.filter((message) => message.imageUrl && message.imageId);
  const [activeIndex, setActiveIndex] = useState(0);
  const [caseOpen, setCaseOpen] = useState(false);
  const [copyingImage, setCopyingImage] = useState(false);
  const [resultPreviewState, setResultPreviewState] = useState<ImageLightboxState | null>(null);
  const [thumbMaxHeight, setThumbMaxHeight] = useState<number | null>(null);
  const [thumbsOverflowing, setThumbsOverflowing] = useState(false);
  const mainImageRef = useRef<HTMLDivElement | null>(null);
  const thumbsRef = useRef<HTMLDivElement | null>(null);
  const { showToast } = useToast();
  const { t } = useI18n();
  const maxIndex = Math.max(0, imageMessages.length - 1);
  const currentIndex = Math.min(activeIndex, maxIndex);
  const activeMessage = imageMessages[currentIndex] ?? imageMessages[0];
  const image = activeMessage ? workImageFromMessage(activeMessage) : null;
  const capabilities = resolveChatMessageCapabilities(mode, capabilityOverrides);
  const canOpenEditor = capabilities.editImage && Boolean(image && onOpenEditor);
  const groupImages = imageMessages.map((message) => workImageFromMessage(message)).filter((item): item is WorkImage => Boolean(item));
  const resultPreviewItems = imageMessages.map((message, index) => ({
    url: messagePreviewUrl(message),
    thumbnailUrl: messageThumbnailUrl(message),
    name: message.content || t("chatMessages.viewNthImage", { index: index + 1 })
  }));
  const sharedPreviewMessages = mode === "shared-readonly" && sharedResultMessages?.length
    ? sharedResultMessages
    : imageMessages;
  const longImage = isLongAssistantImage(activeMessage);
  const imageGroupStyle = {
    ...(thumbMaxHeight ? { "--image-result-thumb-max-height": `${Math.round(thumbMaxHeight)}px` } : {})
  } as CSSProperties;

  const updateThumbLayout = useCallback(() => {
    const height = mainImageRef.current?.getBoundingClientRect().height ?? 0;
    if (height > 0) {
      setThumbMaxHeight((value) => (Math.abs((value ?? 0) - height) < 1 ? value : height));
    }
    const thumbs = thumbsRef.current;
    if (thumbs) {
      const overflowing = thumbs.scrollHeight > thumbs.clientHeight + 1;
      setThumbsOverflowing((value) => (value === overflowing ? value : overflowing));
    }
  }, []);

  useEffect(() => {
    setActiveIndex((value) => Math.min(value, Math.max(0, imageMessages.length - 1)));
  }, [imageMessages.length]);

  useLayoutEffect(() => {
    updateThumbLayout();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateThumbLayout);
    const mainTarget = mainImageRef.current;
    const thumbsTarget = thumbsRef.current;
    if (mainTarget) observer.observe(mainTarget);
    if (thumbsTarget) observer.observe(thumbsTarget);
    return () => observer.disconnect();
  }, [activeMessage?.id, imageMessages.length, updateThumbLayout]);

  useLayoutEffect(() => {
    updateThumbLayout();
  }, [thumbMaxHeight, updateThumbLayout]);

  if (!activeMessage || !activeMessage.imageUrl) return null;

  const copyImage = async () => {
    if (!activeMessage.imageUrl || copyingImage) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      const copiedUrl = await copyTextToClipboard(activeMessage.imageUrl);
      showToast(copiedUrl ? t("toast.imageCopyUnsupportedUrlCopied") : t("toast.imageCopyUnsupported"), copiedUrl ? "info" : "error");
      return;
    }
    setCopyingImage(true);
    try {
      const response = await fetch(activeMessage.imageUrl);
      if (!response.ok) throw new Error(t("toast.imageReadFailed"));
      const sourceBlob = await response.blob();
      const imageBlob = sourceBlob.type === "image/png" ? sourceBlob : await convertImageBlobToPng(sourceBlob);
      await navigator.clipboard.write([new ClipboardItem({ [imageBlob.type || "image/png"]: imageBlob })]);
      showToast(t("toast.imageCopied"));
    } catch {
      const copiedUrl = await copyTextToClipboard(activeMessage.imageUrl);
      showToast(copiedUrl ? t("toast.imageCopyFailedUrlCopied") : t("toast.imageCopyFailed"), copiedUrl ? "info" : "error");
    } finally {
      setCopyingImage(false);
    }
  };

  return (
    <article className="message assistant-message assistant-image-group-message">
      <div className={cx("image-result-group", longImage && "image-result-group-long")} style={imageGroupStyle}>
        <div className={cx("image-result-thumbs-wrap", thumbsOverflowing && "is-scrollable")}>
          <div className="image-result-thumbs" ref={thumbsRef} aria-label={t("chatMessages.resultThumbnails")}>
            {imageMessages.map((message, index) => (
              <button
                key={message.id}
                type="button"
                className={cx(index === currentIndex && "active")}
                onClick={() => setActiveIndex(index)}
                aria-label={t("chatMessages.viewNthImage", { index: index + 1 })}
                aria-pressed={index === currentIndex}
              >
                <img src={messageThumbnailUrl(message)} alt="" />
                <span className="image-result-thumb-index">{index + 1}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={cx("image-result image-result-main", longImage && "image-result-long")} ref={mainImageRef}>
          <button
            type="button"
            className="image-result-open"
            onClick={() => {
              if (canOpenEditor && image) {
                onOpenEditor?.(image);
                return;
              }
              const previewIndex = mode === "shared-readonly"
                ? Math.max(0, sharedPreviewMessages.findIndex((message) => message.id === activeMessage.id))
                : currentIndex;
              setResultPreviewState({ items: resultPreviewItems, index: previewIndex });
            }}
            aria-label={canOpenEditor ? t("pages.images.editImage") : t("imageLightbox.preview")}
          >
            <img src={messagePreviewUrl(activeMessage)} alt={activeMessage.content} onLoad={updateThumbLayout} />
          </button>
          <AssistantImageActions
            image={image}
            onOpenEditor={onOpenEditor}
            onOpenCase={() => setCaseOpen(true)}
            onAddAsset={onAddAsset}
            mode={mode}
            capabilities={capabilities}
            sharedToken={sharedToken}
            downloadBaseName={downloadBaseName}
          />
        </div>
        <div className="assistant-image-toolbar assistant-image-group-toolbar">
          {capabilities.copyImage ? (
            <button type="button" onClick={() => void copyImage()} disabled={copyingImage} aria-label={t("chatMessages.copyImage")} title={t("chatMessages.copyImage")}>
              <Copy size={17} />
            </button>
          ) : null}
          <MessageMoreButton createdAt={activeMessage.createdAt} />
        </div>
      </div>
      {capabilities.addCase && image && caseOpen ? (
        <AddCaseModal
          source={{
            type: "image",
            id: image.id,
            url: image.previewUrl || image.url,
            titleSeed: image.prompt,
            promptSeed: image.originPrompt?.trim() || image.prompt,
            suggestedTitle: image.suggestedCaseTitle,
            suggestedCategoryIds: image.suggestedCaseCategoryIds,
            images: groupImages.map((item) => ({
              id: item.id,
              url: item.url,
              originalUrl: item.originalUrl,
              previewUrl: item.previewUrl,
              thumbnailUrl: item.thumbnailUrl,
              prompt: item.originPrompt?.trim() || item.prompt,
              suggestedCaseTitle: item.suggestedCaseTitle,
              suggestedCaseCategoryIds: item.suggestedCaseCategoryIds
            }))
          }}
          autoGenerateFields
          onClose={() => setCaseOpen(false)}
        />
      ) : null}
      {mode === "shared-readonly" && resultPreviewState ? (
        <SharedResultImagePreview
          messages={sharedPreviewMessages}
          index={resultPreviewState.index}
          sharedToken={sharedToken}
          downloadBaseName={downloadBaseName}
          onClose={() => setResultPreviewState(null)}
          onIndexChange={(index) => {
            const selectedMessage = sharedPreviewMessages[index];
            const localIndex = selectedMessage
              ? imageMessages.findIndex((message) => message.id === selectedMessage.id)
              : -1;
            if (localIndex >= 0) setActiveIndex(localIndex);
            setResultPreviewState((state) => (state ? { ...state, index } : state));
          }}
        />
      ) : (
        <ImageLightbox
          state={resultPreviewState}
          onClose={() => setResultPreviewState(null)}
          onChangeIndex={(index) => setResultPreviewState((state) => (state ? { ...state, index } : state))}
        />
      )}
    </article>
  );
}

function AssistantImageActions({
  image,
  onOpenEditor,
  onOpenCase,
  onAddAsset,
  mode = "workspace",
  capabilities: capabilityOverrides,
  sharedToken,
  downloadBaseName
}: {
  image: WorkImage | null;
  onOpenEditor?: (image: WorkImage) => void;
  onOpenCase?: () => void;
  onAddAsset?: (image: WorkImage) => void;
  mode?: ChatMessageMode;
  capabilities?: Partial<ChatMessageCapabilities>;
  sharedToken?: string;
  downloadBaseName?: string;
}) {
  const { t } = useI18n();
  const capabilities = resolveChatMessageCapabilities(mode, capabilityOverrides);
  const normalizedSharedToken = sharedToken?.trim() ?? "";
  const downloadSource: ImageDownloadSource | null =
    image && capabilities.downloadResultImage
      ? mode === "shared-readonly"
        ? normalizedSharedToken
          ? { type: "shared-image", id: image.id, token: normalizedSharedToken, downloadBaseName }
          : null
        : { type: "image", id: image.id, downloadBaseName }
      : null;
  const canEditImage = capabilities.editImage && Boolean(image && onOpenEditor);
  const canAddCase = capabilities.addCase && Boolean(onOpenCase);
  const canAddAsset = capabilities.addAsset && Boolean(image && onAddAsset);
  if (!canEditImage && !canAddCase && !canAddAsset && !downloadSource) return null;

  return (
    <div className={cx("image-actions", mode === "shared-readonly" && "shared-readonly")}>
      {canEditImage ? (
        <button
          type="button"
          onClick={() => {
            if (image) onOpenEditor?.(image);
          }}
        >
          {t("pages.images.edit")}
        </button>
      ) : null}
      {canAddCase ? (
        <button type="button" onClick={onOpenCase}>
          {t("pages.cases.addToInspiration")}
        </button>
      ) : null}
      {canAddAsset ? (
        <button
          type="button"
          onClick={() => {
            if (image) onAddAsset?.(image);
          }}
        >
          {t("pages.cases.addToAssets")}
        </button>
      ) : null}
      {downloadSource ? <ImageDownloadMenu source={downloadSource} /> : null}
    </div>
  );
}

export function ChatMessage({
  message,
  onOpenEditor,
  onAddAsset,
  mode = "workspace",
  capabilities: capabilityOverrides,
  sharedToken,
  sharedResultMessages,
  downloadBaseName
}: {
  message: Message;
  onOpenEditor?: (image: WorkImage) => void;
  onAddAsset?: (image: WorkImage) => void;
  mode?: ChatMessageMode;
  capabilities?: Partial<ChatMessageCapabilities>;
  sharedToken?: string;
  sharedResultMessages?: Message[];
  downloadBaseName?: string;
}) {
  const [caseOpen, setCaseOpen] = useState(false);
  const [copyingImage, setCopyingImage] = useState(false);
  const [referencePreviewState, setReferencePreviewState] = useState<ImageLightboxState | null>(null);
  const [userTextMultiline, setUserTextMultiline] = useState(false);
  const [userTextOverflowing, setUserTextOverflowing] = useState(false);
  const [userTextExpanded, setUserTextExpanded] = useState(false);
  const userTextRef = useRef<HTMLParagraphElement | null>(null);
  const { showToast } = useToast();
  const { t } = useI18n();
  const image = workImageFromMessage(message);
  const capabilities = resolveChatMessageCapabilities(mode, capabilityOverrides);
  const canOpenEditor = capabilities.editImage && Boolean(image && onOpenEditor);
  const hideReference = message.metadata?.hideReference === true;
  const referenceImageUrl = message.referenceImageUrl ?? (message.role === "user" ? message.imageUrl : null);
  const referenceImagePrompt = message.referenceImagePrompt ?? message.imagePrompt ?? t("chatMessages.referenceImage");
  const referenceImageKind = message.referenceImageKind ?? (message.role === "user" && referenceImageUrl ? "image" : null);
  const sourceReferenceImages = message.sourceReferenceImages ?? [];
  const showSelectedContentLabel =
    message.role === "user" &&
    referenceImageKind === "image" &&
    message.metadata?.mode === "edit" &&
    message.metadata?.hasMask === true;
  const directReferenceImages: MessageSourceReferenceImage[] =
    message.role === "user" && referenceImageKind === "asset" && !hideReference
      ? sourceReferenceImages.length > 0
        ? sourceReferenceImages
        : referenceImageUrl
          ? [
              {
                id: "reference-asset",
                sourceAssetId: null,
                kind: "asset",
                name: referenceImagePrompt,
                url: referenceImageUrl,
                originalUrl: referenceImageUrl,
                previewUrl: message.referenceImagePreviewUrl ?? referenceImageUrl,
                thumbnailUrl: message.referenceImageThumbnailUrl ?? message.referenceImagePreviewUrl ?? referenceImageUrl,
                imageWidth: message.referenceImageWidth ?? 0,
                imageHeight: message.referenceImageHeight ?? 0
              }
            ]
          : []
      : [];
  const editMaterialReferenceImages: MessageSourceReferenceImage[] =
    message.role === "user" && referenceImageKind === "image" && !hideReference
      ? sourceReferenceImages.filter((item) => item.kind === "asset")
      : [];
  const openReferencePreview = (items: ImageLightboxTarget[], index: number) => {
    setReferencePreviewState({ items, index });
  };
  const closeReferencePreview = () => {
    setReferencePreviewState(null);
  };
  const userTextToggleable = message.role === "user" && userTextOverflowing;
  const userTextCollapsed = userTextToggleable && !userTextExpanded;
  const longAssistantImage = message.role === "assistant" && isLongAssistantImage(message);
  const directReferencePreviewItems = directReferenceImages.map((item) => ({
    url: item.previewUrl ?? item.url,
    thumbnailUrl: item.thumbnailUrl ?? item.previewUrl ?? item.url,
    name: item.name
  }));
  const editMaterialPreviewItems = editMaterialReferenceImages.map((item) => ({
    url: item.previewUrl ?? item.url,
    thumbnailUrl: item.thumbnailUrl ?? item.previewUrl ?? item.url,
    name: item.name
  }));
  const primaryReferencePreviewItems = referenceImageUrl
    ? [
        {
          url: referencePreviewUrl(message),
          thumbnailUrl: referenceThumbnailUrl(message),
          name: referenceImagePrompt
        }
      ]
    : [];
  const resultPreviewItems = message.imageUrl
    ? [
        {
          url: messagePreviewUrl(message),
          thumbnailUrl: messageThumbnailUrl(message),
          name: message.content || t("imageLightbox.preview")
        }
      ]
    : [];
  const sharedPreviewMessages = mode === "shared-readonly" && sharedResultMessages?.length
    ? sharedResultMessages
    : [message];
  const sharedPreviewIndex = Math.max(0, sharedPreviewMessages.findIndex((item) => item.id === message.id));
  const renderUserText = () => (
    <>
      <p ref={userTextRef} className={cx("user-message-text", userTextCollapsed && "is-collapsed")}>
        {message.content}
      </p>
      {userTextToggleable ? (
        <button
          type="button"
          className="user-message-toggle"
          onClick={() => setUserTextExpanded((value) => !value)}
          aria-label={userTextCollapsed ? t("chatMessages.expandFullMessage") : t("chatMessages.collapseMessage")}
          aria-expanded={userTextExpanded}
        >
          <span>{userTextCollapsed ? t("common.expand") : t("common.collapse")}</span>
          {userTextCollapsed ? <ChevronDown size={14} strokeWidth={2.2} /> : <ChevronUp size={14} strokeWidth={2.2} />}
        </button>
      ) : null}
    </>
  );

  useEffect(() => {
    setUserTextExpanded(false);
  }, [message.content, message.id]);

  useLayoutEffect(() => {
    if (message.role !== "user") {
      setUserTextMultiline(false);
      setUserTextOverflowing(false);
      return;
    }
    const element = userTextRef.current;
    if (!element) return;

    const measure = () => {
      const style = window.getComputedStyle(element);
      const lineHeight = Number.parseFloat(style.lineHeight);
      const fullHeight = element.scrollHeight;
      const multiline = Number.isFinite(lineHeight) && lineHeight > 0 ? fullHeight > lineHeight * 1.45 : fullHeight > 36;
      const overflowing =
        Number.isFinite(lineHeight) && lineHeight > 0
          ? fullHeight > lineHeight * USER_MESSAGE_COLLAPSED_LINES + 1
          : fullHeight > 360;
      setUserTextMultiline((value) => (value === multiline ? value : multiline));
      setUserTextOverflowing((value) => (value === overflowing ? value : overflowing));
    };

    measure();

    let observer: ResizeObserver | null = null;
    if ("ResizeObserver" in window) {
      observer = new ResizeObserver(measure);
      observer.observe(element);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [message.content, message.role, userTextExpanded]);

  const copyImage = async () => {
    if (!message.imageUrl || copyingImage) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      const copiedUrl = await copyTextToClipboard(message.imageUrl);
      showToast(copiedUrl ? t("toast.imageCopyUnsupportedUrlCopied") : t("toast.imageCopyUnsupported"), copiedUrl ? "info" : "error");
      return;
    }
    setCopyingImage(true);
    try {
      const response = await fetch(message.imageUrl);
      if (!response.ok) throw new Error(t("toast.imageReadFailed"));
      const sourceBlob = await response.blob();
      const imageBlob = sourceBlob.type === "image/png" ? sourceBlob : await convertImageBlobToPng(sourceBlob);
      await navigator.clipboard.write([new ClipboardItem({ [imageBlob.type || "image/png"]: imageBlob })]);
      showToast(t("toast.imageCopied"));
    } catch {
      const copiedUrl = await copyTextToClipboard(message.imageUrl);
      showToast(copiedUrl ? t("toast.imageCopyFailedUrlCopied") : t("toast.imageCopyFailed"), copiedUrl ? "info" : "error");
    } finally {
      setCopyingImage(false);
    }
  };

  if (message.role === "user" && directReferenceImages.length > 0) {
    return (
      <article className={cx("message direct-image-message", userTextMultiline ? "user-message-multiline" : "user-message-singleline")}>
        <div className="direct-image-preview-grid" aria-label={t("chatMessages.sentImages")}>
          {directReferenceImages.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className="direct-image-preview"
              onClick={() => openReferencePreview(directReferencePreviewItems, index)}
              aria-label={t("chatMessages.previewSentImage", { name: item.name })}
            >
              <img src={item.thumbnailUrl ?? item.previewUrl ?? item.url} alt={item.name} />
            </button>
          ))}
        </div>
        <div className={cx("user-message-content-bubble", userTextToggleable && "is-toggleable", userTextCollapsed && "is-collapsed")}>
          {renderUserText()}
        </div>
        <ImageLightbox
          state={referencePreviewState}
          onClose={closeReferencePreview}
          onChangeIndex={(index) => setReferencePreviewState((state) => (state ? { ...state, index } : state))}
        />
      </article>
    );
  }

  if (message.role === "user" && referenceImageUrl && !hideReference) {
    return (
      <article className={cx("message user-message edit-request-message", userTextMultiline ? "user-message-multiline" : "user-message-singleline")}>
        <div className="edit-request-ref">
          <span className="edit-request-arrow">
            <EditReferenceArrowIcon />
          </span>
          <button
            type="button"
            className="edit-request-thumb"
            onClick={() => openReferencePreview(primaryReferencePreviewItems, 0)}
            aria-label={t("chatMessages.previewReferenceImage")}
          >
            <img src={referenceThumbnailUrl(message)} alt={referenceImagePrompt} />
            <span className="edit-request-hover-preview" aria-hidden="true">
              <img src={referencePreviewUrl(message)} alt="" />
            </span>
          </button>
          {showSelectedContentLabel ? <strong>{t("chatMessages.selectedContent")}</strong> : null}
        </div>
        {editMaterialReferenceImages.length > 0 ? (
          <div className="direct-image-preview-grid edit-request-material-grid" aria-label={t("chatMessages.sentMaterials")}>
            {editMaterialReferenceImages.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className="direct-image-preview"
                onClick={() => openReferencePreview(editMaterialPreviewItems, index)}
                aria-label={t("chatMessages.previewSentMaterial", { name: item.name })}
              >
                <img src={item.thumbnailUrl ?? item.previewUrl ?? item.url} alt={item.name} />
              </button>
            ))}
          </div>
        ) : null}
        <div className={cx("user-message-content-bubble", userTextToggleable && "is-toggleable", userTextCollapsed && "is-collapsed")}>
          {renderUserText()}
        </div>
        <ImageLightbox
          state={referencePreviewState}
          onClose={closeReferencePreview}
          onChangeIndex={(index) => setReferencePreviewState((state) => (state ? { ...state, index } : state))}
        />
      </article>
    );
  }

  return (
    <article
      className={cx(
        "message",
        message.role === "user" ? "user-message" : "assistant-message",
        message.role === "user" && (userTextMultiline ? "user-message-multiline" : "user-message-singleline"),
        userTextToggleable && "user-message-toggleable",
        userTextCollapsed && "user-message-collapsed"
      )}
    >
      {message.imageUrl && message.role === "assistant" ? (
        <>
          <div className={cx("image-result", longAssistantImage && "image-result-long")}>
            <button
              type="button"
              className="image-result-open"
              onClick={() => {
                if (canOpenEditor && image) {
                  onOpenEditor?.(image);
                  return;
                }
                setReferencePreviewState({
                  items: resultPreviewItems,
                  index: mode === "shared-readonly" && message.role === "assistant" ? sharedPreviewIndex : 0
                });
              }}
              aria-label={canOpenEditor ? t("pages.images.editImage") : t("imageLightbox.preview")}
            >
              <img src={messagePreviewUrl(message)} alt={message.content} />
            </button>
            <AssistantImageActions
              image={image}
              onOpenEditor={onOpenEditor}
              onOpenCase={() => setCaseOpen(true)}
              onAddAsset={onAddAsset}
              mode={mode}
              capabilities={capabilities}
              sharedToken={sharedToken}
              downloadBaseName={downloadBaseName}
            />
          </div>
          <div className="assistant-image-toolbar">
            {capabilities.copyImage ? (
              <button type="button" onClick={() => void copyImage()} disabled={copyingImage} aria-label={t("chatMessages.copyImage")} title={t("chatMessages.copyImage")}>
                <Copy size={17} />
              </button>
            ) : null}
            <MessageMoreButton createdAt={message.createdAt} />
          </div>
        </>
      ) : null}
      {message.imageUrl && message.role === "assistant" ? null : message.role === "user" ? renderUserText() : <p>{message.content}</p>}
      {capabilities.addCase && image && caseOpen ? (
        <AddCaseModal
          source={{
            type: "image",
            id: image.id,
            url: image.previewUrl || image.url,
            titleSeed: image.prompt,
            promptSeed: image.originPrompt?.trim() || image.prompt,
            suggestedTitle: image.suggestedCaseTitle,
            suggestedCategoryIds: image.suggestedCaseCategoryIds
          }}
          autoGenerateFields
          onClose={() => setCaseOpen(false)}
        />
      ) : null}
      {message.role === "assistant" && mode === "shared-readonly" && referencePreviewState ? (
        <SharedResultImagePreview
          messages={sharedPreviewMessages}
          index={referencePreviewState.index}
          sharedToken={sharedToken}
          downloadBaseName={downloadBaseName}
          onClose={closeReferencePreview}
          onIndexChange={(index) => setReferencePreviewState((state) => (state ? { ...state, index } : state))}
        />
      ) : (
        <ImageLightbox
          state={message.role === "assistant" ? referencePreviewState : null}
          onClose={closeReferencePreview}
          onChangeIndex={(index) => setReferencePreviewState((state) => (state ? { ...state, index } : state))}
        />
      )}
    </article>
  );
}
