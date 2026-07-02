# Lead Pipeline Board — Design Spec

**Date:** 2026-07-03
**Phase:** 5 (pipeline + outreach + commission) — Slice 1 of 3: the pipeline board.
**Status:** Approved for implementation (autonomous build).

## Problem

The sourcing engine already produces `leads` (matching + scoring, Slice 2), enriches
them with a reverse brief (Slice 3) and a contact block (Slice 4). Each lead carries a
`pipeline_stage` Postgres enum column (`sourced → contacted → engaged → pitched → won →
lost → delivered → paid`, default `sourced`) — but **nothing moves a lead through those
stages**. There is no transition logic, no data function, no server action, and no UI.
The `/pipeline` route is an empty stub whose copy promises "Leads tracked from sourced to
paid."

This slice builds the operator-facing **pipeline board**: view every lead grouped by its
stage, and move a lead to a legal next stage. It is the foundation the later Phase-5
slices (outreach, commission) build on.

## Scope

**In scope**
- A pure stage-transition domain model (`src/lib/pipeline/schema.ts`): the legal stage
  graph, the read shape for a board card, display ordering + labels.
- A data layer (`src/lib/pipeline/data.ts`): read all leads as board cards (joined to
  company + vendor names); move one lead to a validated next stage.
- A thin auth-gated server action wiring the data layer to the UI.
- The board UI on `/pipeline`: columns per stage, lead cards, per-card stage controls.
- Unit tests (transition graph), integration tests (data layer), component tests (board +
  controls).

**Out of scope (later Phase-5 slices)**
- Commission tracking/calculation (the "with commission" half of the empty-state copy).
- The `/leads` list/detail view (surfacing a single lead's brief + contact block).
- Setting `outreach_mode` / any outreach action.
- Backward stage correction (moving a lead to an *earlier* stage). Forward-only + a `lost`
  escape hatch is the MVP; an undo/correct affordance can be a later enhancement.
- Any schema migration — the `pipeline_stage` column and enum already exist (migration
  `0000`/`0004`); this slice writes zero DDL.

## Architecture

Three thin layers plus tests, mirroring the established `signals`/`mappings` UI pattern and
the `sourcing` data-layer pattern:

```
/pipeline/page.tsx (RSC)  ──calls──▶  listPipelineLeads(db)  ─┐
                                                              ├─▶ src/lib/pipeline/data.ts
stage-controls.tsx (client) ─▶ advanceLeadStageAction ─▶ setLeadStage(db, id, to) ─┘
        │                          (actions.ts, "use server")
        └── renders buttons from nextStages(stage)  ◀── src/lib/pipeline/schema.ts (pure)
```

### Domain model — `src/lib/pipeline/schema.ts` (pure, DB-free, client-safe)

Mirrors the `canTransition` precedent in `src/lib/signals/schema.ts`. Zero imports from
`@/db` or `@/ai`. Exports:

- `PIPELINE_STAGES` — `as const` tuple mirroring `enums.ts` **exactly and in the same
  order**: `["sourced","contacted","engaged","pitched","won","lost","delivered","paid"]`.
- `type PipelineStage = (typeof PIPELINE_STAGES)[number]`.
- `STAGE_LABELS: Record<PipelineStage, string>` — human labels (title-case).
- `BOARD_ORDER` — display column order, `lost` moved to the end so the board reads as a
  funnel: `["sourced","contacted","engaged","pitched","won","delivered","paid","lost"]`.
  (Distinct from `PIPELINE_STAGES`, whose order is locked to the DB enum.)
- The legal advance graph (the only allowed moves):
  ```
  sourced   → contacted, lost
  contacted → engaged,   lost
  engaged   → pitched,   lost
  pitched   → won,       lost
  won       → delivered
  delivered → paid
  paid      → (terminal)
  lost      → (terminal)
  ```
  `lost` is reachable only from the four active pre-win stages — a won/delivered/paid deal
  is never "lost". Forward-only; no backward edges.
- `canAdvance(from, to): boolean` — graph membership test (`ALLOWED[from]?.includes(to) ?? false`).
- `nextStages(from): PipelineStage[]` — the legal targets (drives which buttons render).
- `isTerminal(stage): boolean` — `nextStages(stage).length === 0` (true for `paid`, `lost`).
- `type LeadCard` — the board read shape:
  ```ts
  {
    leadId: string;
    companyName: string;
    vendorName: string;
    intent: string | null;
    score: number | null;
    stage: PipelineStage;
    hasBrief: boolean;
    hasContactBlock: boolean;
    createdAt: Date;
  }
  ```

### Data layer — `src/lib/pipeline/data.ts` (injected `db: DB`, server-only orchestration)

Uses the **injected-DB pattern** — `import type { DB } from "@/db/client"` (the `type`
keyword is load-bearing) — mirroring `src/lib/sourcing/*`, because this operates on the
sourcing-domain `leads` table and it gives isolated integration tests. The RSC page and the
server action import the singleton `db` from `@/db/client` and pass it in.

- `listPipelineLeads(db: DB): Promise<LeadCard[]>`
  - `leads` INNER JOIN `companies` (name) INNER JOIN `vendorProfiles` (name).
  - `hasBrief` / `hasContactBlock` computed in SQL as `<col> IS NOT NULL` (never pull the
    jsonb payloads into the board — they can be multi-KB).
  - Bounded `.limit(PIPELINE_LEAD_LIMIT)` (= 1000), consistent with `listMappings`'
    `.limit(500)` convention for operator RSC lists (this is not a public API endpoint).
  - Ordered `score` desc (nulls last) then `createdAt` desc, so the highest-value lead
    leads each column after the UI groups by stage.
- `setLeadStage(db: DB, leadId: string, to: PipelineStage): Promise<{ ok: true } | { ok: false; error: string }>`
  - Reject a malformed `leadId` with the shared UUID regex (avoid a 500 on a bad id),
    mirroring `setMappingStatus`.
  - Load the lead's current `pipelineStage`; unknown id → `{ ok: false, error: "Lead not found." }`.
  - `if (!canAdvance(current, to))` → `{ ok: false, error: "Cannot move a <from> lead to <to>." }`.
  - Else `db.update(leads).set({ pipelineStage: to }).where(eq(leads.leadId, leadId))`; return `{ ok: true }`.

### Server action — `src/app/(app)/pipeline/actions.ts` (`"use server"`)

Mirrors `src/app/(app)/mappings/actions.ts`:

- `signedIn()` auth gate (via `@/lib/auth`), returning `{ ok: false, error: "Not signed in." }`.
- `advanceLeadStageAction(leadId: string, to: PipelineStage): Promise<{ ok: boolean; error?: string }>`
  - Auth-gate first.
  - **Validate `to` is a real stage** (`PIPELINE_STAGES.includes(to)`) before touching the
    DB — defense in depth; the client-supplied target is never trusted, and `canAdvance` in
    the data layer is the second gate.
  - `import { db } from "@/db/client"`; call `setLeadStage(db, leadId, to)`.
  - On success `revalidatePath("/pipeline")`. Return `{ ok, error? }`.

### UI

- `src/app/(app)/pipeline/page.tsx` (RSC, replaces the stub) — `listPipelineLeads(db)`; if
  empty, keep the `EmptyState` (copy trimmed to drop the not-yet-built "commission");
  otherwise render `<PipelineBoard leads={rows} />`. Keeps `<PageHeader eyebrow="Operate"
  title="Pipeline" />`.
- `src/app/(app)/pipeline/pipeline-board.tsx` (server component, presentational) — groups
  leads by stage in `BOARD_ORDER`, renders one `<section>` per stage with a heading + count
  and a `<ul>` of lead cards. Each card shows company, vendor, intent, score, brief/contact
  indicators, a stage badge, and `<StageControls leadId stage />`. Empty columns are
  omitted (mirrors `MappingList`).
- `src/app/(app)/pipeline/stage-controls.tsx` (`"use client"`) — mirrors
  `mappings/status-controls.tsx`: for a non-terminal stage renders one button per
  `nextStages(stage)` target (labelled e.g. "→ Contacted", "Mark lost"); terminal stages
  render nothing. `useRouter`/`useTransition`; calls `advanceLeadStageAction(leadId,
  target)`; `router.refresh()` on ok; error surfaced via `role="alert"`.
- Styles appended to `src/app/styles/components.css`: `.pipeline-board`, `.pipeline-column`,
  `.lead-card`, and `.stage-badge` + per-stage accent classes. **Mobile-first (375px):**
  columns stack vertically and become a horizontally-scrollable row at ≥768px. No drag-drop
  (poor on touch and unnecessary for the MVP).

## Data flow

1. Operator opens `/pipeline`. The RSC calls `listPipelineLeads(db)` → cards.
2. `PipelineBoard` groups cards into stage columns; each card renders legal next-stage
   buttons from `nextStages`.
3. Operator clicks "→ Engaged" on a `contacted` lead. `StageControls` calls
   `advanceLeadStageAction(leadId, "engaged")`.
4. The action auth-gates, validates `"engaged"` is a real stage, calls `setLeadStage`,
   which re-checks `canAdvance("contacted","engaged")` (true), updates the row,
   `revalidatePath("/pipeline")`.
5. `router.refresh()` re-renders the board; the lead now sits in the Engaged column.
6. An illegal move (e.g. a tampered client sending `contacted → paid`) is rejected by
   `canAdvance` with a clear error shown via `role="alert"`; the DB is untouched.

## Error handling

- Malformed `leadId` → `{ ok: false, error }`, no query (UUID guard), no 500.
- Unknown `leadId` → `{ ok: false, error: "Lead not found." }`.
- Illegal transition → `{ ok: false, error }`, DB untouched (validated in both the action
  and the data layer).
- Unauthenticated → `{ ok: false, error: "Not signed in." }`.
- All errors surface to the operator via `role="alert"`; no stack traces reach the client.

## Testing

- **Unit** (`tests/unit/pipeline/schema.test.ts`, pure): `PIPELINE_STAGES` mirrors the enum;
  `canAdvance` accepts every legal edge and rejects representative illegal ones (skip-ahead,
  backward, lost-from-won); `nextStages` returns the exact target set per stage;
  `isTerminal` true only for `paid`/`lost`; `BOARD_ORDER` is a permutation of `PIPELINE_STAGES`.
- **Integration** (`tests/integration/pipeline-data.test.ts`, real Neon via the shared
  harness): seed company+vendor+mapping+lead; `listPipelineLeads` returns the `LeadCard`
  shape with joined names and correct `hasBrief`/`hasContactBlock` booleans and ordering;
  `setLeadStage` performs a legal move, rejects an illegal move **without mutating** the row,
  rejects a malformed UUID, rejects an unknown id.
- **Component** (`tests/unit/components/pipeline-*.test.tsx`, jsdom + Testing Library,
  mocking the action + `next/navigation` like `mappings-status-controls.test.tsx`):
  `StageControls` renders the correct buttons per stage (active → next + lost; won →
  delivered; paid/lost → none) and calls the action with `(leadId, target)`;
  `PipelineBoard` groups leads into the right stage columns and renders company/vendor/intent
  + indicators.

## Constraints (carried into the plan's Global Constraints)

- `PIPELINE_STAGES` mirrors `src/db/schema/enums.ts` `pipelineStage` values **exactly, same order**.
- Data layer takes `db: DB` as first param via `import type { DB } from "@/db/client"`
  (type-only, load-bearing). Pure schema module imports neither `@/db` nor `@/ai` nor
  `server-only`.
- Transition validated in **both** the server action (`PIPELINE_STAGES` membership) and the
  data layer (`canAdvance`) — the client-supplied target is never trusted.
- Parameterized Drizzle only; UUID-guard `leadId` before querying.
- Server action is auth-gated (`signedIn()`), mirroring the mappings action.
- No schema migration; writes limited to the `leads.pipeline_stage` column; tender path,
  scoring, brief, contacts, and `generateLeads` untouched.
- Mobile-first 375px; semantic HTML (`section`/`ul`/`li`/`button`); buttons keyboard-navigable
  with focus states and accessible names; errors via `role="alert"`; no image without alt.
- No `console.log`/TODO/silent empty catch in committed code.
- Additive only: new files + replace the `pipeline/page.tsx` stub + append to `components.css`.
```
