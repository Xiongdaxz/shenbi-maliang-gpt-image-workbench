import { useMemo } from "react";
import { useI18n } from "../i18n";
import type { SubmitRequest } from "../lib/chatRequest";
import { MAIN_CHAT_BRANCH_ID, isServerEchoOfPending, messageChatBranchId } from "../lib/chatRender";
import type { ImageJob, Message } from "../types";

type UseChatViewStateOptions = {
  currentScopeBusy: boolean;
  currentScopeSubmitting: boolean;
  currentSubmitScope: string;
  activeBranchId: string;
  activeClientRequestId: string | null;
  pendingMode: SubmitRequest["mode"];
  pendingSubmitScope: string | null;
  pendingUserMessage: Message | null;
  runningImageJobs: ImageJob[];
  serverMessages: Message[];
};

export function imageJobHasVisibleResult(jobId: string | null | undefined, messages: Message[]) {
  const normalizedJobId = String(jobId ?? "").trim();
  if (!normalizedJobId) return false;
  return messages.some((message) => (
    message.role === "assistant"
    && Boolean(message.imageId && message.imageUrl)
    && String(message.metadata?.jobId ?? "").trim() === normalizedJobId
  ));
}

type ResolveActiveImageRequestCountOptions = {
  activeBranchId: string;
  activeClientRequestId: string | null;
  pendingUserMessage: Message | null;
  runningImageJobs: ImageJob[];
  serverMessages: Message[];
};

function messageImageCount(message: Message) {
  return Math.max(0, Math.trunc(Number(message.metadata?.n)) || 0);
}

export function resolveActiveImageRequestCount({
  activeBranchId,
  activeClientRequestId,
  pendingUserMessage,
  runningImageJobs,
  serverMessages
}: ResolveActiveImageRequestCountOptions) {
  const pendingImageCount = pendingUserMessage && messageChatBranchId(pendingUserMessage) === activeBranchId
    ? messageImageCount(pendingUserMessage)
    : 0;
  const normalizedClientRequestId = String(activeClientRequestId ?? "").trim();
  const requestImageCount = normalizedClientRequestId
    ? serverMessages.reduce((count, message) => {
        if (
          message.role !== "user"
          || messageChatBranchId(message) !== activeBranchId
          || String(message.metadata?.clientRequestId ?? "").trim() !== normalizedClientRequestId
        ) return count;
        return Math.max(count, messageImageCount(message));
      }, 0)
    : 0;
  const visibleRunningJobIds = new Set(
    runningImageJobs
      .filter((job) => (job.branchId?.trim() || MAIN_CHAT_BRANCH_ID) === activeBranchId)
      .map((job) => job.id)
  );
  const runningImageCount = visibleRunningJobIds.size > 0
    ? serverMessages.reduce((count, message) => {
        if (message.role !== "user" || !visibleRunningJobIds.has(String(message.metadata?.jobId ?? "").trim())) return count;
        return Math.max(count, messageImageCount(message));
      }, 0)
    : 0;
  return Math.max(pendingImageCount, requestImageCount, runningImageCount);
}

export function useChatViewState({
  currentScopeBusy,
  currentScopeSubmitting,
  currentSubmitScope,
  activeBranchId,
  activeClientRequestId,
  pendingMode,
  pendingSubmitScope,
  pendingUserMessage,
  runningImageJobs,
  serverMessages
}: UseChatViewStateOptions) {
  const { t } = useI18n();
  const pendingMatchesCurrentView = pendingSubmitScope === currentSubmitScope;
  const pendingMatchesActiveBranch = Boolean(pendingUserMessage && messageChatBranchId(pendingUserMessage) === activeBranchId);
  const pendingHasServerEcho = Boolean(pendingUserMessage && serverMessages.some((message) => isServerEchoOfPending(message, pendingUserMessage)));
  const visiblePendingUserMessage = pendingMatchesCurrentView && pendingMatchesActiveBranch && !pendingHasServerEcho ? pendingUserMessage : null;
  const messageList = useMemo(
    () => [...serverMessages, ...(visiblePendingUserMessage ? [visiblePendingUserMessage] : [])],
    [serverMessages, visiblePendingUserMessage]
  );
  const visibleRunningImageJobs = runningImageJobs.filter((job) => (job.branchId?.trim() || MAIN_CHAT_BRANCH_ID) === activeBranchId);
  const visibleRunningImageJob = visibleRunningImageJobs[0] ?? null;
  const activeImageRequestCount = resolveActiveImageRequestCount({
    activeBranchId,
    activeClientRequestId,
    pendingUserMessage: pendingMatchesCurrentView && pendingMatchesActiveBranch ? pendingUserMessage : null,
    runningImageJobs: visibleRunningImageJobs,
    serverMessages
  });
  const multiImageLoading = activeImageRequestCount > 1;
  const singleImageResultVisible = !multiImageLoading && imageJobHasVisibleResult(visibleRunningImageJob?.id, serverMessages);
  const visibleLoadingMode: SubmitRequest["mode"] | null =
    pendingMatchesCurrentView && pendingMatchesActiveBranch && currentScopeSubmitting && !singleImageResultVisible
      ? pendingMode
      : visibleRunningImageJob && !singleImageResultVisible
        ? visibleRunningImageJob.type === "edit" ? "edit" : "generation"
        : null;
  const loadingTitle = visibleLoadingMode === "edit"
    ? t("chat.loading.editingImage")
    : visibleLoadingMode === "generation"
      ? t("chat.loading.creatingImage")
      : "";

  return {
    currentViewSubmitting: currentScopeBusy,
    loadingTitle,
    messageList,
    multiImageLoading,
    visibleLoadingMode,
    visiblePendingUserMessage
  };
}
