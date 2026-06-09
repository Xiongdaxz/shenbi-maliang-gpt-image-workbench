import type { ReactNode } from "react";

export function PageHeader({ title, desc, icon, actions }: { title: string; desc: string; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-title-row">
        <h1>
          {icon ? <span className="page-header-icon">{icon}</span> : null}
          {title}
        </h1>
        {actions ? <span className="page-header-actions">{actions}</span> : null}
      </div>
      <p>{desc}</p>
    </header>
  );
}
