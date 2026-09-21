import { randomUUID } from "node:crypto";
import { buildChatRenderState, MAIN_CHAT_BRANCH_ID } from "../src/lib/chatRender";
import type { Message } from "../src/types";
import { expireStaleImageJobs } from "./chatStore";
import { appDb, getAll, getOne, run } from "./db";
import { now, safeJson } from "./utils";

export const SESSION_SHARE_MAX_MESSAGES = 2_000;

export type SessionShareLinkRow = {
  id: string;
  public_token: string;
  user_id: string;
  session_id: string;
  title: string;
  includes_branches: number;
  include_references: number;
  created_at: string;
  message_count?: number | null;
};

export class SessionShareError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "SessionShareError";
  }
}

export type SessionShareSnapshot = {
  sessionId: string;
  messageIds: string[];
};

type BranchMessageRow = {
  id: string;
  role: string;
  content: string;
  image_id: string | null;
  metadata: string | null;
  created_at: string;
};

function renderMessage(row: BranchMessageRow): Message {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    imageId: row.image_id,
    imageUrl: null,
    imagePrompt: null,
    imageKind: null,
    imageSize: null,
    imageQuality: null,
    imageProviderId: null,
    parentImageId: null,
    metadata: safeJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.created_at
  };
}

function messageBranchId(message: Message, fallbackJobBranches: Map<string, string>) {
  const explicit = String(message.metadata.branchId ?? "").trim();
  if (explicit) return explicit;
  const jobId = String(message.metadata.jobId ?? "").trim();
  return fallbackJobBranches.get(jobId) ?? MAIN_CHAT_BRANCH_ID;
}

export function caseShareMessageIds(messages: readonly Message[], imageIds: readonly string[]) {
  const ids = Array.from(new Set(imageIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) throw new SessionShareError("请选择可分享的绘画图片");
  const fallbackJobBranches = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    const jobId = String(message.metadata.jobId ?? "").trim();
    if (!jobId) continue;
    fallbackJobBranches.set(jobId, String(message.metadata.branchId ?? "").trim() || MAIN_CHAT_BRANCH_ID);
  }
  const targetByImageId = new Map<string, Message>();
  for (const message of messages) {
    if (message.role === "assistant" && message.imageId && ids.includes(message.imageId)) targetByImageId.set(message.imageId, message);
  }
  if (targetByImageId.size !== ids.length) throw new SessionShareError("绘画结果消息不存在，无法创建分享链接", 409);
  const targets = ids.map((id) => targetByImageId.get(id)!);
  const branchIds = new Set(targets.map((message) => messageBranchId(message, fallbackJobBranches)));
  if (branchIds.size !== 1) throw new SessionShareError("所选图片不在同一个会话分支");
  const branchId = messageBranchId(targets[0]!, fallbackJobBranches);
  const visibleMessages = buildChatRenderState([...messages], branchId).visibleMessages;
  const visibleIndexById = new Map(visibleMessages.map((message, index) => [message.id, index]));
  const targetIndexes = targets.map((message) => visibleIndexById.get(message.id) ?? -1);
  if (targetIndexes.some((index) => index < 0)) throw new SessionShareError("所选图片不在同一个可分享会话分支", 409);
  return visibleMessages.slice(0, Math.max(...targetIndexes) + 1).map((message) => message.id);
}

export function sessionShareSnapshotForImages(userId: string, imageIds: readonly string[]): SessionShareSnapshot {
  const ids = Array.from(new Set(imageIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) throw new SessionShareError("请选择可分享的绘画图片");
  const images = getAll<{ id: string; session_id: string | null }>(
    appDb,
    `select id, session_id from images where user_id = ? and id in (${ids.map(() => "?").join(", ")})`,
    userId,
    ...ids
  );
  if (images.length !== ids.length) throw new SessionShareError("部分绘画图片不存在", 404);
  const sessionIds = new Set(images.map((image) => image.session_id?.trim() ?? ""));
  if (sessionIds.size !== 1 || sessionIds.has("")) throw new SessionShareError("所选图片未关联同一个可分享会话");
  const sessionId = images[0]!.session_id!.trim();
  const rows = getAll<BranchMessageRow>(
    appDb,
    `select id, role, content, image_id, metadata, created_at
     from messages
     where user_id = ? and session_id = ? and role in ('user', 'assistant')
     order by created_at asc, rowid asc`,
    userId,
    sessionId
  );
  const messages = rows.map(renderMessage);
  const messageIds = caseShareMessageIds(messages, ids);
  if (messageIds.length === 0) throw new SessionShareError("当前会话没有可分享的消息");
  return { sessionId, messageIds };
}

export function createOrReuseSessionShareSnapshot(input: {
  userId: string;
  sessionId: string;
  messageIds: readonly string[];
  includeBranches: boolean;
  includeReferences: boolean;
}) {
  expireStaleImageJobs(input.userId, input.sessionId);
  const messageIds = input.messageIds.map((id) => id.trim());
  if (messageIds.length === 0) throw new SessionShareError("当前会话没有可分享的消息");
  if (messageIds.length > SESSION_SHARE_MAX_MESSAGES) throw new SessionShareError(`单次最多分享 ${SESSION_SHARE_MAX_MESSAGES} 条消息`);
  if (messageIds.some((id) => !id) || new Set(messageIds).size !== messageIds.length) throw new SessionShareError("分享消息列表无效");
  const session = getOne<{ id: string; title: string }>(
    appDb,
    "select id, title from sessions where id = ? and user_id = ? and deleted_at is null",
    input.sessionId,
    input.userId
  );
  if (!session) throw new SessionShareError("对话不存在", 404);
  const running = getOne<{ id: string }>(
    appDb,
    "select id from image_jobs where session_id = ? and user_id = ? and status = 'running' limit 1",
    input.sessionId,
    input.userId
  );
  if (running) throw new SessionShareError("图片仍在生成中，请完成后再分享", 409);
  const rows = getAll<{ id: string; role: string }>(
    appDb,
    `select id, role from messages
     where session_id = ? and user_id = ? and id in (${messageIds.map(() => "?").join(", ")})
     order by created_at asc, rowid asc`,
    input.sessionId,
    input.userId,
    ...messageIds
  );
  if (
    rows.length !== messageIds.length ||
    rows.some((row) => row.role !== "user" && row.role !== "assistant") ||
    rows.some((row, index) => row.id !== messageIds[index])
  ) {
    throw new SessionShareError("消息列表已变化，请刷新会话后重试", 409);
  }
  const includeReferences = input.includeReferences ? 1 : 0;
  const existingShares = getAll<SessionShareLinkRow>(
    appDb,
    `select l.*,
            (select count(*) from session_share_messages sm where sm.share_id = l.id) as message_count
     from session_share_links l
     where l.user_id = ? and l.session_id = ?
       and l.includes_branches = ? and coalesce(l.include_references, 1) = ?
       and (select count(*) from session_share_messages sm where sm.share_id = l.id) = ?
     order by l.created_at asc, l.rowid asc`,
    input.userId,
    input.sessionId,
    input.includeBranches ? 1 : 0,
    includeReferences,
    rows.length
  );
  const requestedIds = rows.map((row) => row.id);
  const existingShare = existingShares.find((share) => {
    const existingMessageIds = getAll<{ message_id: string }>(
      appDb,
      "select message_id from session_share_messages where share_id = ? order by sort_order asc",
      share.id
    ).map((item) => item.message_id);
    return existingMessageIds.length === requestedIds.length && existingMessageIds.every((id, index) => id === requestedIds[index]);
  });
  if (existingShare) return { row: existingShare, reused: true as const };

  const id = `share_${randomUUID().replaceAll("-", "")}`;
  const publicToken = randomUUID();
  const timestamp = now();
  run(
    appDb,
    `insert into session_share_links
      (id, public_token, user_id, session_id, title, includes_branches, include_references, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    publicToken,
    input.userId,
    input.sessionId,
    session.title,
    input.includeBranches ? 1 : 0,
    includeReferences,
    timestamp
  );
  rows.forEach((row, index) => {
    run(appDb, "insert into session_share_messages (share_id, message_id, sort_order) values (?, ?, ?)", id, row.id, index);
  });
  return {
    row: {
      id,
      public_token: publicToken,
      user_id: input.userId,
      session_id: input.sessionId,
      title: session.title,
      includes_branches: input.includeBranches ? 1 : 0,
      include_references: includeReferences,
      created_at: timestamp,
      message_count: rows.length
    } satisfies SessionShareLinkRow,
    reused: false as const
  };
}

export function attachCaseSessionShare(groupId: string, shareId: string) {
  run(
    appDb,
    `insert into case_session_shares (group_id, share_id, created_at) values (?, ?, ?)
     on conflict(group_id) do update set share_id = excluded.share_id, created_at = excluded.created_at`,
    groupId,
    shareId,
    now()
  );
}

export function detachCaseSessionShare(groupId: string) {
  run(appDb, "delete from case_session_shares where group_id = ?", groupId);
}

export type CaseSessionShareAssociation = {
  shareId: string;
  includeReferences: boolean;
};

export type CaseSessionShareAssociationAction = "preserve" | "attach" | "detach";

export function caseSessionShareAssociation(groupId: string): CaseSessionShareAssociation | null {
  const row = getOne<{ share_id: string; include_references: number }>(
    appDb,
    `select css.share_id, coalesce(ssl.include_references, 1) as include_references
     from case_session_shares css
     join session_share_links ssl on ssl.id = css.share_id
     where css.group_id = ?`,
    groupId
  );
  return row ? { shareId: row.share_id, includeReferences: row.include_references !== 0 } : null;
}

export function caseSessionShareAssociationAction(input: {
  current: CaseSessionShareAssociation | null;
  nextEnabled: boolean;
  nextIncludeReferences: boolean;
}): CaseSessionShareAssociationAction {
  if (!input.nextEnabled) return input.current ? "detach" : "preserve";
  if (!input.current || input.current.includeReferences !== input.nextIncludeReferences) return "attach";
  return "preserve";
}

export type CaseSessionShareMetadata = {
  conversationSharePath: string | null;
  conversationShareAvailable: boolean;
};

export function caseSessionShareMetadataByGroupIds(groupIds: readonly string[]) {
  const ids = Array.from(new Set(groupIds.map((id) => id.trim()).filter(Boolean)));
  const result = new Map<string, CaseSessionShareMetadata>();
  for (const id of ids) result.set(id, { conversationSharePath: null, conversationShareAvailable: false });
  if (ids.length === 0) return result;
  const rows = getAll<{
    group_id: string;
    image_id: string | null;
    asset_id: string | null;
    session_id: string | null;
    public_token: string | null;
  }>(
    appDb,
    `select cgi.group_id, cgi.image_id, cgi.asset_id, images.session_id, session_share_links.public_token
     from case_group_images cgi
     left join images on images.id = cgi.image_id
     left join case_session_shares css on css.group_id = cgi.group_id
     left join session_share_links on session_share_links.id = css.share_id
     where cgi.group_id in (${ids.map(() => "?").join(", ")})
     order by cgi.group_id asc, cgi.sort_order asc, cgi.rowid asc`,
    ...ids
  );
  const rowsByGroup = new Map<string, typeof rows>();
  for (const row of rows) rowsByGroup.set(row.group_id, [...(rowsByGroup.get(row.group_id) ?? []), row]);
  for (const groupId of ids) {
    const groupRows = rowsByGroup.get(groupId) ?? [];
    const sessions = new Set(groupRows.map((row) => row.session_id?.trim() ?? ""));
    const available = groupRows.length > 0 && groupRows.every((row) => Boolean(row.image_id) && !row.asset_id) && sessions.size === 1 && !sessions.has("");
    const publicToken = groupRows.find((row) => row.public_token)?.public_token?.trim() ?? "";
    result.set(groupId, {
      conversationSharePath: publicToken ? `/share/${encodeURIComponent(publicToken)}` : null,
      conversationShareAvailable: available
    });
  }
  return result;
}

export function caseSessionShareMetadata(groupId: string, ownerUserId?: string | null) {
  const metadata = caseSessionShareMetadataByGroupIds([groupId]).get(groupId) ?? {
    conversationSharePath: null,
    conversationShareAvailable: false
  };
  const userId = ownerUserId?.trim() ?? "";
  if (!userId) return { ...metadata, conversationShareAvailable: false };
  if (!metadata.conversationShareAvailable) return metadata;
  const imageIds = getAll<{ image_id: string | null }>(
    appDb,
    "select image_id from case_group_images where group_id = ? and user_id = ? order by sort_order asc, rowid asc",
    groupId,
    userId
  ).map((row) => row.image_id?.trim() ?? "").filter(Boolean);
  try {
    const snapshot = sessionShareSnapshotForImages(userId, imageIds);
    const session = getOne<{ id: string }>(
      appDb,
      "select id from sessions where id = ? and user_id = ? and deleted_at is null",
      snapshot.sessionId,
      userId
    );
    const running = getOne<{ id: string }>(
      appDb,
      "select id from image_jobs where session_id = ? and user_id = ? and status = 'running' limit 1",
      snapshot.sessionId,
      userId
    );
    return { ...metadata, conversationShareAvailable: Boolean(session) && !running };
  } catch {
    return { ...metadata, conversationShareAvailable: false };
  }
}
