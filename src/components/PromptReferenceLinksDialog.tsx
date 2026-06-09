import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ImageOff, Link2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { api, type PromptReferenceLinkPayload } from "../api";
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
      showToast("灵感链接已新增");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "新增灵感链接失败";
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
      showToast("灵感链接已更新");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "更新灵感链接失败";
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
      showToast("灵感链接已删除");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "删除灵感链接失败";
      showToast(message, "error");
    }
  });

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
      setFormError("链接地址必须是 http 或 https");
      return;
    }
    if (payload.thumbnailUrl && !isHttpUrl(payload.thumbnailUrl)) {
      setFormError("缩略图地址必须是 http 或 https");
      return;
    }
    setFormError("");
    if (editingLink?.mode === "edit") {
      updateLink.mutate({ linkId: editingLink.link.id, data: payload });
    } else {
      createLink.mutate(payload);
    }
  };

  return (
    <>
      <div className="modal-backdrop prompt-reference-backdrop">
      <section className={cx("prompt-reference-dialog", editingLink && "has-form")} aria-label="灵感链接">
        <header className="prompt-reference-dialog-header">
          <div>
            <h3>灵感链接</h3>
            <p>收集常用生图提示词网站，打开后可以直接找灵感。</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭灵感链接">
            <X size={18} />
          </button>
        </header>

        <div className="prompt-reference-toolbar">
          <label className="prompt-reference-search">
            <Search size={17} />
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索链接标题或地址" aria-label="搜索灵感链接" />
          </label>
          <button className="primary-btn" type="button" onClick={() => setEditingLink({ mode: "create" })}>
            <Plus size={16} />
            新增链接
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
              <strong>{editingLink.mode === "edit" ? "编辑链接" : "新增链接"}</strong>
              <button className="ghost-btn" type="button" onClick={() => setEditingLink(null)}>
                取消
              </button>
            </div>
            <div className="prompt-reference-form-grid">
              <label>
                链接地址
                <input value={form.url} onChange={(event) => setForm((value) => ({ ...value, url: event.target.value }))} placeholder="example.com" autoFocus />
              </label>
              <label>
                自定义标题
                <input
                  value={form.title}
                  onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))}
                  placeholder="不填则自动读取网页标题"
                />
              </label>
              <label>
                自定义封面
                <input
                  value={form.thumbnailUrl}
                  onChange={(event) => setForm((value) => ({ ...value, thumbnailUrl: event.target.value }))}
                  placeholder="不填则自动读取封面或图标"
                />
              </label>
            </div>
            {formError ? <div className="form-error">{formError}</div> : null}
            <div className="row-actions">
              <button className="primary-btn" type="submit" disabled={pending}>
                {pending ? "保存中" : "保存链接"}
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
                  <a className="prompt-reference-thumb" href={link.url} target="_blank" rel="noreferrer" aria-label={`打开${link.title}`}>
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
                    <a className="prompt-reference-action-icon" href={link.url} target="_blank" rel="noreferrer" aria-label="打开链接" title="打开链接">
                      <ExternalLink size={16} />
                    </a>
                    <button className="prompt-reference-action-icon" type="button" onClick={() => setEditingLink({ mode: "edit", link })} aria-label="编辑链接" title="编辑链接">
                      <Pencil size={16} />
                    </button>
                    <button
                      className="prompt-reference-action-icon danger"
                      type="button"
                      onClick={() => setDeleteTarget(link)}
                      aria-label="删除链接"
                      title="删除链接"
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
              {links.length === 0 ? "暂无灵感链接" : "暂无匹配链接"}
            </div>
          ) : null}
          {linksQuery.isLoading ? <div className="prompt-reference-empty">加载中</div> : null}
        </div>
      </section>
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除灵感链接"
        description={`确认删除“${deleteTarget?.title ?? ""}”？删除后不会影响目标网页或其他数据。`}
        confirmText={deleteLink.isPending ? "删除中" : "删除"}
        destructive
        onConfirm={() => {
          if (deleteTarget && !deleteLink.isPending) deleteLink.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
