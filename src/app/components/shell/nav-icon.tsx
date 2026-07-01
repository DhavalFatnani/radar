export type NavIconName =
  | "dashboard"
  | "leads"
  | "pipeline"
  | "contacts"
  | "vendors"
  | "catalogue"
  | "signals"
  | "mappings";

const PATHS: Record<NavIconName, string> = {
  dashboard: `<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z"/>`,
  leads: `<path d="M3 7l9 6 9-6"/><rect x="3" y="5" width="18" height="14" rx="2"/>`,
  pipeline: `<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="8" rx="1"/>`,
  contacts: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>`,
  vendors: `<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/>`,
  catalogue: `<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6h7M6 8.5v7M18 8.5v7M8.5 18h7"/>`,
  signals: `<path d="M4 12a8 8 0 0 1 8-8M4 12a8 8 0 0 0 8 8"/><circle cx="12" cy="12" r="1.5"/>`,
  mappings: `<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M8.5 6.8 15.5 11M8.5 17.2 15.5 13"/>`,
};

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
