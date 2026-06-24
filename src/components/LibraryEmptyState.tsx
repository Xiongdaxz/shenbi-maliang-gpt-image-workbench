import type { ReactNode } from "react";
import { publicAssetPath } from "../lib/publicAssets";
import { cx } from "../lib/cx";

type LibraryEmptyStateProps = {
  imageSrc?: string;
  imageAlt?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
};

export function LibraryEmptyState({
  imageSrc,
  imageAlt = "",
  title,
  description,
  action,
  compact = false
}: LibraryEmptyStateProps) {
  return (
    <section className={cx("library-empty-state", compact && "compact")}>
      {imageSrc ? (
        <img
          className="library-empty-state-illustration"
          src={publicAssetPath(imageSrc)}
          alt={imageAlt}
          loading="lazy"
          draggable={false}
        />
      ) : null}
      <div className="library-empty-state-copy">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="library-empty-state-actions">{action}</div> : null}
    </section>
  );
}
