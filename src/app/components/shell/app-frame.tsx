"use client";

import { cloneElement, isValidElement, useState, type ReactNode } from "react";

// Wraps the rail + main so the mobile menu button can toggle `data-rail-open`
// (the copied command.css drawer behavior). On desktop the rail is always shown.
// Injects `onNavigate` into the rail element so navigation closes the drawer.
export function AppFrame({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const railWithClose = isValidElement(rail)
    ? cloneElement(rail as React.ReactElement<{ onNavigate?: () => void }>, {
        onNavigate: () => setOpen(false),
      })
    : rail;

  return (
    <div className="v2-app" {...(open ? { "data-rail-open": "" } : {})}>
      {railWithClose}
      <div className="v2-main">
        <button
          className="icon-btn rail-toggle"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
}
