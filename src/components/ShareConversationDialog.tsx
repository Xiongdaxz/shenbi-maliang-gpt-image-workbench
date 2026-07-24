import { Check, Copy, ExternalLink, Link2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { copyTextToClipboard } from "../lib/clipboard";
import { cx } from "../lib/cx";
import type { SessionShareLink } from "../types";
import { useToast } from "../ui";

export function absoluteShareUrl(link: SessionShareLink) {
  const value = link.url?.trim() || link.path;
  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return value;
  }
}

export function ShareConversationDialog({
  open,
  link,
  includeAllBranches,
  branchCount,
  pending,
  onIncludeAllBranchesChange,
  onClose
}: {
  open: boolean;
  link: SessionShareLink | null;
  includeAllBranches: boolean;
  branchCount: number;
  pending: boolean;
  onIncludeAllBranchesChange: (includeAllBranches: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const shareUrl = useMemo(() => (link ? absoluteShareUrl(link) : ""), [link]);
  useEffect(() => setCopied(false), [link?.id]);
  if (!open || !link) return null;

  const copyLink = async () => {
    const ok = await copyTextToClipboard(shareUrl);
    setCopied(ok);
    showToast(ok ? t("shareDialog.copied") : t("shareDialog.copyFailed"), ok ? "success" : "error");
    if (ok) window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="modal-backdrop modal-backdrop-top" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="case-modal compact-modal action-modal share-conversation-dialog" role="dialog" aria-modal="true" aria-label={t("shareDialog.title")}>
        <header>
          <div className="share-dialog-heading">
            <h3>{t("shareDialog.title")}</h3>
            <p>{t("shareDialog.description")}</p>
          </div>
          <button className="share-dialog-close" type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </header>
        <div className={cx("share-dialog-result", pending && "is-pending")}>
          <div className="share-dialog-url-row">
            <Link2 size={16} aria-hidden="true" />
            <div
              className="share-dialog-url-value"
              role="textbox"
              aria-label={t("shareDialog.linkLabel")}
              aria-readonly="true"
              tabIndex={0}
              title={shareUrl}
            >
              {shareUrl}
            </div>
          </div>
        </div>
        {branchCount > 1 ? (
          <label className={cx("case-reference-toggle", "share-dialog-scope-toggle", includeAllBranches && "active", pending && "is-pending")}>
            <input
              type="checkbox"
              checked={includeAllBranches}
              disabled={pending}
              onChange={(event) => onIncludeAllBranchesChange(event.target.checked)}
            />
            <span className="case-reference-toggle-check" aria-hidden="true">
              {includeAllBranches ? <Check size={13} strokeWidth={2.5} /> : null}
            </span>
            <span className="case-reference-toggle-copy">
              <span>{t("shareDialog.allBranches")}</span>
              <small>{t("shareDialog.allBranchesDescription", { count: branchCount })}</small>
            </span>
          </label>
        ) : null}
        <div className="row-actions">
          <button className="secondary-btn" type="button" disabled={pending} onClick={() => void copyLink()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? t("shareDialog.copiedShort") : t("shareDialog.copy")}
          </button>
          <button className="secondary-btn" type="button" disabled={pending} onClick={() => window.open(shareUrl, "_blank", "noopener,noreferrer")}>
            <ExternalLink size={15} />
            {t("shareDialog.open")}
          </button>
        </div>
      </section>
    </div>
  );
}
