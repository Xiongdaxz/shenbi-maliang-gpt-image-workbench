import { useI18n } from "../../i18n";
import { cx } from "../../lib/cx";

export function ImageCompareSelection({ imageIds, activeId, mobile, onActivate }: {
  imageIds: string[]; activeId: string; mobile: boolean; onActivate: (id: string) => void;
}) {
  const { t } = useI18n();
  if (mobile && imageIds.length > 1) return <div className="image-compare-switcher" role="group" aria-label={t("compare.switchSlot")}>
    {imageIds.map((id, index) => {
      const label = String.fromCharCode(65 + index);
      return <button key={id} type="button" className={cx("image-compare-switch", id === activeId && "active")}
        aria-label={t("compare.image", { label })} aria-pressed={id === activeId} data-tooltip={`${t("compare.switchSlot")} · ${label}`}
        onClick={() => onActivate(id)}>{label}</button>;
    })}
  </div>;
  const label = activeId ? String.fromCharCode(65 + imageIds.indexOf(activeId)) : "—";
  return <span className="image-compare-current" aria-label={t("compare.active", { label })} data-tooltip={t("compare.active", { label })}>{label}</span>;
}
