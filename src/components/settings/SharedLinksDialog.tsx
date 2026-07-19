import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Link2, MessageCircle, MoreHorizontal, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { copyTextToClipboard } from "../../lib/clipboard";
import type { SessionShareLink } from "../../types";
import { ConfirmDialog, useToast } from "../../ui";

const SHARE_LINK_PAGE_SIZE = 30;

function absoluteShareUrl(link: SessionShareLink) {
  try {
    return new URL(link.url?.trim() || link.path, window.location.origin).toString();
  } catch {
    return link.url?.trim() || link.path;
  }
}

function formatDate(value: string, locale: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" }).format(date);
}

export function SharedLinksDialog({
  open,
  onClose,
  onCloseSettings
}: {
  open: boolean;
  onClose: () => void;
  onCloseSettings: () => void;
}) {
  const { resolvedLanguage, t } = useI18n();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SessionShareLink | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const linksQuery = useInfiniteQuery({
    queryKey: ["session-share-links", "paged"],
    queryFn: ({ pageParam, signal }) => api.sessionShareLinks({ limit: SHARE_LINK_PAGE_SIZE, offset: Number(pageParam) }, { signal }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.pageInfo.hasMore ? lastPage.pageInfo.offset + lastPage.pageInfo.limit : undefined,
    enabled: open
  });
  const links = useMemo(() => linksQuery.data?.pages.flatMap((page) => page.links) ?? [], [linksQuery.data?.pages]);
  const total = linksQuery.data?.pages[0]?.pageInfo.total ?? 0;
  useEffect(() => {
    if (!open) {
      setMenuOpen(false);
      return;
    }
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen, open]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["session-share-links", "paged"] }),
      queryClient.invalidateQueries({ queryKey: ["session-share-links", "count"] })
    ]);
  };
  const deleteOne = useMutation({
    mutationFn: (id: string) => api.deleteSessionShareLink(id),
    onSuccess: async () => {
      setDeleteTarget(null);
      await refresh();
      showToast(t("sharedLinks.revoked"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("sharedLinks.revokeFailed"), "error")
  });
  const deleteAll = useMutation({
    mutationFn: api.deleteAllSessionShareLinks,
    onSuccess: async ({ deleted }) => {
      setDeleteAllOpen(false);
      await refresh();
      showToast(t("sharedLinks.allRevoked", { count: deleted }));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("sharedLinks.revokeAllFailed"), "error")
  });
  if (!open) return null;

  const copyLink = async (link: SessionShareLink) => {
    const ok = await copyTextToClipboard(absoluteShareUrl(link));
    showToast(ok ? t("shareDialog.copied") : t("shareDialog.copyFailed"), ok ? "success" : "error");
  };

  return (
    <>
      <div className="archived-chats-backdrop shared-links-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <section className="archived-chats-modal shared-links-modal" role="dialog" aria-modal="true" aria-label={t("sharedLinks.title")}>
          <header>
            <div className="shared-links-heading">
              <h3>{t("sharedLinks.title")}</h3>
              <p>{t("sharedLinks.description")}</p>
            </div>
            <div className="archived-chat-head-actions shared-links-head-actions">
              <div ref={menuRef} className="shared-links-more-wrap">
                <button
                  className="archived-close-btn"
                  type="button"
                  onClick={() => setMenuOpen((value) => !value)}
                  aria-label={t("common.more")}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <MoreHorizontal size={18} />
                </button>
                {menuOpen ? (
                  <div className="shared-links-more-menu ui-pop-motion" role="menu" data-state="open" data-placement="bottom-end">
                    <button
                      className="danger"
                      type="button"
                      role="menuitem"
                      disabled={total === 0 || deleteAll.isPending}
                      onClick={() => {
                        setMenuOpen(false);
                        setDeleteAllOpen(true);
                      }}
                    >
                      <Trash2 size={16} />
                      {t("sharedLinks.revokeAll")}
                    </button>
                  </div>
                ) : null}
              </div>
              <button className="archived-close-btn" type="button" onClick={onClose} aria-label={t("common.close")}>
                <X size={18} />
              </button>
            </div>
          </header>
          <div className="archived-chat-table shared-links-table">
            <div className="archived-chat-row shared-link-row header" role="row">
              <span>{t("sharedLinks.name")}</span>
              <span>{t("sharedLinks.type")}</span>
              <span>{t("sharedLinks.sharedAt")}</span>
              <span />
            </div>
            {linksQuery.isLoading ? <div className="archived-chat-empty">{t("common.loadingEllipsis")}</div> : null}
            {linksQuery.isError ? <div className="archived-chat-empty form-error">{t("sharedLinks.loadFailed")}</div> : null}
            {!linksQuery.isLoading && !linksQuery.isError && links.length === 0 ? <div className="archived-chat-empty">{t("sharedLinks.empty")}</div> : null}
            {links.map((link) => (
              <div className="archived-chat-row shared-link-row" role="row" key={link.id}>
                <button className="shared-link-title" type="button" onClick={() => window.open(absoluteShareUrl(link), "_blank", "noopener,noreferrer")}>
                  <Link2 size={16} />
                  <strong>{link.title}</strong>
                </button>
                <span>{t("sharedLinks.chatType")}</span>
                <span>{formatDate(link.createdAt, resolvedLanguage)}</span>
                <span className="archived-chat-actions shared-link-actions">
                  <button type="button" onClick={() => void copyLink(link)} aria-label={t("sharedLinks.copyOne", { title: link.title })} title={t("shareDialog.copy")}>
                    <Copy size={16} />
                  </button>
                  <button type="button" onClick={() => window.open(absoluteShareUrl(link), "_blank", "noopener,noreferrer")} aria-label={t("sharedLinks.openOne", { title: link.title })} title={t("shareDialog.open")}>
                    <ExternalLink size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onCloseSettings();
                      navigate(`/chat/${encodeURIComponent(link.sessionId)}`);
                    }}
                    aria-label={t("sharedLinks.sourceChatOne", { title: link.title })}
                    title={t("sharedLinks.sourceChat")}
                  >
                    <MessageCircle size={16} />
                  </button>
                  <button className="danger" type="button" onClick={() => setDeleteTarget(link)} aria-label={t("sharedLinks.revokeOne", { title: link.title })} title={t("sharedLinks.revoke")}>
                    <Trash2 size={16} />
                  </button>
                </span>
              </div>
            ))}
            {linksQuery.hasNextPage ? (
              <button className="secondary-btn shared-links-load-more" type="button" disabled={linksQuery.isFetchingNextPage} onClick={() => void linksQuery.fetchNextPage()}>
                {linksQuery.isFetchingNextPage ? t("common.loading") : t("sharedLinks.loadMore")}
              </button>
            ) : null}
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("sharedLinks.revokeTitle")}
        description={t("sharedLinks.revokeDescription")}
        confirmText={t("sharedLinks.revoke")}
        cancelText={t("common.cancel")}
        destructive
        backdropClassName="modal-backdrop-top"
        onConfirm={() => deleteTarget && !deleteOne.isPending && deleteOne.mutate(deleteTarget.id)}
        onCancel={() => !deleteOne.isPending && setDeleteTarget(null)}
      />
      <ConfirmDialog
        open={deleteAllOpen}
        title={t("sharedLinks.revokeAllTitle")}
        description={t("sharedLinks.revokeAllDescription")}
        confirmText={t("sharedLinks.revokeAll")}
        cancelText={t("common.cancel")}
        destructive
        backdropClassName="modal-backdrop-top"
        onConfirm={() => !deleteAll.isPending && deleteAll.mutate()}
        onCancel={() => !deleteAll.isPending && setDeleteAllOpen(false)}
      />
    </>
  );
}
