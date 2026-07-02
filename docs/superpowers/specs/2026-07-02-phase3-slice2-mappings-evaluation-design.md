# Phase 3 · Slice 3.2 — Mappings + Evaluation (validation gate) — Design Spec

**Date:** 2026-07-02
**Phase:** 3 (Signal library + mappings). **Slice:** 3.2 (mappings + the approval gate + a static validation gate).
**AI?** No — deterministic CRUD + governance. (Live company-vs-mapping scoring is the Phase 4 sourcing engine.)

## 1. Goal

Make the mapping library live, the sibling of the 3.1 signal library. A **mapping** is
*"an approved rule that combines signals into a buying intent for a specific vendor or vendor
type. Defines which signals are required, which are supporting, the threshold to fire, timing,
strength, and disqualifiers"* (Phase0 spec line 50). Today `/mappings` is a 14-line empty-state
placeholder with no data/UI layer, even though the `mappings` table and the `lifecycle_status`
approval gate already exist (migration 0002). This slice:

1. Loads the **2 canonical seed mappings** (Phase0 spec §6 — Warehouse expansion, Offline
   marketing push) as `status: 'approved'`.
2. Gives the operator a `/mappings` UI to **browse** the library (filter by status),
   **propose** a new mapping (enters as `proposed`), and **approve / retire** mappings.
3. Adds the "**Evaluation**" of this slice as *static well-formedness*, not live scoring: a
   mapping is a rule built **on** signals, so the slice validates that a mapping's signal
   references are real and approved, surfaces a **readiness panel** on the detail view, and
   **blocks approving** a mapping whose required signals are not all approved.

The deliverable is the operator-governed mapping library with a validation gate that gives the
governance model teeth: you cannot make a rule "live" (`approved`) when the signals it depends on
are not themselves live. This extends Phase0's trust model (line 19: *"Every signal and every
mapping enters as `proposed` and only goes live when the operator approves it"*).

## 2. Scope decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Seed via an idempotent `tsx` script** `src/db/seed-mappings.ts` (`npm run db:seed:mappings`). The 2 canonical mappings use **fixed literal UUID PKs** (`mapping_id`) so `onConflictDoNothing` on the PK is idempotent. Run **after** `db:seed:signals`. | `mapping_id` is `uuid defaultRandom`, so a stable literal PK is the only re-runnable conflict target (no unique key on `name`); mirrors 3.1's `db:seed:signals`; keeps canonical data out of migration history. |
| D2 | **`schema.ts` / `data.ts` split** under `src/lib/mappings/`. `schema.ts` is pure (Zod + types, client-safe, NO `@/db`). It **reuses the lifecycle primitives** — `LifecycleStatus`, `LIFECYCLE_STATUSES`, `canTransition` — by importing them from the pure `@/lib/signals/schema`. | Codebase rule (schema/data split); the governance gate is **identical** to signals, so reuse over duplication — and importing a pure module needs **no change to shipped 3.1 code** and keeps the client bundle clean. |
| D3 | **`mapping_id` is DB-generated** (`uuid defaultRandom`) — the operator does **not** supply it (contrast signals' operator-supplied `SIG-` id). Detail route is `/mappings/[mappingId]`. | The table already defaults it; a uuid has no operator-meaningful value to type. |
| D4 | **Create form = required core + optional rest.** Required: `name`, **≥ 1 required signal**. Optional: `intentDescription`, `servesVendorType` (free text), `supportingSignals`, `thresholdRule`, `timingWindowDays`, `strengthLogic`, `disqualifiers`. Signal references (required + supporting) are **multi-select checklists of currently-`approved` signals** (loaded server-side, passed to the form); `disqualifiers` are free text. | A mapping with no required signal can never fire (Phase0 threshold = "at least one required signal"). Picking from approved signals makes references well-formed **by construction** and prevents typos, which is the point of the validation gate. |
| D5 | **Approval gate + validation gate.** Transitions are the same total set as signals (`proposed→approved`, `proposed→retired`, `approved→retired`, `retired→approved`), via the shared `canTransition`. **Additionally, any transition _to_ `approved` requires every `requiredSignals` entry to currently be an `approved` signal**; otherwise a friendly no-op error naming the offending signals. Supporting signals are **not** gated (they only multiply score). | The governance gate is the slice's core; requiring approved required-signals is the "Evaluation" with teeth — a live rule cannot depend on non-live signals. |
| D6 | **Detail view shows a signal-readiness panel:** for each referenced signal (required + supporting), its current status (`approved` / `proposed` / `retired`) or **`missing`** if the ID no longer resolves. | The operator must see exactly why a mapping can or cannot be approved; makes the D5 gate legible. |
| D7 | **List filters by status only**, default shows all, grouped by status (`proposed` first — they need attention). No family/vendor enum filter (`servesVendorType` is free text). | Mirrors `/signals`; the operator's core loop is "what's waiting for me to approve?" |
| D8 | **Create action validates signal-reference existence at the data layer** (defense in depth), even though the form only offers approved signals: unknown IDs → friendly error naming them. | The form can be bypassed and a picked signal can be retired between page-load and submit; the action must not trust the client. |

## 3. Out of scope (deferred — do NOT build here)

- **Live scoring / matching companies against mappings.** `threshold_rule` and `strength_logic`
  stay **free text**; no numeric model, no company evaluation. → Phase 4 sourcing engine.
- **`leads.matched_mapping_id`** wiring (FK added by migration 0004) → Phase 4.
- **`track_record`** (computed, empty until real outcomes) → Phase 5+. Left null.
- **`signal_definitions.pairs_with`** — **left untouched.** It is an informal co-occurrence hint;
  mappings formalize the same concept, but 3.2 does not read from, derive from, or write to it.
- **Editing an existing mapping's fields.** 3.2 provides create + status transitions only (mirrors
  the 3.1 signals slice, which had no edit form). A full edit form is deferred.
- **SIA growth-engine** proposing mappings from interviews → a later Phase 3 slice.
- No new **migration** (the `mappings` table and `lifecycle_status` enum already exist).

## 4. Data model (already in the DB — this slice only reads/writes it)

`mappings` (`src/db/schema/mappings.ts`): PK `mapping_id uuid DEFAULT gen_random_uuid()`;
`name text NOT NULL`, `intent_description text`, `serves_vendor_type text`,
`required_signals text[]` (signal_id[]), `supporting_signals text[]` (signal_id[]),
`threshold_rule text`, `timing_window_days int`, `strength_logic text`, `disqualifiers text[]`,
**`status lifecycle_status NOT NULL DEFAULT 'proposed'`**, `origin text`, `track_record jsonb`
(computed, untouched here). There is **no** DB-level FK from `required_signals` /
`supporting_signals` to `signal_definitions` — referential integrity is an **application-layer**
concern (D5/D8). `lifecycle_status` enum: `proposed | approved | retired`
(`src/db/schema/enums.ts`).

## 5. Modules & interfaces

### `src/lib/mappings/schema.ts` (pure, client-safe)
- Re-export the lifecycle primitives for local ergonomics: `import { LIFECYCLE_STATUSES,
  canTransition } from "@/lib/signals/schema"; import type { LifecycleStatus } from
  "@/lib/signals/schema";`
- `type MappingDefinition` — the read shape (all display columns; `trackRecord` omitted).
- `type SignalRef = { signalId: string; name: string | null; status: LifecycleStatus | null }` —
  a resolved reference for the readiness panel (`status: null` ⇒ the ID no longer resolves).
- `createMappingSchema` (Zod): required `name` (1–200), `requiredSignals` (`string[]`, **min 1**,
  each matching `^SIG-[A-Z0-9-]{3,}$`); optional `intentDescription` (≤ 4000), `servesVendorType`
  (≤ 200), `supportingSignals` (`string[]`, same id regex), `thresholdRule` (≤ 2000),
  `timingWindowDays` (int 0–3650), `strengthLogic` (≤ 2000), `disqualifiers` (string→list, each ≤
  500). `type CreateMappingInput = z.infer<...>`. Reuse the `stringList` newline/comma→`string[]`
  transform idiom from signals for `disqualifiers`.

### `src/lib/mappings/data.ts` (server-only, DB)
- `listMappings(filter?: { status?: LifecycleStatus }): Promise<MappingDefinition[]>` — explicit
  columns, `.limit(500)`, ordered status(`proposed→approved→retired`) then `name` (in-process
  `STATUS_RANK` sort, mirroring `listSignals`).
- `getMapping(mappingId: string): Promise<MappingDefinition | null>` — `.limit(1)` by PK.
- `resolveSignalRefs(ids: string[]): Promise<SignalRef[]>` — one entry per input id (dedup + order
  preserved); queries `signal_definitions` for `signalId, name, status`; missing ⇒ `{ status: null,
  name: null }`. Used by the approve gate (on `requiredSignals`) and the detail readiness panel (on
  required + supporting).
- `createMapping(input: CreateMappingInput): Promise<{ ok: true; mapping } | { ok: false; error }>`
  — **D8**: resolve `requiredSignals ∪ supportingSignals`; if any are `missing` (`status: null`),
  return `{ ok:false, error:"Unknown signal IDs: …" }` (no insert). Else insert with `status:
  'proposed'`, `origin: 'operator'`; return the row.
- `setMappingStatus(mappingId, to: LifecycleStatus): Promise<{ ok: true; mapping } | { ok: false;
  error }>` — read current `status` + `requiredSignals`; guard with `canTransition` (friendly error
  on a disallowed jump); **D5**: if `to === 'approved'`, `resolveSignalRefs(requiredSignals)` and if
  any is not `status === 'approved'`, return `{ ok:false, error:"Cannot approve: these required
  signals are not approved: …" }`; else update `status`.

### `src/app/(app)/mappings/actions.ts` (`"use server"`)
- `signedIn()` guard verbatim (catalogue/signals pattern) as the **first statement** of every
  action; unauthenticated → `{ ok:false, error:"Not signed in." }` (no DB touch, no throw).
- `createMappingAction(prevState, formData)` — `useActionState`-shaped `(prev, FormData) =>
  Promise<{ ok; error? }>`; parses `requiredSignals` / `supportingSignals` via
  `formData.getAll(...)`, validates with `createMappingSchema`, calls `createMapping`,
  `revalidatePath("/mappings")`.
- `approveMappingAction(mappingId)` → `setMappingStatus(id, "approved")` (also serves un-retire —
  identical call, `canTransition` permits `retired→approved`).
- `retireMappingAction(mappingId)` → `setMappingStatus(id, "retired")`.
- Each returns a serializable `{ ok, error? }` — never leak internals; `revalidatePath("/mappings")`
  (and the detail path) on success.

### UI
- `src/app/(app)/mappings/page.tsx` (server) — `listMappings()`; also `listSignals({ status:
  'approved' })` to feed the create form's checklists. If empty, keep `EmptyState`; else render the
  filter bar + grouped `<MappingList/>` + `<AddMappingForm approvedSignals={…}/>`. Each row links to
  detail.
- `src/app/(app)/mappings/mapping-list.tsx` (server) — grouped-by-status list, mirrors
  `signal-list.tsx`.
- `src/app/(app)/mappings/[mappingId]/page.tsx` (server) — `await params`; `getMapping()` →
  `notFound()` if null; renders the full mapping + status badge + `<StatusControls/>` +
  `<ReadinessPanel refs={await resolveSignalRefs([...required, ...supporting])} .../>`.
- `src/app/(app)/mappings/add-mapping-form.tsx` (`"use client"`) — the create form (D4 fields);
  `useActionState(createMappingAction, { ok:false })` + native `<form action={formAction}>`;
  required/supporting rendered as checkbox groups from the `approvedSignals` prop; reset-on-success
  via `formRef` + `useEffect`. Imports **types + the action only** — no `@/db`.
- `src/app/(app)/mappings/status-controls.tsx` (`"use client"`) — approve/retire/un-retire buttons
  (`useTransition` + `router.refresh()` on ok, error state on failure), mirrors signals.
- `src/app/(app)/mappings/readiness-panel.tsx` (server or presentational) — renders each `SignalRef`
  with a status badge (or `missing`); a summary line stating whether all required signals are
  approved.
- CSS reuses existing tokens in `command.css` (a `Slice 3.2 (mappings)` block).

## 6. Approval-gate + validation behaviour (the core assertion)

1. Seed mappings load as `approved` (the canonical validated library).
2. Any operator-created mapping is `proposed` — invisible to future sourcing until approved.
3. `approveMappingAction` moves `proposed→approved` (and `retired→approved`) **only if** every
   required signal is currently `approved`; otherwise a friendly no-op naming the blockers.
4. `retireMappingAction` moves `→retired` (always allowed from `proposed`/`approved`).
5. `createMapping` rejects references to signal IDs that do not exist (D8).
6. The detail readiness panel shows, per referenced signal, `approved` / `proposed` / `retired` /
   `missing` — so the gate's verdict is legible before the operator clicks Approve.
7. The list surfaces `proposed` first so the operator sees pending governance work.

## 7. Error handling & security

- All actions `signedIn()`-guarded; unauthenticated → `{ ok:false, error:"Not signed in." }`, no DB
  touch, no throw.
- Zod-validated inputs; parameterized Drizzle queries only; bounded reads (`.limit`).
- Unknown-signal, disallowed-transition, and not-approved-required-signal cases all return friendly
  `{ ok:false, error }` — no stack traces to the client.
- `add-mapping-form`, `status-controls`, `readiness-panel` client boundaries import **types +
  actions only** (no `@/db`, no `data.ts`) — client-bundle purity, verified by the build.
- Semantic HTML + keyboard-navigable controls + labelled inputs (project frontend standards).

## 8. Testing

- **Unit** (`tests/unit/lib/mappings-schema.test.ts`): `createMappingSchema` accepts a valid
  mapping; rejects empty `name`, **zero required signals**, a bad signal-id shape; `disqualifiers`
  string→list transform; re-exported `canTransition` truth table (representative allowed +
  disallowed).
- **Integration** (`tests/integration/mappings-data.test.ts`): seed a few signals, then —
  `createMapping` inserts as `proposed` with defaults; unknown-signal reference → `{ok:false}` (D8);
  `setMappingStatus` honors `canTransition` (reject a disallowed jump); **approve is blocked** when a
  required signal is `proposed`/`retired`, and **succeeds** once all required signals are `approved`
  (D5); `retire` always allowed; `resolveSignalRefs` returns correct statuses incl. `missing`;
  `listMappings` filters by status and orders proposed-first.
- **Integration** (`tests/integration/seed-mappings.test.ts`): running the seeder loads 2 rows all
  `approved` with the expected required/supporting signals; running it twice is idempotent (still 2,
  no throw). *(Replaces / extends the existing 19-line `mappings.test.ts` smoke test.)*
- **Component** (`tests/unit/components/add-mapping-form.test.tsx`,
  `status-controls`/`readiness-panel`): form renders approved-signal checklists and submits the
  right `FormData` (mock the action); status-controls fire the right action; readiness-panel renders
  a `missing`/`proposed`/`approved` mix. Mirror the signals component tests.
- Extends the existing suite (single `vitest.config.ts`, `fileParallelism:false`, real Neon); all
  green before merge.

## 9. Acceptance

- `npm run db:seed:mappings` (after `db:seed:signals`) loads 2 approved mappings; re-running is safe.
- `/mappings` lists them, filterable by status, grouped proposed-first, each linking to detail.
- Operator can create a mapping (picking approved signals) → appears as `proposed`.
- The detail readiness panel shows each referenced signal's status.
- Approving a mapping whose required signals are all approved → `approved`; approving one with a
  non-approved required signal is a friendly no-op naming the blocker; retire → `retired`.
- Full suite green; typecheck + lint clean; build shows no `@/db` in the `/mappings` client bundle.
