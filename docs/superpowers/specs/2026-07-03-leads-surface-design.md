# Leads Surface (Phase 5, Slice 2) — Design Spec

**Date:** 2026-07-03
**Status:** Approved (autonomous build under the standing "build the whole platform" directive)
**Phase:** 5 (pipeline + outreach + commission)
**Depends on:** Slice 1 (pipeline board, shipped 156f2b2) — reuses `LeadCard`, `PipelineStage`, `STAGE_LABELS`, `listPipelineLeads`, and the `StageControls` client component.

## Goal

Give the operator a place to **read a single lead in full** — its reverse brief and contact block — and a real **`/leads` list** to reach it from. Today `/leads` is a permanent empty state (a dead nav item) and the pipeline board's lead cards are static; a generated brief and contact block are persisted but never rendered anywhere. This slice renders them.

## Scope

**In scope**
- A real `/leads` list page: every lead as a linked row (company, vendor, stage badge, score, brief/contacts indicators), reusing the existing `listPipelineLeads` read.
- A `/leads/[id]` detail page: summary facts + stage controls (reused) + a **reverse-brief renderer** + a **contact-block renderer**.
- A new read-only data function `getLeadDetail(db, leadId)` that returns one lead joined to its company and vendor, with the two JSONB columns validated and parsed into typed objects.
- A pure `src/lib/leads/schema.ts` module owning the `LeadDetail` view type, a `leadBriefSchema` (validating the persisted brief — none exists today), outreach-mode labels, and pure display helpers.

**Out of scope (later slices)**
- Outreach mode changes / drafting / sending — the detail page *displays* `outreachMode` read-only but offers no controls.
- Commission tracking.
- Editing a lead's brief/contacts, re-running enrichment, or any write beyond the already-shipped stage transition.
- Linking the **pipeline board** cards into the detail page — deliberately excluded to keep this slice purely additive (no edits to the shipped pipeline board or its test). The `/leads` list is the canonical entry point into a lead detail. A board→detail link is a trivial future follow-up.
- No database migration — every column read (`brief`, `contact_block`, `outreach_mode`, `score`, `pipeline_stage`, company/vendor names) already exists.

## Architecture

Mirrors the shipped pipeline slice's layering exactly.

- **Pure domain/view module** `src/lib/leads/schema.ts` — DB-free, client-safe (no `@/db`, no `server-only`). Owns:
  - `LeadDetail` type — the view model the detail page consumes. References `LeadBrief` (type-only, from `@/ai/brief/schema`) and `ContactBlock` (type-only, from `@/lib/sourcing/contacts-schema`).
  - `OutreachMode` type + `OUTREACH_LABELS: Record<OutreachMode, string>`.
  - `leadBriefSchema` (+ internal `briefProofSchema`) — a Zod schema mirroring the persisted `LeadBrief` shape, so the data layer can `safeParse` the untyped JSONB column into a typed object. Lives here (not in the shipped `@/ai/brief/schema`) so the AI module is untouched; its inferred type is structurally identical to `LeadBrief` and assignable to it.
  - Pure display helpers `formatScore(score: number | null): string` and `formatBriefDate(iso: string): string` (UTC-deterministic — no locale/timezone flake).
- **Server data module** `src/lib/leads/data.ts` — `import type { DB } from "@/db/client"` (type-only, load-bearing: a value import eagerly opens Postgres and breaks no-DB tests). Exposes `getLeadDetail(db, leadId)`. Validates `leadId` against the UUID regex before querying; inner-joins company + vendor; parses `brief` via `leadBriefSchema` and `contact_block` via the existing `contactBlockSchema`, degrading a malformed/unparseable payload to `null` rather than throwing.
- **RSC pages** inject the singleton `db` (Pattern B) into the injected-DB read (Pattern A), consistent with the pipeline page.
- **Presentational components** are server components (no `"use client"`) except the reused `StageControls`.

The `(app)` layout calls `auth()`, so the whole segment renders dynamically — `/leads` and `/leads/[id]` need no `export const dynamic`.

## Data flow

```
/leads  (RSC)            → listPipelineLeads(db) → LeadCard[] → <LeadsList> (rows link to /leads/[id])
/leads/[id]  (RSC)       → getLeadDetail(db, id) → LeadDetail | null
                            ├ null → notFound()
                            └ else → summary <dl> + <StageControls> + <BriefView> + <ContactBlockView>
StageControls (existing)  → advanceLeadStageAction → setLeadStage → router.refresh() re-runs the detail RSC
```

`StageControls` is reused unchanged. Its server action calls `revalidatePath("/pipeline")`; on the detail page the visible refresh comes from the component's own `router.refresh()`, which re-runs the current (dynamic) RSC. Because every `(app)` page is dynamic, there is no route-level cache to go stale — no change to the shipped action is needed.

## Components

- **`LeadsList`** (`src/app/(app)/leads/leads-list.tsx`, server) — props `{ leads: LeadCard[] }`. A semantic `<ul>`; each `<li>` is a `next/link` to `/leads/{leadId}` showing company, vendor, stage badge (reusing `.stage-badge`/`.stage-dot-*`), score, and `brief`/`contacts` tags.
- **`BriefView`** (`src/app/(app)/leads/[id]/brief-view.tsx`, server) — props `{ brief: LeadBrief }`. Sections for *Why them / What they need / Hook / Why this vendor*, a *Why now* list of proofs (claim + date·source + evidence), an *Objections* list (objection/response), and a "Brief generated <date>" footer.
- **`ContactBlockView`** (`src/app/(app)/leads/[id]/contact-block-view.tsx`, server) — props `{ block: ContactBlock }`. A status line plus a decision-maker list (name·role, why, warm/cold badge, and contact paths rendering `type → val (conf)` with `val ?? "—"`). Empty `decision_makers` → an inline note.
- **`/leads/[id]/page.tsx`** (RSC) — back-link, `PageHeader` titled with the company name, summary `<dl>` (vendor, intent, stage badge, score, outreach mode when set), reused `StageControls`, then `BriefView`/`ContactBlockView` or an inline "not generated yet" note per section.
- **`/leads/page.tsx`** (RSC, replaces the empty-only page) — `EmptyState` when there are no leads, else `<LeadsList>`.

## Error handling & validation

- `getLeadDetail` returns `null` for a malformed (non-UUID) id and for an unknown id; the page calls `notFound()`.
- Both JSONB columns are validated with Zod `safeParse`; a payload that fails validation degrades to `null` (the section renders its "not generated yet" note) instead of crashing the page. No stack traces or internal errors reach the client.
- No user-supplied string is interpolated into SQL — the id flows through Drizzle's parameterized `eq()`.

## Testing

- **Unit** (`tests/unit/leads/schema.test.ts`): `formatScore` (null/`—`, 8.5, 87→"87.0"); `formatBriefDate` (UTC-deterministic, invalid→raw); `OUTREACH_LABELS`; `leadBriefSchema` accepts a valid brief and rejects a malformed one (including `disqualifier_check_passed: false`).
- **Integration** (`tests/integration/leads-data.test.ts`, real Neon): full detail with parsed brief + contacts; null columns → null fields; company description + vendor type surfaced; malformed brief JSONB → `brief: null` with the rest intact; unknown UUID → null; non-UUID → null.
- **Component** (jsdom): `BriefView`, `ContactBlockView` (incl. empty decision-makers), and `LeadsList` (row text, tags, and `href` per row — with `next/link` mocked). The RSC pages themselves are covered by typecheck + `next build`, matching the repo convention (no async-RSC unit tests).

## Global constraints (from the project standards)

- Data-module split: pure `schema.ts` (no `@/db`, no `server-only`, no `@/ai` **value** imports) + server `data.ts`.
- Injected-DB data layer uses `import type { DB }` (type-only, load-bearing).
- Mobile-first (375 → 768 → 1280), semantic HTML, keyboard-native controls, focus states; every list is a real `<ul>`/`<li>`.
- Paginate/limit reads — `getLeadDetail` is `.limit(1)`; the list reuses the already-capped `listPipelineLeads`.
- No `console.log`, no TODOs, no silent empty catches; explicit error handling.
- Parameterized queries only; validate inputs; no stack traces to the client.
- Tests live in the mirroring test dir; every new pure function is unit-tested.
- Additive only — new `src/lib/leads/*` + new `src/app/(app)/leads/[id]/*` + new `leads-list.tsx` + a replaced `leads/page.tsx` + appended CSS. No edits to shipped pipeline/AI modules.
