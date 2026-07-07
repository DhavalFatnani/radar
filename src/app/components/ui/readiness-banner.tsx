import type { ReactNode } from "react";
export function ReadinessBanner({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className={`readiness ${ok ? "readiness--ok" : "readiness--warn"}`}>
      <span className="readiness-dot" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
