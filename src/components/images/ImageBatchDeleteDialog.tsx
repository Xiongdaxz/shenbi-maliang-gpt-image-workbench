import { useEffect, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { cx } from "../../lib/cx";
import type { ImageDeleteImpact } from "../../types";
import { ModalPortal } from "../../ui";

export function ImageBatchDeleteDialog({ selectedCount, impact, pending, onClose, onConfirm }: {
  selectedCount: number;
  impact: ImageDeleteImpact;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [confirmationValue, setConfirmationValue] = useState("");
  const [associatedAccepted, setAssociatedAccepted] = useState(false);
  const requiresCount = selectedCount > 20;
  useEffect(() => {
    setConfirmationValue("");
    setAssociatedAccepted(false);
  }, [impact, selectedCount]);
  const countMatched = !requiresCount || confirmationValue.trim() === String(selectedCount);
  const canConfirm = countMatched && (!impact.hasAssociated || associatedAccepted) && !pending;
  return (
    <ModalPortal>
      <div className="modal-backdrop">
        <section className="case-modal compact-modal image-batch-dialog image-batch-delete-dialog">
          <header>
            <h3>{t("pages.images.batch.deleteTitle", { count: selectedCount })}</h3>
            <button type="button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>
          </header>
          <div className="image-batch-delete-warning"><Trash2 size={20} /><span>{t("pages.images.batch.deleteWarning")}</span></div>
          <div className="image-batch-impact-grid">
            <span>{t("pages.images.batch.impactImages")}<strong>{impact.images}</strong></span>
            <span>{t("pages.images.batch.impactAssets")}<strong>{impact.assets}</strong></span>
            <span>{t("pages.images.batch.impactCases")}<strong>{impact.caseGroups}</strong></span>
          </div>
          {impact.hasAssociated ? (
            <label className={cx("case-reference-toggle", associatedAccepted && "active")}>
              <input type="checkbox" checked={associatedAccepted} onChange={(event) => setAssociatedAccepted(event.target.checked)} />
              <span className="case-reference-toggle-check" aria-hidden="true">{associatedAccepted ? <Check size={13} /> : null}</span>
              <span className="case-reference-toggle-copy">
                <span>{t("pages.images.batch.confirmAssociated")}</span>
                <small>{t("pages.images.batch.confirmAssociatedDesc")}</small>
              </span>
            </label>
          ) : null}
          {requiresCount ? (
            <label>
              {t("pages.images.batch.typeCount", { count: selectedCount })}
              <input value={confirmationValue} onChange={(event) => setConfirmationValue(event.target.value)} placeholder={String(selectedCount)} inputMode="numeric" autoFocus />
            </label>
          ) : null}
          <div className="row-actions">
            <button className="secondary-btn" type="button" onClick={onClose} disabled={pending}>{t("common.cancel")}</button>
            <button className="danger-btn" type="button" onClick={onConfirm} disabled={!canConfirm}>
              {pending ? t("common.deleting") : t("pages.images.batch.deleteConfirm", { count: selectedCount })}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
