import { RotateCcw } from "lucide-react";
import { useI18n } from "../i18n";

export function LibraryPageLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="page-load-error" role="alert">
      <span>{t("common.requestFailed")}</span>
      <button className="secondary-btn" type="button" onClick={onRetry}>
        <RotateCcw size={15} />
        {t("common.retry")}
      </button>
    </div>
  );
}
