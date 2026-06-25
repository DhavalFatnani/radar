import type { ReactNode } from "react";
import { ModeToggle } from "./mode-toggle";

// Thin action bar — no heading (the page's PageHeader owns the single <h1>,
// the rail owns the brand).
export function Topbar({ actions }: { actions?: ReactNode }) {
  return (
    <header className="v2-topbar">
      <div className="v2-actions">
        <ModeToggle />
        {actions}
      </div>
    </header>
  );
}
