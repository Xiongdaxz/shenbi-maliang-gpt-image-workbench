import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { ExternalLink, ImageOff, Link2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { api, type PromptReferenceLinkPayload } from "../api";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import type { PromptReferenceLink } from "../types";
import { ConfirmDialog, useToast } from "../ui";

type EditingLink =
  | { mode: "create"; link?: undefined }
  | { mode: "edit"; link: PromptReferenceLink }
  | null;

type LinkForm = {
  title: string;
  url: string;
  thumbnailUrl: string;
};

const EMPTY_FORM: LinkForm = { title: "", url: "", thumbnailUrl: "" };

function displayHost(url: string) {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function normalizeFormUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(normalizeFormUrl(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function PromptReferenceLinksDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [editingLink, setEditingLink] = useState<EditingLink>(null);
  const [form, setForm] = useState<LinkForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PromptReferenceLink | null>(null);
  const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(() => new Set());
  const [failedIcons, setFailedIcons] = useState<Set<string>>(() => new Set());

  const linksQuery = useQuery({
    queryKey: ["prompt-reference-links"],
    queryFn: () => api.promptReferenceLinks(),
    enabled: open
  });
  const links = linksQuery.data?.links ?? [];
  const filteredLinks = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return links;
    return links.filter((link) => {
      const host = displayHost(link.url).toLowerCase();
      return link.title.toLowerCase().includes(normalizedKeyword) || link.url.toLowerCase().includes(normalizedKeyword) || host.includes(normalizedKeyword);
    });
  }, [keyword, links]);

  useEffect(() => {
    if (!open) {
      setKeyword("");
      setEditingLink(null);
      setForm(EMPTY_FORM);
      setFormError("");
      setDeleteTarget(null);
      setFailedThumbnails(new Set());
      setFailedIcons(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!editingLink) {
      setForm(EMPTY_FORM);
      setFormError("");
      return;
    }
    setForm(
      editingLink.mode === "edit"
        ? {
            title: editingLink.link.titleOverride,
            url: editingLink.link.url,
            thumbnailUrl: editingLink.link.thumbnailUrlOverride
          }
        : EMPTY_FORM
    );
    setFormError("");
  }, [editingLink]);

  const createLink = useMutation({
    mutationFn: (payload: PromptReferenceLinkPayload) => api.createPromptReferenceLink(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-reference-links"] });
      setFailedThumbnails(new Set());
      setFailedIcons(new Set());
      setEditingLink(null);
      showToast(t("promptReference.toast.created"));
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t("promptReference.toast.createFailed");
      setFormError(message);
      showToast(message, "error");
    }
  });

  const updateLink = useMutation({
    mutationFn: (payload: { linkId: string; data: PromptReferenceLinkPayload }) => api.updatePromptReferenceLink(payload.linkId, payload.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-reference-links"] });
      setFailedThumbnails(new Set());
      setFailedIcons(new Set());
      setEditingLink(null);
      showToast(t("promptReference.toast.updated"));
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t("promptReference.toast.updateFailed");
      setFormError(message);
      showToast(message, "error");
    }
  });

  const deleteLink = useMutation({
    mutationFn: (linkId: string) => api.deletePromptReferenceLink(linkId),
    onSuccess: (_, linkId) => {
      queryClient.invalidateQueries({ queryKey: ["prompt-reference-links"] });
      setFailedThumbnails(new Set());
      setFailedIcons(new Set());
      setDeleteTarget(null);
      setEditingLink((value) => (value?.mode === "edit" && value.link.id === linkId ? null : value));
      showToast(t("promptReference.toast.deleted"));
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t("promptReference.toast.deleteFailed");
      showToast(message, "error");
    }
  });

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [open]);

  if (!open) return null;

  const pending = createLink.isPending || updateLink.isPending;
  const submitForm = () => {
    if (pending) return;
    const payload: PromptReferenceLinkPayload = {
      title: form.title.trim(),
      url: form.url.trim(),
      thumbnailUrl: form.thumbnailUrl.trim() || undefined
    };
    if (!payload.url || !isHttpUrl(payload.url)) {
      setFormError(t("promptReference.error.urlProtocol"));
      return;
    }
    if (payload.thumbnailUrl && !isHttpUrl(payload.thumbnailUrl)) {
      setFormError(t("promptReference.error.thumbnailProtocol"));
      return;
    }
    setFormError("");
    if (editingLink?.mode === "edit") {
      updateLink.mutate({ linkId: editingLink.link.id, data: payload });
    } else {
      createLink.mutate(payload);
    }
  };

  const dialog = (
    <>
      <div className="modal-backdrop prompt-reference-backdrop">
        <section className={cx("prompt-reference-dialog", editingLink && "has-form")} aria-label={t("promptReference.title")}>
          <header className="prompt-reference-dialog-header">
            <div>
              <h3>{t("promptReference.title")}</h3>
              <p>{t("promptReference.desc")}</p>
            </div>
            <button className="icon-btn" type="button" onClick={onClose} aria-label={t("promptReference.close")}>
              <X size={18} />
            </button>
          </header>

          <div className="prompt-reference-toolbar">
            <label className="prompt-reference-search">
              <Search size={17} />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t("promptReference.searchPlaceholder")}
                aria-label={t("promptReference.searchAria")}
              />
            </label>
            <button className="primary-btn" type="button" onClick={() => setEditingLink({ mode: "create" })}>
              <Plus size={16} />
              {t("promptReference.add")}
            </button>
          </div>

          {editingLink ? (
            <form
              className="prompt-reference-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitForm();
              }}
            >
              <div className="prompt-reference-form-title">
                <strong>{editingLink.mode === "edit" ? t("promptReference.edit") : t("promptReference.add")}</strong>
                <button className="ghost-btn" type="button" onClick={() => setEditingLink(null)}>
                  {t("common.cancel")}
                </button>
              </div>
              <div className="prompt-reference-form-grid">
                <label>
                  {t("promptReference.url")}
                  <input value={form.url} onChange={(event) => setForm((value) => ({ ...value, url: event.target.value }))} placeholder="example.com" autoFocus />
                </label>
                <label>
                  {t("promptReference.customTitle")}
                  <input
                    value={form.title}
                    onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))}
                    placeholder={t("promptReference.customTitlePlaceholder")}
                  />
                </label>
                <label>
                  {t("promptReference.customCover")}
                  <input
                    value={form.thumbnailUrl}
                    onChange={(event) => setForm((value) => ({ ...value, thumbnailUrl: event.target.value }))}
                    placeholder={t("promptReference.customCoverPlaceholder")}
                  />
                </label>
              </div>
              {formError ? <div className="form-error">{formError}</div> : null}
              <div className="row-actions">
                <button className="primary-btn" type="submit" disabled={pending}>
                  {pending ? t("common.saving") : t("promptReference.save")}
                </button>
              </div>
            </form>
          ) : null}

          <div className="prompt-reference-grid">
            {filteredLinks.map((link) => {
              const host = displayHost(link.url);
              const thumbnailFailed = failedThumbnails.has(link.id);
              const showThumbnail = Boolean(link.thumbnailUrl) && !thumbnailFailed;
              const iconFailed = failedIcons.has(link.id);
              const showIcon = Boolean(link.iconUrl) && !iconFailed;
              return (
                <article className="prompt-reference-card" key={link.id}>
                  <div className="prompt-reference-thumb-shell">
                    <a className="prompt-reference-thumb" href={link.url} target="_blank" rel="noreferrer" aria-label={t("promptReference.openNamed", { title: link.title })}>
                      {showThumbnail ? (
                        <img
                          src={link.thumbnailUrl}
                          alt={link.title}
                          onError={() =>
                            setFailedThumbnails((value) => {
                              const next = new Set(value);
                              next.add(link.id);
                              return next;
                            })
                          }
                        />
                      ) : (
                        <span className="prompt-reference-thumb-fallback">
                          {showIcon ? (
                            <img
                              className="prompt-reference-favicon"
                              src={link.iconUrl}
                              alt=""
                              onError={() =>
                                setFailedIcons((value) => {
                                  const next = new Set(value);
                                  next.add(link.id);
                                  return next;
                                })
                              }
                            />
                          ) : (
                            <ImageOff size={22} />
                          )}
                          <span>{host}</span>
                        </span>
                      )}
                    </a>
                    <div className="prompt-reference-card-actions">
                      <a className="prompt-reference-action-icon" href={link.url} target="_blank" rel="noreferrer" aria-label={t("promptReference.open")} title={t("promptReference.open")}>
                        <ExternalLink size={16} />
                      </a>
                      <button className="prompt-reference-action-icon" type="button" onClick={() => setEditingLink({ mode: "edit", link })} aria-label={t("promptReference.edit")} title={t("promptReference.edit")}>
                        <Pencil size={16} />
                      </button>
                      <button
                        className="prompt-reference-action-icon danger"
                        type="button"
                        onClick={() => setDeleteTarget(link)}
                        aria-label={t("promptReference.delete")}
                        title={t("promptReference.delete")}
                        disabled={deleteLink.isPending}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="prompt-reference-card-body">
                    <h4>{link.title}</h4>
                    <a className="prompt-reference-url" href={link.url} target="_blank" rel="noreferrer" title={link.url}>
                      <Link2 size={14} />
                      <span>{host}</span>
                    </a>
                  </div>
                </article>
              );
            })}
            {!linksQuery.isLoading && filteredLinks.length === 0 ? (
              <div className={cx("prompt-reference-empty", links.length === 0 && "is-empty-list")}>
                {links.length === 0 ? t("promptReference.empty") : t("promptReference.noMatch")}
              </div>
            ) : null}
            {linksQuery.isLoading ? <div className="prompt-reference-empty">{t("common.loading")}</div> : null}
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("promptReference.deleteTitle")}
        description={t("promptReference.deleteDescription", { title: deleteTarget?.title ?? "" })}
        confirmText={deleteLink.isPending ? t("common.deleting") : t("common.delete")}
        destructive
        onConfirm={() => {
          if (deleteTarget && !deleteLink.isPending) deleteLink.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
