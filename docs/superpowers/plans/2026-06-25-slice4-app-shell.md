# Slice 4 — App Shell + Navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An empty but on-brand, navigable `(app)` shell — a Command-style rail + topbar and the six core sections (Vendors, Signals, Mappings, Leads, Contacts, Pipeline) plus a Dashboard landing, each with a clear empty state — adopting the design session's mockup design system.

**Architecture:** Port the mockup CSS design system (`tokens.css` + `base.css` + `components.css` + `v2.css` + `command.css`) into the app as global stylesheets, wire Inter + JetBrains Mono via `next/font`, and build the shell (Rail nav, Topbar with a light/dark mode toggle, mobile rail drawer) and 7 route pages as React components inside the auth-protected `(app)` route group, reusing the mockup's existing CSS classes.

**Tech Stack:** Next.js 15 App Router · React 19 · `next/font/google` · Vitest + @testing-library/react (jsdom) for component tests · the mockup CSS design system.

**Source spec:** `Prompt_Playbook.md` Part 3 → Slice 4; `UIUX_Specification.md`; design reference: `mockups/v2/command/*` + `mockups/assets/tokens.css` + `mockups/v2/assets/command.css`. Operator-approved fidelity: **on-brand shell** (adopt core tokens + shell + empty states; defer ⌘K / view transitions / graph / animated data / pixel-polish to Phase 6).

## Global Constraints

- **Scope:** empty, navigable shell only. Each section shows a clear empty state. **OUT of scope:** real data, working forms, the engine, ⌘K command palette, cross-page view transitions, the graph canvas, animated counters, wayfinding, the 3-theme switcher (keep slate default + a light/dark mode toggle), and the later-phase screens (Catalogue, Holding pool, SIA Interview) — omit from the nav for now.
- **Auth:** every `(app)` route stays protected by the Slice 3 middleware. The shell layout continues to render the operator + sign-out.
- **Frontend rules (`~/.claude/CLAUDE.md`):** mobile-first (375 → 768 → 1280), semantic HTML (`nav`/`main`/`header`/`section`/`button`, no div soup), keyboard-navigable with visible focus, every interactive element accessible, images need alt. Respect `prefers-reduced-motion` (the tokens already do).
- **Design fidelity:** reuse the mockup CSS classes (`.v2-app`, `.v2-rail`, `.v2-topbar`, `.v2-content`, `.nav-item`, `.eyebrow`, `.brand`, `.icon-btn`, `.btn`) — do NOT re-derive styles. Default theme `data-theme="slate"`, `data-mode="light"`.
- **Tests:** component tests via @testing-library/react in jsdom (a new harness alongside the existing node-env tests). TS strict.
- **Staging discipline:** stage only each task's files explicitly — never `git add -A` (untracked `mockups/`-area files + `.superpowers/` scratch + `Access_Control_Console.html` must stay out).

## Design Decisions (flagged for review)

1. **Copy the mockup CSS wholesale** into `src/app/styles/` (tokens, base, components, v2, command) rather than re-deriving. Unused rules (cmdk/graph/skeleton) are harmless bytes; this keeps the app pixel-aligned with the prototype and lets later slices light up those features. Only edit: `tokens.css` font-family lines to point at the `next/font` CSS variables.
2. **Nav = the playbook's 6 sections + Dashboard**, grouped per the mockup: Operate (Dashboard, Leads, Pipeline, Contacts) + Build (Vendors, Signals, Mappings). Catalogue/Holding/SIA-Interview are added when their phases land.
3. **Mode toggle only** (light/dark, persisted) — the full 3-theme switcher is deferred. Default is slate/light; the toggle flips `data-mode` on `<html>`.
4. **Icons** reuse the SVG paths from `mockups/v2/assets/nav.js` (the `I` map) for the 7 nav keys.
5. **No hydration-flash guard** for the mode toggle this slice — default light, toggle client-side (a one-frame flip on manual toggle is acceptable; a `next-themes`-style inline script is a Phase-6 polish item).

---

## Preliminaries

- [ ] On branch `feature/slice-4-app-shell` (already created from main). Working tree otherwise clean (the untracked `Access_Control_Console.html` is the design session's — leave it).

---

## File Structure

```
src/app/
├── layout.tsx                      # Task 1: fonts + data-theme/mode + global CSS imports
├── styles/                         # Task 1: copied mockup design system
│   ├── tokens.css  base.css  components.css  v2.css  command.css
├── (app)/
│   ├── layout.tsx                  # Task 3: shell (Rail + Topbar + content) + auth
│   ├── dashboard/page.tsx          # Task 4
│   ├── vendors/page.tsx            # Task 4
│   ├── signals/page.tsx            # Task 4
│   ├── mappings/page.tsx           # Task 4
│   ├── leads/page.tsx              # Task 4
│   ├── contacts/page.tsx           # Task 4
│   └── pipeline/page.tsx           # Task 4
└── components/
    ├── shell/
    │   ├── rail.tsx                # Task 2: sidebar nav (client, usePathname)
    │   ├── nav-icon.tsx            # Task 2: the 7 SVG icons
    │   ├── topbar.tsx              # Task 3: title + mode toggle + sign-out
    │   ├── mode-toggle.tsx         # Task 3: light/dark (client)
    │   └── app-frame.tsx           # Task 3: client wrapper for the mobile rail drawer
    └── ui/
        ├── empty-state.tsx         # Task 2
        └── page-header.tsx         # Task 2
tests/
├── setup/dom.ts                    # Task 2: jest-dom setup
└── unit/components/
    ├── rail.test.tsx               # Task 2
    └── empty-state.test.tsx        # Task 2
```

---

## Task 1: Design foundation — CSS system + fonts + root layout

**Files:**
- Create: `src/app/styles/{tokens,base,components,v2,command}.css` (copied)
- Modify: `src/app/layout.tsx` (fonts, theme attrs, CSS imports), `src/app/styles/tokens.css` (font-family lines)

**Interfaces:**
- Produces: a global design system (CSS custom properties under `[data-theme="slate"]`), the `--font-inter` / `--font-jetbrains` CSS variables wired into `--font-sans` / `--font-mono`, and `<html data-theme="slate" data-mode="light">`.

- [ ] **Step 1: Copy the five mockup CSS files into `src/app/styles/`**

```bash
mkdir -p src/app/styles
cp mockups/assets/tokens.css       src/app/styles/tokens.css
cp mockups/assets/base.css         src/app/styles/base.css
cp mockups/assets/components.css   src/app/styles/components.css
cp mockups/v2/assets/v2.css        src/app/styles/v2.css
cp mockups/v2/assets/command.css   src/app/styles/command.css
```

- [ ] **Step 2: Point `tokens.css` font families at the `next/font` variables**

In `src/app/styles/tokens.css`, change the three font-family declarations in the `:root` block:

```css
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: var(--font-jetbrains), ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
  --font-serif: Georgia, "Times New Roman", serif;
```

(Leave everything else in tokens.css unchanged. Spectral is only used by the Paper theme, which is deferred — drop it from `--font-serif`.)

- [ ] **Step 3: Rewrite `src/app/layout.tsx` to load fonts, set the theme, and import the CSS**

```tsx
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/v2.css";
import "./styles/command.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata = {
  title: "Radar",
  description: "Lead-intelligence & matchmaking platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="slate" data-mode="light" className={`${inter.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Build + verify existing tests still pass**

Run: `npm run build` (compiles; fonts fetch at build), then `npm test` (all prior tests still green), then `npx tsc --noEmit`.
Expected: build succeeds; the existing home/login pages now render with the Inter font + slate tokens. If `next/font/google` cannot reach the network in the sandbox, retry the build command with the sandbox disabled.

- [ ] **Step 5: Commit**

```bash
git add src/app/styles src/app/layout.tsx
git commit -m "feat(ui): port mockup design system (tokens/base/components/v2/command) + next/font

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Component-test harness + UI primitives + Rail nav

**Files:**
- Modify: `package.json` (deps), `vitest.config.ts` (jsdom for component tests), `tests/setup/dom.ts`
- Create: `src/app/components/ui/empty-state.tsx`, `src/app/components/ui/page-header.tsx`, `src/app/components/shell/nav-icon.tsx`, `src/app/components/shell/rail.tsx`
- Test: `tests/unit/components/empty-state.test.tsx`, `tests/unit/components/rail.test.tsx`

**Interfaces:**
- Produces: `<EmptyState icon title description />`, `<PageHeader eyebrow title />`, `<NavIcon name />` (name ∈ the 7 keys), `<Rail onNavigate? />` (client; renders the Operate/Build nav with `aria-current="page"` on the active route).

- [ ] **Step 1: Install the component-test harness**

```bash
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Add the jest-dom setup file `tests/setup/dom.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Make `.tsx` component tests run in jsdom — update `vitest.config.ts`**

Add to the existing `test` block (keep `environment: "node"` as the default; opt component tests into jsdom by path, and add the dom setup file):

```ts
    environmentMatchGlobs: [["tests/unit/components/**", "jsdom"]],
    setupFiles: ["./tests/setup/load-env.ts", "./tests/setup/dom.ts"],
```

(If your Vitest version warns that `environmentMatchGlobs` is deprecated, instead add `// @vitest-environment jsdom` as the first line of each component test file and keep `setupFiles` as above.)

- [ ] **Step 4: Write the failing test `tests/unit/components/empty-state.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "@/app/components/ui/empty-state";

describe("EmptyState", () => {
  it("renders the title and description", () => {
    render(<EmptyState icon="vendors" title="No vendors yet" description="Add your first vendor." />);
    expect(screen.getByText("No vendors yet")).toBeInTheDocument();
    expect(screen.getByText("Add your first vendor.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Implement `src/app/components/shell/nav-icon.tsx`**

Create a `NavIcon` component with a `name` prop covering the 7 keys `dashboard | leads | pipeline | contacts | vendors | signals | mappings`. Copy the SVG inner paths verbatim from `mockups/v2/assets/nav.js` (the `I` object) for those 7 keys. Wrap each in:

```tsx
export type NavIconName =
  | "dashboard" | "leads" | "pipeline" | "contacts" | "vendors" | "signals" | "mappings";

const PATHS: Record<NavIconName, string> = {
  // paste the inner SVG markup for each key from mockups/v2/assets/nav.js `I`:
  dashboard: `<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z"/>`,
  leads: `<path d="M3 7l9 6 9-6"/><rect x="3" y="5" width="18" height="14" rx="2"/>`,
  pipeline: `<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="8" rx="1"/>`,
  contacts: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>`,
  vendors: `<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/>`,
  signals: `<path d="M4 12a8 8 0 0 1 8-8M4 12a8 8 0 0 0 8 8"/><circle cx="12" cy="12" r="1.5"/>`,
  mappings: `<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M8.5 6.8 15.5 11M8.5 17.2 15.5 13"/>`,
};

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }} />
  );
}
```

(`dangerouslySetInnerHTML` with static, in-repo SVG strings is safe — no user input.)

- [ ] **Step 6: Implement `src/app/components/ui/empty-state.tsx`**

```tsx
import { NavIcon, type NavIconName } from "@/app/components/shell/nav-icon";

export function EmptyState({
  icon, title, description,
}: { icon: NavIconName; title: string; description: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true"><NavIcon name={icon} /></div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
```

- [ ] **Step 7: Implement `src/app/components/ui/page-header.tsx`**

```tsx
export function PageHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="page-header">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
    </header>
  );
}
```

- [ ] **Step 8: Run the EmptyState test (now passes)**

Run: `npx vitest run tests/unit/components/empty-state.test.tsx`
Expected: PASS.

- [ ] **Step 9: Write the failing Rail test `tests/unit/components/rail.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Rail } from "@/app/components/shell/rail";

vi.mock("next/navigation", () => ({ usePathname: () => "/leads" }));

describe("Rail", () => {
  it("renders all 7 nav links grouped Operate/Build", () => {
    render(<Rail />);
    for (const label of ["Dashboard", "Leads", "Pipeline", "Contacts", "Vendors", "Signals", "Mappings"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getByText("Operate")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
  });

  it("marks the current route with aria-current", () => {
    render(<Rail />);
    const active = screen.getByRole("link", { name: /Leads/ });
    expect(active).toHaveAttribute("aria-current", "page");
  });
});
```

- [ ] **Step 10: Implement `src/app/components/shell/rail.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon, type NavIconName } from "./nav-icon";

const NAV: { group: string; items: [string, string, NavIconName][] }[] = [
  { group: "Operate", items: [
    ["/dashboard", "Dashboard", "dashboard"],
    ["/leads", "Leads", "leads"],
    ["/pipeline", "Pipeline", "pipeline"],
    ["/contacts", "Contacts", "contacts"],
  ]},
  { group: "Build", items: [
    ["/vendors", "Vendors", "vendors"],
    ["/signals", "Signals", "signals"],
    ["/mappings", "Mappings", "mappings"],
  ]},
];

export function Rail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <aside className="v2-rail">
      <Link className="brand" href="/dashboard" onClick={onNavigate}>
        <span className="brand-mark">R</span>
        <span className="brand-name">Radar<small>lead intelligence</small></span>
      </Link>
      <nav className="nav" aria-label="Primary">
        {NAV.map((sec) => (
          <div className="nav-section" key={sec.group}>
            <div className="eyebrow">{sec.group}</div>
            {sec.items.map(([href, label, icon]) => (
              <Link key={href} href={href} className="nav-item" onClick={onNavigate}
                aria-current={pathname === href ? "page" : undefined}>
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
```

- [ ] **Step 11: Run Rail test + full suite + commit**

Run: `npx vitest run tests/unit/components/rail.test.tsx` (passes), then `npm test` (all green), then `npx tsc --noEmit`.

```bash
git add package.json package-lock.json vitest.config.ts tests/setup/dom.ts \
  src/app/components tests/unit/components
git commit -m "feat(ui): component-test harness (jsdom) + EmptyState/PageHeader/Rail primitives

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: App shell layout — Topbar, mode toggle, mobile drawer, auth

**Files:**
- Create: `src/app/components/shell/mode-toggle.tsx`, `src/app/components/shell/topbar.tsx`, `src/app/components/shell/app-frame.tsx`
- Modify: `src/app/(app)/layout.tsx` (replace the Slice 3 placeholder shell with the real one)

**Interfaces:**
- Consumes: `Rail` (Task 2); `auth`, `signOut` (Slice 3).
- Produces: `<ModeToggle />` (client; flips `data-mode` on `<html>`, persists to localStorage), `<Topbar title actions />`, `<AppFrame rail topbar>{children}</AppFrame>` (client wrapper providing the mobile rail-drawer toggle via `data-rail-open`).

- [ ] **Step 1: Implement `src/app/components/shell/mode-toggle.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

export function ModeToggle() {
  const [mode, setMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = localStorage.getItem("radar.mode");
    const initial = stored === "dark" || stored === "light"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setMode(initial);
    document.documentElement.setAttribute("data-mode", initial);
  }, []);

  function toggle() {
    const next = mode === "light" ? "dark" : "light";
    setMode(next);
    document.documentElement.setAttribute("data-mode", next);
    localStorage.setItem("radar.mode", next);
  }

  return (
    <button className="icon-btn" onClick={toggle}
      aria-label={mode === "light" ? "Switch to dark mode" : "Switch to light mode"}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2}
        aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
    </button>
  );
}
```

- [ ] **Step 2: Implement `src/app/components/shell/topbar.tsx`**

```tsx
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
```

- [ ] **Step 3: Implement `src/app/components/shell/app-frame.tsx` (client — mobile drawer)**

```tsx
"use client";

import { useState, type ReactNode } from "react";

// Wraps the rail + main so the mobile menu button can toggle `data-rail-open`
// (the copied command.css drawer behavior). On desktop the rail is always shown.
export function AppFrame({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="v2-app" {...(open ? { "data-rail-open": "" } : {})}>
      {rail}
      <div className="v2-main">
        <button className="icon-btn rail-toggle" aria-label="Toggle menu"
          aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2}
            aria-hidden="true"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
        </button>
        {children}
      </div>
    </div>
  );
}
```

(Note: the `Rail`'s `onNavigate` should close the drawer; wire it in the layout by passing a close handler. To keep `AppFrame`'s state encapsulated, render the rail inside `AppFrame` instead — see Step 4.)

- [ ] **Step 4: Rewrite `src/app/(app)/layout.tsx` to compose the shell (keeps auth)**

```tsx
import type { ReactNode } from "react";
import { auth, signOut } from "@/lib/auth";
import { Rail } from "@/app/components/shell/rail";
import { Topbar } from "@/app/components/shell/topbar";
import { AppFrame } from "@/app/components/shell/app-frame";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  const signOutAction = (
    <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
      <button type="submit" className="btn btn-ghost">Sign out</button>
    </form>
  );

  return (
    <AppFrame rail={<Rail />}>
      <Topbar title="Radar" actions={
        <>
          <span className="op-email">{session?.user?.email}</span>
          {signOutAction}
        </>
      } />
      <main className="v2-content">{children}</main>
    </AppFrame>
  );
}
```

- [ ] **Step 5: Type-check + build + commit**

Run: `npx tsc --noEmit` (clean), then `npm test` (all green — note: the existing Rail test still passes), then `npm run build`.
Expected: build compiles. (`btn-ghost`/`op-email` classes: `btn` variants exist in components.css; if `btn-ghost` is absent, use `btn` — verify in `src/app/styles/components.css`. `.op-email` is a small custom class; add a one-line rule to `src/app/styles/command.css` if you want it muted: `.op-email{color:var(--text-muted);font-size:var(--text-sm)}`.)

```bash
git add src/app/components/shell "src/app/(app)/layout.tsx" src/app/styles/command.css
git commit -m "feat(ui): app shell — Rail + Topbar (mode toggle) + mobile drawer, auth-aware

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The 7 section routes + empty states + done-gate

**Files:**
- Create: `src/app/(app)/{dashboard,vendors,signals,mappings,leads,contacts,pipeline}/page.tsx`
- Modify: `src/app/components/shell/topbar.tsx`, `src/app/(app)/layout.tsx` (review fix: drop the Topbar h1), `README.md`

**Interfaces:**
- Consumes: `PageHeader`, `EmptyState` (Task 2).

- [ ] **Step 0 (review fix): remove the Topbar's static `<h1>` to avoid a double-h1**

Each page's `PageHeader` provides the single `<h1>`; the rail provides the brand. So the Topbar carries no heading. Rewrite `src/app/components/shell/topbar.tsx`:

```tsx
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
```

And in `src/app/(app)/layout.tsx`, drop the `title` prop from the `Topbar` usage (keep the `actions` with the operator email + sign-out):

```tsx
      <Topbar
        actions={
          <>
            <span className="op-email">{session?.user?.email}</span>
            {signOutAction}
          </>
        }
      />
```

- [ ] **Step 1: Create the seven pages**

Each page is a server component rendering a `PageHeader` + an `EmptyState`. Use these exact contents (one file each):

`src/app/(app)/dashboard/page.tsx`:
```tsx
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Dashboard — Radar" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader eyebrow="Operate" title="Dashboard" />
      <EmptyState icon="dashboard" title="Your operating day will appear here"
        description="Once leads, signals, and pipeline activity exist, this becomes your prioritized daily flow." />
    </>
  );
}
```

`src/app/(app)/vendors/page.tsx`:
```tsx
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Vendors — Radar" };

export default function VendorsPage() {
  return (
    <>
      <PageHeader eyebrow="Build" title="Vendors" />
      <EmptyState icon="vendors" title="No vendors yet"
        description="Vendor profiles from the SIA intake interview will appear here." />
    </>
  );
}
```

`src/app/(app)/signals/page.tsx`:
```tsx
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Signals — Radar" };

export default function SignalsPage() {
  return (
    <>
      <PageHeader eyebrow="Build" title="Signals" />
      <EmptyState icon="signals" title="No signals yet"
        description="The seed signal library and signals surfaced from interviews will appear here, each entering as proposed." />
    </>
  );
}
```

`src/app/(app)/mappings/page.tsx`:
```tsx
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Mappings — Radar" };

export default function MappingsPage() {
  return (
    <>
      <PageHeader eyebrow="Build" title="Mappings" />
      <EmptyState icon="mappings" title="No mappings yet"
        description="Approved rules that combine signals into buying intent per vendor will appear here." />
    </>
  );
}
```

`src/app/(app)/leads/page.tsx`:
```tsx
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Leads — Radar" };

export default function LeadsPage() {
  return (
    <>
      <PageHeader eyebrow="Operate" title="Leads" />
      <EmptyState icon="leads" title="No leads yet"
        description="Companies matched to a vendor with a reverse brief and contact block will appear here." />
    </>
  );
}
```

`src/app/(app)/contacts/page.tsx`:
```tsx
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Contacts — Radar" };

export default function ContactsPage() {
  return (
    <>
      <PageHeader eyebrow="Operate" title="Contacts" />
      <EmptyState icon="contacts" title="No contacts yet"
        description="Every decision-maker the engine finds flows into this compounding, deduplicated contact book." />
    </>
  );
}
```

`src/app/(app)/pipeline/page.tsx`:
```tsx
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Pipeline — Radar" };

export default function PipelinePage() {
  return (
    <>
      <PageHeader eyebrow="Operate" title="Pipeline" />
      <EmptyState icon="pipeline" title="No pipeline activity yet"
        description="Leads tracked from sourced to paid, with commission, will appear here." />
    </>
  );
}
```

- [ ] **Step 2: Add minimal empty-state + page-header CSS**

Append to `src/app/styles/command.css` (reuses tokens; centered, muted):

```css
/* --- Slice 4: section page header + empty state --- */
.page-header { padding: 0 0 var(--space-5); }
.page-header h1 { font-size: var(--text-2xl); letter-spacing: var(--tracking-tight); }
.empty-state { display: grid; place-items: center; gap: var(--space-3); text-align: center;
  padding: var(--space-12) var(--space-5); border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg); color: var(--text-muted); }
.empty-state-icon { width: 44px; height: 44px; display: grid; place-items: center;
  border-radius: var(--radius-md); background: var(--surface-2); color: var(--text-faint); }
.empty-state h2 { font-size: var(--text-lg); color: var(--text); }
.empty-state p { max-width: 46ch; font-size: var(--text-sm); }
```

- [ ] **Step 3: Full quality gate**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all pass; `npm run build` shows the 7 `(app)` routes plus `/login` and `/`.

- [ ] **Step 4: Manual nav + responsive + auth walkthrough**

```bash
npm run dev &
# wait for ready, then (curl --retry handles the wait):
for p in dashboard vendors signals mappings leads contacts pipeline; do
  echo "$p (unauth): $(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' http://localhost:3000/$p)"
done
kill %1
```

Expected: every `(app)` route still redirects to `/login` when unauthenticated (protection intact). Then verify interactively in a browser (logged in): the rail lists all 7 sections grouped Operate/Build, each renders its empty state, the active link is highlighted, the mode toggle flips light/dark, and the rail collapses to a drawer at narrow widths. If `next dev` can't run in the sandbox, the controller verifies this; the build + Rail test are the automated evidence.

- [ ] **Step 5: Update `README.md`**

Add under "Getting started":

```markdown
### App shell (Slice 4)

After signing in, the app has a Command-style rail (Operate: Dashboard/Leads/Pipeline/Contacts · Build: Vendors/Signals/Mappings), a topbar with a light/dark toggle, and a clear empty state per section. Visual system ported from `mockups/` (`tokens.css` + the v2 Command shell).
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)" src/app/styles/command.css README.md
git commit -m "feat(ui): seven (app) section routes with empty states; document the shell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Acceptance Criteria → Task Map (self-review)

| Slice 4 acceptance criterion (playbook) | Implemented / verified by |
|---|---|
| Each main section is reachable from navigation | Task 2 (Rail with 7 links) + Task 4 (the 7 routes) |
| Each section renders a clear empty state | Task 4 (PageHeader + EmptyState per route) |
| The shell is responsive and fast | Task 1 (next/font, ported tokens) + Task 3 (mobile rail drawer) |
| (Implicit) routes stay auth-protected | Task 3 (layout keeps `auth()`) + Task 4 Step 4 (unauth redirect proof) |

## Done gate for the slice

All 7 sections navigable with empty states, rail + topbar + mode toggle working, responsive drawer, routes still auth-protected, component tests + full gate green, README updated, all committed on `feature/slice-4-app-shell`. Then surface the branch for merge (operator sign-off; do not merge unprompted).
