import { useMemo } from "react";
import type { SubmitRequest } from "../lib/chatRequest";
import { MAIN_CHAT_BRANCH_ID, isServerEchoOfPending, messageChatBranchId } from "../lib/chatRender";
import type { ImageJob, Message } from "../types";

type UseChatViewStateOptions = {
  currentScopeBusy: boolean;
  currentScopeSubmitting: boolean;
  currentSubmitScope: string;
  activeBranchId: string;
  pendingMode: SubmitRequest["mode"];
  pendingSubmitScope: string | null;
  pendingUserMessage: Message | null;
  runningImageJobs: ImageJob[];
  serverMessages: Message[];
};

export function useChatViewState({
  currentScopeBusy,
  currentScopeSubmitting,
  currentSubmitScope,
  activeBranchId,
  pendingMode,
  pendingSubmitScope,
  pendingUserMessage,
  runningImageJobs,
  serverMessages
}: UseChatViewStateOptions) {
  const pendingMatchesCurrentView = pendingSubmitScope === currentSubmitScope;
  const pendingMatchesActiveBranch = Boolean(pendingUserMessage && messageChatBranchId(pendingUserMessage) === activeBranchId);
  const pendingHasServerEcho = Boolean(pendingUserMessage && serverMessages.some((message) => isServerEchoOfPending(message, pendingUserMessage)));
  const visiblePendingUserMessage = pendingMatchesCurrentView && pendingMatchesActiveBranch && !pendingHasServerEcho ? pendingUserMessage : null;
  const messageList = useMemo(
    () => [...serverMessages, ...(visiblePendingUserMessage ? [visiblePendingUserMessage] : [])],
    [serverMessages, visiblePendingUserMessage]
  );
  const visibleRunningImageJobs = runningImageJobs.filter((job) => (job.branchId?.trim() || MAIN_CHAT_BRANCH_ID) === activeBranchId);
  const visibleLoadingMode: SubmitRequest["mode"] | null =
    pendingMatchesCurrentView && pendingMatchesActiveBranch && currentScopeSubmitting
      ? pendingMode
      : visibleRunningImageJobs[0]?.type === "edit"
        ? "edit"
        : visibleRunningImageJobs[0]
          ? "generation"
          : null;
  const loadingTitle = visibleLoadingMode === "edit" ? "正在编辑图片" : visibleLoadingMode === "generation" ? "正在创建图片" : "";

  return {
    currentViewSubmitting: currentScopeBusy,
    loadingTitle,
    messageList,
    visibleLoadingMode,
    visiblePendingUserMessage
  };
}
