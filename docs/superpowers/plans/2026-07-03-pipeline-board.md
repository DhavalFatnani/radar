# Lead Pipeline Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/pipeline` board — view every lead grouped by stage and move a lead through the pre-wired `pipeline_stage` enum via legal, validated transitions.

**Architecture:** A pure stage-transition domain model (`src/lib/pipeline/schema.ts`), a server-only data layer that reads board cards and writes stage changes (`src/lib/pipeline/data.ts`, injected `db: DB`), a thin auth-gated server action, and the board UI (RSC page + presentational board + client stage controls). No schema migration — the column and enum already exist.

**Tech Stack:** Next.js 15 App Router (RSC + server actions), TypeScript strict, Drizzle ORM over Postgres (Neon), NextAuth v5, Vitest (unit + integration + jsdom component tests via `@testing-library/react`).

## Global Constraints

- `PIPELINE_STAGES` mirrors `src/db/schema/enums.ts` `pipelineStage` values **exactly and in the same order**: `["sourced","contacted","engaged","pitched","won","lost","delivered","paid"]`.
- The pure schema module (`src/lib/pipeline/schema.ts`) imports **nothing** from `@/db`, `@/ai`, or `server-only` — it must be safe to import from client components and tests.
- The data layer takes `db: DB` as its first parameter via `import type { DB } from "@/db/client"` — the `type` keyword is **load-bearing** (a value import eagerly runs `postgres(env.DATABASE_URL)` and breaks no-DB tests). The RSC page and server action import the singleton `db` from `@/db/client` and pass it in.
- The stage transition is validated in **both** the server action (`PIPELINE_STAGES` membership of the client-supplied `to`) and the data layer (`canAdvance(from, to)`). Never trust the client-supplied target.
- Parameterized Drizzle queries only — never string-interpolated SQL. UUID-guard `leadId` before querying with `const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;`.
- The server action is auth-gated with a local `signedIn()` helper (`const session = await auth(); return Boolean(session?.user);`), mirroring `src/app/(app)/mappings/actions.ts`.
- No schema migration. The only column written is `leads.pipeline_stage`. The tender path, scoring, brief, contacts, and `generateLeads` are untouched.
- Mobile-first (design at 375px first). Semantic HTML: `<section>`, `<ul>`/`<li>`, `<button>`. Buttons are keyboard-navigable with visible focus states and accessible names. Errors surface via `role="alert"`. No image without an `alt`.
- No `console.log`, no `TODO` comments, no silent empty `catch` in committed code.
- Additive only: new files under `src/lib/pipeline/` and `src/app/(app)/pipeline/`, replace the `pipeline/page.tsx` stub, and append to `src/app/styles/components.css`. Touch nothing else.
- Commit only the explicit file paths listed in each step — never `git add .` or `git add -A`. Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Pipeline stage domain model (pure)

**Files:**
- Create: `src/lib/pipeline/schema.ts`
- Test: `tests/unit/pipeline/schema.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (later tasks rely on these exact names/types):
  - `PIPELINE_STAGES: readonly ["sourced","contacted","engaged","pitched","won","lost","delivered","paid"]`
  - `type PipelineStage = (typeof PIPELINE_STAGES)[number]`
  - `STAGE_LABELS: Record<PipelineStage, string>`
  - `BOARD_ORDER: PipelineStage[]`
  - `canAdvance(from: PipelineStage, to: PipelineStage): boolean`
  - `nextStages(from: PipelineStage): PipelineStage[]`
  - `isTerminal(stage: PipelineStage): boolean`
  - `type LeadCard = { leadId: string; companyName: string; vendorName: string; intent: string | null; score: number | null; stage: PipelineStage; hasBrief: boolean; hasContactBlock: boolean; createdAt: Date }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pipeline/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  PIPELINE_STAGES,
  BOARD_ORDER,
  STAGE_LABELS,
  canAdvance,
  nextStages,
  isTerminal,
  type PipelineStage,
} from "@/lib/pipeline/schema";

// Must mirror src/db/schema/enums.ts pipelineStage exactly, same order.
const ENUM_ORDER: PipelineStage[] = [
  "sourced",
  "contacted",
  "engaged",
  "pitched",
  "won",
  "lost",
  "delivered",
  "paid",
];

describe("pipeline stage model", () => {
  it("PIPELINE_STAGES mirrors the DB enum exactly and in order", () => {
    expect([...PIPELINE_STAGES]).toEqual(ENUM_ORDER);
  });

  it("STAGE_LABELS provides a non-empty label for every stage", () => {
    for (const s of PIPELINE_STAGES) {
      expect(STAGE_LABELS[s]).toBeTruthy();
    }
  });

  it("BOARD_ORDER is a permutation of PIPELINE_STAGES with lost placed last", () => {
    expect([...BOARD_ORDER].sort()).toEqual([...PIPELINE_STAGES].sort());
    expect(BOARD_ORDER[BOARD_ORDER.length - 1]).toBe("lost");
  });

  it("canAdvance accepts every legal forward edge", () => {
    expect(canAdvance("sourced", "contacted")).toBe(true);
    expect(canAdvance("contacted", "engaged")).toBe(true);
    expect(canAdvance("engaged", "pitched")).toBe(true);
    expect(canAdvance("pitched", "won")).toBe(true);
    expect(canAdvance("won", "delivered")).toBe(true);
    expect(canAdvance("delivered", "paid")).toBe(true);
  });

  it("canAdvance allows lost only from the active pre-win stages", () => {
    expect(canAdvance("sourced", "lost")).toBe(true);
    expect(canAdvance("contacted", "lost")).toBe(true);
    expect(canAdvance("engaged", "lost")).toBe(true);
    expect(canAdvance("pitched", "lost")).toBe(true);
    expect(canAdvance("won", "lost")).toBe(false);
    expect(canAdvance("delivered", "lost")).toBe(false);
    expect(canAdvance("paid", "lost")).toBe(false);
  });

  it("canAdvance rejects skip-ahead and backward moves", () => {
    expect(canAdvance("sourced", "engaged")).toBe(false);
    expect(canAdvance("sourced", "won")).toBe(false);
    expect(canAdvance("engaged", "contacted")).toBe(false);
    expect(canAdvance("won", "pitched")).toBe(false);
    expect(canAdvance("paid", "delivered")).toBe(false);
    expect(canAdvance("sourced", "sourced")).toBe(false);
  });

  it("nextStages returns the exact legal targets per stage", () => {
    expect(nextStages("sourced")).toEqual(["contacted", "lost"]);
    expect(nextStages("contacted")).toEqual(["engaged", "lost"]);
    expect(nextStages("engaged")).toEqual(["pitched", "lost"]);
    expect(nextStages("pitched")).toEqual(["won", "lost"]);
    expect(nextStages("won")).toEqual(["delivered"]);
    expect(nextStages("delivered")).toEqual(["paid"]);
    expect(nextStages("paid")).toEqual([]);
    expect(nextStages("lost")).toEqual([]);
  });

  it("isTerminal is true only for paid and lost", () => {
    expect(isTerminal("paid")).toBe(true);
    expect(isTerminal("lost")).toBe(true);
    for (const s of [
      "sourced",
      "contacted",
      "engaged",
      "pitched",
      "won",
      "delivered",
    ] as PipelineStage[]) {
      expect(isTerminal(s)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/pipeline/schema.test.ts`
Expected: FAIL — cannot resolve `@/lib/pipeline/schema` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/pipeline/schema.ts`:

```typescript
// Pure pipeline-stage domain model. Mirrors the pipeline_stage enum in
// src/db/schema/enums.ts. No imports from @/db, @/ai, or server-only — safe to
// import from client components and tests. Mirrors the canTransition precedent in
// src/lib/signals/schema.ts.

// Enum union — mirror src/db/schema/enums.ts pipelineStage EXACTLY, same order.
export const PIPELINE_STAGES = [
  "sourced",
  "contacted",
  "engaged",
  "pitched",
  "won",
  "lost",
  "delivered",
  "paid",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Human-readable labels for display.
export const STAGE_LABELS: Record<PipelineStage, string> = {
  sourced: "Sourced",
  contacted: "Contacted",
  engaged: "Engaged",
  pitched: "Pitched",
  won: "Won",
  lost: "Lost",
  delivered: "Delivered",
  paid: "Paid",
};

// Column order for the board — funnel order with the terminal `lost` moved last.
// A permutation of PIPELINE_STAGES (whose order is locked to the DB enum).
export const BOARD_ORDER: PipelineStage[] = [
  "sourced",
  "contacted",
  "engaged",
  "pitched",
  "won",
  "delivered",
  "paid",
  "lost",
];

// The legal forward moves. `lost` is an escape hatch from the active pre-win
// stages only — a won/delivered/paid deal is never "lost". Forward-only: no
// backward edges (backward correction is a later enhancement).
const ALLOWED: Record<PipelineStage, PipelineStage[]> = {
  sourced: ["contacted", "lost"],
  contacted: ["engaged", "lost"],
  engaged: ["pitched", "lost"],
  pitched: ["won", "lost"],
  won: ["delivered"],
  delivered: ["paid"],
  paid: [],
  lost: [],
};

export function canAdvance(from: PipelineStage, to: PipelineStage): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function nextStages(from: PipelineStage): PipelineStage[] {
  return ALLOWED[from] ?? [];
}

export function isTerminal(stage: PipelineStage): boolean {
  return nextStages(stage).length === 0;
}

// Board read shape returned by the data layer.
export type LeadCard = {
  leadId: string;
  companyName: string;
  vendorName: string;
  intent: string | null;
  score: number | null;
  stage: PipelineStage;
  hasBrief: boolean;
  hasContactBlock: boolean;
  createdAt: Date;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/pipeline/schema.test.ts`
Expected: PASS (8 tests).

Also confirm the pure module has no forbidden imports:
Run: `grep -nE "@/db|@/ai|server-only" src/lib/pipeline/schema.ts`
Expected: no matches (empty output).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/schema.ts tests/unit/pipeline/schema.test.ts
git commit -m "feat(pipeline): pure stage-transition domain model

PIPELINE_STAGES mirrors the pipeline_stage enum; canAdvance/nextStages/isTerminal
encode a forward-only graph with a lost escape hatch from active pre-win stages;
BOARD_ORDER + STAGE_LABELS + LeadCard drive the board UI. Pure and client-safe.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pipeline data layer (read cards + write stage)

**Files:**
- Create: `src/lib/pipeline/data.ts`
- Test: `tests/integration/pipeline-data.test.ts`

**Interfaces:**
- Consumes: `canAdvance`, `LeadCard`, `PipelineStage` from `@/lib/pipeline/schema`; `DB` (type-only) from `@/db/client`; `leads`, `companies`, `vendorProfiles` from `@/db/schema`.
- Produces (later tasks rely on these):
  - `listPipelineLeads(db: DB): Promise<LeadCard[]>`
  - `setLeadStage(db: DB, leadId: string, to: PipelineStage): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/pipeline-data.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { leads, companies, vendorProfiles } from "@/db/schema";
import { listPipelineLeads, setLeadStage } from "@/lib/pipeline/data";
import type { PipelineStage } from "@/lib/pipeline/schema";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
});

async function makeCompany(name: string): Promise<string> {
  const [row] = await testDb
    .insert(companies)
    .values({ name, normalizedName: name.toLowerCase() })
    .returning();
  return row.companyId;
}

async function makeVendor(name: string): Promise<string> {
  const [row] = await testDb.insert(vendorProfiles).values({ name }).returning();
  return row.vendorId;
}

async function makeLead(opts: {
  companyId: string;
  vendorId: string;
  intent?: string | null;
  score?: number | null;
  stage?: PipelineStage;
  brief?: unknown;
  contactBlock?: unknown;
}): Promise<string> {
  const [row] = await testDb
    .insert(leads)
    .values({
      companyId: opts.companyId,
      vendorId: opts.vendorId,
      intent: opts.intent ?? null,
      score: opts.score ?? null,
      pipelineStage: opts.stage ?? "sourced",
      brief: opts.brief ?? null,
      contactBlock: opts.contactBlock ?? null,
    })
    .returning();
  return row.leadId;
}

describe("pipeline data layer", () => {
  it("listPipelineLeads returns board cards joined to company + vendor names", async () => {
    const companyId = await makeCompany("Zephyr Retail");
    const vendorId = await makeVendor("Acme Infra");
    await makeLead({
      companyId,
      vendorId,
      intent: "Warehouse buildout",
      score: 8.5,
      stage: "contacted",
    });

    const cards = await listPipelineLeads(testDb);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.companyName).toBe("Zephyr Retail");
    expect(card.vendorName).toBe("Acme Infra");
    expect(card.intent).toBe("Warehouse buildout");
    expect(card.score).toBe(8.5);
    expect(card.stage).toBe("contacted");
    expect(card.hasBrief).toBe(false);
    expect(card.hasContactBlock).toBe(false);
    expect(card.createdAt).toBeInstanceOf(Date);
  });

  it("hasBrief / hasContactBlock reflect jsonb presence", async () => {
    const companyId = await makeCompany("Meridian Logistics");
    const vendorId = await makeVendor("Beacon Marketing");
    await makeLead({
      companyId,
      vendorId,
      stage: "engaged",
      brief: { hook: "expanding fast" },
      contactBlock: { decision_makers: [] },
    });

    const [card] = await listPipelineLeads(testDb);
    expect(card.hasBrief).toBe(true);
    expect(card.hasContactBlock).toBe(true);
  });

  it("listPipelineLeads orders by score desc with nulls last", async () => {
    const companyId = await makeCompany("Vantage Foods");
    const vendorId = await makeVendor("Acme Infra");
    await makeLead({ companyId, vendorId, intent: "low", score: 2 });
    await makeLead({ companyId, vendorId, intent: "high", score: 9 });
    await makeLead({ companyId, vendorId, intent: "none", score: null });

    const cards = await listPipelineLeads(testDb);
    expect(cards.map((c) => c.intent)).toEqual(["high", "low", "none"]);
  });

  it("setLeadStage performs a legal move", async () => {
    const companyId = await makeCompany("Co One");
    const vendorId = await makeVendor("Vendor One");
    const leadId = await makeLead({ companyId, vendorId, stage: "sourced" });

    const res = await setLeadStage(testDb, leadId, "contacted");
    expect(res.ok).toBe(true);

    const [row] = await testDb
      .select({ stage: leads.pipelineStage })
      .from(leads)
      .where(eq(leads.leadId, leadId));
    expect(row.stage).toBe("contacted");
  });

  it("setLeadStage rejects an illegal move without mutating the row", async () => {
    const companyId = await makeCompany("Co Two");
    const vendorId = await makeVendor("Vendor Two");
    const leadId = await makeLead({ companyId, vendorId, stage: "sourced" });

    const res = await setLeadStage(testDb, leadId, "paid");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cannot move/i);

    const [row] = await testDb
      .select({ stage: leads.pipelineStage })
      .from(leads)
      .where(eq(leads.leadId, leadId));
    expect(row.stage).toBe("sourced");
  });

  it("setLeadStage rejects a malformed id", async () => {
    const res = await setLeadStage(testDb, "not-a-uuid", "contacted");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Lead not found.");
  });

  it("setLeadStage rejects an unknown lead", async () => {
    const res = await setLeadStage(
      testDb,
      "10000000-0000-4000-8000-000000000009",
      "contacted",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Lead not found.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/pipeline-data.test.ts`
Expected: FAIL — cannot resolve `@/lib/pipeline/data` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/pipeline/data.ts`:

```typescript
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — erased at runtime; a value import would eagerly open Postgres
import { leads, companies, vendorProfiles } from "@/db/schema";
import { canAdvance, type LeadCard, type PipelineStage } from "@/lib/pipeline/schema";

const PIPELINE_LEAD_LIMIT = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * All leads as board cards, joined to company + vendor names. brief/contactBlock
 * are reduced to booleans in SQL — the jsonb payloads are never pulled into the
 * board. Ordered score desc (nulls last) then newest first, so the strongest lead
 * heads each column once the UI groups by stage. Caller owns the connection.
 */
export async function listPipelineLeads(db: DB): Promise<LeadCard[]> {
  const rows = await db
    .select({
      leadId: leads.leadId,
      companyName: companies.name,
      vendorName: vendorProfiles.name,
      intent: leads.intent,
      score: leads.score,
      stage: leads.pipelineStage,
      hasBrief: sql<boolean>`(${leads.brief} is not null)`,
      hasContactBlock: sql<boolean>`(${leads.contactBlock} is not null)`,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.companyId))
    .innerJoin(vendorProfiles, eq(leads.vendorId, vendorProfiles.vendorId))
    .orderBy(sql`${leads.score} desc nulls last`, sql`${leads.createdAt} desc`)
    .limit(PIPELINE_LEAD_LIMIT);

  return rows.map((r) => ({
    leadId: r.leadId,
    companyName: r.companyName,
    vendorName: r.vendorName,
    intent: r.intent,
    score: r.score,
    stage: r.stage as PipelineStage,
    hasBrief: Boolean(r.hasBrief),
    hasContactBlock: Boolean(r.hasContactBlock),
    createdAt: r.createdAt,
  }));
}

/**
 * Move one lead to a validated next stage. Rejects a malformed id, an unknown
 * lead, and any move canAdvance() disallows — the DB is left untouched on
 * rejection. Caller owns the connection.
 */
export async function setLeadStage(
  db: DB,
  leadId: string,
  to: PipelineStage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };

  const [current] = await db
    .select({ stage: leads.pipelineStage })
    .from(leads)
    .where(eq(leads.leadId, leadId))
    .limit(1);

  if (!current) return { ok: false, error: "Lead not found." };

  const from = current.stage as PipelineStage;
  if (!canAdvance(from, to)) {
    return { ok: false, error: `Cannot move a ${from} lead to ${to}.` };
  }

  await db.update(leads).set({ pipelineStage: to }).where(eq(leads.leadId, leadId));
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/pipeline-data.test.ts`
Expected: PASS (7 tests). If a test fails on a transient Neon TRUNCATE/latency error, re-run 2-3× before investigating — that flakiness is not structural.

Also confirm the type-only DB import is intact (a value import would break no-DB tests):
Run: `grep -n "import type { DB }" src/lib/pipeline/data.ts`
Expected: one match.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/data.ts tests/integration/pipeline-data.test.ts
git commit -m "feat(pipeline): data layer — board cards + validated stage writes

listPipelineLeads joins leads→companies→vendors and reduces brief/contactBlock to
booleans in SQL; setLeadStage UUID-guards, loads the current stage, enforces
canAdvance, and updates only pipeline_stage. Injected db: DB (type-only import).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Pipeline board UI (page + board + controls + action + styles)

**Files:**
- Create: `src/app/(app)/pipeline/actions.ts`
- Modify (replace the stub): `src/app/(app)/pipeline/page.tsx`
- Create: `src/app/(app)/pipeline/pipeline-board.tsx`
- Create: `src/app/(app)/pipeline/stage-controls.tsx`
- Modify (append): `src/app/styles/components.css`
- Test: `tests/unit/components/pipeline-stage-controls.test.tsx`
- Test: `tests/unit/components/pipeline-board.test.tsx`

**Interfaces:**
- Consumes: `listPipelineLeads` from `@/lib/pipeline/data`; `setLeadStage` from `@/lib/pipeline/data`; `PIPELINE_STAGES`, `BOARD_ORDER`, `STAGE_LABELS`, `nextStages`, `isTerminal`, `LeadCard`, `PipelineStage` from `@/lib/pipeline/schema`; `db` (singleton) from `@/db/client`; `auth` from `@/lib/auth`; `PageHeader`, `EmptyState` from `@/app/components/ui/*`.
- Produces:
  - `advanceLeadStageAction(leadId: string, to: PipelineStage): Promise<{ ok: boolean; error?: string }>`
  - `PipelineBoard({ leads }: { leads: LeadCard[] })` (server component)
  - `StageControls({ leadId, stage }: { leadId: string; stage: PipelineStage })` (client component)

Note on rendering mode: the `(app)/layout.tsx` calls `auth()` (reads cookies), which opts the whole segment out of static prerendering. So this DB-reading RSC does **not** need `export const dynamic` — the `catalogue` page follows the same pattern. Do not add a `dynamic` export.

- [ ] **Step 1: Write the failing component tests**

Create `tests/unit/components/pipeline-stage-controls.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/pipeline/actions", () => ({
  advanceLeadStageAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { StageControls } from "@/app/(app)/pipeline/stage-controls";
import { advanceLeadStageAction } from "@/app/(app)/pipeline/actions";

const ID = "10000000-0000-4000-8000-000000000001";

describe("StageControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an advance button and a Mark lost button for an active stage", () => {
    render(<StageControls leadId={ID} stage="sourced" />);
    expect(screen.getByRole("button", { name: /contacted/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark lost/i })).toBeInTheDocument();
  });

  it("renders only the single next button for won (no lost)", () => {
    render(<StageControls leadId={ID} stage="won" />);
    expect(screen.getByRole("button", { name: /delivered/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark lost/i })).not.toBeInTheDocument();
  });

  it("renders nothing for a terminal stage", () => {
    const { container } = render(<StageControls leadId={ID} stage="paid" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("clicking an advance button calls the action with (leadId, target)", async () => {
    render(<StageControls leadId={ID} stage="pitched" />);
    await userEvent.click(screen.getByRole("button", { name: /won/i }));
    expect(advanceLeadStageAction).toHaveBeenCalledWith(ID, "won");
  });

  it("clicking Mark lost calls the action with lost", async () => {
    render(<StageControls leadId={ID} stage="engaged" />);
    await userEvent.click(screen.getByRole("button", { name: /mark lost/i }));
    expect(advanceLeadStageAction).toHaveBeenCalledWith(ID, "lost");
  });
});
```

Create `tests/unit/components/pipeline-board.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// StageControls is a client component that imports the server action (which pulls
// in @/db/client). Stub it out — the board test only covers layout + grouping.
vi.mock("@/app/(app)/pipeline/stage-controls", () => ({
  StageControls: () => null,
}));

import { PipelineBoard } from "@/app/(app)/pipeline/pipeline-board";
import type { LeadCard } from "@/lib/pipeline/schema";

const base: Omit<LeadCard, "leadId" | "companyName" | "stage"> = {
  vendorName: "Acme Infra",
  intent: "Warehouse buildout",
  score: 7.5,
  hasBrief: false,
  hasContactBlock: false,
  createdAt: new Date("2026-06-01T00:00:00Z"),
};

const leads: LeadCard[] = [
  { ...base, leadId: "10000000-0000-4000-8000-000000000001", companyName: "Zephyr Retail", stage: "sourced" },
  { ...base, leadId: "10000000-0000-4000-8000-000000000002", companyName: "Meridian Logistics", stage: "won" },
];

describe("PipelineBoard", () => {
  it("renders a column per non-empty stage and omits empty stages", () => {
    render(<PipelineBoard leads={leads} />);
    expect(screen.getByText("Sourced")).toBeInTheDocument();
    expect(screen.getByText("Won")).toBeInTheDocument();
    expect(screen.queryByText("Engaged")).not.toBeInTheDocument();
  });

  it("renders company and vendor for each lead", () => {
    render(<PipelineBoard leads={leads} />);
    expect(screen.getByText("Zephyr Retail")).toBeInTheDocument();
    expect(screen.getByText("Meridian Logistics")).toBeInTheDocument();
    expect(screen.getAllByText(/Acme Infra/).length).toBeGreaterThan(0);
  });

  it("shows brief and contacts tags only when present", () => {
    const tagged: LeadCard[] = [
      {
        ...base,
        leadId: "10000000-0000-4000-8000-000000000003",
        companyName: "Vantage Foods",
        stage: "engaged",
        hasBrief: true,
        hasContactBlock: true,
      },
    ];
    render(<PipelineBoard leads={tagged} />);
    expect(screen.getByText("brief")).toBeInTheDocument();
    expect(screen.getByText("contacts")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/pipeline-stage-controls.test.tsx tests/unit/components/pipeline-board.test.tsx`
Expected: FAIL — cannot resolve `@/app/(app)/pipeline/stage-controls` and `@/app/(app)/pipeline/pipeline-board` (modules do not exist).

- [ ] **Step 3: Write the server action**

Create `src/app/(app)/pipeline/actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/pipeline/schema";
import { setLeadStage } from "@/lib/pipeline/data";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export async function advanceLeadStageAction(
  leadId: string,
  to: PipelineStage,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  // Never trust the client-supplied target — validate it is a real stage before
  // touching the DB. canAdvance() in the data layer is the second gate.
  if (!PIPELINE_STAGES.includes(to)) return { ok: false, error: "Unknown stage." };

  const r = await setLeadStage(db, leadId, to);
  if (r.ok) {
    revalidatePath("/pipeline");
    return { ok: true };
  }
  return { ok: false, error: r.error };
}
```

- [ ] **Step 4: Write the client stage controls**

Create `src/app/(app)/pipeline/stage-controls.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  nextStages,
  isTerminal,
  STAGE_LABELS,
  type PipelineStage,
} from "@/lib/pipeline/schema";
import { advanceLeadStageAction } from "./actions";

export function StageControls({
  leadId,
  stage,
}: {
  leadId: string;
  stage: PipelineStage;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  // Hooks run unconditionally above this early return (Rules of Hooks).
  if (isTerminal(stage)) return null;

  function move(to: PipelineStage) {
    setError(undefined);
    startTransition(async () => {
      const r = await advanceLeadStageAction(leadId, to);
      if (r.ok) router.refresh();
      else setError(r.error ?? "Action failed.");
    });
  }

  return (
    <div className="stage-controls">
      {nextStages(stage).map((to) => (
        <button
          key={to}
          type="button"
          className={to === "lost" ? "btn btn-sm" : "btn btn-sm btn-primary"}
          disabled={pending}
          onClick={() => move(to)}
        >
          {to === "lost" ? "Mark lost" : `Move to ${STAGE_LABELS[to]}`}
        </button>
      ))}
      {error && (
        <p role="alert" className="stage-error">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write the presentational board**

Create `src/app/(app)/pipeline/pipeline-board.tsx`:

```tsx
import {
  BOARD_ORDER,
  STAGE_LABELS,
  type LeadCard,
  type PipelineStage,
} from "@/lib/pipeline/schema";
import { StageControls } from "./stage-controls";

function formatScore(score: number | null): string {
  return score == null ? "—" : score.toFixed(1);
}

export function PipelineBoard({ leads }: { leads: LeadCard[] }) {
  const byStage = new Map<PipelineStage, LeadCard[]>();
  for (const stage of BOARD_ORDER) byStage.set(stage, []);
  for (const lead of leads) byStage.get(lead.stage)?.push(lead);

  const columns = BOARD_ORDER.map((stage) => ({
    stage,
    items: byStage.get(stage) ?? [],
  })).filter((c) => c.items.length > 0);

  return (
    <div className="pipeline-board">
      {columns.map(({ stage, items }) => (
        <section
          key={stage}
          className="pipeline-column"
          aria-label={`${STAGE_LABELS[stage]} (${items.length})`}
        >
          <h2 className="pipeline-column-head">
            <span className={`stage-badge stage-dot-${stage}`}>{STAGE_LABELS[stage]}</span>
            <span className="pipeline-count">{items.length}</span>
          </h2>
          <ul className="lead-list">
            {items.map((lead) => (
              <li key={lead.leadId} className="lead-card">
                <p className="lead-company">{lead.companyName}</p>
                <p className="lead-vendor">for {lead.vendorName}</p>
                {lead.intent && <p className="lead-intent">{lead.intent}</p>}
                <p className="lead-meta">
                  <span className="lead-score">score {formatScore(lead.score)}</span>
                  {lead.hasBrief && <span className="lead-tag">brief</span>}
                  {lead.hasContactBlock && <span className="lead-tag">contacts</span>}
                </p>
                <StageControls leadId={lead.leadId} stage={lead.stage} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Replace the page stub**

Replace the entire contents of `src/app/(app)/pipeline/page.tsx` with:

```tsx
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { db } from "@/db/client";
import { listPipelineLeads } from "@/lib/pipeline/data";
import { PipelineBoard } from "./pipeline-board";

export const metadata = { title: "Pipeline — Radar" };

export default async function PipelinePage() {
  const leads = await listPipelineLeads(db);

  return (
    <>
      <PageHeader eyebrow="Operate" title="Pipeline" />
      {leads.length === 0 ? (
        <EmptyState
          icon="pipeline"
          title="No pipeline activity yet"
          description="Leads from the sourcing engine appear here, tracked from sourced to paid. Run `npm run db:source:leads` to generate leads."
        />
      ) : (
        <PipelineBoard leads={leads} />
      )}
    </>
  );
}
```

- [ ] **Step 7: Append the board styles**

Append this block to the end of `src/app/styles/components.css` (all tokens below exist in `src/app/styles/tokens.css`; `--stage-<name>` accent colors are defined per theme):

```css
/* ---- Pipeline board (Phase 5, slice 1) ---------------------------------- */
.pipeline-board {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
@media (min-width: 768px) {
  .pipeline-board {
    flex-direction: row;
    align-items: flex-start;
    overflow-x: auto;
    gap: var(--space-4);
    padding-bottom: var(--space-3);
  }
}
.pipeline-column {
  flex: 0 0 auto;
  min-width: 0;
}
@media (min-width: 768px) {
  .pipeline-column {
    width: 17rem;
  }
}
.pipeline-column-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
}
.pipeline-count {
  color: var(--text-faint);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.lead-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.lead-card {
  border: var(--border-w) solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  padding: var(--space-3);
  box-shadow: var(--shadow-sm);
}
.lead-company {
  margin: 0;
  font-weight: var(--weight-semibold);
  color: var(--text);
}
.lead-vendor {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.lead-intent {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--text);
}
.lead-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  font-size: var(--text-xs);
}
.lead-score {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.lead-tag {
  padding: 0 var(--space-2);
  border: var(--border-w) solid var(--border);
  border-radius: var(--radius-full);
  color: var(--text-muted);
  background: var(--surface-2);
}
.stage-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-muted);
}
.stage-badge::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--stage-dot, var(--text-faint));
}
.stage-dot-sourced::before {
  background: var(--stage-sourced);
}
.stage-dot-contacted::before {
  background: var(--stage-contacted);
}
.stage-dot-engaged::before {
  background: var(--stage-engaged);
}
.stage-dot-pitched::before {
  background: var(--stage-pitched);
}
.stage-dot-won::before {
  background: var(--stage-won);
}
.stage-dot-lost::before {
  background: var(--stage-lost);
}
.stage-dot-delivered::before {
  background: var(--stage-delivered);
}
.stage-dot-paid::before {
  background: var(--stage-paid);
}
.stage-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.stage-error {
  flex-basis: 100%;
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--attention);
}
```

- [ ] **Step 8: Run component tests to verify they pass**

Run: `npx vitest run tests/unit/components/pipeline-stage-controls.test.tsx tests/unit/components/pipeline-board.test.tsx`
Expected: PASS (5 + 3 = 8 tests).

- [ ] **Step 9: Typecheck and build (server/client boundary)**

Run: `npm run typecheck`
Expected: exits 0 (no type errors).

Run: `npm run build`
Expected: build succeeds; `/pipeline` compiles with the server-action/client-component boundary intact. (If the build reports an env/DATABASE_URL issue unrelated to this diff, note it in the report — the typecheck + component tests are the primary correctness gates.)

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/pipeline/actions.ts" "src/app/(app)/pipeline/page.tsx" "src/app/(app)/pipeline/pipeline-board.tsx" "src/app/(app)/pipeline/stage-controls.tsx" src/app/styles/components.css tests/unit/components/pipeline-stage-controls.test.tsx tests/unit/components/pipeline-board.test.tsx
git commit -m "feat(pipeline): board UI + auth-gated stage-advance action

/pipeline groups leads into stage columns (BOARD_ORDER, empty columns omitted) with
company/vendor/intent/score + brief/contact tags; StageControls renders legal
next-stage buttons and calls advanceLeadStageAction, which auth-gates, validates the
target stage, and revalidates. Mobile-first columns; per-stage accent dots.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- Domain model (`schema.ts`, transition graph, `LeadCard`, `BOARD_ORDER`, labels) → Task 1.
- Data layer (`listPipelineLeads`, `setLeadStage`, injected DB, SQL booleans, ordering, UUID guard) → Task 2.
- Server action (auth gate, stage-membership validation, `revalidatePath`) → Task 3 Step 3.
- UI (page replacing stub, board grouping/empty-column omission, client controls, mobile-first CSS) → Task 3 Steps 4-7.
- Testing (unit graph, integration data, component board + controls) → Tasks 1-3 tests.
- Error handling (malformed/unknown id, illegal move, unauthenticated, `role="alert"`) → Task 2 tests + Task 3 controls.

**2. Placeholder scan** — no TBD/TODO; every code step contains complete code; no "add error handling" hand-waves.

**3. Type consistency** — `PipelineStage`, `LeadCard`, `PIPELINE_STAGES`, `BOARD_ORDER`, `STAGE_LABELS`, `canAdvance`, `nextStages`, `isTerminal` are defined in Task 1 and consumed with identical names/signatures in Tasks 2-3. `listPipelineLeads(db)` / `setLeadStage(db, leadId, to)` signatures defined in Task 2 match their calls in Task 3's action and page. `advanceLeadStageAction(leadId, to)` signature defined in Task 3 Step 3 matches the mock + call in the component tests. Data-layer return `{ ok: true } | { ok: false; error }` is narrowed with `if (!res.ok)` in both tests and the action.

**4. Cross-cutting checks** — `import type { DB }` (type-only) preserved in Task 2. Both transition gates present (action membership + data-layer `canAdvance`). No migration. Semantic HTML + `role="alert"` + keyboard-native `<button>`s. Commits list explicit paths only.
