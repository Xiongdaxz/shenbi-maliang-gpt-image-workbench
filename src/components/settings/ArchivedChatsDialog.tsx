import { ArchiveRestore, MessageCircle, Trash2, X } from "lucide-react";
import type { ChatSession } from "../../types";

type ArchivedChatsDialogProps = {
  open: boolean;
  sessions: ChatSession[];
  loading?: boolean;
  actionPending?: boolean;
  restoreAllPending?: boolean;
  onClose: () => void;
  onRestore: (session: ChatSession) => void;
  onRestoreAll: () => void;
  onDelete: (session: ChatSession) => void;
};

function formatArchivedDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(value));
}

export function ArchivedChatsDialog({
  open,
  sessions,
  loading,
  actionPending,
  restoreAllPending,
  onClose,
  onRestore,
  onRestoreAll,
  onDelete
}: ArchivedChatsDialogProps) {
  if (!open) return null;

  return (
    <div
      className="archived-chats-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="archived-chats-modal" role="dialog" aria-modal="true" aria-label="已归档的聊天">
        <header>
          <h3>已归档的聊天</h3>
          <div className="archived-chat-head-actions">
            <button
              className="secondary-btn"
              type="button"
              disabled={loading || restoreAllPending || sessions.length === 0}
              onClick={onRestoreAll}
            >
              <ArchiveRestore size={15} />
              {restoreAllPending ? "恢复中" : "全部取消归档"}
            </button>
            <button className="archived-close-btn" type="button" onClick={onClose} aria-label="关闭">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="archived-chat-table">
          <div className="archived-chat-row header" role="row">
            <span>名称</span>
            <span>创建日期</span>
            <span />
          </div>
          {loading ? <div className="archived-chat-empty">读取中...</div> : null}
          {!loading && sessions.length === 0 ? <div className="archived-chat-empty">暂无已归档聊天</div> : null}
          {!loading
            ? sessions.map((session) => (
                <div className="archived-chat-row" role="row" key={session.id}>
                  <span className="archived-chat-title">
                    <MessageCircle size={17} />
                    <strong>{session.title}</strong>
                  </span>
                  <span>{formatArchivedDate(session.createdAt)}</span>
                  <span className="archived-chat-actions">
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={() => onRestore(session)}
                      aria-label={`取消归档：${session.title}`}
                      title="取消归档"
                    >
                      <ArchiveRestore size={17} />
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={actionPending}
                      onClick={() => onDelete(session)}
                      aria-label={`删除聊天：${session.title}`}
                      title="删除"
                    >
                      <Trash2 size={17} />
                    </button>
                  </span>
                </div>
              ))
            : null}
        </div>
      </section>
    </div>
  );
}
