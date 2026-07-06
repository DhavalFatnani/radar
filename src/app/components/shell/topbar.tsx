import type { ReactNode } from "react";
import { ModeToggle } from "./mode-toggle";
import { GlobalSearch } from "./global-search";

// Thin action bar — global search + notifications + theme. The page's PageHeader
// owns the single <h1>; the rail owns the brand.
export function Topbar({ actions }: { actions?: ReactNode }) {
  return (
    <header className="v2-topbar">
      <GlobalSearch />
      <div className="v2-actions">
        <button type="button" className="icon-btn" aria-label="Notifications">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
        </button>
        <ModeToggle />
        {actions}
      </div>
    </header>
  );
}
