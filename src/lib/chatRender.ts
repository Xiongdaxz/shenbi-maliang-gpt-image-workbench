import type { Message } from "../types";

export const MAIN_CHAT_BRANCH_ID = "main";

export type MessageRevision = {
  user: Message;
  assistant: Message | null;
  assistants: Message[];
  rootId: string;
  branchId: string;
  parentBranchId: string;
  branchForkMessageId: string;
  branchRootMessageId: string;
  order: number;
};

type MessageThreadItem = {
  type: "thread";
  rootId: string;
  branchId: string;
  versions: MessageRevision[];
  activeVersionIndex?: number;
};

type StandaloneMessageItem = {
  type: "message";
  message: Message;
  branchId: string;
};

export type ChatRenderItem = MessageThreadItem | StandaloneMessageItem;

export type ChatRenderState = {
  items: ChatRenderItem[];
  activeBranchId: string;
  visibleMessages: Message[];
};

type TimelineEntry =
  | {
      type: "turn";
      revision: MessageRevision;
      branchId: string;
      order: number;
    }
  | {
      type: "message";
      message: Message;
      branchId: string;
      order: number;
    };

type BranchInfo = {
  id: string;
  parentId: string;
  forkMessageId: string;
  rootId: string;
  firstRevision: MessageRevision;
};

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function messageMetadataString(message: Message, key: string) {
  const value = message.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function messageMetadataIdList(message: Message, key: string) {
  const value = message.metadata?.[key];
  const rawValues =
    typeof value === "string" && value.trim().startsWith("[")
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [value];
          } catch {
            return [value];
          }
        })()
      : Array.isArray(value)
        ? value
        : [value];
  return unique(rawValues.map((item) => String(item ?? "").trim()).filter(Boolean));
}

function sameIdList(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

function messageTimestampMs(message: Message) {
  const timestamp = Date.parse(message.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function isServerEchoOfPending(message: Message, pending: Message) {
  if (message.role !== "user" || pending.role !== "user") return false;
  if (message.id === pending.id || message.content !== pending.content) return false;

  const pendingMode = messageMetadataString(pending, "mode");
  if (pendingMode && messageMetadataString(message, "mode") !== pendingMode) return false;

  for (const key of [
    "revisionRootId",
    "editedMessageId",
    "branchId",
    "parentBranchId",
    "branchForkMessageId",
    "branchRootMessageId"
  ] as const) {
    const pendingValue = messageMetadataString(pending, key);
    if (pendingValue && messageMetadataString(message, key) !== pendingValue) return false;
  }

  for (const key of ["sourceImageIds", "sourceAssetIds", "sourceCaseItemIds", "sourceReferenceIds"] as const) {
    const pendingIds = messageMetadataIdList(pending, key);
    if (pendingIds.length > 0 && !sameIdList(messageMetadataIdList(message, key), pendingIds)) return false;
  }

  return messageTimestampMs(message) >= messageTimestampMs(pending) - 1000;
}

export function messageChatBranchId(message: Message) {
  return messageMetadataString(message, "branchId") || MAIN_CHAT_BRANCH_ID;
}

function messageRevisionRootId(message: Message) {
  return messageMetadataString(message, "revisionRootId") || message.id;
}

function messageRevisionBranchId(message: Message, rootId: string) {
  const explicitBranchId = messageMetadataString(message, "branchId");
  if (explicitBranchId) return explicitBranchId;
  const revisionRootId = messageMetadataString(message, "revisionRootId");
  return revisionRootId && revisionRootId === rootId && message.id !== rootId ? `legacy-${message.id}` : MAIN_CHAT_BRANCH_ID;
}

function branchOptionKey(parentBranchId: string, forkMessageId: string) {
  return `${parentBranchId}\u0000${forkMessageId}`;
}

function collectChatTimeline(messages: Message[]) {
  const timeline: TimelineEntry[] = [];
  const threadVersions = new Map<string, MessageRevision[]>();
  const revisions: MessageRevision[] = [];
  const revisionsByJobId = new Map<string, MessageRevision>();
  const unmatchedRevisions: MessageRevision[] = [];

  const assignAssistant = (revision: MessageRevision, message: Message) => {
    if (!revision.assistant) revision.assistant = message;
    revision.assistants.push(message);
    const index = unmatchedRevisions.indexOf(revision);
    if (index >= 0) unmatchedRevisions.splice(index, 1);
    return true;
  };

  const attachAssistant = (message: Message) => {
    const jobId = messageMetadataString(message, "jobId");
    if (jobId) {
      const revision = revisionsByJobId.get(jobId);
      if (revision) return assignAssistant(revision, message);
    }

    const rootId = messageMetadataString(message, "revisionRootId");
    if (rootId) {
      const versions = threadVersions.get(rootId);
      const revision = versions?.[versions.length - 1];
      if (revision && !revision.assistant) return assignAssistant(revision, message);
    }

    const lastEntry = timeline[timeline.length - 1];
    if (unmatchedRevisions.length === 1 && lastEntry?.type === "turn") {
      const revision = lastEntry.revision;
      if (revision && !revision.assistant) return assignAssistant(revision, message);
    }
    return false;
  };

  messages.forEach((message, order) => {
    if (message.role === "user") {
      const rootId = messageRevisionRootId(message);
      const branchId = messageRevisionBranchId(message, rootId);
      const isLegacyBranch = branchId !== MAIN_CHAT_BRANCH_ID && !messageMetadataString(message, "branchId");
      const revision: MessageRevision = {
        user: message,
        assistant: null,
        assistants: [],
        rootId,
        branchId,
        parentBranchId: messageMetadataString(message, "parentBranchId") || (isLegacyBranch ? MAIN_CHAT_BRANCH_ID : ""),
        branchForkMessageId: messageMetadataString(message, "branchForkMessageId") || (isLegacyBranch ? rootId : ""),
        branchRootMessageId: messageMetadataString(message, "branchRootMessageId") || rootId,
        order
      };
      const versions = threadVersions.get(rootId) ?? [];
      versions.push(revision);
      threadVersions.set(rootId, versions);
      revisions.push(revision);
      unmatchedRevisions.push(revision);
      timeline.push({ type: "turn", revision, branchId, order });
      const jobId = messageMetadataString(message, "jobId");
      if (jobId) revisionsByJobId.set(jobId, revision);
      return;
    }

    if (!attachAssistant(message)) {
      timeline.push({ type: "message", message, branchId: messageChatBranchId(message), order });
    }
  });

  return { timeline, revisions };
}

function collectBranches(revisions: MessageRevision[]) {
  const branches = new Map<string, BranchInfo>();
  const branchesByParentFork = new Map<string, BranchInfo[]>();

  for (const revision of revisions) {
    if (revision.branchId === MAIN_CHAT_BRANCH_ID || !revision.branchForkMessageId || branches.has(revision.branchId)) continue;
    const branch: BranchInfo = {
      id: revision.branchId,
      parentId: revision.parentBranchId || MAIN_CHAT_BRANCH_ID,
      forkMessageId: revision.branchForkMessageId,
      rootId: revision.branchRootMessageId || revision.rootId,
      firstRevision: revision
    };
    branches.set(branch.id, branch);
    const key = branchOptionKey(branch.parentId, branch.forkMessageId);
    const siblings = branchesByParentFork.get(key) ?? [];
    siblings.push(branch);
    siblings.sort((left, right) => left.firstRevision.order - right.firstRevision.order);
    branchesByParentFork.set(key, siblings);
  }

  return { branches, branchesByParentFork };
}

function resolveActiveBranchId(revisions: MessageRevision[], branches: Map<string, BranchInfo>, requestedActiveBranchId?: string | null) {
  if (requestedActiveBranchId === MAIN_CHAT_BRANCH_ID || (requestedActiveBranchId && branches.has(requestedActiveBranchId))) {
    return requestedActiveBranchId;
  }
  const latestBranchedRevision = [...revisions].reverse().find((revision) => revision.branchId !== MAIN_CHAT_BRANCH_ID && branches.has(revision.branchId));
  return latestBranchedRevision?.branchId ?? MAIN_CHAT_BRANCH_ID;
}

function activeBranchPath(activeBranchId: string, branches: Map<string, BranchInfo>) {
  const path = [activeBranchId];
  const seen = new Set(path);
  let currentId = activeBranchId;

  while (currentId !== MAIN_CHAT_BRANCH_ID) {
    const branch = branches.get(currentId);
    const parentId = branch?.parentId || MAIN_CHAT_BRANCH_ID;
    if (seen.has(parentId)) break;
    path.unshift(parentId);
    seen.add(parentId);
    currentId = parentId;
  }

  if (path[0] !== MAIN_CHAT_BRANCH_ID) path.unshift(MAIN_CHAT_BRANCH_ID);
  return path;
}

function selectedMessagesFromItems(items: ChatRenderItem[]) {
  const selectedMessages: Message[] = [];
  for (const item of items) {
    if (item.type === "message") {
      selectedMessages.push(item.message);
      continue;
    }
    const selectedIndex = item.activeVersionIndex ?? Math.max(0, item.versions.length - 1);
    const revision = item.versions[selectedIndex] ?? item.versions[item.versions.length - 1];
    if (!revision) continue;
    selectedMessages.push(revision.user, ...revision.assistants);
  }
  return selectedMessages;
}

function appendThreadItem({
  branchId,
  rootId,
  revisions,
  branchesByParentFork,
  selectedChildBranchId,
  items
}: {
  branchId: string;
  rootId: string;
  revisions: MessageRevision[];
  branchesByParentFork: Map<string, BranchInfo[]>;
  selectedChildBranchId?: string;
  items: ChatRenderItem[];
}) {
  const branchRevisions = revisions.filter((revision) => revision.branchId === branchId && revision.rootId === rootId);
  const childBranches = branchesByParentFork.get(branchOptionKey(branchId, rootId)) ?? [];
  const childRevisions = childBranches.map((branch) => branch.firstRevision);
  const versions = [...branchRevisions, ...childRevisions]
    .filter((revision, index, source) => source.findIndex((item) => item.user.id === revision.user.id) === index)
    .sort((left, right) => left.order - right.order);

  if (versions.length === 0) return;

  const selectedChildIndex = selectedChildBranchId
    ? versions.findIndex((revision) => revision.branchId === selectedChildBranchId && revision.branchForkMessageId === rootId)
    : -1;
  const latestBranchRevisionIndex = versions.reduce((latestIndex, revision, index) => {
    if (revision.branchId !== branchId) return latestIndex;
    return latestIndex < 0 || revision.order > versions[latestIndex].order ? index : latestIndex;
  }, -1);
  const activeVersionIndex =
    childBranches.length > 0 ? (selectedChildIndex >= 0 ? selectedChildIndex : Math.max(0, latestBranchRevisionIndex)) : undefined;

  items.push({
    type: "thread",
    rootId,
    branchId,
    versions,
    ...(activeVersionIndex !== undefined ? { activeVersionIndex } : {})
  });
}

function appendBranchSegment({
  branchId,
  skipUserMessageId,
  selectedChildBranch,
  timeline,
  revisions,
  branchesByParentFork,
  items
}: {
  branchId: string;
  skipUserMessageId: string;
  selectedChildBranch: BranchInfo | null;
  timeline: TimelineEntry[];
  revisions: MessageRevision[];
  branchesByParentFork: Map<string, BranchInfo[]>;
  items: ChatRenderItem[];
}) {
  const processedRoots = new Set<string>();
  const entries = timeline.filter((entry) => entry.branchId === branchId).sort((left, right) => left.order - right.order);
  const selectedForkOrder = selectedChildBranch?.firstRevision.order ?? Number.POSITIVE_INFINITY;
  const selectedForkMessageId = selectedChildBranch?.forkMessageId ?? "";

  for (const entry of entries) {
    if (entry.order > selectedForkOrder) break;

    if (entry.type === "message") {
      if (entry.order < selectedForkOrder) {
        items.push({ type: "message", message: entry.message, branchId });
      }
      continue;
    }

    const { revision } = entry;
    if (revision.user.id === skipUserMessageId) continue;
    if (processedRoots.has(revision.rootId)) continue;
    processedRoots.add(revision.rootId);

    if (revision.rootId === selectedForkMessageId) {
      appendThreadItem({
        branchId,
        rootId: revision.rootId,
        revisions,
        branchesByParentFork,
        selectedChildBranchId: selectedChildBranch?.id,
        items
      });
      break;
    }

    if (entry.order < selectedForkOrder) {
      appendThreadItem({
        branchId,
        rootId: revision.rootId,
        revisions,
        branchesByParentFork,
        items
      });
    }
  }
}

export function buildChatRenderState(messages: Message[], requestedActiveBranchId?: string | null): ChatRenderState {
  const { timeline, revisions } = collectChatTimeline(messages);
  const { branches, branchesByParentFork } = collectBranches(revisions);
  const activeBranchId = resolveActiveBranchId(revisions, branches, requestedActiveBranchId);
  const path = activeBranchPath(activeBranchId, branches);
  const items: ChatRenderItem[] = [];

  path.forEach((branchId, index) => {
    const branchInfo = branchId === MAIN_CHAT_BRANCH_ID ? null : branches.get(branchId) ?? null;
    const selectedChildBranch = path[index + 1] ? branches.get(path[index + 1]) ?? null : null;
    appendBranchSegment({
      branchId,
      skipUserMessageId: branchInfo?.firstRevision.user.id ?? "",
      selectedChildBranch,
      timeline,
      revisions,
      branchesByParentFork,
      items
    });
  });

  return {
    items,
    activeBranchId,
    visibleMessages: selectedMessagesFromItems(items)
  };
}

export function buildChatRenderItems(messages: Message[]): ChatRenderItem[] {
  return buildChatRenderState(messages).items;
}
