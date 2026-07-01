"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon, type NavIconName } from "./nav-icon";

const NAV: { group: string; items: [string, string, NavIconName][] }[] = [
  {
    group: "Operate",
    items: [
      ["/dashboard", "Dashboard", "dashboard"],
      ["/leads", "Leads", "leads"],
      ["/pipeline", "Pipeline", "pipeline"],
      ["/contacts", "Contacts", "contacts"],
    ],
  },
  {
    group: "Build",
    items: [
      ["/vendors", "Vendors", "vendors"],
      ["/catalogue", "Catalogue", "catalogue"],
      ["/signals", "Signals", "signals"],
      ["/mappings", "Mappings", "mappings"],
    ],
  },
];

export function Rail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <aside className="v2-rail">
      <Link className="brand" href="/dashboard" onClick={onNavigate}>
        <span className="brand-mark">R</span>
        <span className="brand-name">
          Radar<small>lead intelligence</small>
        </span>
      </Link>
      <nav className="nav" aria-label="Primary">
        {NAV.map((sec) => (
          <div className="nav-section" key={sec.group}>
            <div className="eyebrow">{sec.group}</div>
            {sec.items.map(([href, label, icon]) => (
              <Link
                key={href}
                href={href}
                className="nav-item"
                onClick={onNavigate}
                aria-current={pathname === href ? "page" : undefined}
              >
                <NavIcon name={icon} />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
