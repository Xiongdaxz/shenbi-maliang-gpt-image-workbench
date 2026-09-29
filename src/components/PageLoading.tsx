import { useI18n } from "../i18n";
import { ProjectLogo } from "./ProjectLogo";

export function PageLoading({ label }: { label?: string }) {
  const { t } = useI18n();

  return (
    <main className="center-screen page-loading">
      <div className="page-loading-content" role="status">
        <div className="page-loading-mark" aria-hidden="true">
          <ProjectLogo className="page-loading-logo" alt="" />
        </div>
        <p className="page-loading-label">{label ?? t("common.loadingEllipsis")}</p>
      </div>
    </main>
  );
}
