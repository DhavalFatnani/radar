import type { ReactNode } from "react";
import { ModeToggle } from "./mode-toggle";

export function Topbar({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="v2-topbar">
      <h1 className="v2-title">{title}</h1>
      <div className="v2-actions">
        <ModeToggle />
        {actions}
      </div>
    </header>
  );
}
