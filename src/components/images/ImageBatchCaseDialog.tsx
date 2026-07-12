import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { cx } from "../../lib/cx";
import type { WorkImage } from "../../types";
import { ModalPortal } from "../../ui";

export function ImageBatchCaseDialog({ images, pending, error, onClose, onSubmit }: {
  images: WorkImage[];
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onSubmit: (payload: { includeReferences: boolean }) => void;
}) {
  const { t } = useI18n();
  const [includeReferences, setIncludeReferences] = useState(true);
  return (
    <ModalPortal>
      <div className="modal-backdrop">
        <section className="case-modal compact-modal image-batch-dialog">
          <header>
            <h3>{t("pages.images.batch.caseTitle", { count: images.length })}</h3>
            <button type="button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>
          </header>
          <div className="image-batch-preview-strip">
            {images.slice(0, 8).map((image) => <img key={image.id} src={image.thumbnailUrl || image.previewUrl || image.url} alt="" />)}
            {images.length > 8 ? <span>+{images.length - 8}</span> : null}
          </div>
          <div className="image-batch-auto-field-hint">
            <Sparkles size={19} />
            <span>
              <strong>{t("pages.images.batch.caseAutoFields")}</strong>
              <small>{t("pages.images.batch.caseAutoFieldsDesc")}</small>
            </span>
          </div>
          <label className={cx("case-reference-toggle", includeReferences && "active")}>
            <input type="checkbox" checked={includeReferences} onChange={(event) => setIncludeReferences(event.target.checked)} />
            <span className="case-reference-toggle-check" aria-hidden="true">{includeReferences ? <Check size={13} /> : null}</span>
            <span className="case-reference-toggle-copy">
              <span>{t("pages.cases.includeReferences")}</span>
              <small>{t("pages.cases.includeReferencesDesc")}</small>
            </span>
          </label>
          {error ? <div className="form-error">{error.message}</div> : null}
          <div className="row-actions">
            <button className="secondary-btn" type="button" onClick={onClose} disabled={pending}>{t("common.cancel")}</button>
            <button className="primary-btn" type="button" onClick={() => onSubmit({ includeReferences })} disabled={pending}>
              {pending ? t("common.adding") : t("pages.images.batch.caseConfirm", { count: images.length })}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
