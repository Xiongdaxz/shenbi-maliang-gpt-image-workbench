import { ArchiveRestore, MessageCircle, Trash2, X } from "lucide-react";
import { useI18n } from "../../i18n";
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

function formatArchivedDate(value: string, locale: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(locale, {
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
  const { resolvedLanguage, t } = useI18n();
  if (!open) return null;

  return (
    <div
      className="archived-chats-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="archived-chats-modal" role="dialog" aria-modal="true" aria-label={t("settings.data.archivedChats")}>
        <header>
          <h3>{t("settings.data.archivedChats")}</h3>
          <div className="archived-chat-head-actions">
            <button
              className="secondary-btn"
              type="button"
              disabled={loading || restoreAllPending || sessions.length === 0}
              onClick={onRestoreAll}
            >
              <ArchiveRestore size={15} />
              {restoreAllPending ? t("archivedChats.restoring") : t("archivedChats.restoreAll")}
            </button>
            <button className="archived-close-btn" type="button" onClick={onClose} aria-label={t("common.close")}>
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="archived-chat-table">
          <div className="archived-chat-row header" role="row">
            <span>{t("archivedChats.name")}</span>
            <span>{t("archivedChats.createdAt")}</span>
            <span />
          </div>
          {loading ? <div className="archived-chat-empty">{t("common.loadingEllipsis")}</div> : null}
          {!loading && sessions.length === 0 ? <div className="archived-chat-empty">{t("archivedChats.empty")}</div> : null}
          {!loading
            ? sessions.map((session) => (
                <div className="archived-chat-row" role="row" key={session.id}>
                  <span className="archived-chat-title">
                    <MessageCircle size={17} />
                    <strong>{session.title}</strong>
                  </span>
                  <span>{formatArchivedDate(session.createdAt, resolvedLanguage)}</span>
                  <span className="archived-chat-actions">
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={() => onRestore(session)}
                      aria-label={t("archivedChats.restoreOne", { title: session.title })}
                      title={t("archivedChats.restore")}
                    >
                      <ArchiveRestore size={17} />
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={actionPending}
                      onClick={() => onDelete(session)}
                      aria-label={t("archivedChats.deleteOne", { title: session.title })}
                      title={t("common.delete")}
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
