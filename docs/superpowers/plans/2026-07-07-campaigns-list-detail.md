# Campaigns List + Detail — Implementation Plan (Redesign Plan B of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the two Campaigns **read** surfaces — the list (`/campaigns`) and the detail (`/campaigns/[campaignId]`) — by assembling them from the Plan-A UI kit: KPI stat-tiles, a command bar (search + status chips + source segmented), a sortable/bulk-select data table with score-heat yield meters, and a sticky context rail (credit gauge, quick views, needs-attention / run-details / yield).

**Architecture:** Data fetching (Drizzle) stays **inline in the server page components** (mirrors the existing `[campaignId]/page.tsx` pattern) — no new DB helper to unit-test against Neon. All derivations (yield %, relative time, source tag, KPI aggregation, row shaping) live in **pure functions** in `campaigns/view-model.ts` (fast unit tests). All rendering + interactivity lives in **client components** that take plain typed row arrays (jsdom tests with fixtures, exactly like the existing `campaign-list.test.tsx`). New CSS appends to `src/app/styles/kit.css` (tokens only). List ships first (Tasks 1–5) so the first review checkpoint already shows a redesigned `/campaigns`; detail follows (Tasks 6–9).

**Tech Stack:** Next.js 15 (App Router, RSC + client components), React 19 (`useState`/`useMemo`), Drizzle ORM, TypeScript strict, Vitest + jsdom + @testing-library/react.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-07-campaigns-ui-redesign-design.md` §4.1 (list) + §4.2 (detail) + §5 (responsiveness). This is Plan B of 3; Plan A (kit + shell) is merged; Plan C is the new-campaign form + backend wiring.
- **Kit is already built and merged** — consume these **verbatim** signatures from `src/app/components/ui/` (do not re-create):
  - `ScoreMeter({ value: number; size?: "sm" })` and `scoreHeatVar(value): string` — `score-meter.tsx`
  - `StatTile({ label; value: string; unit?; delta?; deltaDir?: "up"|"down"; points?: number[] })` — `stat-tile.tsx`
  - `Gauge({ value: number; max: number })` — `gauge.tsx`
  - `StatusPill({ status: "queued"|"running"|"done"|"failed" })` + exported type `CampaignStatus` — `status-pill.tsx`
  - `KvList({ rows: { k: string; v: ReactNode }[] })` — `kv-list.tsx`
  - `SearchInput({ value; onChange: (v:string)=>void; placeholder? })`, `FilterChips({ options: {value,label}[]; value; onChange })`, `Segmented({ options: {value,label}[]; value; onChange })` — `controls.tsx` (all `"use client"`)
  - `useSort<T>(rows, initialKey: keyof T & string, initialDir?: 1|-1)` → `{ sorted, sortKey, sortDir, toggle }`, `useRowSelection(ids: string[])` → `{ selected: Set<string>, toggle, toggleAll, allChecked }` — `use-table.ts` (`"use client"`)
- **Existing kit CSS classes to reuse** (already in `kit.css`): `.stat-row`, `.cmdbar`, `.chips`/`.chip`/`.chip-on`, `.seg`, `.table-wrap`, `.data-table` (+ `.sortable`, `.num`, `.money`, `.clickable`, `.cell-co`, `.arw`), `.ctx-grid`/`.ctx-rail`/`.ctx-panel`, `.pill`/`.pill-*`, `.kv-list`/`.kv`/`.kv-k`/`.kv-v`, `.score`, `.gauge`/`.gauge-cluster`. Also existing global `.btn`/`.btn-primary`/`.btn-sm`/`.btn-ghost` (base.css) and `.empty-state`, `.page-header` (components.css).
- **Tokens only** for any new CSS — real custom properties from `tokens.css`: surfaces `--surface(-2)` `--surface-inset` `--border(-strong)`; text `--text(-muted/-faint)`; semantic `--accent(-soft)` `--success` `--attention` `--money`; status `--status-*(-bg)`; spacing `--space-1..6`; radii `--radius-sm/md/lg/full`; type `--text-2xs..2xl`; `--font-mono`; `--weight-*`; `--tracking-*`; `--border-w`; `--shadow-sm`. Never hardcode colors/spacing/radii.
- **Data facts (verified in schema):**
  - `campaigns`: `campaignId`, `vendorId`, `label`, `config` (jsonb `{ geography, target, enrichTop?, mappingIds? }`), `source` (`"company-fixture"` | `"crustdata"`), `status` (enum `queued|running|done|failed`), `stats` (jsonb `{ companiesFetched, observationsWritten, leadsCreated, leadsUpdated, creditsSpent }`), `error`, `startedAt`, `finishedAt`, `createdAt`.
  - `vendorProfiles`: `vendorId`, `name`, `vendorType`, `version`. Join for the vendor sub-label.
  - `campaignLeads`: `campaignId`, `leadId`, `wasNew`. `leads`: `leadId`, `companyId`, `score` (real, nullable). `companies`: `companyId`, `name`, `profile` (jsonb — domain lives here if anywhere). `companySnapshots`: `snapshot` jsonb `{ fundraiseDate, headcountTotal, opsPostings, score }`, keyed by `campaignId`+`companyId` (LEFT JOIN; every field nullable).
- **Derivation rules (verbatim):**
  - **Yield %** = `companiesFetched > 0 ? round(leadsCreated / companiesFetched * 100) : 0`. Feeds `ScoreMeter` in list (per-campaign) and detail (yield panel).
  - **Source tag:** `source === "crustdata"` → `{ label: "Live", kind: "live" }`, else `{ label: "Test", kind: "test" }`.
  - **Credit budget total:** no column exists → module constant `CREDIT_BUDGET = 600` in `view-model.ts` with a `// forward-looking: becomes vendor/org config in a later spec` note. Gauge shows `used = Σ creditsSpent` vs `CREDIT_BUDGET`. (A gauge is a viz, not a silent no-op control — spec §6 rule does not apply.)
  - **Detail table nullable columns** (funding/headcount/signals/domain): render `"—"` when the source field is null/absent. Never fabricate.
- **Follow radar conventions:** presentational-only components with no state are server components (no `"use client"`); anything with `useState`/`useMemo`/handlers is `"use client"` (top line). Import alias `@/` → `src`. Route group dir is literally `(app)`.
- **Tests:** component/helper tests in `tests/unit/components/*.test.tsx` (or `.test.ts` for pure helpers), first line for jsdom files `// @vitest-environment jsdom`; import `{ render, screen }` from `@testing-library/react`, `userEvent` from `@testing-library/user-event`; explicit `{ describe, it, expect, vi }` from `vitest`. Run one file: `npx vitest run tests/unit/components/<file>`. Full component suite: `npx vitest run tests/unit/components`. Typecheck: `npm run typecheck`.
- **Branch:** `feature/campaigns-list-detail` (already checked out). One commit per task.

---

### Task 1: View-model helpers (pure)

**Files:**
- Create: `src/app/(app)/campaigns/view-model.ts`
- Test: `tests/unit/components/campaign-view-model.test.ts`

**Interfaces:**
- Produces (consumed by every later task):
  - Types `CampaignListRow = { campaignId; label; vendorName: string; source: string; status: CampaignStatus; companies: number; leads: number; credits: number; yield: number; createdAt: string }` and `CampaignStatsShape = { companiesFetched; observationsWritten; leadsCreated; leadsUpdated; creditsSpent: number }` (re-exported here; the detail page imports it from here now).
  - `yieldPct(companiesFetched: number, leadsCreated: number): number`
  - `relativeTime(when: string | Date, now: Date): string`
  - `sourceTag(source: string): { label: "Live" | "Test"; kind: "live" | "test" }`
  - `CREDIT_BUDGET: number`
  - `deriveListKpis(rows: CampaignListRow[], now: Date): { label: string; value: string; unit?: string; delta?: string; deltaDir?: "up" | "down"; points?: number[] }[]` — four tiles: Campaigns 30d, Leads sourced, Companies scanned, Avg yield.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/campaign-view-model.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { yieldPct, relativeTime, sourceTag, deriveListKpis, CREDIT_BUDGET, type CampaignListRow } from "@/app/(app)/campaigns/view-model";

const NOW = new Date("2026-07-07T12:00:00Z");
function row(over: Partial<CampaignListRow>): CampaignListRow {
  return { campaignId: "c", label: "L", vendorName: "V", source: "crustdata", status: "done", companies: 20, leads: 8, credits: 1, yield: 40, createdAt: NOW.toISOString(), ...over };
}

describe("yieldPct", () => {
  it("is leads/companies as a rounded percent, guarding divide-by-zero", () => {
    expect(yieldPct(20, 8)).toBe(40);
    expect(yieldPct(0, 5)).toBe(0);
    expect(yieldPct(3, 1)).toBe(33);
  });
});

describe("relativeTime", () => {
  it("renders coarse buckets", () => {
    expect(relativeTime(new Date("2026-07-07T11:59:40Z"), NOW)).toBe("just now");
    expect(relativeTime(new Date("2026-07-07T11:45:00Z"), NOW)).toBe("15m");
    expect(relativeTime(new Date("2026-07-07T09:00:00Z"), NOW)).toBe("3h");
    expect(relativeTime(new Date("2026-07-05T12:00:00Z"), NOW)).toBe("2d");
    expect(relativeTime(new Date("2026-06-01T12:00:00Z"), NOW)).toBe("Jun 1");
  });
});

describe("sourceTag", () => {
  it("maps crustdata to Live, everything else to Test", () => {
    expect(sourceTag("crustdata")).toEqual({ label: "Live", kind: "live" });
    expect(sourceTag("company-fixture")).toEqual({ label: "Test", kind: "test" });
  });
});

describe("deriveListKpis", () => {
  it("returns four tiles with real aggregates", () => {
    const rows = [
      row({ companies: 20, leads: 8, createdAt: new Date("2026-07-06T12:00:00Z").toISOString() }),
      row({ companies: 10, leads: 5, createdAt: new Date("2026-07-01T12:00:00Z").toISOString() }),
      row({ companies: 30, leads: 3, createdAt: new Date("2026-05-01T12:00:00Z").toISOString() }), // >30d old
    ];
    const tiles = deriveListKpis(rows, NOW);
    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toMatchObject({ label: "Campaigns 30d", value: "2" });   // two within 30d
    expect(tiles[1]).toMatchObject({ label: "Leads sourced", value: "16" });  // 8+5+3
    expect(tiles[2]).toMatchObject({ label: "Companies scanned", value: "60" });
    expect(tiles[3].label).toBe("Avg yield");
    expect(tiles[3].unit).toBe("%");
  });
  it("exposes a spendable budget constant", () => {
    expect(CREDIT_BUDGET).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/campaign-view-model.test.ts`
Expected: FAIL — cannot find module `@/app/(app)/campaigns/view-model`.

- [ ] **Step 3: Write the helpers**

Create `src/app/(app)/campaigns/view-model.ts`:
```ts
import type { CampaignStatus } from "@/app/components/ui/status-pill";

export type CampaignStatsShape = {
  companiesFetched: number; observationsWritten: number;
  leadsCreated: number; leadsUpdated: number; creditsSpent: number;
};

export type CampaignListRow = {
  campaignId: string;
  label: string;
  vendorName: string;
  source: string;
  status: CampaignStatus;
  companies: number;
  leads: number;
  credits: number;
  yield: number;
  createdAt: string;
};

/** Leads per company scanned, as a rounded percent. Guards divide-by-zero. */
export function yieldPct(companiesFetched: number, leadsCreated: number): number {
  if (companiesFetched <= 0) return 0;
  return Math.round((leadsCreated / companiesFetched) * 100);
}

/** Coarse relative time: just now / Nm / Nh / Nd, falling back to "Mon D" past a week. */
export function relativeTime(when: string | Date, now: Date): string {
  const then = typeof when === "string" ? new Date(when) : when;
  const secs = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function sourceTag(source: string): { label: "Live" | "Test"; kind: "live" | "test" } {
  return source === "crustdata" ? { label: "Live", kind: "live" } : { label: "Test", kind: "test" };
}

// forward-looking: becomes vendor/org config in a later spec.
export const CREDIT_BUDGET = 600;

function withinDays(iso: string, now: Date, days: number): boolean {
  return now.getTime() - new Date(iso).getTime() <= days * 86400_000;
}
function seriesTail(rows: CampaignListRow[], pick: (r: CampaignListRow) => number, n = 8): number[] {
  // rows arrive newest-first; sparkline reads oldest→newest.
  return rows.slice(0, n).map(pick).reverse();
}
function trend(points: number[]): { delta?: string; deltaDir?: "up" | "down" } {
  if (points.length < 4) return {};
  const half = Math.floor(points.length / 2);
  const older = points.slice(0, half), newer = points.slice(half);
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const o = avg(older), n = avg(newer);
  if (o === 0) return {};
  const pct = Math.round(((n - o) / o) * 100);
  if (pct === 0) return {};
  return pct > 0 ? { delta: `▲ ${pct}%`, deltaDir: "up" } : { delta: `▼ ${Math.abs(pct)}%`, deltaDir: "down" };
}

export function deriveListKpis(rows: CampaignListRow[], now: Date) {
  const leadsPts = seriesTail(rows, (r) => r.leads);
  const coPts = seriesTail(rows, (r) => r.companies);
  const yieldPts = seriesTail(rows, (r) => r.yield);
  const withYield = rows.filter((r) => r.companies > 0);
  const avgYield = withYield.length ? Math.round(withYield.reduce((s, r) => s + r.yield, 0) / withYield.length) : 0;
  return [
    { label: "Campaigns 30d", value: String(rows.filter((r) => withinDays(r.createdAt, now, 30)).length) },
    { label: "Leads sourced", value: String(rows.reduce((s, r) => s + r.leads, 0)), points: leadsPts, ...trend(leadsPts) },
    { label: "Companies scanned", value: String(rows.reduce((s, r) => s + r.companies, 0)), points: coPts, ...trend(coPts) },
    { label: "Avg yield", value: String(avgYield), unit: "%", points: yieldPts, ...trend(yieldPts) },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/campaign-view-model.test.ts`
Expected: PASS. Then `npm run typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/campaigns/view-model.ts tests/unit/components/campaign-view-model.test.ts
git commit -m "feat(campaigns): view-model helpers — yield/relativeTime/sourceTag/KPIs"
```

---

### Task 2: `PageHeader` — additive sub + actions slot

**Files:**
- Modify: `src/app/components/ui/page-header.tsx`
- Test: `tests/unit/components/page-header.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PageHeader({ eyebrow: string; title: string; sub?: string; actions?: ReactNode })` — **backward compatible** (existing 15 callers pass only `eyebrow`+`title`; `sub`/`actions` are optional). Renders eyebrow + h1 + optional sub `<p>` on the left and `actions` on the right of a flex row.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/page-header.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "@/app/components/ui/page-header";

describe("PageHeader", () => {
  it("renders eyebrow + title with no sub/actions (back-compat)", () => {
    render(<PageHeader eyebrow="Operate" title="Campaigns" />);
    expect(screen.getByRole("heading", { level: 1, name: "Campaigns" })).toBeInTheDocument();
    expect(screen.getByText("Operate")).toBeInTheDocument();
  });
  it("renders an optional sub line and an actions slot", () => {
    render(<PageHeader eyebrow="Operate" title="Campaigns" sub="Every sourcing run" actions={<button>New Campaign</button>} />);
    expect(screen.getByText("Every sourcing run")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Campaign" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/page-header.test.tsx`
Expected: FAIL — the second case can't find the sub text / actions button.

- [ ] **Step 3: Extend the component**

Replace `src/app/components/ui/page-header.tsx` with:
```tsx
import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow: string; title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {sub ? <p className="page-header-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}
```

- [ ] **Step 4: Append CSS to kit.css**

Append to `src/app/styles/kit.css`:
```css
/* ---- 12. Page header — sub + actions row -------------------------------- */
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.page-header-sub { margin: var(--space-1) 0 0; color: var(--text-muted); font-size: var(--text-sm); }
.page-header-actions { display: flex; align-items: center; gap: var(--space-2); flex: none; }
```
> Note: `.page-header` already has base styling in components.css; these rules only add the flex row + sub/actions and win because kit.css loads last.

- [ ] **Step 5: Run test + regression**

Run: `npx vitest run tests/unit/components/page-header.test.tsx` (PASS). Then `npx vitest run tests/unit/components` — the whole suite stays green (the 15 existing `PageHeader` callers pass only `eyebrow`+`title`; unaffected). `npm run typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/ui/page-header.tsx src/app/styles/kit.css tests/unit/components/page-header.test.tsx
git commit -m "feat(kit): PageHeader — optional sub line + actions slot"
```

---

### Task 3: `CampaignTable` (sortable + bulk-select)

**Files:**
- Create: `src/app/(app)/campaigns/campaign-table.tsx`
- Modify: `src/app/styles/kit.css`
- Test: `tests/unit/components/campaign-table.test.tsx`

**Interfaces:**
- Consumes: `CampaignListRow` (Task 1); `useSort`, `useRowSelection` (kit); `ScoreMeter`, `StatusPill` (kit); `sourceTag`, `relativeTime` (Task 1).
- Produces (`"use client"`): `CampaignTable({ rows: CampaignListRow[]; now: Date })` — a `.table-wrap` > `.data-table` with a select-all checkbox column, sortable headers (Campaign, Companies, Leads, Yield, Credits, Run), a source tag + status pill, a `ScoreMeter` yield cell, money-colored credits, relative run time, and the campaign label linking to `/campaigns/{id}`. When any row is selected, a `.bulkbar` appears above the table (Re-run / Export / Dismiss — presentational stubs; wiring is a later plan).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/campaign-table.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignTable } from "@/app/(app)/campaigns/campaign-table";
import type { CampaignListRow } from "@/app/(app)/campaigns/view-model";

const NOW = new Date("2026-07-07T12:00:00Z");
const rows: CampaignListRow[] = [
  { campaignId: "a1", label: "RackPro · India · 20", vendorName: "RackPro", source: "crustdata", status: "done", companies: 20, leads: 8, credits: 0.87, yield: 40, createdAt: new Date("2026-07-07T10:00:00Z").toISOString() },
  { campaignId: "b2", label: "Acme · India · 10", vendorName: "Acme", source: "company-fixture", status: "failed", companies: 10, leads: 1, credits: 0, yield: 10, createdAt: new Date("2026-07-06T10:00:00Z").toISOString() },
];

describe("CampaignTable", () => {
  it("links the campaign label to its detail route with a source tag and status pill", () => {
    render(<CampaignTable rows={rows} now={NOW} />);
    expect(screen.getByRole("link", { name: /RackPro · India · 20/ })).toHaveAttribute("href", "/campaigns/a1");
    expect(document.querySelector(".pill-done")).toBeTruthy();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  it("sorts by a numeric column when its header is clicked", async () => {
    render(<CampaignTable rows={rows} now={NOW} />);
    await userEvent.click(screen.getByRole("button", { name: /Leads/ }));
    const firstDataRow = document.querySelectorAll("tbody tr")[0];
    // ascending by leads → Acme (1) first. Query the label link (the vendor <span> also says "Acme").
    expect(within(firstDataRow as HTMLElement).getByRole("link", { name: /Acme/ })).toBeInTheDocument();
  });

  it("shows the bulk action bar once rows are selected via select-all", async () => {
    render(<CampaignTable rows={rows} now={NOW} />);
    expect(document.querySelector(".bulkbar")).toBeNull();
    await userEvent.click(screen.getByLabelText("Select all campaigns"));
    expect(document.querySelector(".bulkbar")).toBeTruthy();
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/campaign-table.test.tsx`
Expected: FAIL — cannot find module `campaign-table`.

- [ ] **Step 3: Write the component**

Create `src/app/(app)/campaigns/campaign-table.tsx`:
```tsx
"use client";
import Link from "next/link";
import { useSort, useRowSelection } from "@/app/components/ui/use-table";
import { ScoreMeter } from "@/app/components/ui/score-meter";
import { StatusPill } from "@/app/components/ui/status-pill";
import { sourceTag, relativeTime, type CampaignListRow } from "./view-model";

function arrow(active: boolean, dir: 1 | -1) {
  return active ? <span className="arw">{dir === 1 ? "▲" : "▼"}</span> : null;
}

export function CampaignTable({ rows, now }: { rows: CampaignListRow[]; now: Date }) {
  const { sorted, sortKey, sortDir, toggle } = useSort<CampaignListRow>(rows, "createdAt", -1);
  const sel = useRowSelection(rows.map((r) => r.campaignId));

  // Sortable headers are real <button>s: keyboard-navigable + queryable by role.
  const sortBtn = (key: keyof CampaignListRow & string, label: string) => (
    <button type="button" className="th-sort" onClick={() => toggle(key)}>{label}{arrow(sortKey === key, sortDir)}</button>
  );
  const numHead = (key: keyof CampaignListRow & string, label: string) => (
    <th className="num sortable">{sortBtn(key, label)}</th>
  );

  return (
    <div>
      {sel.selected.size > 0 ? (
        <div className="bulkbar">
          <span>{sel.selected.size} selected</span>
          <div className="bulkbar-actions">
            <button type="button" className="btn btn-sm">Re-run</button>
            <button type="button" className="btn btn-sm">Export</button>
            <button type="button" className="btn btn-sm">Dismiss</button>
          </div>
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="chk"><input type="checkbox" aria-label="Select all campaigns" checked={sel.allChecked} onChange={sel.toggleAll} /></th>
              <th className="sortable">{sortBtn("label", "Campaign")}</th>
              <th>Source</th>
              <th>Status</th>
              {numHead("companies", "Companies")}
              {numHead("leads", "Leads")}
              {numHead("yield", "Yield")}
              {numHead("credits", "Credits")}
              {numHead("createdAt", "Run")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const tag = sourceTag(c.source);
              return (
                <tr key={c.campaignId}>
                  <td className="chk"><input type="checkbox" aria-label={`Select ${c.label}`} checked={sel.selected.has(c.campaignId)} onChange={() => sel.toggle(c.campaignId)} /></td>
                  <td className="cell-co"><Link href={`/campaigns/${c.campaignId}`}><b>{c.label}</b></Link><span>{c.vendorName}</span></td>
                  <td><span className={`src-tag ${tag.kind}`}>{tag.label}</span></td>
                  <td><StatusPill status={c.status} /></td>
                  <td className="num">{c.companies}</td>
                  <td className="num">{c.leads}</td>
                  <td className="num"><ScoreMeter value={c.yield} size="sm" /></td>
                  <td className="num money">{c.credits.toFixed(2)}</td>
                  <td className="num">{relativeTime(c.createdAt, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

Append to `src/app/styles/kit.css`:
```css
/* ---- 13. Source tag + bulk action bar + checkbox column ----------------- */
.src-tag { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; padding: 1px var(--space-2); border-radius: var(--radius-full); border: var(--border-w) solid var(--border-strong); color: var(--text-muted); }
.src-tag.live { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.data-table th.sortable .th-sort { font: inherit; color: inherit; letter-spacing: inherit; text-transform: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; display: inline-flex; align-items: center; }
.data-table th.sortable .th-sort:hover { color: var(--text); }
.data-table td.chk, .data-table th.chk { width: 34px; text-align: center; padding-right: 0; }
.data-table td.chk input, .data-table th.chk input { cursor: pointer; accent-color: var(--accent); }
.data-table .cell-co a { color: inherit; text-decoration: none; }
.data-table .cell-co a:hover b { color: var(--accent); }
.bulkbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) var(--space-3); margin-bottom: var(--space-2); background: var(--accent-soft); border: var(--border-w) solid var(--accent); border-radius: var(--radius-md); font-size: var(--text-sm); }
.bulkbar-actions { display: flex; gap: var(--space-2); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/campaign-table.test.tsx`
Expected: PASS (link/tag/pill, numeric sort, bulk bar).

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/campaigns/campaign-table.tsx src/app/styles/kit.css tests/unit/components/campaign-table.test.tsx
git commit -m "feat(campaigns): CampaignTable — sortable + bulk-select + yield meter"
```

---

### Task 4: `CampaignListView` (KPI row + command bar + rail)

**Files:**
- Modify (rewrite): `src/app/(app)/campaigns/campaign-list.tsx`
- Modify: `src/app/styles/kit.css`
- Test: `tests/unit/components/campaign-list.test.tsx` (replace the existing thin test)

**Interfaces:**
- Consumes: `CampaignListRow`, `deriveListKpis`, `CREDIT_BUDGET`, `sourceTag` (Task 1); `CampaignTable` (Task 3); `StatTile`, `Gauge`, `StatusPill`, `SearchInput`, `FilterChips`, `Segmented` (kit).
- Produces (`"use client"`): `CampaignListView({ rows: CampaignListRow[]; nowMs: number })` — full list surface: a 4× `StatTile` KPI row, a command bar (search + status `FilterChips` + source `Segmented`), the filtered `CampaignTable`, and a context rail (credit `Gauge`, Quick views buttons that set filters, Needs-attention list of running/failed/queued). Owns `search`/`statusFilter`/`sourceFilter` state; filtering is pure/in-memory. `nowMs` is passed from the server (a number, so the client boundary stays serializable) and rehydrated to `Date`.
- **Note:** this file previously exported `CampaignList` + types `CampaignRow`/`CampaignStatsShape`. Those types now live in `view-model.ts`; the page (Task 5) imports `CampaignListView` and the detail page (Task 9) imports `CampaignStatsShape` from `view-model.ts`. This task removes the old `CampaignList`/`CampaignRow` exports.

- [ ] **Step 1: Write the failing test**

Replace `tests/unit/components/campaign-list.test.tsx` with:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignListView } from "@/app/(app)/campaigns/campaign-list";
import type { CampaignListRow } from "@/app/(app)/campaigns/view-model";

const NOW = new Date("2026-07-07T12:00:00Z").getTime();
const rows: CampaignListRow[] = [
  { campaignId: "a1", label: "RackPro · India · 20", vendorName: "RackPro", source: "crustdata", status: "done", companies: 20, leads: 8, credits: 0.87, yield: 40, createdAt: new Date("2026-07-07T10:00:00Z").toISOString() },
  { campaignId: "b2", label: "Acme · India · 10", vendorName: "Acme", source: "company-fixture", status: "failed", companies: 10, leads: 1, credits: 0, yield: 10, createdAt: new Date("2026-07-06T10:00:00Z").toISOString() },
  { campaignId: "c3", label: "Globex · US · 15", vendorName: "Globex", source: "crustdata", status: "running", companies: 5, leads: 0, credits: 0.2, yield: 0, createdAt: new Date("2026-07-07T11:00:00Z").toISOString() },
];

describe("CampaignListView", () => {
  it("renders the KPI row and all campaigns by default", () => {
    render(<CampaignListView rows={rows} nowMs={NOW} />);
    expect(screen.getByText("Leads sourced")).toBeInTheDocument();
    // Query the label links — the vendor <span> repeats the name, so getByText would be ambiguous.
    expect(screen.getByRole("link", { name: /RackPro/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acme/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Globex/ })).toBeInTheDocument();
  });

  it("filters the table by the status chips", async () => {
    render(<CampaignListView rows={rows} nowMs={NOW} />);
    await userEvent.click(screen.getByRole("button", { name: "Failed" }));
    expect(screen.getByRole("link", { name: /Acme/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /RackPro/ })).toBeNull();
  });

  it("filters by source via the segmented control", async () => {
    render(<CampaignListView rows={rows} nowMs={NOW} />);
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(screen.getByRole("link", { name: /Acme/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /RackPro/ })).toBeNull();
  });

  it("filters by the search box (label or vendor)", async () => {
    render(<CampaignListView rows={rows} nowMs={NOW} />);
    await userEvent.type(screen.getByLabelText(/Search campaigns/i), "globex");
    expect(screen.getByRole("link", { name: /Globex/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /RackPro/ })).toBeNull();
  });

  it("shows a credit budget gauge in the rail", () => {
    const { container } = render(<CampaignListView rows={rows} nowMs={NOW} />);
    expect(container.querySelector("svg.gauge .gauge-arc")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/campaign-list.test.tsx`
Expected: FAIL — `CampaignListView` is not exported.

- [ ] **Step 3: Write the component**

Replace `src/app/(app)/campaigns/campaign-list.tsx` with:
```tsx
"use client";
import { useMemo, useState } from "react";
import { StatTile } from "@/app/components/ui/stat-tile";
import { Gauge } from "@/app/components/ui/gauge";
import { StatusPill } from "@/app/components/ui/status-pill";
import { SearchInput, FilterChips, Segmented } from "@/app/components/ui/controls";
import { CampaignTable } from "./campaign-table";
import { deriveListKpis, CREDIT_BUDGET, type CampaignListRow } from "./view-model";

const STATUS_OPTS = [
  { value: "all", label: "All" }, { value: "done", label: "Done" },
  { value: "running", label: "Running" }, { value: "failed", label: "Failed" },
];
const SOURCE_OPTS = [{ value: "all", label: "All" }, { value: "crustdata", label: "Live" }, { value: "fixture", label: "Test" }];

export function CampaignListView({ rows, nowMs }: { rows: CampaignListRow[]; nowMs: number }) {
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [minYield, setMinYield] = useState(0);

  const kpis = useMemo(() => deriveListKpis(rows, now), [rows, now]);
  const used = useMemo(() => rows.reduce((s, r) => s + r.credits, 0), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (source === "crustdata" && r.source !== "crustdata") return false;
      if (source === "fixture" && r.source === "crustdata") return false;
      if (minYield > 0 && r.yield < minYield) return false;
      if (q && !(`${r.label} ${r.vendorName}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, status, source, minYield]);

  const attention = rows.filter((r) => r.status === "running" || r.status === "failed" || r.status === "queued");

  return (
    <div className="ctx-grid">
      <div className="ctx-main">
        <div className="stat-row">
          {kpis.map((k) => <StatTile key={k.label} {...k} />)}
        </div>
        <div className="cmdbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search campaigns…" />
          <FilterChips options={STATUS_OPTS} value={status} onChange={setStatus} />
          <Segmented options={SOURCE_OPTS} value={source} onChange={setSource} />
        </div>
        <CampaignTable rows={filtered} now={now} />
      </div>

      <aside className="ctx-rail">
        <div className="ctx-panel">
          <h3>Credit budget</h3>
          <div className="gauge-cluster">
            <Gauge value={used} max={CREDIT_BUDGET} />
            <div><div className="big">{used.toFixed(1)}</div><div className="sm">of {CREDIT_BUDGET} credits</div></div>
          </div>
        </div>
        <div className="ctx-panel">
          <h3>Quick views</h3>
          <div className="qv">
            <button type="button" onClick={() => { setStatus("all"); setSource("all"); setSearch(""); setMinYield(0); }}>All campaigns</button>
            <button type="button" onClick={() => { setStatus("running"); setMinYield(0); }}>Live runs</button>
            <button type="button" onClick={() => { setStatus("failed"); setMinYield(0); }}>Failed runs</button>
            <button type="button" onClick={() => { setStatus("all"); setMinYield(40); }}>High-yield ≥40%</button>
          </div>
        </div>
        <div className="ctx-panel">
          <h3>Needs attention</h3>
          {attention.length === 0 ? <p className="qv-empty">Nothing needs attention.</p> : (
            <ul className="attn">
              {attention.map((r) => (
                <li key={r.campaignId}><span className="attn-label">{r.label}</span><StatusPill status={r.status} /></li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

Append to `src/app/styles/kit.css`:
```css
/* ---- 14. List context rail — quick views + needs-attention -------------- */
.ctx-main { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.qv { display: flex; flex-direction: column; gap: var(--space-1); }
.qv button { text-align: left; font-size: var(--text-sm); padding: var(--space-1) var(--space-2); border: 0; background: none; color: var(--text-muted); border-radius: var(--radius-sm); cursor: pointer; }
.qv button:hover { background: var(--surface-2); color: var(--text); }
.qv-empty { font-size: var(--text-xs); color: var(--text-faint); margin: 0; }
.attn { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.attn li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.attn-label { font-size: var(--text-xs); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/campaign-list.test.tsx`
Expected: PASS (KPI + all rows, status filter, source filter, search, gauge).

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/campaigns/campaign-list.tsx src/app/styles/kit.css tests/unit/components/campaign-list.test.tsx
git commit -m "feat(campaigns): CampaignListView — KPI row + command bar + context rail"
```

---

### Task 5: `campaigns/page.tsx` — server assembly

**Files:**
- Modify (rewrite): `src/app/(app)/campaigns/page.tsx`

**Interfaces:**
- Consumes: `db`; Drizzle `campaigns` + `vendorProfiles` join; `CampaignListRow`, `yieldPct` (Task 1); `CampaignListView` (Task 4); `PageHeader` (Task 2, with `actions`); `EmptyState`.
- Produces: the server route. Fetches campaigns joined to vendor name, maps to `CampaignListRow[]` (deriving `yield` via `yieldPct` and reading counts/credits from `stats`), renders `PageHeader` with a "New Campaign" CTA + `CampaignListView`, or `EmptyState` when there are none. `nowMs` computed server-side and passed down.

- [ ] **Step 1: Rewrite the page**

Replace `src/app/(app)/campaigns/page.tsx` with:
```tsx
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, vendorProfiles } from "@/db/schema";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { CampaignListView } from "./campaign-list";
import { yieldPct, type CampaignListRow, type CampaignStatsShape } from "./view-model";

export const metadata = { title: "Campaigns — Radar" };

export default async function CampaignsPage() {
  const raw = await db
    .select({
      campaignId: campaigns.campaignId, label: campaigns.label, source: campaigns.source,
      status: campaigns.status, stats: campaigns.stats, createdAt: campaigns.createdAt,
      vendorName: vendorProfiles.name,
    })
    .from(campaigns)
    .innerJoin(vendorProfiles, eq(campaigns.vendorId, vendorProfiles.vendorId))
    .orderBy(desc(campaigns.createdAt));

  const rows: CampaignListRow[] = raw.map((r) => {
    const s = (r.stats as CampaignStatsShape | null);
    const companies = s?.companiesFetched ?? 0;
    const leads = s?.leadsCreated ?? 0;
    return {
      campaignId: r.campaignId, label: r.label, vendorName: r.vendorName ?? "—",
      source: r.source, status: r.status, companies, leads,
      credits: s?.creditsSpent ?? 0, yield: yieldPct(companies, leads),
      createdAt: (r.createdAt ?? new Date()).toISOString(),
    };
  });

  const newCta = <Link href="/campaigns/new" className="btn btn-primary btn-sm">New Campaign</Link>;

  return (
    <>
      <PageHeader eyebrow="Operate" title="Campaigns" sub="Every sourcing run, its yield, and what needs a look." actions={newCta} />
      {rows.length === 0 ? (
        <EmptyState icon="campaigns" title="No campaigns yet"
          description="Open a vendor and hit “Find Leads” to run your first campaign." />
      ) : (
        <CampaignListView rows={rows} nowMs={Date.now()} />
      )}
    </>
  );
}
```
> `/campaigns/new` is Plan C's route; the CTA link is correct now and lands once Plan C ships. Until then it 404s — acceptable for an internal tool and explicitly a Plan C dependency (do not stub a fake route here).

- [ ] **Step 2: Verify typecheck + full component suite**

Run: `npm run typecheck` (clean — the page is server-only, no test). Then `npx vitest run tests/unit/components` — all green (the list/table/view-model tests from Tasks 1,3,4 pass; nothing else references the removed `CampaignList`/`CampaignRow`).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/campaigns/page.tsx
git commit -m "feat(campaigns): list page assembly — vendor join + KPIs + New Campaign CTA"
```

---

### Task 6: Detail surfaced-leads mapper

**Files:**
- Modify: `src/app/(app)/campaigns/view-model.ts` (append)
- Test: `tests/unit/components/campaign-view-model.test.ts` (append cases)

**Interfaces:**
- Produces:
  - Type `SurfacedLeadRow = { leadId: string; companyName: string; domain: string | null; signals: number | null; funding: string | null; headcount: number | null; score: number; wasNew: boolean }`.
  - `toSurfacedLeadRow(raw: { leadId: string; companyName: string; score: number | null; wasNew: boolean; profile: unknown; snapshot: unknown }): SurfacedLeadRow` — pulls `domain` from `companies.profile.domain`/`.website` (defensive), and `signals`/`funding`/`headcount` from `companySnapshots.snapshot.{opsPostings, fundraiseDate, headcountTotal}`; every derived field is `null` when absent. `score` defaults to `0` when the lead score is null.

- [ ] **Step 1: Append the failing test**

Append to `tests/unit/components/campaign-view-model.test.ts`:
```ts
import { toSurfacedLeadRow } from "@/app/(app)/campaigns/view-model";

describe("toSurfacedLeadRow", () => {
  it("pulls domain + snapshot fields defensively, nulls when absent", () => {
    const r = toSurfacedLeadRow({
      leadId: "l1", companyName: "RackPro", score: 72, wasNew: true,
      profile: { domain: "rackpro.io" },
      snapshot: { opsPostings: 4, fundraiseDate: "2026-03-01", headcountTotal: 180 },
    });
    expect(r).toEqual({ leadId: "l1", companyName: "RackPro", domain: "rackpro.io", signals: 4, funding: "2026-03-01", headcount: 180, score: 72, wasNew: true });
  });
  it("degrades to nulls / zero score when data is missing", () => {
    const r = toSurfacedLeadRow({ leadId: "l2", companyName: "Acme", score: null, wasNew: false, profile: null, snapshot: null });
    expect(r).toEqual({ leadId: "l2", companyName: "Acme", domain: null, signals: null, funding: null, headcount: null, score: 0, wasNew: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/campaign-view-model.test.ts`
Expected: FAIL — `toSurfacedLeadRow` not exported.

- [ ] **Step 3: Append the mapper**

Append to `src/app/(app)/campaigns/view-model.ts`:
```ts
export type SurfacedLeadRow = {
  leadId: string; companyName: string;
  domain: string | null; signals: number | null; funding: string | null; headcount: number | null;
  score: number; wasNew: boolean;
};

export function toSurfacedLeadRow(raw: {
  leadId: string; companyName: string; score: number | null; wasNew: boolean; profile: unknown; snapshot: unknown;
}): SurfacedLeadRow {
  const p = (raw.profile ?? {}) as Record<string, unknown>;
  const s = (raw.snapshot ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    leadId: raw.leadId,
    companyName: raw.companyName,
    domain: str(p.domain) ?? str(p.website),
    signals: num(s.opsPostings),
    funding: str(s.fundraiseDate),
    headcount: num(s.headcountTotal),
    score: raw.score ?? 0,
    wasNew: raw.wasNew,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/campaign-view-model.test.ts`
Expected: PASS (both new cases + the Task-1 cases still green).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/campaigns/view-model.ts tests/unit/components/campaign-view-model.test.ts
git commit -m "feat(campaigns): toSurfacedLeadRow — defensive snapshot/profile mapping"
```

---

### Task 7: `SurfacedLeadsTable`

**Files:**
- Create: `src/app/(app)/campaigns/surfaced-leads-table.tsx`
- Modify: `src/app/styles/kit.css`
- Test: `tests/unit/components/surfaced-leads-table.test.tsx`

**Interfaces:**
- Consumes: `SurfacedLeadRow` (Task 6); `ScoreMeter` (kit); `Segmented` (kit).
- Produces (`"use client"`): `SurfacedLeadsTable({ rows: SurfacedLeadRow[] })` — a `Segmented` "By score / New only" toggle over a `.data-table`: Company (+ domain sub), Signals, Funding, Headcount, Score (`ScoreMeter`), State (`new`/`updated` tag), Open→ link to `/leads/{id}`. "By score" sorts score desc; "New only" filters `wasNew`. Nullable cells render `"—"`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/surfaced-leads-table.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SurfacedLeadsTable } from "@/app/(app)/campaigns/surfaced-leads-table";
import type { SurfacedLeadRow } from "@/app/(app)/campaigns/view-model";

const rows: SurfacedLeadRow[] = [
  { leadId: "l1", companyName: "RackPro", domain: "rackpro.io", signals: 4, funding: "2026-03-01", headcount: 180, score: 72, wasNew: true },
  { leadId: "l2", companyName: "Acme", domain: null, signals: null, funding: null, headcount: null, score: 88, wasNew: false },
];

describe("SurfacedLeadsTable", () => {
  it("renders companies, an Open link, and '—' for missing cells", () => {
    render(<SurfacedLeadsTable rows={rows} />);
    expect(screen.getByText("RackPro")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Open/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
  it("sorts by score descending by default (Acme 88 before RackPro 72)", () => {
    render(<SurfacedLeadsTable rows={rows} />);
    const bodyRows = document.querySelectorAll("tbody tr");
    expect(bodyRows[0].textContent).toContain("Acme");
  });
  it("filters to new-only when that segment is chosen", async () => {
    render(<SurfacedLeadsTable rows={rows} />);
    await userEvent.click(screen.getByRole("button", { name: "New only" }));
    expect(screen.getByText("RackPro")).toBeInTheDocument();
    expect(screen.queryByText("Acme")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/surfaced-leads-table.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the component**

Create `src/app/(app)/campaigns/surfaced-leads-table.tsx`:
```tsx
"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ScoreMeter } from "@/app/components/ui/score-meter";
import { Segmented } from "@/app/components/ui/controls";
import type { SurfacedLeadRow } from "./view-model";

const VIEW_OPTS = [{ value: "score", label: "By score" }, { value: "new", label: "New only" }];
const dash = (v: string | number | null) => (v === null || v === "" ? "—" : String(v));

export function SurfacedLeadsTable({ rows }: { rows: SurfacedLeadRow[] }) {
  const [view, setView] = useState("score");
  const shown = useMemo(() => {
    const base = view === "new" ? rows.filter((r) => r.wasNew) : rows;
    return [...base].sort((a, b) => b.score - a.score);
  }, [rows, view]);

  return (
    <div>
      <div className="cmdbar" style={{ justifyContent: "flex-end" }}>
        <Segmented options={VIEW_OPTS} value={view} onChange={setView} />
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Company</th><th className="num">Signals</th><th>Funding</th>
              <th className="num">Headcount</th><th className="num">Score</th><th>State</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.leadId}>
                <td className="cell-co"><b>{l.companyName}</b><span>{dash(l.domain)}</span></td>
                <td className="num">{dash(l.signals)}</td>
                <td>{dash(l.funding)}</td>
                <td className="num">{dash(l.headcount)}</td>
                <td className="num"><ScoreMeter value={l.score} size="sm" /></td>
                <td><span className={`src-tag ${l.wasNew ? "live" : ""}`}>{l.wasNew ? "new" : "updated"}</span></td>
                <td className="num"><Link href={`/leads/${l.leadId}`} className="open-link">Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

Append to `src/app/styles/kit.css`:
```css
/* ---- 15. Surfaced-leads open link --------------------------------------- */
.open-link { color: var(--accent); text-decoration: none; font-family: var(--font-mono); font-size: var(--text-xs); white-space: nowrap; }
.open-link:hover { text-decoration: underline; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/surfaced-leads-table.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/campaigns/surfaced-leads-table.tsx src/app/styles/kit.css tests/unit/components/surfaced-leads-table.test.tsx
git commit -m "feat(campaigns): SurfacedLeadsTable — score sort + new-only + score meter"
```

---

### Task 8: `CampaignDetailView`

**Files:**
- Create: `src/app/(app)/campaigns/campaign-detail-view.tsx`
- Modify: `src/app/styles/kit.css`
- Test: `tests/unit/components/campaign-detail-view.test.tsx`

**Interfaces:**
- Consumes: `SurfacedLeadRow`, `CampaignStatsShape` (view-model); `StatTile`, `ScoreMeter`, `KvList` (kit); `SurfacedLeadsTable` (Task 7).
- Produces (`"use client"` — the surfaced table it wraps is a client component): `CampaignDetailView({ stats, runDetails, leads }: { stats: CampaignStatsShape | null; runDetails: { k: string; v: string }[]; leads: SurfacedLeadRow[] })` — a `ctx-grid`: main = 4 `StatTile`s (Companies fetched, Observations, Leads created + Δnew, Credits) + "Leads surfaced" + `SurfacedLeadsTable`; rail = Actions (Re-run · Export CSV · Add all to pipeline · Dismiss — presentational `.btn` stubs) + Run details (`KvList`) + Yield (best lead + `ScoreMeter`, avg score, new/updated split).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/campaign-detail-view.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CampaignDetailView } from "@/app/(app)/campaigns/campaign-detail-view";
import type { SurfacedLeadRow } from "@/app/(app)/campaigns/view-model";

const leads: SurfacedLeadRow[] = [
  { leadId: "l1", companyName: "RackPro", domain: "rackpro.io", signals: 4, funding: null, headcount: 180, score: 72, wasNew: true },
  { leadId: "l2", companyName: "Acme", domain: null, signals: null, funding: null, headcount: null, score: 88, wasNew: false },
];
const stats = { companiesFetched: 24, observationsWritten: 41, leadsCreated: 8, leadsUpdated: 1, creditsSpent: 0.87 };
// Vendor value is "Initech" (not a lead company) so getByText("RackPro") stays unique to the table.
const runDetails = [{ k: "Vendor", v: "Initech" }, { k: "Geography", v: "India" }];

describe("CampaignDetailView", () => {
  it("renders the four stat tiles and the run-details kv list", () => {
    render(<CampaignDetailView stats={stats} runDetails={runDetails} leads={leads} />);
    expect(screen.getByText("Companies fetched")).toBeInTheDocument();
    expect(screen.getByText("Observations")).toBeInTheDocument();
    expect(screen.getByText("Vendor")).toBeInTheDocument();
    expect(screen.getByText("India")).toBeInTheDocument();
  });
  it("surfaces the leads table and an Actions panel", () => {
    render(<CampaignDetailView stats={stats} runDetails={runDetails} leads={leads} />);
    expect(screen.getByText("RackPro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-run/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/campaign-detail-view.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the component**

Create `src/app/(app)/campaigns/campaign-detail-view.tsx`:
```tsx
"use client";
import { StatTile } from "@/app/components/ui/stat-tile";
import { ScoreMeter } from "@/app/components/ui/score-meter";
import { KvList } from "@/app/components/ui/kv-list";
import { SurfacedLeadsTable } from "./surfaced-leads-table";
import type { SurfacedLeadRow, CampaignStatsShape } from "./view-model";

export function CampaignDetailView({ stats, runDetails, leads }: {
  stats: CampaignStatsShape | null; runDetails: { k: string; v: string }[]; leads: SurfacedLeadRow[];
}) {
  const best = leads.reduce<SurfacedLeadRow | null>((b, l) => (!b || l.score > b.score ? l : b), null);
  const avg = leads.length ? Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length) : 0;
  const newCount = leads.filter((l) => l.wasNew).length;

  return (
    <div className="ctx-grid">
      <div className="ctx-main">
        <div className="stat-row">
          <StatTile label="Companies fetched" value={String(stats?.companiesFetched ?? 0)} />
          <StatTile label="Observations" value={String(stats?.observationsWritten ?? 0)} />
          <StatTile label="Leads created" value={String(stats?.leadsCreated ?? 0)} delta={`▲ ${newCount} new`} deltaDir="up" />
          <StatTile label="Credits" value={(stats?.creditsSpent ?? 0).toFixed(2)} />
        </div>
        <h2 className="signal-group-head">Leads surfaced</h2>
        {leads.length === 0 ? <p className="mapping-empty">No leads surfaced by this run.</p> : <SurfacedLeadsTable rows={leads} />}
      </div>

      <aside className="ctx-rail">
        <div className="ctx-panel">
          <h3>Actions</h3>
          <div className="actions-list">
            <button type="button" className="btn btn-sm">Re-run</button>
            <button type="button" className="btn btn-sm">Export CSV</button>
            <button type="button" className="btn btn-sm">Add all to pipeline</button>
            <button type="button" className="btn btn-sm btn-ghost">Dismiss</button>
          </div>
        </div>
        <div className="ctx-panel">
          <h3>Run details</h3>
          <KvList rows={runDetails} />
        </div>
        <div className="ctx-panel">
          <h3>Yield</h3>
          {best ? (
            <div className="yield-panel">
              <div className="yield-row"><span>Best lead</span><b>{best.companyName}</b></div>
              <div className="yield-row"><span>Top score</span><ScoreMeter value={best.score} size="sm" /></div>
              <div className="yield-row"><span>Avg score</span><b>{avg}</b></div>
              <div className="yield-row"><span>New / updated</span><b>{newCount} / {leads.length - newCount}</b></div>
            </div>
          ) : <p className="qv-empty">No yield yet.</p>}
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

Append to `src/app/styles/kit.css`:
```css
/* ---- 16. Detail — actions + yield panel --------------------------------- */
.actions-list { display: flex; flex-direction: column; gap: var(--space-2); align-items: stretch; }
.actions-list .btn { justify-content: flex-start; }
.yield-panel { display: flex; flex-direction: column; gap: var(--space-2); }
.yield-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: var(--text-sm); }
.yield-row span { color: var(--text-muted); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/campaign-detail-view.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/campaigns/campaign-detail-view.tsx src/app/styles/kit.css tests/unit/components/campaign-detail-view.test.tsx
git commit -m "feat(campaigns): CampaignDetailView — stat tiles + actions + run details + yield"
```

---

### Task 9: `campaigns/[campaignId]/page.tsx` — server assembly

**Files:**
- Modify (rewrite): `src/app/(app)/campaigns/[campaignId]/page.tsx`

**Interfaces:**
- Consumes: `db`; `getCampaign` (existing data.ts); Drizzle `campaignLeads`/`leads`/`companies`/`companySnapshots`/`vendorProfiles`; `toSurfacedLeadRow`, `sourceTag`, `CampaignStatsShape` (view-model); `PageHeader` (Task 2), `StatusPill` (kit), `CampaignDetailView` (Task 8).
- Produces: the detail route. Fetches the campaign + vendor + surfaced leads (LEFT JOIN `companySnapshots` on campaign+company for funding/headcount/signals) and maps rows via `toSurfacedLeadRow`; builds `runDetails` from `config` + timestamps; renders back-link, `PageHeader` (title + status pill + source tag via `actions`), and `CampaignDetailView`.

- [ ] **Step 1: Rewrite the page**

Replace `src/app/(app)/campaigns/[campaignId]/page.tsx` with:
```tsx
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getCampaign } from "@/lib/campaigns/data";
import { campaignLeads, leads, companies, companySnapshots, vendorProfiles } from "@/db/schema";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusPill } from "@/app/components/ui/status-pill";
import { CampaignDetailView } from "../campaign-detail-view";
import { toSurfacedLeadRow, sourceTag, type CampaignStatsShape } from "../view-model";

export default async function CampaignDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const campaign = await getCampaign(db, campaignId);
  if (!campaign) notFound();

  const [vendor] = await db.select({ name: vendorProfiles.name }).from(vendorProfiles).where(eq(vendorProfiles.vendorId, campaign.vendorId)).limit(1);

  const raw = await db
    .select({
      leadId: leads.leadId, companyName: companies.name, score: leads.score,
      wasNew: campaignLeads.wasNew, profile: companies.profile, snapshot: companySnapshots.snapshot,
    })
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.leadId))
    .innerJoin(companies, eq(leads.companyId, companies.companyId))
    .leftJoin(companySnapshots, and(eq(companySnapshots.campaignId, campaignId), eq(companySnapshots.companyId, companies.companyId)))
    .where(eq(campaignLeads.campaignId, campaignId));

  const surfaced = raw.map(toSurfacedLeadRow);
  const stats = campaign.stats as CampaignStatsShape | null;
  const cfg = (campaign.config ?? {}) as Record<string, unknown>;
  const tag = sourceTag(campaign.source);

  const runDetails = [
    { k: "Vendor", v: vendor?.name ?? "—" },
    { k: "Geography", v: String(cfg.geography ?? "—") },
    { k: "Target", v: String(cfg.target ?? "—") },
    { k: "Source", v: tag.label },
    { k: "Started", v: campaign.startedAt ? new Date(campaign.startedAt).toLocaleString() : "—" },
    { k: "Finished", v: campaign.finishedAt ? new Date(campaign.finishedAt).toLocaleString() : "—" },
  ];

  return (
    <>
      <Link href="/campaigns" className="back-link">← All campaigns</Link>
      <PageHeader eyebrow="Operate" title={campaign.label}
        actions={<><StatusPill status={campaign.status} /><span className={`src-tag ${tag.kind}`}>{tag.label}</span></>} />
      {campaign.error && <p role="alert" className="run-error">{campaign.error}</p>}
      <CampaignDetailView stats={stats} runDetails={runDetails} leads={surfaced} />
    </>
  );
}
```

- [ ] **Step 2: Verify typecheck + full component suite + regression**

Run: `npm run typecheck` (clean). Then `npx vitest run tests/unit/components` — all green. Then `npx vitest run tests/unit` — the whole unit suite stays green (nothing outside campaigns changed; `CampaignStatsShape` now resolves from `view-model.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/campaigns/\[campaignId\]/page.tsx
git commit -m "feat(campaigns): detail page assembly — snapshot join + status pill + run details"
```

---

## Self-Review

**1. Spec coverage (§4.1 list + §4.2 detail + §5 responsive):**
- §4.1 KPI row (4 tiles + sparkline + delta) → Task 4 (`deriveListKpis` Task 1) ✓
- §4.1 command bar (search + status chips + source segmented) → Task 4 ✓
- §4.1 campaigns table (Campaign+vendor sub, Source tag, Status pill, Companies, Leads, Yield meter, Credits money, Run relative, sortable, bulk-select, row→detail) → Task 3 ✓; empty → `EmptyState` Task 5 ✓
- §4.1 context rail (Credit gauge, Quick views drive filters, Needs-attention pills) → Task 4 ✓
- §4.2 header (label + status pill + source tag) → Task 9 ✓
- §4.2 4 stat tiles (+Δnew on leads) → Task 8 ✓
- §4.2 surfaced-leads table (Company+domain, Signals, Funding, Headcount, Score meter, State tag, Open→; by-score/new-only segmented) → Task 7 ✓ (nullable → "—")
- §4.2 context rail (Actions SVG/`.btn` stubs, Run details `.kv`, Yield best+avg+split) → Task 8 ✓
- §5 responsive — reuses kit's already-responsive `.ctx-grid`/`.stat-row`/`.table-wrap` (Plan A media queries at 1180/1080/560) ✓; no new fixed widths introduced.
- §6 backend: **out of scope for Plan B** (read views only). The `stats`/`config`/`companySnapshots` consumed here are all already written by the existing run pipeline. New-campaign form + parameter wiring = Plan C.

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". Presentational stubs (bulk bar actions, detail Actions buttons, `/campaigns/new` CTA) are intentional and labelled as later-plan wiring — none silently claim to work. Every code step is complete.

**3. Type consistency:** `CampaignListRow` (Task 1) is produced by Task 5's mapper and consumed by Tasks 3/4 with identical field names/types. `CampaignStatsShape` moved to `view-model.ts` and both pages import it from there (old `campaign-list` export removed in Task 4; Task 5 + Task 9 updated). `SurfacedLeadRow` (Task 6) flows Task 6→7→8→9 unchanged. `CampaignStatus` reused from the kit's `status-pill.tsx`. `StatTile`/`ScoreMeter`/`Gauge`/`StatusPill`/`KvList`/`SearchInput`/`FilterChips`/`Segmented`/`useSort`/`useRowSelection` all called with their real Plan-A signatures. All new CSS references real `tokens.css` custom properties.

**4. Scope check:** Read surfaces only (list + detail). No new-campaign form, no backend parameter changes, no data-layer helper needing a Neon test — all logic is in pure `view-model.ts` (unit-tested) or client components (jsdom-tested with fixtures), fetching stays inline in server pages. List (Tasks 1–5) is independently shippable and reviewable before detail (Tasks 6–9).
