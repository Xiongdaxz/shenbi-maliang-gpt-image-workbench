import { publicAssetPath } from "../lib/publicAssets";
import { cx } from "../lib/cx";

const PROJECT_LOGO_SRC = publicAssetPath("/image/logo.png");

export function ProjectLogo({ className, alt = "神笔马良" }: { className?: string; alt?: string }) {
  return <img className={cx("project-logo", className)} src={PROJECT_LOGO_SRC} alt={alt} />;
}
