# Slice 5 — End-to-End Wiring Proof Design

**Date:** 2026-06-29
**Status:** Approved (operator, 2026-06-29).
**Scope:** Phase 1 Slice 5 only (one thin real path: UI → backend → DB → UI). Completes Phase 1.
**Source of truth:** `Prompt_Playbook.md` Part 3 → Slice 5; `Phase0_Platform_Specification.md` §4 (vendor profile data model).

---

## Context

Slices 1–4 are merged on `main`: the app runs, the data layer exists (Slice 2), the single operator can log in (Slice 3), and the navigable app shell with empty states is live (Slice 4). Nothing yet writes to or reads real data from the UI.

Slice 5 proves the architecture holds by pushing **one record through the entire stack** and back: create a minimal vendor stub from the Vendors screen, persist it to Neon, and list it back. Per the playbook this is the last Phase 1 slice — clearing its done gate means "the architecture is proven," and the result is **tagged as the Phase 1 baseline**.

**Non-negotiables carried from earlier slices:**
- Every `(app)` route (and `/api/v1/vendors`) stays behind the Slice 3 auth middleware.
- Reuse Slice 4 UI primitives (`PageHeader`, `EmptyState`) and Slice 2 schema (`vendorProfiles`) — do not re-derive.
- Tests run against **real Neon** (the project's integration-test philosophy), reusing the `testDb` helper.
- Parameterized DB access via Drizzle (no string-interpolated SQL); never leak internals to the client.

---

## Goal & Scope

**Goal:** Prove a record flows UI → backend → database → back, confirming the architecture.

**In scope — one thin real path for a vendor stub (`{ name }`, the only `NOT NULL` column):**
- A minimal "add vendor" form on the Vendors screen.
- A **server action** that validates and persists the stub (the write surface).
- A **`GET /api/v1/vendors`** REST route that returns the persisted list (the read surface).
- The Vendors page lists persisted vendors (or the existing empty state when none).
- An integration-level end-to-end test covering create-then-read through the stack.

**Out of scope (YAGNI / deferred to later phases):**
- The full vendor profile, the SIA intake interview, deep validation.
- Edit / delete vendors.
- Pagination **params/UI** (page size, cursors) — deferred. But `listVendors()` keeps a safety `LIMIT 100` and selects explicit columns, honoring the global "never SELECT \* without LIMIT" / max-100 rule; full pagination lands when vendor volume grows.
- Client-side data fetching / optimistic UI.
- Rate limiting on the route (it is auth-gated, not public — see Error Handling).

---

## Approaches Considered

The two pivotal decisions, with the operator's choices:

### Backend wiring — **chosen: both surfaces (server action write + REST read)**
- **A — Server action only (simpler):** create via action, list via server component reading the DB directly. Least code; matches the existing login mutation pattern.
- **B — REST `/api/v1/vendors` only:** POST + GET under `/api/v1`; page becomes a client fetcher. Honors the CLAUDE.md API conventions but adds client-state boilerplate.
- **C — Both (chosen):** server action for the UI write path **plus** a `GET /api/v1/vendors` read route. Exercises both surfaces. Heavier than a minimal proof, but establishes the REST read contract now. Reconciled cleanly by routing both consumers through one shared pure data module (see Architecture), so there is no duplicated query logic and no client-side fetch state machine.

### Test depth — **chosen: integration-level (no browser)**
- **A — Integration-level (chosen):** drive the real server action and the real GET route handler against real Neon (create-then-read), plus a jsdom component test for the form. Covers the full stack minus the literal browser; no new harness.
- **B — Playwright browser E2E:** truest UI-to-UI proof, but introduces a browser harness, deps, CI browser installs, and an auth fixture — too heavy for a thin proof.

---

## Architecture & Data Flow

A shared, pure, auth-free data module is the single source of truth; the action, the page, and the route are thin wrappers around it.

```
                 ┌─ createVendorStub({name}) ─┐  zod validate → db.insert(vendorProfiles)
write:  Form ───▶ createVendor (server action) ┤
        (UI)      "use server" + auth guard     │
                  + revalidatePath("/vendors")  └─▶ src/lib/vendors/data.ts ──▶ Neon
                                                 ┌─▶ listVendors() ─────────────▶ Neon
read:   Vendors page (server component) ─────────┤
        GET /api/v1/vendors (REST, auth guard) ──┘  → Response.json({ data })
```

- **Write:** the form submits to the `createVendor` server action → `auth()` guard → `vendorStubSchema` parse → `createVendorStub()` → `revalidatePath("/vendors")` so the new row appears immediately (and after reload).
- **Read (page):** the Vendors page is a server component that calls `listVendors()` directly (no self-HTTP). Reload re-runs it → the persisted record reappears.
- **Read (API):** `GET /api/v1/vendors` calls the same `listVendors()` and serializes `{ data }`. This is the explicit REST read contract for later slices and is covered by the E2E test.

---

## Components / Files

| File | Role |
|------|------|
| `src/lib/vendors/data.ts` | Pure data layer: `vendorStubSchema` (zod: `name` → trim, min 1, max 200), `createVendorStub({ name })`, `listVendors()` (selects explicit `{ vendorId, name }`, ordered for determinism, `LIMIT 100`). No auth, no framework. The tested create-then-read core. |
| `src/app/(app)/vendors/actions.ts` | `"use server"` `createVendor(prevState, formData)`: `auth()` guard → validate → `createVendorStub` → `revalidatePath("/vendors")`. Returns an error-message string on invalid input (mirrors `login/actions.ts`); never leaks internals. |
| `src/app/(app)/vendors/add-vendor-form.tsx` | Client component: `useActionState(createVendor, undefined)`, a single `name` input + submit (disabled while pending), validation error in `role="alert"`. Clears on success. |
| `src/app/(app)/vendors/page.tsx` | Server component: `listVendors()` → semantic `<ul>` of vendor names, or the existing `<EmptyState icon="vendors">` when the list is empty; renders the form above the list. Keeps `PageHeader`. |
| `src/app/api/v1/vendors/route.ts` | `GET`: `auth()` guard → `listVendors()` → `Response.json({ data })` (200). 401 / 500 return `{ error, code }` with the correct status. |

---

## Error Handling

- **Validation:** `vendorStubSchema` rejects empty/whitespace names. The action returns a human message (`"Vendor name is required."`); the form shows it in `role="alert"`. No DB write occurs on invalid input.
- **Auth:** middleware (`src/middleware.ts`) already protects `/vendors` and `/api/v1/vendors` (proven: unauthenticated → `307 /login`). Defense-in-depth: the GET route also calls `auth()` and returns **`401 { error: "Unauthorized", code: "UNAUTHORIZED" }`** if reached without a session (correct API status, no redirect for an API client); the server action's `auth()` guard returns its error string.
- **Server faults:** the GET route catches DB errors and returns `500 { error: "Internal error", code: "INTERNAL_ERROR" }` — never a stack trace or internal detail (CLAUDE.md API rules).
- **Consistent error shape:** all route errors use `{ error: string, code: string }`.

---

## Testing (integration-level, real Neon — no browser)

Reuse `tests/integration/helpers/db.ts` (`migrateTestDb` / `truncateAll(["vendor_profiles"])` / `closeTestDb`). Mock `@/lib/auth` `auth()` to return a session and `next/cache` `revalidatePath` where the action/route require them.

1. **E2E proof** — `tests/integration/vendors-e2e.test.ts`: call `createVendor(undefined, FormData{name})` → assert a row exists in `vendor_profiles` with that name → call the route `GET()` → assert `res.status === 200` and `(await res.json()).data` contains the vendor. Create-then-read through action + route + DB.
2. **Validation** — empty / whitespace-only name → `createVendor` returns the error string and **inserts nothing**.
3. **API auth** — with `auth()` mocked to `null`, `GET()` returns `401` and `{ error, code }`.
4. **Component** (jsdom, `tests/unit/components/add-vendor-form.test.tsx`) — the form renders a labeled `name` input and a submit button.

Pure-unit coverage of `vendorStubSchema` (trim/min/max) sits alongside the data module if not already exercised by the above.

---

## Acceptance Criteria → Coverage

| Slice 5 acceptance criterion (playbook) | Covered by |
|---|---|
| Creating the stub from the UI persists it to the database | `createVendor` action + form; E2E test step 1 |
| The persisted record appears back in the UI after reload | Vendors page server component reading `listVendors()` + `revalidatePath`; manual walkthrough |
| An end-to-end test covers create-then-read through the stack | `vendors-e2e.test.ts` (action → DB → GET route) |
| (Implicit) routes stay auth-protected | Middleware (proven) + route `auth()` 401 test |

---

## Done Gate & Phase 1 Baseline

- Full quality gate green: `typecheck`, `lint`, `test` (all integration + component), `build`.
- Manual walkthrough (logged in): type a name on `/vendors` → submit → it appears in the list → reload → still there; unauthenticated `/api/v1/vendors` → blocked.
- All work committed on `feature/slice-5-e2e-wiring`; surfaced for operator merge (do not merge unprompted).
- On merge: **tag the Phase 1 baseline** as an annotated tag **`phase-1-baseline`** on the merge commit. Phase 1 is then complete — the architecture is proven end to end.

---

## Approval

Design approved by operator on 2026-06-29 ("proceed basis suggestion"). Next: generate the task-by-task implementation plan via the writing-plans skill.
