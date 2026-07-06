"use client";
/** Command-palette trigger. Wiring (⌘K modal, actual search) comes in a later plan. */
export function GlobalSearch() {
  return (
    <button type="button" className="global-search" aria-label="Search vendors, leads, companies" onClick={() => { /* open ⌘K — later */ }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <span>Search vendors, leads, companies…</span>
      <span className="kbd">⌘K</span>
    </button>
  );
}
