import { X } from "lucide-react";
import { useI18n } from "../../i18n";
import type { ImageBatchResult } from "../../types";
import { ModalPortal } from "../../ui";

export function ImageBatchResultDialog({ title, result, onClose }: { title: string; result: ImageBatchResult; onClose: () => void }) {
  const { t } = useI18n();
  const details = result.items.filter((item) => item.status === "duplicate" || item.status === "not_found" || item.status === "failed");
  return (
    <ModalPortal>
      <div className="modal-backdrop">
        <section className="case-modal compact-modal image-batch-dialog">
          <header><h3>{title}</h3><button type="button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button></header>
          <div className="image-batch-result-summary">
            <span>{t("pages.images.batch.resultSucceeded", { count: result.succeeded })}</span>
            <span>{t("pages.images.batch.resultSkipped", { count: result.skipped })}</span>
            <span>{t("pages.images.batch.resultFailed", { count: result.failed })}</span>
          </div>
          <div className="image-batch-result-list">
            {details.map((item) => <div key={`${item.imageId}:${item.status}`}><code>{item.imageId}</code><span>{item.reason || item.status}</span></div>)}
          </div>
          <div className="row-actions"><button className="primary-btn" type="button" onClick={onClose}>{t("common.confirm")}</button></div>
        </section>
      </div>
    </ModalPortal>
  );
}
