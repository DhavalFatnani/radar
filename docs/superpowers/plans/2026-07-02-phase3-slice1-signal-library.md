# Phase 3 Slice 3.1 — Signal Library + Approval Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the 17 canonical seed signals and ship a `/signals` UI to browse (filter by
status + family), propose (enters as `proposed`), and approve/retire signals — the
operator-governed approval gate.

**Architecture:** Deterministic, no AI. Mirrors the shipped catalogue slice: pure
`schema.ts` (client-safe) + server-only `data.ts`; `/signals` server components read the data
layer; `"use client"` form/buttons call auth-guarded server actions. All signal tables/enums
already exist (migrations 0000–0002); no new migration.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle + postgres-js (Neon), Zod,
Vitest (unit = jsdom/pure; integration = real Neon branch, serial).

**Spec:** `docs/superpowers/specs/2026-07-02-phase3-slice1-signal-library-design.md`

## Global Constraints

- **schema.ts is pure & client-safe:** NO `@/db` import in `src/lib/signals/schema.ts`. Types +
  Zod + `const` option arrays + `canTransition` only.
- **Client-bundle purity:** `"use client"` files import ONLY `import type` from `schema.ts` +
  server-action refs. NEVER `@/db/*` or `src/lib/signals/data.ts`. The build must show no DB in
  the `/signals` client bundle.
- **Auth guard verbatim:** every server action begins with the catalogue `signedIn()` pattern
  (`src/app/(app)/catalogue/actions.ts`); unauthenticated → return `{ ok:false, error:"Not signed in." }`
  (or `[]` for reads), no DB touch, no throw.
- **SQL safety:** parameterized Drizzle only; explicit columns; every list read `.limit(...)`; no `SELECT *`.
- **No error leakage:** duplicate id / invalid transition / any failure → serializable
  `{ ok:false, error }`; never a stack trace or internal message to the client.
- **`signalId` format:** `^SIG-[A-Z0-9-]{3,}$`, unique (PK).
- **Status transitions (total set):** `proposed→approved`, `proposed→retired`, `approved→retired`,
  `retired→approved`. Everything else is a rejected no-op.
- **Defaults on create:** `status:'proposed'`, `origin:'operator'`, `proposedBy:'operator'`,
  `dateAdded:` today (ISO date). On any status change: set `lastReviewed:` today.
- **Out of scope (do NOT build):** mappings, mapping evaluation, `signal_recipe`,
  `signal_observations` UI, SIA growth-engine parser, editing of `parameters`/`pairs_with`/
  `geography`/`proof_captured`/`confirmation_rule`/`recheck_cadence`/`track_record`.
- **Commit hygiene:** stage ONLY the explicit files each task lists — never `git add .`/`-A`.
  Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Test file location:** `tests/unit/**` (pure) and `tests/integration/**` (DB). Integration
  tests use the existing harness (`migrateTestDb`/`truncateAll`/`closeTestDb`) — mirror
  `tests/integration/catalogue-data.test.ts` and `tests/integration/signals.test.ts`.

## File Structure

- Create: `src/lib/signals/schema.ts`, `src/lib/signals/data.ts`
- Create: `src/db/seed-signals.ts`; Modify: `package.json` (add `db:seed:signals` script)
- Create: `src/app/(app)/signals/actions.ts`, `.../signals/[signalId]/page.tsx`,
  `.../signals/status-controls.tsx`, `.../signals/add-signal-form.tsx`
- Modify: `src/app/(app)/signals/page.tsx`; `src/app/styles/command.css` (signals classes)
- Test: `tests/unit/lib/signals-schema.test.ts`, `tests/integration/signals-data.test.ts`,
  `tests/integration/seed-signals.test.ts`, `tests/unit/components/signals-*.test.tsx`

---

### Task 1: `src/lib/signals/schema.ts` — pure types, Zod, transitions

**Files:** Create `src/lib/signals/schema.ts`; Test `tests/unit/lib/signals-schema.test.ts`.

**Produces (consumed by every later task):**
- Unions + option arrays: `LifecycleStatus`, `SignalFamily`, `DetectionMethod`, `SignalStrength`,
  `FalsePositiveRisk`, `SignalPolarity`, `EntityType`; `SIGNAL_FAMILIES`, `SIGNAL_STRENGTHS`,
  `FALSE_POSITIVE_RISKS`, `DETECTION_METHODS`, `SIGNAL_POLARITIES`, `ENTITY_TYPES`, `LIFECYCLE_STATUSES`.
- `type SignalDefinition` (read shape). `createSignalSchema` + `type CreateSignalInput`.
- `canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean`.

- [ ] **Step 1: Write the failing test** `tests/unit/lib/signals-schema.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createSignalSchema, canTransition } from "@/lib/signals/schema";

const valid = { signalId: "SIG-HIRING-OPS-SURGE", name: "Ops hiring surge", family: "hiring",
  strength: "high", falsePositiveRisk: "low" };

describe("createSignalSchema", () => {
  it("accepts a valid minimal signal", () => {
    expect(createSignalSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a bad signalId", () => {
    expect(createSignalSchema.safeParse({ ...valid, signalId: "hiring-surge" }).success).toBe(false);
  });
  it("rejects an empty name and a bad enum", () => {
    expect(createSignalSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(createSignalSchema.safeParse({ ...valid, family: "weather" }).success).toBe(false);
  });
  it("parses a newline/comma sources string into a clean list", () => {
    const r = createSignalSchema.parse({ ...valid, sources: "news, jobs\n crunchbase " });
    expect(r.sources).toEqual(["news", "jobs", "crunchbase"]);
  });
});

describe("canTransition", () => {
  it("allows the governance moves", () => {
    expect(canTransition("proposed", "approved")).toBe(true);
    expect(canTransition("proposed", "retired")).toBe(true);
    expect(canTransition("approved", "retired")).toBe(true);
    expect(canTransition("retired", "approved")).toBe(true);
  });
  it("rejects no-op and invalid moves", () => {
    expect(canTransition("approved", "proposed")).toBe(false);
    expect(canTransition("proposed", "proposed")).toBe(false);
    expect(canTransition("retired", "proposed")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run tests/unit/lib/signals-schema.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/signals/schema.ts`.** Mirror the enum-literal + `stringList`
  transform style of `src/lib/vendors/schema.ts`. NO `@/db` import.

```ts
import { z } from "zod";

// Enum unions — mirror src/db/schema/enums.ts exactly.
export const LIFECYCLE_STATUSES = ["proposed", "approved", "retired"] as const;
export const SIGNAL_FAMILIES = ["hiring", "procurement", "money", "expansion", "leadership", "digital"] as const;
export const DETECTION_METHODS = ["structured_query", "api_field", "keyword_match", "ai_classification", "combination"] as const;
export const SIGNAL_STRENGTHS = ["low", "medium", "high", "very_high"] as const;
export const FALSE_POSITIVE_RISKS = ["low", "medium", "high"] as const;
export const SIGNAL_POLARITIES = ["positive", "negative", "contextual"] as const;
export const ENTITY_TYPES = ["business", "individual", "both"] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];
export type SignalFamily = (typeof SIGNAL_FAMILIES)[number];
export type DetectionMethod = (typeof DETECTION_METHODS)[number];
export type SignalStrength = (typeof SIGNAL_STRENGTHS)[number];
export type FalsePositiveRisk = (typeof FALSE_POSITIVE_RISKS)[number];
export type SignalPolarity = (typeof SIGNAL_POLARITIES)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];

// Read shape returned by the data layer for display.
export type SignalDefinition = {
  signalId: string;
  name: string;
  family: SignalFamily;
  description: string | null;
  sources: string[] | null;
  detectionMethod: DetectionMethod | null;
  triggerRule: string | null;
  strength: SignalStrength | null;
  falsePositiveRisk: FalsePositiveRisk | null;
  freshnessWindowDays: number | null;
  polarity: SignalPolarity | null;
  entityType: EntityType | null;
  example: string | null;
  status: LifecycleStatus;
  origin: string | null;
  proposedBy: string | null;
  dateAdded: string | null;
  lastReviewed: string | null;
};

// newline/comma-separated string (or array) -> clean string[]
const stringList = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(/[\n,]/)))
  .transform((a) => a.map((s) => s.trim()).filter(Boolean));

export const createSignalSchema = z.object({
  signalId: z.string().trim().regex(/^SIG-[A-Z0-9-]{3,}$/, "ID must look like SIG-HIRING-OPS-SURGE."),
  name: z.string().trim().min(1, "Name is required.").max(200),
  family: z.enum(SIGNAL_FAMILIES),
  strength: z.enum(SIGNAL_STRENGTHS),
  falsePositiveRisk: z.enum(FALSE_POSITIVE_RISKS),
  description: z.string().trim().max(2000).optional().transform((v) => (v && v.length ? v : undefined)),
  sources: stringList.optional(),
  detectionMethod: z.enum(DETECTION_METHODS).optional(),
  triggerRule: z.string().trim().max(2000).optional().transform((v) => (v && v.length ? v : undefined)),
  polarity: z.enum(SIGNAL_POLARITIES).optional(),
  entityType: z.enum(ENTITY_TYPES).optional(),
  freshnessWindowDays: z.coerce.number().int().min(0).max(3650).optional(),
  example: z.string().trim().max(2000).optional().transform((v) => (v && v.length ? v : undefined)),
});
export type CreateSignalInput = z.infer<typeof createSignalSchema>;

// The governance gate — the only allowed status moves (design §D5).
const ALLOWED: Record<LifecycleStatus, LifecycleStatus[]> = {
  proposed: ["approved", "retired"],
  approved: ["retired"],
  retired: ["approved"],
};
export function canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}
```

- [ ] **Step 4: Run the test, verify pass** — `npx vitest run tests/unit/lib/signals-schema.test.ts`.
- [ ] **Step 5: Typecheck** — `npm run typecheck` (expect clean).
- [ ] **Step 6: Commit** — `git add src/lib/signals/schema.ts tests/unit/lib/signals-schema.test.ts` then commit.

---

### Task 2: `src/lib/signals/data.ts` — list/get/create/setStatus

**Files:** Create `src/lib/signals/data.ts`; Test `tests/integration/signals-data.test.ts`.

**Consumes:** Task 1 types (`SignalDefinition`, `CreateSignalInput`, `LifecycleStatus`,
`canTransition`), `db` from `@/db/client`, `signalDefinitions` from `@/db/schema`.

**Produces:**
- `listSignals(filter?: { status?: LifecycleStatus; family?: SignalFamily }): Promise<SignalDefinition[]>`
- `getSignal(signalId: string): Promise<SignalDefinition | null>`
- `createSignal(input: CreateSignalInput): Promise<{ ok: true; signal: SignalDefinition } | { ok: false; error: string }>`
- `setSignalStatus(signalId: string, to: LifecycleStatus): Promise<{ ok: true; signal: SignalDefinition } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing test** `tests/integration/signals-data.test.ts` — mirror the
  harness of `tests/integration/catalogue-data.test.ts` (imports `migrateTestDb`, `truncateAll`,
  `closeTestDb`, `testDb`; `afterEach(() => truncateAll(["signal_observations","signal_definitions"]))`).

```ts
// Cases:
// 1. createSignal inserts as 'proposed' with origin/proposedBy 'operator' + dateAdded set.
// 2. createSignal on a duplicate signalId -> { ok:false, error }.
// 3. setSignalStatus proposed->approved ok; approved->retired ok; retired->approved ok.
// 4. setSignalStatus approved->proposed -> { ok:false } (canTransition rejects).
// 5. listSignals({status:'proposed'}) and ({family:'hiring'}) filter correctly.
// 6. listSignals orders proposed before approved before retired.
```

  Use exact assertions (e.g. after create: `expect(r.ok && r.signal.status).toBe("proposed")`).

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run tests/integration/signals-data.test.ts`.

- [ ] **Step 3: Implement `src/lib/signals/data.ts`.** Pattern = `src/lib/catalogue/data.ts`
  (explicit `.select({...})` column maps, `.limit()`, `db` from `@/db/client`). Key points:
  - A shared `const COLUMNS = { signalId: signalDefinitions.signalId, ... }` select map returning
    exactly the `SignalDefinition` shape; reuse in `listSignals`/`getSignal`/returns.
  - `listSignals`: build `and(...)` from optional `eq(status)` / `eq(family)`; `.limit(500)`;
    order by a `CASE` on status (proposed=0, approved=1, retired=2) then `name`. Use
    `sql\`case ...\`` or fetch + sort in JS by a status-rank map (simpler, bounded ≤500 — acceptable).
  - `createSignal`: `today = new Date().toISOString().slice(0,10)`. Insert `{ ...input,
    status:"proposed", origin:"operator", proposedBy:"operator", dateAdded: today }` with
    `.onConflictDoNothing()`; if nothing returned → `{ ok:false, error:"A signal with that ID already exists." }`.
  - `setSignalStatus`: read current status; if `!canTransition(cur, to)` → `{ ok:false,
    error:\`Cannot move a ${cur} signal to ${to}.\` }`; else update `{ status: to, lastReviewed: today }` returning the row.
  - Every return maps DB row → `SignalDefinition` (cast enum columns via the typed select).

- [ ] **Step 4: Run the test, verify pass.**
- [ ] **Step 5: Typecheck** — `npm run typecheck`.
- [ ] **Step 6: Commit** `git add src/lib/signals/data.ts tests/integration/signals-data.test.ts`.

---

### Task 3: `src/db/seed-signals.ts` — idempotent 17-signal seeder + script

**Files:** Create `src/db/seed-signals.ts`; Modify `package.json`; Test `tests/integration/seed-signals.test.ts`.

**Consumes:** `signalDefinitions` from `@/db/schema`; a `DB` handle (like `src/db/seed.ts`).

**Produces:** `seedSignals(db: DB): Promise<{ inserted: number; total: number }>` — inserts all 17
seed signals from **Phase0_Platform_Specification.md §5** as `status:'approved'` with
`.onConflictDoNothing()`; returns how many were newly inserted and the total attempted (17).

- [ ] **Step 1: Read the source data.** Open `Phase0_Platform_Specification.md`, locate **§5 (the
  seed signal library)**, and transcribe ALL 17 signal definitions faithfully — `signalId`, `name`,
  `family`, and every field the spec provides (`description`, `sources`, `detectionMethod`,
  `triggerRule`, `strength`, `falsePositiveRisk`, `freshnessWindowDays`, `polarity`, `entityType`,
  `pairsWith`, `geography`, `example`). Do not invent or omit signals; use the spec's exact ids and
  values. Map any spec enum wording to the DB enum literals in `src/db/schema/enums.ts`. If the spec
  lists fewer than 17, seed exactly what §5 defines and set `total` to that count (update the test
  count to match) — but report the discrepancy in your task report.

- [ ] **Step 2: Write the failing test** `tests/integration/seed-signals.test.ts` (integration harness):

```ts
// 1. seedSignals(testDb) inserts N rows (N = count in §5, expected 17), all status 'approved'.
// 2. Running seedSignals twice is idempotent: second run inserts 0, total still N, no throw.
// 3. Spot-check one known signal id from §5 exists with family from §5.
```

- [ ] **Step 3: Run it, verify it fails.**

- [ ] **Step 4: Implement `src/db/seed-signals.ts`.** Structure mirrors `src/db/seed.ts`: export
  `seedSignals(db)`, a `const SEED_SIGNALS: NewSignal[] = [ ...17... ]` array (each with
  `status:"approved"`), `db.insert(signalDefinitions).values(SEED_SIGNALS).onConflictDoNothing().returning()`;
  `inserted = returned.length`, `total = SEED_SIGNALS.length`. Add the direct-run block
  (`if (process.argv[1]?.endsWith("seed-signals.ts")) { ... config .env.local; DIRECT_URL ?? DATABASE_URL; postgres({prepare:false,max:1}); }`)
  copied from `seed.ts`, logging `Seeded signals: <inserted>/<total>`.

- [ ] **Step 5: Add the npm script.** In `package.json` scripts add:
  `"db:seed:signals": "tsx src/db/seed-signals.ts"`.

- [ ] **Step 6: Run the test, verify pass; typecheck.**
- [ ] **Step 7: Commit** `git add src/db/seed-signals.ts package.json tests/integration/seed-signals.test.ts`.

---

### Task 4: `/signals` list page + filter bar + list styles

**Files:** Modify `src/app/(app)/signals/page.tsx`; Create `src/app/(app)/signals/signal-list.tsx`
(server or plain component is fine — no client state needed for filters if done via query params);
Modify `src/app/styles/command.css`; Test `tests/unit/components/signals-list.test.tsx`.

**Consumes:** `listSignals` (Task 2), `SignalDefinition`, option arrays (Task 1).

**Design:** Filters via URL search params (server-rendered, no client JS): `page.tsx` reads
`searchParams` `{ status?, family? }`, passes to `listSignals`. Render a filter bar of links
(status: All/Proposed/Approved/Retired; family: All + 6 families) that set the query params, and a
list grouped by status (proposed first) showing name, `signalId`, family, strength, and a status
badge; each row links to `/signals/${signalId}`. Keep the `EmptyState icon="signals"` when the
UNfiltered library is empty; when a filter yields nothing, show a short "No signals match" line.

- [ ] **Step 1: Write a failing component/render test** `tests/unit/components/signals-list.test.tsx`
  (jsdom pragma line 1). Render the list component with 2–3 fixture `SignalDefinition`s and assert:
  proposed signal renders before approved; the `signalId` and a status badge appear; a family label
  shows. (Pure render — pass fixtures directly to the list component, don't hit the DB.)

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement.** `page.tsx` becomes `async`, reads `searchParams`, calls `listSignals`,
  renders `<PageHeader eyebrow="Build" title="Signals" />`, the filter bar, `<AddSignalForm/>`
  (placeholder import is Task 6 — for THIS task, omit the form; Task 6 wires it in), and
  `<SignalList signals={...} activeStatus activeFamily />`. Mirror `src/app/(app)/vendors/page.tsx`
  for the list/empty-state shape and `Link` usage. Add list/badge/filter CSS classes to
  `command.css` (badge colors per status: proposed=amber, approved=green, retired=muted — reuse
  existing CSS custom props seen in `command.css`/`v2.css`).

- [ ] **Step 4: Run test, verify pass; typecheck; lint.**
- [ ] **Step 5: Commit** `git add src/app/(app)/signals/page.tsx src/app/(app)/signals/signal-list.tsx src/app/styles/command.css tests/unit/components/signals-list.test.tsx`.

---

### Task 5: server actions + detail page + status controls (the gate)

**Files:** Create `src/app/(app)/signals/actions.ts`, `src/app/(app)/signals/[signalId]/page.tsx`,
`src/app/(app)/signals/status-controls.tsx`; Modify `src/app/styles/command.css`; Test
`tests/unit/components/signals-status-controls.test.tsx`.

**Consumes:** `getSignal`, `setSignalStatus`, `createSignal` (Task 2); `createSignalSchema`,
`SignalDefinition`, `LifecycleStatus` (Task 1); `auth` from `@/lib/auth`.

**Produces (server actions, all auth-guarded, all `revalidatePath`):**
- `createSignalAction(input: CreateSignalInput): Promise<{ ok: true; signalId: string } | { ok: false; error: string }>`
- `approveSignalAction(signalId: string): Promise<{ ok: boolean; error?: string }>`
- `retireSignalAction(signalId: string): Promise<{ ok: boolean; error?: string }>`
- `unretireSignalAction(signalId: string): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Write a failing client-component test** `tests/unit/components/signals-status-controls.test.tsx`
  (jsdom). Render `<StatusControls signalId="SIG-X-Y" status="proposed" />` passing a **mocked**
  action set (props or `vi.mock` the actions module); assert: for `proposed` it shows Approve +
  Retire buttons; clicking Approve calls the approve action with the signalId; for `approved` it
  shows Retire only; for `retired` it shows Un-retire. (No DB, no real action.)

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement `actions.ts`.** Verbatim `signedIn()` from
  `src/app/(app)/catalogue/actions.ts`. Each action: `if (!(await signedIn())) return { ok:false,
  error:"Not signed in." }`. `createSignalAction`: `const p = createSignalSchema.safeParse(input);
  if (!p.success) return { ok:false, error: p.error.issues[0]?.message ?? "Invalid signal." }`;
  call `createSignal(p.data)`; on ok `revalidatePath("/signals")` and return `{ ok:true, signalId }`.
  Status actions: call `setSignalStatus(signalId, "approved"|"retired")`; `revalidatePath("/signals")`
  and `revalidatePath(\`/signals/${signalId}\`)`; return `{ ok, error }`.

- [ ] **Step 4: Implement `status-controls.tsx`** (`"use client"`, imports type `LifecycleStatus`
  + the three status actions only). Buttons chosen by current status (per Step 1). On click:
  call the action, then `router.refresh()` on ok, or show the returned `error` inline. Keyboard
  focusable, semantic `<button>`s.

- [ ] **Step 5: Implement `[signalId]/page.tsx`** (server): `getSignal(params.signalId)`; if null →
  a "Signal not found" message + link back to `/signals`; else render the full definition
  (name, id, family, description, sources, detection, strength, false-positive risk, freshness,
  polarity, entity type, example, origin/dates) + a status badge + `<StatusControls signalId status/>`.
  Add detail CSS to `command.css`.

- [ ] **Step 6: Run test, verify pass; typecheck; lint.**
- [ ] **Step 7: Commit** the five files listed above.

---

### Task 6: create form (propose path) + wire into list + FULL GATE

**Files:** Create `src/app/(app)/signals/add-signal-form.tsx`; Modify
`src/app/(app)/signals/page.tsx` (render the form) and `src/app/styles/command.css`; Test
`tests/unit/components/signals-add-form.test.tsx`.

**Consumes:** `createSignalAction` (Task 5); `createSignalSchema` + option arrays (Task 1).

- [ ] **Step 1: Write a failing test** `tests/unit/components/signals-add-form.test.tsx` (jsdom).
  Render `<AddSignalForm/>` with a **mocked** `createSignalAction`; assert the required fields
  render (signalId, name, family select with 6 options, strength select, false-positive select);
  submitting with valid values calls `createSignalAction` with the parsed shape; an error result
  renders inline. Mirror the interaction style of `tests/unit/components/catalogue-view.test.tsx`.

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement `add-signal-form.tsx`** (`"use client"`). A `<form>` with the D4 fields:
  required `signalId` (with a hint of the SIG- format), `name`, `family` select
  (`SIGNAL_FAMILIES`), `strength` select, `falsePositiveRisk` select; optional `description`
  (textarea), `sources` (text, comma/newline), `detectionMethod` select, `triggerRule`, `polarity`
  select, `entityType` select, `freshnessWindowDays` (number), `example`. On submit: build the
  input object, call `createSignalAction`; on `{ok:true}` reset the form + `router.refresh()`; on
  `{ok:false}` show `error`. Import ONLY types + option arrays from `schema.ts` and the action —
  no `@/db`. Semantic HTML, labels tied to inputs, keyboard-navigable.

- [ ] **Step 4: Wire into the list page** — in `page.tsx` render `<AddSignalForm/>` under the
  `PageHeader` (like `AddVendorForm` in `src/app/(app)/vendors/page.tsx`). Add form CSS.

- [ ] **Step 5: Run the new test, verify pass.**

- [ ] **Step 6: FULL INTEGRATION GATE (report all in the task report):**
  - `npm run typecheck` → ZERO errors.
  - `npm run lint` → clean.
  - `npm test` → all pass (report file/test counts).
  - `npm run build` → success; confirm `/signals` present and **no `@/db` in its client bundle**.

- [ ] **Step 7: Commit** `git add src/app/(app)/signals/add-signal-form.tsx src/app/(app)/signals/page.tsx src/app/styles/command.css tests/unit/components/signals-add-form.test.tsx`.

---

## Self-review (controller, pre-execution)

- **Spec coverage:** D1→Task 3; D2→Tasks 1–2; D3→Task 1 regex + Task 2 onConflict; D4→Task 6;
  D5→Task 1 `canTransition` + Task 2 guard + Task 5 controls; D6→Task 4 filters. §8 tests spread
  across Tasks 1/2/3 + component tests. ✓
- **Type consistency:** `SignalDefinition` fields match `src/db/schema/signals.ts` columns; enum
  unions match `enums.ts`; action return shapes consistent across Tasks 5/6. ✓
- **Ordering:** Task 4 imports `AddSignalForm` only in Task 6 — Task 4 explicitly omits it to stay
  independently green. ✓
- **No new migration; no out-of-scope tables touched.** ✓
