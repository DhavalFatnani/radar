# UI Kit + Shell Implementation Plan (Redesign Plan A of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable UI kit — score-heat meter, stat tile + sparkline, radial gauge, toggle-row, kv-list, status pill, normalized form controls, filter/search/segmented controls, sortable+selectable table helpers, the main+context-rail layout — plus the shell change (topbar global search + notifications), so Redesign Plans B (Campaigns list/detail) and C (new-campaign form) assemble from a consistent, tested set.

**Architecture:** Small, focused React components under `src/app/components/ui/`, pure server components where possible (score-heat is computed at render time — no client JS), client components only for interactivity (filter chips, search, table sort/select). All styling lives in a new `src/app/styles/kit.css` (imported last in `layout.tsx`) and references radar's existing design tokens (`tokens.css`) — never hardcoded colors/spacing/radii. Everything works in both light and dark modes.

**Tech Stack:** Next.js 15 (App Router, RSC + client components), React 19 (`useState`), TypeScript strict, Vitest + jsdom + @testing-library/react for component tests.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-07-campaigns-ui-redesign-design.md` §2 (the kit) + §3 (shell). This is Plan A of 3; Plans B/C consume this kit.
- **Follow radar conventions exactly** (verified in-repo): pure presentational components are **server components** (no `"use client"`) like `page-header.tsx`/`empty-state.tsx`; interactive ones are `"use client"` with `useState`/`useTransition` like `mappings/status-controls.tsx`. Import alias `@/` → `src`.
- **Tokens only.** Use the real CSS custom properties from `tokens.css`: score-heat ramp `--strength-low` `--strength-medium` `--strength-high` `--strength-vhigh`; status `--status-approved(-bg)` `--status-proposed(-bg)` `--status-retired(-bg)`; semantic `--success` `--warning` `--attention` `--money` `--accent(-soft/-hover/-contrast)`; surfaces `--surface(-2)` `--inset`(via `--surface-inset`) `--border(-strong)` `--text(-muted/-faint)`; spacing `--space-1..12`; radii `--radius-sm/md/lg/full`; type `--text-2xs..3xl`; `--font-mono`. (Note the token is `--surface-inset`, not `--inset`.)
- **Score-heat thresholds (verbatim):** value `< 25` → `--strength-low`, `< 50` → `--strength-medium`, `< 75` → `--strength-high`, `>= 75` → `--strength-vhigh`. Cool→hot (high score = strong).
- **CSS home:** create `src/app/styles/kit.css`; add its import as the LAST line of the style imports in `src/app/layout.tsx` (after `command.css`) so kit rules win where needed. Each task appends its slice to `kit.css`.
- **Tests:** component tests go in `tests/unit/components/*.test.tsx`, first line `// @vitest-environment jsdom`; import `{ render, screen }` from `@testing-library/react`, `userEvent` from `@testing-library/user-event` for interaction; explicit `{ describe, it, expect }` imports from `vitest` (convention even though globals on). Run one file: `npx vitest run tests/unit/components/<file>.test.tsx`.
- **Branch:** `feature/campaigns-ui-redesign` (already checked out). One commit per task.

---

### Task 1: `kit.css` scaffold + normalized form controls

**Files:**
- Create: `src/app/styles/kit.css`
- Modify: `src/app/layout.tsx` (import kit.css last)
- Create: `src/app/components/ui/field.tsx`
- Test: `tests/unit/components/field.test.tsx`

**Interfaces:**
- Produces: CSS classes `.field-group` (label+control stack), `.field-label`, `.field-input` (text/number/select normalization: `appearance:none` select + custom chevron + fixed height + soft-halo focus), `.field-pair` (2-col grid, `align-items:start` so cells never stretch a borderless sibling and misalign inputs). And a `<Field>` server component wrapping label + control.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/field.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "@/app/components/ui/field";

describe("Field", () => {
  it("renders a label bound to the control by id", () => {
    render(<Field label="Geography" htmlFor="geo"><select id="geo" className="field-input"><option>India</option></select></Field>);
    const label = screen.getByText("Geography");
    expect(label).toHaveAttribute("for", "geo");
    expect(screen.getByRole("combobox")).toHaveClass("field-input");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/field.test.tsx`
Expected: FAIL — cannot find module `@/app/components/ui/field`.

- [ ] **Step 3: Create the Field component**

Create `src/app/components/ui/field.tsx`:
```tsx
import type { ReactNode } from "react";

/** A labelled form control. Pair two with <div className="field-pair"> for a 2-col row. */
export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Create kit.css with the form-control normalization**

Create `src/app/styles/kit.css`:
```css
/* ============================================================================
   Radar — UI Kit (redesign). Loaded last, after command.css. Tokens only.
   ========================================================================== */

/* ---- 1. Normalized form controls ---------------------------------------- */
.field-group { display: grid; gap: var(--space-1); }
.field-label {
  font-family: var(--font-mono); font-size: var(--text-2xs);
  letter-spacing: var(--tracking-caps); text-transform: uppercase; color: var(--text-muted);
}
.field-input {
  width: 100%; height: 38px; padding: 0 var(--space-3);
  border: var(--border-w) solid var(--border-strong); border-radius: var(--radius-md);
  background: var(--surface); color: var(--text); font: inherit; font-size: var(--text-sm);
}
select.field-input {
  appearance: none; -webkit-appearance: none; cursor: pointer; padding-right: var(--space-6);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%238A93A3' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right var(--space-3) center;
}
textarea.field-input { height: auto; padding: var(--space-2) var(--space-3); }
.field-input:focus {
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}
.field-pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); align-items: start; }
@media (max-width: 560px) { .field-pair { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Import kit.css last in layout**

In `src/app/layout.tsx`, add after the existing `import "./styles/command.css";` line:
```tsx
import "./styles/kit.css";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/field.test.tsx`
Expected: PASS. Then `npm run typecheck` clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/styles/kit.css src/app/layout.tsx src/app/components/ui/field.tsx tests/unit/components/field.test.tsx
git commit -m "feat(kit): kit.css scaffold + normalized form controls (Field, select/focus/pair)"
```

---

### Task 2: `ScoreMeter`

**Files:**
- Create: `src/app/components/ui/score-meter.tsx`
- Modify: `src/app/styles/kit.css` (append score-heat CSS)
- Test: `tests/unit/components/score-meter.test.tsx`

**Interfaces:**
- Produces: `scoreHeatVar(value: number): string` (returns a CSS var name string per the threshold table) and `<ScoreMeter value={number} size?: "sm" />` — a server component rendering a bar (fill width `value%`, fill color `var(scoreHeatVar(value))`) + the number.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/score-meter.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ScoreMeter, scoreHeatVar } from "@/app/components/ui/score-meter";

describe("scoreHeatVar", () => {
  it("maps value buckets to the strength ramp (cool→hot)", () => {
    expect(scoreHeatVar(10)).toBe("--strength-low");
    expect(scoreHeatVar(24)).toBe("--strength-low");
    expect(scoreHeatVar(25)).toBe("--strength-medium");
    expect(scoreHeatVar(49)).toBe("--strength-medium");
    expect(scoreHeatVar(50)).toBe("--strength-high");
    expect(scoreHeatVar(74)).toBe("--strength-high");
    expect(scoreHeatVar(75)).toBe("--strength-vhigh");
    expect(scoreHeatVar(100)).toBe("--strength-vhigh");
  });
});

describe("ScoreMeter", () => {
  it("renders the number and a fill sized to the value with the heat color", () => {
    const { container } = render(<ScoreMeter value={72} />);
    expect(container.querySelector(".score-num")?.textContent).toBe("72");
    const fill = container.querySelector(".score-fill") as HTMLElement;
    expect(fill.style.width).toBe("72%");
    expect(fill.style.background).toContain("--strength-high");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/score-meter.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the component**

Create `src/app/components/ui/score-meter.tsx`:
```tsx
/** Score-heat threshold → strength-ramp token (cool→hot; high score = strong). */
export function scoreHeatVar(value: number): string {
  if (value >= 75) return "--strength-vhigh";
  if (value >= 50) return "--strength-high";
  if (value >= 25) return "--strength-medium";
  return "--strength-low";
}

export function ScoreMeter({ value, size }: { value: number; size?: "sm" }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className={`score${size === "sm" ? " score-sm" : ""}`}>
      <span className="score-bar">
        <span className="score-fill" style={{ width: `${v}%`, background: `var(${scoreHeatVar(v)})` }} />
      </span>
      <span className="score-num">{v}</span>
    </span>
  );
}
```

- [ ] **Step 4: Append score-heat CSS to kit.css**

Append to `src/app/styles/kit.css`:
```css
/* ---- 2. Score-heat meter ------------------------------------------------ */
.score { display: inline-flex; align-items: center; gap: var(--space-2); }
.score-bar { width: 64px; height: 7px; border-radius: var(--radius-full); background: var(--surface-inset); overflow: hidden; flex: none; }
.score-fill { display: block; height: 100%; border-radius: var(--radius-full); }
.score-num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--text-sm); font-weight: var(--weight-semibold); min-width: 1.6ch; text-align: right; }
.score-sm .score-bar { width: 42px; height: 6px; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/score-meter.test.tsx`
Expected: PASS (both bucket + render cases).

- [ ] **Step 6: Commit**

```bash
git add src/app/components/ui/score-meter.tsx src/app/styles/kit.css tests/unit/components/score-meter.test.tsx
git commit -m "feat(kit): ScoreMeter — score-heat meter on the strength ramp"
```

---

### Task 3: `StatTile` + `Sparkline`

**Files:**
- Create: `src/app/components/ui/sparkline.tsx`
- Create: `src/app/components/ui/stat-tile.tsx`
- Modify: `src/app/styles/kit.css`
- Test: `tests/unit/components/stat-tile.test.tsx`

**Interfaces:**
- Produces: `<Sparkline points={number[]} />` (server component, SVG area+line+endpoint) and `<StatTile label value unit? delta? deltaDir? points? />`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/stat-tile.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile } from "@/app/components/ui/stat-tile";

describe("StatTile", () => {
  it("renders label, value, unit, and an up-delta", () => {
    const { container } = render(<StatTile label="Leads sourced" value="142" delta="▲ 23%" deltaDir="up" points={[4,7,6,9,12]} />);
    expect(screen.getByText("Leads sourced")).toBeInTheDocument();
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(container.querySelector(".stat-delta")).toHaveClass("up");
    expect(container.querySelector("svg.sparkline path")).toBeTruthy();
  });
  it("omits the sparkline when no points given", () => {
    const { container } = render(<StatTile label="X" value="1" />);
    expect(container.querySelector("svg.sparkline")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/stat-tile.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write Sparkline**

Create `src/app/components/ui/sparkline.tsx`:
```tsx
/** A tiny area+line sparkline. Pure — computes an SVG path from the point array. */
export function Sparkline({ points, width = 60, height = 24 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const max = Math.max(...points), min = Math.min(...points), span = max - min || 1;
  const pts = points.map((y, i) => [ (i / (points.length - 1)) * width, height - 2 - ((y - min) / span) * (height - 4) ]);
  const line = "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill="var(--accent)" opacity="0.08" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx={ex.toFixed(1)} cy={ey.toFixed(1)} r="2" fill="var(--accent)" />
    </svg>
  );
}
```

- [ ] **Step 4: Write StatTile**

Create `src/app/components/ui/stat-tile.tsx`:
```tsx
import { Sparkline } from "./sparkline";

export function StatTile({ label, value, unit, delta, deltaDir, points }: {
  label: string; value: string; unit?: string; delta?: string; deltaDir?: "up" | "down"; points?: number[];
}) {
  return (
    <div className="stat-tile">
      <div className="stat-k">{label}</div>
      <div className="stat-v">{value}{unit ? <small>{unit}</small> : null}</div>
      {delta ? <div className={`stat-delta ${deltaDir ?? ""}`}>{delta}</div> : null}
      {points && points.length > 1 ? <div className="stat-spark"><Sparkline points={points} /></div> : null}
    </div>
  );
}
```

- [ ] **Step 5: Append CSS**

Append to `src/app/styles/kit.css`:
```css
/* ---- 3. Stat tile ------------------------------------------------------- */
.stat-tile { position: relative; overflow: hidden; background: var(--surface); border: var(--border-w) solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-3) var(--space-4); }
.stat-k { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; color: var(--text-faint); }
.stat-v { font-family: var(--font-mono); font-size: var(--text-2xl); font-weight: var(--weight-semibold); letter-spacing: var(--tracking-tight); font-variant-numeric: tabular-nums; margin-top: 2px; }
.stat-v small { font-size: var(--text-sm); color: var(--text-muted); font-weight: var(--weight-regular); }
.stat-delta { font-family: var(--font-mono); font-size: var(--text-2xs); margin-top: 2px; }
.stat-delta.up { color: var(--success); } .stat-delta.down { color: var(--attention); }
.stat-spark { position: absolute; right: var(--space-3); bottom: var(--space-2); opacity: .9; }
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-3); }
@media (max-width: 1080px) { .stat-row { grid-template-columns: repeat(2, 1fr); } }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/stat-tile.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/components/ui/sparkline.tsx src/app/components/ui/stat-tile.tsx src/app/styles/kit.css tests/unit/components/stat-tile.test.tsx
git commit -m "feat(kit): StatTile + Sparkline"
```

---

### Task 4: `Gauge` (radial budget)

**Files:**
- Create: `src/app/components/ui/gauge.tsx`
- Modify: `src/app/styles/kit.css`
- Test: `tests/unit/components/gauge.test.tsx`

**Interfaces:**
- Produces: `<Gauge value={number} max={number} />` — an SVG donut; the accent arc's `stroke-dasharray` encodes `value/max`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/gauge.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Gauge } from "@/app/components/ui/gauge";

describe("Gauge", () => {
  it("draws the accent arc proportional to value/max", () => {
    const { container } = render(<Gauge value={12.6} max={600} />);
    const arc = container.querySelector(".gauge-arc") as SVGPathElement;
    // 12.6/600 = 2.1% → dasharray first value ≈ 2.1 (of ~100 circumference scale)
    expect(arc.getAttribute("stroke-dasharray")).toMatch(/^2\.1 /);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/gauge.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the component**

Create `src/app/components/ui/gauge.tsx`:
```tsx
/** A radial budget donut. The arc length encodes value/max on a ~100-unit circumference. */
export function Gauge({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const d = "M18 2.5a15.5 15.5 0 1 1 0 31 15.5 15.5 0 0 1 0-31";
  return (
    <svg className="gauge" viewBox="0 0 36 36" width="72" height="72" aria-hidden="true">
      <path d={d} fill="none" stroke="var(--surface-inset)" strokeWidth="3.4" />
      <path className="gauge-arc" d={d} fill="none" stroke="var(--accent)" strokeWidth="3.4" strokeLinecap="round" strokeDasharray={`${pct.toFixed(1)} 100`} />
    </svg>
  );
}
```

- [ ] **Step 4: Append CSS**

Append to `src/app/styles/kit.css`:
```css
/* ---- 4. Gauge ----------------------------------------------------------- */
.gauge { flex: none; }
.gauge-cluster { display: flex; align-items: center; gap: var(--space-3); }
.gauge-cluster .big { font-family: var(--font-mono); font-size: var(--text-xl); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
.gauge-cluster .sm { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/gauge.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/ui/gauge.tsx src/app/styles/kit.css tests/unit/components/gauge.test.tsx
git commit -m "feat(kit): Gauge — radial budget donut"
```

---

### Task 5: `StatusPill` + `KvList` + `ToggleRow`

**Files:**
- Create: `src/app/components/ui/status-pill.tsx`
- Create: `src/app/components/ui/kv-list.tsx`
- Create: `src/app/components/ui/toggle-row.tsx`
- Modify: `src/app/styles/kit.css`
- Test: `tests/unit/components/status-pill.test.tsx`

**Interfaces:**
- Produces:
  - `<StatusPill status="queued"|"running"|"done"|"failed" />` — renders `<span className="pill pill-{status}">{status}</span>` (a dotted pill; `running` pulses).
  - `<KvList rows={{ k: string; v: ReactNode }[]} />` — `.kv-list` of `.kv` rows.
  - `<ToggleRow label description name defaultChecked? />` — a bordered card: label + helper on the left, a switch on the right.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/status-pill.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "@/app/components/ui/status-pill";
import { KvList } from "@/app/components/ui/kv-list";
import { ToggleRow } from "@/app/components/ui/toggle-row";

describe("StatusPill", () => {
  it("renders a status class + text", () => {
    const { container } = render(<StatusPill status="done" />);
    expect(container.querySelector(".pill-done")?.textContent).toBe("done");
  });
});
describe("KvList", () => {
  it("renders key/value rows", () => {
    render(<KvList rows={[{ k: "Vendor", v: "Dhaval" }, { k: "Geo", v: "IND" }]} />);
    expect(screen.getByText("Vendor")).toBeInTheDocument();
    expect(screen.getByText("Dhaval")).toBeInTheDocument();
  });
});
describe("ToggleRow", () => {
  it("renders label, helper text, and a checkbox reflecting defaultChecked", () => {
    render(<ToggleRow label="Exclude seen" description="Skip past companies" name="excludeSeen" defaultChecked />);
    expect(screen.getByText("Exclude seen")).toBeInTheDocument();
    expect(screen.getByText("Skip past companies")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/status-pill.test.tsx`
Expected: FAIL — cannot find modules.

- [ ] **Step 3: Write the three components**

Create `src/app/components/ui/status-pill.tsx`:
```tsx
export type CampaignStatus = "queued" | "running" | "done" | "failed";
export function StatusPill({ status }: { status: CampaignStatus }) {
  return <span className={`pill pill-${status}`}>{status}</span>;
}
```

Create `src/app/components/ui/kv-list.tsx`:
```tsx
import type { ReactNode } from "react";
export function KvList({ rows }: { rows: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="kv-list">
      {rows.map((r) => (
        <div className="kv" key={r.k}><dt className="kv-k">{r.k}</dt><dd className="kv-v">{r.v}</dd></div>
      ))}
    </dl>
  );
}
```

Create `src/app/components/ui/toggle-row.tsx`:
```tsx
export function ToggleRow({ label, description, name, defaultChecked }: {
  label: string; description: string; name: string; defaultChecked?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-text"><b>{label}</b><span>{description}</span></span>
      <span className="switch"><input type="checkbox" name={name} defaultChecked={defaultChecked} /><span className="switch-track" /></span>
    </label>
  );
}
```

- [ ] **Step 4: Append CSS**

Append to `src/app/styles/kit.css`:
```css
/* ---- 5. Status pill (campaign run) -------------------------------------- */
.pill { display: inline-flex; align-items: center; gap: var(--space-1); font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; padding: 2px var(--space-2); border-radius: var(--radius-full); }
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill-done { color: var(--status-approved); background: var(--status-approved-bg); }
.pill-running { color: var(--status-proposed); background: var(--status-proposed-bg); }
.pill-running::before { animation: pulse 1.4s var(--ease-in-out) infinite; }
.pill-queued { color: var(--status-retired); background: var(--status-retired-bg); }
.pill-failed { color: var(--attention); background: color-mix(in srgb, var(--attention) 12%, transparent); }
@media (prefers-reduced-motion: reduce) { .pill-running::before { animation: none; } }

/* ---- 6. Kv list --------------------------------------------------------- */
.kv-list { margin: 0; }
.kv { display: flex; justify-content: space-between; gap: var(--space-3); padding: var(--space-1) 0; font-size: var(--text-xs); }
.kv + .kv { border-top: var(--border-w) solid var(--border); }
.kv-k { color: var(--text-muted); font-family: var(--font-mono); margin: 0; }
.kv-v { color: var(--text); font-weight: var(--weight-semibold); text-align: right; margin: 0; }

/* ---- 7. Toggle row ------------------------------------------------------ */
.toggle-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-2) var(--space-3); border: var(--border-w) solid var(--border); border-radius: var(--radius-md); background: var(--surface-2); cursor: pointer; }
.toggle-text b { font-size: var(--text-sm); display: block; } .toggle-text span { font-size: var(--text-2xs); color: var(--text-muted); }
.switch { position: relative; flex: none; } .switch input { position: absolute; opacity: 0; }
.switch-track { display: block; width: 34px; height: 19px; border-radius: var(--radius-full); background: var(--border-strong); transition: background var(--dur-fast); }
.switch-track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: #fff; transition: transform var(--dur-fast); }
.switch input:checked + .switch-track { background: var(--accent); }
.switch input:checked + .switch-track::after { transform: translateX(15px); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/status-pill.test.tsx`
Expected: PASS (all three components).

- [ ] **Step 6: Commit**

```bash
git add src/app/components/ui/status-pill.tsx src/app/components/ui/kv-list.tsx src/app/components/ui/toggle-row.tsx src/app/styles/kit.css tests/unit/components/status-pill.test.tsx
git commit -m "feat(kit): StatusPill + KvList + ToggleRow"
```

---

### Task 6: `SearchInput` + `FilterChips` + `Segmented` (client controls)

**Files:**
- Create: `src/app/components/ui/controls.tsx`
- Modify: `src/app/styles/kit.css`
- Test: `tests/unit/components/controls.test.tsx`

**Interfaces:**
- Produces (`"use client"`):
  - `<SearchInput value onChange placeholder? />` — controlled search field with magnifier.
  - `<FilterChips options={{value,label}[]} value onChange />` — exclusive chip row, active chip highlighted.
  - `<Segmented options={{value,label}[]} value onChange />` — compact exclusive segmented control.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/controls.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput, FilterChips, Segmented } from "@/app/components/ui/controls";

describe("SearchInput", () => {
  it("calls onChange with typed text", async () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} placeholder="Filter…" />);
    await userEvent.type(screen.getByPlaceholderText("Filter…"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });
});
describe("FilterChips", () => {
  const opts = [{ value: "all", label: "All" }, { value: "done", label: "Done" }];
  it("marks the active chip and reports selection", async () => {
    const onChange = vi.fn();
    render(<FilterChips options={opts} value="all" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "All" })).toHaveClass("chip-on");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith("done");
  });
});
describe("Segmented", () => {
  const opts = [{ value: "all", label: "All" }, { value: "live", label: "Live" }];
  it("reports the clicked segment", async () => {
    const onChange = vi.fn();
    render(<Segmented options={opts} value="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(onChange).toHaveBeenCalledWith("live");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/controls.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the controls**

Create `src/app/components/ui/controls.tsx`:
```tsx
"use client";
type Opt = { value: string; label: string };

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder ?? "Search"} />
    </div>
  );
}
export function FilterChips({ options, value, onChange }: { options: Opt[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="chips" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className={`chip${value === o.value ? " chip-on" : ""}`} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
export function Segmented({ options, value, onChange }: { options: Opt[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? "seg-on" : ""} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

Append to `src/app/styles/kit.css`:
```css
/* ---- 8. Search / chips / segmented -------------------------------------- */
.search { position: relative; flex: 1 1 200px; min-width: 170px; }
.search svg { position: absolute; left: var(--space-2); top: 50%; transform: translateY(-50%); width: 15px; height: 15px; color: var(--text-faint); }
.search input { width: 100%; height: 36px; padding: 0 var(--space-3) 0 2rem; border: var(--border-w) solid var(--border-strong); border-radius: var(--radius-md); background: var(--surface); color: var(--text); font: inherit; font-size: var(--text-sm); }
.search input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
.chips { display: flex; gap: var(--space-1); flex-wrap: wrap; }
.chip { font-family: var(--font-mono); font-size: var(--text-xs); padding: var(--space-1) var(--space-2); border-radius: var(--radius-full); border: var(--border-w) solid var(--border-strong); background: var(--surface); color: var(--text-muted); cursor: pointer; }
.chip:hover { color: var(--text); } .chip-on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.seg { display: inline-flex; border: var(--border-w) solid var(--border-strong); border-radius: var(--radius-md); overflow: hidden; }
.seg button { font-family: var(--font-mono); font-size: var(--text-xs); padding: var(--space-1) var(--space-2); border: 0; background: var(--surface); color: var(--text-muted); cursor: pointer; }
.seg button + button { border-left: var(--border-w) solid var(--border); }
.seg button.seg-on { background: var(--accent-soft); color: var(--accent); }
.cmdbar { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/controls.test.tsx`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add src/app/components/ui/controls.tsx src/app/styles/kit.css tests/unit/components/controls.test.tsx
git commit -m "feat(kit): SearchInput + FilterChips + Segmented controls"
```

---

### Task 7: Table sort/select hooks + context-rail layout CSS

**Files:**
- Create: `src/app/components/ui/use-table.ts`
- Modify: `src/app/styles/kit.css`
- Test: `tests/unit/components/use-table.test.tsx`

**Interfaces:**
- Produces (`"use client"` hooks):
  - `useSort<T>(rows: T[], initialKey: keyof T & string, initialDir?: 1 | -1)` → `{ sorted, sortKey, sortDir, toggle(key) }` — pure sort by a key, string vs number aware.
  - `useRowSelection(ids: string[])` → `{ selected: Set<string>, toggle(id), toggleAll(), allChecked }`.
- Produces CSS: `.data-table` (sortable header affordance + hover + numeric alignment), `.ctx-grid` (main + context-rail layout, sticky, responsive), `.ctx-rail`, `.ctx-panel`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/use-table.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSort, useRowSelection } from "@/app/components/ui/use-table";

describe("useSort", () => {
  const rows = [{ n: "b", v: 2 }, { n: "a", v: 3 }, { n: "c", v: 1 }];
  it("sorts by a numeric key and flips direction on re-toggle", () => {
    const { result } = renderHook(() => useSort(rows, "v", 1));
    expect(result.current.sorted.map((r) => r.v)).toEqual([1, 2, 3]);
    act(() => result.current.toggle("v"));
    expect(result.current.sorted.map((r) => r.v)).toEqual([3, 2, 1]);
  });
  it("sorts by a string key", () => {
    const { result } = renderHook(() => useSort(rows, "n", 1));
    expect(result.current.sorted.map((r) => r.n)).toEqual(["a", "b", "c"]);
  });
});
describe("useRowSelection", () => {
  it("toggles a row and select-all", () => {
    const { result } = renderHook(() => useRowSelection(["x", "y"]));
    act(() => result.current.toggle("x"));
    expect(result.current.selected.has("x")).toBe(true);
    act(() => result.current.toggleAll());
    expect(result.current.allChecked).toBe(true);
    expect(result.current.selected.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/use-table.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the hooks**

Create `src/app/components/ui/use-table.ts`:
```ts
"use client";
import { useMemo, useState } from "react";

export function useSort<T>(rows: T[], initialKey: keyof T & string, initialDir: 1 | -1 = 1) {
  const [sortKey, setSortKey] = useState<keyof T & string>(initialKey);
  const [sortDir, setSortDir] = useState<1 | -1>(initialDir);
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (typeof x === "string" && typeof y === "string") return x.localeCompare(y) * sortDir;
      return ((x as number) - (y as number)) * sortDir;
    });
  }, [rows, sortKey, sortDir]);
  function toggle(key: keyof T & string) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  }
  return { sorted, sortKey, sortDir, toggle };
}

export function useRowSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const allChecked = ids.length > 0 && ids.every((id) => selected.has(id));
  function toggleAll() { setSelected(allChecked ? new Set() : new Set(ids)); }
  return { selected, toggle, toggleAll, allChecked };
}
```

- [ ] **Step 4: Append CSS (table + context-rail layout)**

Append to `src/app/styles/kit.css`:
```css
/* ---- 9. Data table ------------------------------------------------------ */
.table-wrap { background: var(--surface); border: var(--border-w) solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); min-width: 640px; }
.data-table thead th { text-align: left; font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; color: var(--text-faint); font-weight: var(--weight-medium); padding: var(--space-2) var(--space-4); border-bottom: var(--border-w) solid var(--border); white-space: nowrap; }
.data-table thead th.sortable { cursor: pointer; user-select: none; }
.data-table thead th.num { text-align: right; }
.data-table thead th .arw { margin-left: 2px; font-size: .6rem; }
.data-table tbody tr { border-bottom: var(--border-w) solid var(--border); }
.data-table tbody tr:last-child { border-bottom: 0; }
.data-table tbody tr.clickable { cursor: pointer; } .data-table tbody tr:hover { background: var(--surface-2); }
.data-table td { padding: var(--space-2) var(--space-4); vertical-align: middle; white-space: nowrap; }
.data-table td.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.data-table td.money { color: var(--money); }
.cell-co b { font-weight: var(--weight-semibold); font-size: var(--text-sm); display: block; }
.cell-co span { font-size: var(--text-2xs); color: var(--text-faint); font-family: var(--font-mono); }

/* ---- 10. Main + context-rail layout ------------------------------------- */
.ctx-grid { display: grid; grid-template-columns: minmax(0, 1fr) 316px; gap: var(--space-4); align-items: start; }
.ctx-rail { display: flex; flex-direction: column; gap: var(--space-3); position: sticky; top: 68px; }
.ctx-panel { background: var(--surface); border: var(--border-w) solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-4); }
.ctx-panel h3 { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; color: var(--text-faint); margin: 0 0 var(--space-3); }
@media (max-width: 1180px) { .ctx-grid { grid-template-columns: 1fr; } .ctx-rail { position: static; flex-direction: row; flex-wrap: wrap; } .ctx-rail .ctx-panel { flex: 1 1 240px; } }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/use-table.test.tsx`
Expected: PASS (sort numeric/string/flip; selection toggle/all).

- [ ] **Step 6: Commit**

```bash
git add src/app/components/ui/use-table.ts src/app/styles/kit.css tests/unit/components/use-table.test.tsx
git commit -m "feat(kit): useSort/useRowSelection hooks + data-table & context-rail CSS"
```

---

### Task 8: Shell — topbar global search + notifications

**Files:**
- Modify: `src/app/components/shell/topbar.tsx`
- Create: `src/app/components/shell/global-search.tsx`
- Modify: `src/app/styles/kit.css`
- Test: `tests/unit/components/topbar.test.tsx`

**Interfaces:**
- Consumes: existing `ModeToggle`.
- Produces: `<GlobalSearch />` (a `"use client"` command-palette trigger button showing "Search… ⌘K"; opens nothing yet — a stub that's keyboard-focusable and labelled) rendered in the topbar alongside a notifications icon-button and the mode toggle.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/topbar.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/components/shell/mode-toggle", () => ({ ModeToggle: () => <button aria-label="Toggle theme" /> }));

import { Topbar } from "@/app/components/shell/topbar";

describe("Topbar", () => {
  it("renders the global search trigger with the ⌘K hint and a notifications button", () => {
    render(<Topbar />);
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
    expect(screen.getByText(/⌘K/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notifications/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/topbar.test.tsx`
Expected: FAIL — no global-search trigger / notifications button.

- [ ] **Step 3: Write GlobalSearch**

Create `src/app/components/shell/global-search.tsx`:
```tsx
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
```

- [ ] **Step 4: Wire the topbar**

Replace `src/app/components/shell/topbar.tsx` with:
```tsx
import type { ReactNode } from "react";
import { ModeToggle } from "./mode-toggle";
import { GlobalSearch } from "./global-search";

// Thin action bar — global search + notifications + theme. The page's PageHeader
// owns the single <h1>; the rail owns the brand.
export function Topbar({ actions }: { actions?: ReactNode }) {
  return (
    <header className="v2-topbar">
      <GlobalSearch />
      <div className="v2-actions">
        <button type="button" className="icon-btn" aria-label="Notifications">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
        </button>
        <ModeToggle />
        {actions}
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Append CSS**

Append to `src/app/styles/kit.css`:
```css
/* ---- 11. Topbar global search ------------------------------------------- */
.global-search { display: flex; align-items: center; gap: var(--space-2); flex: 1; max-width: 440px; height: 34px; padding: 0 var(--space-3); border: var(--border-w) solid var(--border-strong); border-radius: var(--radius-md); background: var(--surface-2); color: var(--text-faint); font-size: var(--text-sm); cursor: text; text-align: left; }
.global-search svg { width: 15px; height: 15px; flex: none; }
.global-search span { flex: 1; } .global-search .kbd { flex: none; font-family: var(--font-mono); font-size: var(--text-2xs); border: var(--border-w) solid var(--border-strong); border-radius: 4px; padding: 0 4px; }
@media (max-width: 820px) { .global-search { display: none; } }
```

- [ ] **Step 6: Run test + regression**

Run: `npx vitest run tests/unit/components/topbar.test.tsx` (PASS). Then `npm run typecheck` and `npx vitest run tests/unit/components` — the full component suite stays green (existing shell tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/app/components/shell/topbar.tsx src/app/components/shell/global-search.tsx src/app/styles/kit.css tests/unit/components/topbar.test.tsx
git commit -m "feat(shell): topbar global search (⌘K) + notifications"
```

---

## Self-Review

**1. Spec coverage (§2 kit + §3 shell):**
- §2.1 score-heat meter → Task 2 ✓ (thresholds verbatim)
- §2.2 status pills → Task 5 ✓ (done/running+pulse/queued/failed, dot, reduced-motion)
- §2.3 stat tile + sparkline → Task 3 ✓
- §2.4 command bar (search/chips/segmented) → Task 6 ✓
- §2.5 data table (sortable + bulk-select) → Task 7 (hooks + CSS; the assembled table markup lives in Plan B views) ✓
- §2.6 context-rail layout → Task 7 CSS ✓
- §2.7 modern form controls (select appearance:none + chevron, soft-halo focus, `.field-pair` align-start, toggle-row) → Tasks 1 + 5 ✓
- §2.8 radial gauge → Task 4 ✓
- §2.9 buttons w/ SVG icons (existing `.btn`), kv-list, readiness banner (existing `.readiness-*`), empty state (existing), page header (existing) → reused; kv-list Task 5 ✓
- §3 shell: topbar global search + notifications → Task 8 ✓; brand "radar" — **already** "Radar · lead intelligence" in `rail.tsx` (no "ops radar" in real code), nav-icon `campaigns` already present → no change needed (noted).

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". `GlobalSearch` onClick is an intentional stub (the ⌘K modal is a later plan), labelled as such. Every code step is complete.

**3. Type consistency:** `scoreHeatVar`/`ScoreMeter` (Task 2) used by Plan B; `CampaignStatus` (Task 5) matches the DB enum `queued|running|done|failed`; `useSort`/`useRowSelection` (Task 7) generic signatures match their tests; `SearchInput`/`FilterChips`/`Segmented` (Task 6) `Opt = {value,label}` consistent; `StatTile`/`Sparkline`/`Gauge`/`KvList`/`ToggleRow`/`Field` props match their tests. All CSS references real `tokens.css` custom properties (verified names, incl. `--surface-inset` not `--inset`).

**4. Scope check:** Foundation only — no view assembly (that's Plan B) and no backend (Plan C). Every task is an independently testable component/hook. Good.
