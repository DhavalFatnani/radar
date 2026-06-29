# Phase 2 · Slice 2.1 — Vendor Profile Foundation — Design Spec

**Status:** Approved by operator 2026-06-30.
**Scope:** Phase 2, Slice 2.1 only. First slice of Phase 2 (vendor intake + catalogue).
**Source spec:** `Phase0_Platform_Specification.md` §4.4 (vendor profile), §7.1 (SIA intake); `Prompt_Playbook.md` Part 4 → Phase 2 hints.
**Builds on:** Slice 5 (`phase-1-baseline`) — the vendor *stub* (`{ name }`) and its proven data-module → server-action → server-component-page + client-form pattern.

## Phase 2 decomposition (context)

Phase 2 is split into slices, each its own design → plan → build → verify cycle:

| Slice | Scope | AI? |
|-------|-------|-----|
| **2.1 Profile foundation** (this spec) | Vendor stub → full versioned, operator-editable profile + detail page | No |
| 2.2 SIA engine | `src/ai/` orchestration: adaptive question generation + structured profile extraction | Yes |
| 2.3 SIA interview UI | Operator-co-piloted chat that drives 2.2 and writes via 2.1 | Yes |
| 2.4 Catalogue graph | Populate `catalogue_nodes`/`edges` from profiles; matchmaking queries | No |
| 2.5 First real interview | End-to-end with a real vendor — the "does it pull precise data?" gate | Yes |

The SIA "growth engine" (flagging candidate signals during interviews) is deferred to Phase 3, where the signal-approval gate lives.

## Goal

Let the operator turn a vendor stub into a rich, structured, **versioned** profile through an editable vendor **detail page**, persisting every field the `vendor_profiles` schema already defines (except the computed `signal_recipe`). This raises the ceiling on downstream lead quality (§7.1) and gives the later SIA interview (2.2/2.3) a place to write.

## Pivotal decisions (operator chose)

- **Start point → Profile foundation (2.1).** Lower-risk, deterministic, builds on the proven Slice 5 pattern, and gives the SIA interview a write target. Defers the AI-provider decision to 2.2.
- **Field scope → Pragmatic full coverage.** All operator-editable fields are present, but nested JSON is modeled pragmatically (lists + a small set of typed/free-text constraint fields + text areas) rather than with rich structured editors. Rejected *minimal subset* (too little to be useful) and *full structured editors* (high churn risk before the SIA interview informs the real shape).

## Architecture & data flow (mirrors Slice 5)

A pure, auth-free data module remains the single source of truth. A `"use server"` action wraps it. The detail page (server component) reads via the data module directly; the edit form is a client component using `useActionState`.

```
src/
├── lib/vendors/data.ts                         # + vendorProfileSchema, VendorProfile, getVendor, updateVendorProfile
└── app/(app)/vendors/
    ├── page.tsx                                # list <li> → links to /vendors/[vendorId]
    └── [vendorId]/
        ├── page.tsx                            # async server component: getVendor → view + edit; notFound() if missing
        ├── actions.ts                          # "use server" updateVendor(prevState, formData)
        └── edit-profile-form.tsx               # "use client" useActionState edit form (accessible)
```

**Read path:** detail page → `getVendor(vendorId)` → render. No self-HTTP, no REST `[id]` endpoint in this slice (YAGNI).
**Write path:** form → `updateVendor` (auth guard → zod validate → `updateVendorProfile` → revalidate the vendor's detail path and the `/vendors` list; exact `revalidatePath` form is a plan detail).

## Editable fields → column mapping

The operator-editable set (everything except `version`, `interview_history`, and the computed `signal_recipe`). Existing `vendor_profiles` columns are reused as-is — **no schema migration**.

| Field | Column (type) | 2.1 shape |
|-------|---------------|-----------|
| name | `name` (text, NOT NULL) | string, trimmed, 1–200 (as Slice 5) |
| capabilities | `capabilities` (text[]) | `string[]` — entered newline/comma-separated, trimmed, empties dropped |
| constraints | `constraints` (jsonb) | `{ minProjectSize?, maxProjectSize?, geographies?: string[], capacity?, currentLoad?, workingCapitalLimit?, leadTimes? }` — all free-text strings except `geographies` (string[]); omitted/empty keys dropped; object null if all empty |
| idealCustomer | `ideal_customer` (jsonb) | `{ text: string }` or null — forward-compatible with later structured data |
| knownGoodSignals | `known_good_signals` (text) | string or null |
| differentiators | `differentiators` (text) | string or null |
| credibility | `credibility` (jsonb) | `{ text: string }` or null — later: structured case studies |

All free-text fields trimmed; sensible max lengths (name 200; single-line fields ≤ 200; text areas ≤ 4000). Empty inputs normalize to null (or dropped array/object keys), never empty strings.

## Versioning & `interview_history`

Single living `vendor_profiles` row (matches the schema — no separate history table).

- On a save that **changes ≥1 editable field**: increment `version` by 1 and append one entry to the `interview_history` jsonb array.
- **History entry shape:** `{ at: <ISO timestamp, server-stamped>, actor: "operator", kind: "manual_edit", changed: string[], version: <new version> }` where `changed` lists the editable field names whose normalized value differs from the current row (per-field deep compare via normalized JSON).
- **No-op saves** (nothing changed) do not bump `version` and append nothing; the action returns success without a write.
- New stubs start at `version: 1` with `interview_history: null`; the first profile edit yields `version: 2` and a one-element history array.
- **Forward-compatible:** the SIA re-interview (2.2/2.3) appends entries with `kind: "sia_interview"`; nothing here blocks that.

## Validation, errors, auth

- zod validation in the action; on failure return the first issue's message (mirrors `createVendor`), no DB write.
- `auth()` guard returns `"You must be signed in."`; routes also stay behind Slice 3 middleware (307 → `/login`) — defense in depth.
- Drizzle parameterized queries only. No stack traces / internals leaked. Consistent `{ error, code }` shape is an API concern; this slice's writes are via the server action (string message), matching Slice 5.

## Testing (TDD, integration-level like Slice 5)

- `getVendor`: returns the full profile for an existing id; `null` for a missing id.
- `updateVendorProfile`: updates fields; bumps `version` 1→2; appends a history entry whose `changed` lists exactly the altered fields; a no-op save leaves `version` and history unchanged; arrays/jsonb round-trip correctly.
- `updateVendor` action: persists from `FormData` + revalidates; returns the validation message and writes nothing on bad input; rejects an unauthenticated caller and writes nothing (mocks `@/lib/auth`, `next/cache`).
- `edit-profile-form.tsx` (jsdom): renders labeled inputs for the fields + a submit button (mocks the action module).
- Detail `page.tsx` (async server component): not unit-tested directly — covered by the data + action tests, the production build, and the manual walkthrough (consistent with Slice 5's `page.tsx`).

## Out of scope (YAGNI / later slices)

SIA AI interview (2.2/2.3); catalogue population (2.4); `signal_recipe` (computed, Phase 3); `GET /api/v1/vendors/[id]` REST endpoint; delete-vendor; structured nested editors for constraints/ideal-customer/credibility; optimistic UI / client fetching; pagination of the vendor list.

## Acceptance criteria

1. From the vendor list, the operator can open a vendor detail page at `/vendors/[vendorId]`.
2. The detail page shows the current profile and an edit form covering all editable fields.
3. Saving valid edits persists every field to `vendor_profiles`, bumps `version`, and appends a `manual_edit` history entry listing the changed fields.
4. A no-op save does not bump `version`.
5. Invalid input returns a human-readable message and writes nothing; unauthenticated requests are rejected (middleware 307 + action guard).
6. After reload the edits persist (page reads `getVendor`).

## Done gate

All tests green (existing 51 + this slice's new tests), `npm run lint`/`typecheck`/`test`/`build` green, manual walkthrough confirmed (open vendor → edit → save → reload → version bumped + history grew), per-task commits on a `feature/` branch. Merge to `main` on operator approval. **No git tag** — annotated tags are reserved for phase baselines, and 2.1 is mid-Phase-2.
