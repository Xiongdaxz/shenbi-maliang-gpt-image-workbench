import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { splitFileDisplayName } from "../lib/assets";
import { cx } from "../lib/cx";
import type { AssetItem, CaseCategory } from "../types";
import { CaseCategoryMultiSelect } from "./CaseCategoryMultiSelect";

export function AssetEditModal({
  asset,
  categories,
  pending,
  error,
  onClose,
  onSave
}: {
  asset: AssetItem;
  categories: CaseCategory[];
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: (payload: { name: string; categoryIds: string[]; shared?: boolean }) => void;
}) {
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
    <div className="modal-backdrop">
      <section className="case-modal compact-modal asset-category-modal">
        <header>
          <h3>编辑素材</h3>
          <button onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <img src={asset.previewUrl ?? asset.url} alt={asset.name} />
        <label>
          名称
          <span className="asset-name-input-row">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="素材名称" />
            {nameParts.ext ? <span>{nameParts.ext}</span> : null}
          </span>
        </label>
        <label>
          标签
          <CaseCategoryMultiSelect categories={categories} value={categoryIds} onChange={setCategoryIds} labelName="标签" />
        </label>
        <label className="asset-upload-field">
          共享状态
          {asset.space === "private" ? (
            <div className="asset-space-options" role="group" aria-label="共享状态">
              <button
                type="button"
                className={cx(shared && "active")}
                onClick={() => setShared((value) => !value)}
              >
                <span className="asset-option-check">{shared ? <Check size={14} /> : null}</span>
                <span>{shared ? (asset.shareStatus === "pending" ? "共享审核中" : "已申请共享") : "提交共享审核"}</span>
              </button>
            </div>
          ) : (
            <span className="asset-shared-note">本素材已在共享中，无需单独共享。</span>
          )}
        </label>
        {error ? <div className="form-error">{error.message}</div> : null}
        <div className="row-actions">
          <button className="secondary-btn" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-btn" type="button" onClick={submit} disabled={!name.trim() || pending}>
            {pending ? "保存中" : "保存"}
          </button>
        </div>
      </section>
    </div>
  );
}
