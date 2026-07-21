import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { splitFileDisplayName } from "../lib/assets";
import { cx } from "../lib/cx";
import { useI18n } from "../i18n";
import { ModalPortal } from "../ui";
import type { AssetItem, CaseCategory } from "../types";
import { CaseCategoryMultiSelect } from "./CaseCategoryMultiSelect";

export function AssetEditModal({
  asset,
  categories,
  assetReviewEnabled,
  pending,
  error,
  onClose,
  onSave
}: {
  asset: AssetItem;
  categories: CaseCategory[];
  assetReviewEnabled: boolean;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: (payload: { name: string; categoryIds: string[]; shared?: boolean }) => void;
}) {
  const { t } = useI18n();
  const nameParts = splitFileDisplayName(asset.name);
  const [name, setName] = useState(nameParts.base);
  const [categoryIds, setCategoryIds] = useState<string[]>(asset.categoryIds);
  const [shared, setShared] = useState(asset.shared || asset.shareStatus === "pending");

  useEffect(() => {
    setName(splitFileDisplayName(asset.name).base);
    setCategoryIds(asset.categoryIds);
    setShared(asset.shared || asset.shareStatus === "pending");
  }, [asset.categoryIds, asset.id, asset.name, asset.shareStatus, asset.shared]);

  const submit = () => {
    const nextName = name.trim();
    if (!nextName || pending) return;
    onSave({
      name: nextName,
      categoryIds,
      ...(asset.space === "private" ? { shared } : {})
    });
  };

  return (
    <ModalPortal>
      <div className="modal-backdrop">
        <section className="case-modal compact-modal asset-category-modal">
          <header>
            <h3>{t("assetEdit.title")}</h3>
            <button onClick={onClose} aria-label={t("common.close")}>
              <X size={18} />
            </button>
          </header>
          <img src={asset.previewUrl ?? asset.url} alt={asset.name} />
          <label>
            {t("assetEdit.name")}
            <span className="asset-name-input-row">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("assetEdit.namePlaceholder")} />
              {nameParts.ext ? <span>{nameParts.ext}</span> : null}
            </span>
          </label>
          <label>
            {t("assetEdit.tags")}
            <CaseCategoryMultiSelect categories={categories} value={categoryIds} onChange={setCategoryIds} labelName={t("assetEdit.tags")} />
          </label>
          <label className="asset-upload-field">
            {t("assetEdit.shareStatus")}
            {asset.space === "private" ? (
              <div className="asset-space-options" role="group" aria-label={t("assetEdit.shareStatus")}>
                <button
                  type="button"
                  className={cx(shared && "active")}
                  onClick={() => setShared((value) => !value)}
                >
                  <span className="asset-option-check">{shared ? <Check size={14} /> : null}</span>
                  <span>
                    {assetReviewEnabled
                      ? shared
                        ? asset.shareStatus === "pending"
                          ? t("assetEdit.sharePending")
                          : t("assetEdit.shareApplied")
                        : t("assetEdit.submitShare")
                      : shared
                        ? t("assetEdit.shared")
                        : t("assetEdit.share")}
                  </span>
                </button>
              </div>
            ) : (
              <span className="asset-shared-note">{t("assetEdit.alreadyShared")}</span>
            )}
          </label>
          {error ? <div className="form-error">{error.message}</div> : null}
          <div className="row-actions">
            <button className="secondary-btn" type="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button className="primary-btn" type="button" onClick={submit} disabled={!name.trim() || pending}>
              {pending ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
