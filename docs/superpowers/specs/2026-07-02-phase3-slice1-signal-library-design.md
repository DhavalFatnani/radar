# Phase 3 · Slice 3.1 — Signal Library + Approval Gate — Design Spec

**Date:** 2026-07-02
**Phase:** 3 (Signal library + mappings). **Slice:** 3.1 (signals + the approval gate).
**AI?** No — deterministic CRUD + governance. (The SIA "growth engine" that proposes signals from interviews is a later slice.)

## 1. Goal

Make the signal library live. Today `/signals` is an empty-state placeholder and there is no
data/UI layer, even though the `signal_definitions` table, all enums, and the
`lifecycle_status` approval gate already exist in the schema (migrations 0000–0002). This slice:

1. Loads the **17 canonical seed signals** (Phase0 spec §5) as `status: 'approved'`.
2. Gives the operator a `/signals` UI to **browse** the library (filter by status + family),
   **propose** a new signal (enters as `proposed`), and **approve / retire** signals.

The deliverable is the operator-governed library: the mechanism by which a signal becomes
"live" (`approved`) is an explicit operator action, never automatic. This is the gate the whole
platform's trust model rests on (Phase0 spec line 19: *"The system is operator-governed, not
autonomous."*).

## 2. Scope decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Seed via an idempotent `tsx` script** `src/db/seed-signals.ts` (`npm run db:seed:signals`), `onConflictDoNothing` on `signalId`. | Matches existing `db:seed` pattern; re-runnable after resets; keeps the 17-row canonical data out of migration history. |
| D2 | **schema.ts / data.ts split** under `src/lib/signals/`. `schema.ts` is pure (Zod + types + enum unions, client-safe, NO `@/db`); `data.ts` holds DB functions. | Codebase rule (`src/lib/catalogue/*` is the canonical example); `schema.ts` is reachable from the client bundle. |
| D3 | **Operator supplies `signalId`**, Zod-validated `^SIG-[A-Z0-9-]{3,}$`, unique; duplicate → friendly error (no throw to client). | Matches the seed convention (`SIG-HIRING-OPS-SURGE`); avoids auto-gen/collision logic (YAGNI). Client may pre-suggest an ID, but the value is operator-owned. |
| D4 | **Create form = a required core + optional rest**; unspecified columns left null. | Full 25-field form is out of proportion for a solo operator; the primary bulk-add path is the future SIA growth engine. |
| D5 | **Approve/Retire are the only status transitions**, on the signal detail view. Allowed: `proposed→approved`, `proposed→retired`, `approved→retired`, `retired→approved` (un-retire). Disallowed transitions are no-ops that report the current state. | The governance gate is the whole point of the slice; the transition set is small and total. |
| D6 | **List filters by status and family**, default view shows all, grouped by status (proposed first — they need attention). | The operator's core loop is "what's waiting for me to approve?" |

## 3. Out of scope (deferred — do NOT build here)

- **Mappings** (table, UI, CRUD) and **mapping evaluation logic** → Slice 3.2 (roadmap: "3.1 signals → 3.2 mappings").
- **`vendor_profiles.signal_recipe`** computation → Phase 4 (sourcing engine populates it). Leave the column untouched.
- **`signal_observations`** UI / detection → Phase 4 (the engine creates observations against real companies).
- **SIA growth-engine parser** (turning `knownGoodSignals` free text into `proposed` signal rows) → a later Phase 3 slice. This slice's "propose" path is the manual create form only.
- **`track_record`** (computed, empty until real outcomes), `parameters`, `pairs_with`, `geography`, `proof_captured`, `confirmation_rule`, `recheck_cadence` editing — left null/default in 3.1.
- No new **migration** (all tables/enums already exist).

## 4. Data model (already in the DB — this slice only reads/writes it)

`signal_definitions` (`src/db/schema/signals.ts`): PK `signal_id text`; `name`, `family`
(enum), `description`, `sources text[]`, `detection_method` (enum), `trigger_rule`, `strength`
(enum), `false_positive_risk` (enum), `freshness_window_days int`, `polarity` (enum),
`entity_type` (enum), `pairs_with text[]`, `geography text[]`, **`status lifecycle_status NOT
NULL DEFAULT 'proposed'`**, `origin`, `proposed_by`, `date_added date`, `last_reviewed date`,
`example`, plus `parameters`/`confirmation_rule`/`recheck_cadence`/`proof_captured`/`track_record`
(untouched here). Enums in `src/db/schema/enums.ts`: `lifecycle_status`
(proposed|approved|retired), `signal_family` (hiring|procurement|money|expansion|leadership|
digital), `detection_method`, `signal_strength` (low|medium|high|very_high), `false_positive_risk`
(low|medium|high), `signal_polarity` (positive|negative|contextual), `entity_type`
(business|individual|both).

## 5. Modules & interfaces

### `src/lib/signals/schema.ts` (pure, client-safe)
- Enum string-literal unions mirroring the DB enums: `SignalFamily`, `DetectionMethod`,
  `SignalStrength`, `FalsePositiveRisk`, `SignalPolarity`, `EntityType`, `LifecycleStatus`, plus
  `const` arrays (`SIGNAL_FAMILIES`, etc.) for rendering select options.
- `type SignalDefinition` — the read shape (all display columns).
- `createSignalSchema` (Zod): required `signalId` (regex `^SIG-[A-Z0-9-]{3,}$`), `name`
  (1–200), `family` (enum), `strength` (enum), `falsePositiveRisk` (enum); optional `description`,
  `sources` (string→list), `detectionMethod`, `triggerRule`, `polarity`, `entityType`,
  `freshnessWindowDays` (int ≥ 0), `example`. `type CreateSignalInput = z.infer<...>`.
- `STATUS_TRANSITIONS`: pure helper `canTransition(from, to): boolean` encoding D5's total set.

### `src/lib/signals/data.ts` (server-only, DB)
- `listSignals(filter?: { status?; family? }): Promise<SignalDefinition[]>` — explicit columns,
  `.limit(500)`, ordered status(proposed→approved→retired) then name.
- `getSignal(signalId): Promise<SignalDefinition | null>`.
- `createSignal(input: CreateSignalInput): Promise<{ ok: true; signal } | { ok: false; error }>`
  — inserts with `status: 'proposed'`, `origin: 'operator'`, `proposedBy: 'operator'`,
  `dateAdded: today`; duplicate PK → `{ ok:false, error:"A signal with that ID already exists." }`.
- `setSignalStatus(signalId, to: LifecycleStatus): Promise<{ ok: boolean; ... }>` — reads current,
  guards with `canTransition`, updates `status` (+ `lastReviewed: today`).

### `src/app/(app)/signals/actions.ts` (`"use server"`)
- `signedIn()` guard (verbatim catalogue pattern). Actions: `createSignalAction(FormData|input)`,
  `approveSignalAction(signalId)`, `retireSignalAction(signalId)`, `unretireSignalAction(signalId)`.
  Each: guard → validate → data fn → `revalidatePath("/signals")` (and the detail path). Return a
  serializable `{ ok, error? }` — never leak internals.

### UI
- `src/app/(app)/signals/page.tsx` (server) — `listSignals()`; if empty, keep `EmptyState`;
  else render the filter bar + grouped list + `<AddSignalForm/>`. Each row links to detail.
- `src/app/(app)/signals/[signalId]/page.tsx` (server) — `getSignal()`; renders the full
  definition + status badge + Approve/Retire/Un-retire buttons (a small client component calling
  the actions).
- `src/app/(app)/signals/add-signal-form.tsx` (`"use client"`) — the create form (D4 fields),
  imports only types from `schema.ts` + the server action. No `@/db`.
- `src/app/(app)/signals/status-controls.tsx` (`"use client"`) — the approve/retire buttons.

## 6. Approval-gate behaviour (the core assertion)

1. Seed signals load as `approved` (the canonical validated library).
2. Any operator-created signal is `proposed` — invisible to future sourcing until approved.
3. `approveSignalAction` moves `proposed→approved`; `retireSignalAction` moves `→retired`
   (from proposed or approved); `unretireSignalAction` moves `retired→approved`.
4. The list surfaces `proposed` first so the operator sees pending governance work.

## 7. Error handling & security

- All actions `signedIn()`-guarded; unauthenticated → `{ ok:false, error:"Not signed in." }`,
  no DB touch, no throw.
- Zod-validated inputs; parameterized Drizzle queries only; bounded reads (`.limit`).
- Duplicate/invalid-transition returns a friendly `{ ok:false, error }` — no stack traces to client.
- `add-signal-form` and `status-controls` are client components importing **types + actions only**
  (no `@/db`, no `data.ts`) — client-bundle purity, verified by the build.

## 8. Testing

- **Unit** (`tests/unit/lib/signals-schema.test.ts`): `createSignalSchema` accepts a valid signal,
  rejects a bad `signalId` / empty name / bad enum; `sources` string→list transform; `canTransition`
  truth table (all allowed + representative disallowed).
- **Integration** (`tests/integration/signals-data.test.ts`): `createSignal` inserts as `proposed`
  with defaults; duplicate id → `{ok:false}`; `setSignalStatus` honors `canTransition`
  (approve, retire, reject a disallowed jump); `listSignals` filters by status + family and orders
  proposed-first.
- **Integration** (`tests/integration/seed-signals.test.ts`): running the seeder loads 17 rows all
  `approved`; running it twice is idempotent (still 17, no throw).
- Extends the existing suite; all green before merge.

## 9. Acceptance

- `npm run db:seed:signals` loads 17 approved signals; re-running is safe.
- `/signals` lists them, filterable by status + family.
- Operator can create a signal → appears as `proposed`; approve → `approved`; retire → `retired`.
- Full suite green; typecheck + lint clean; build shows no `@/db` in the `/signals` client bundle.
