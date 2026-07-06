// The Radar wordmark: a decorative inline-SVG signal glyph + the "RADAR" text.
// The glyph is aria-hidden; the visible text carries the accessible name.
// Shared by the landing hero and the login shell so both read as one family.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `wordmark ${className}` : "wordmark"}>
      <svg className="wordmark-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="1.5" fill="currentColor" />
        <path d="M8 5.5a2.5 2.5 0 0 1 2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M8 3a5 5 0 0 1 5 5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.55" />
      </svg>
      RADAR
    </span>
  );
}
