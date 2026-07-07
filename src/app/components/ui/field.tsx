import type { ReactNode } from "react";

/** A labelled form control. Pair two with <div className="field-pair"> for a 2-col row. */
export function Field({ label, htmlFor, children }: { label: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
