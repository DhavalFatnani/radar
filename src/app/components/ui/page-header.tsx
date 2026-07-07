import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow: string; title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {sub ? <p className="page-header-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}
