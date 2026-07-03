# Outreach (Phase 5, Slice 3) — Design Spec

**Date:** 2026-07-03
**Status:** Approved (autonomous build under the standing "build the whole platform" directive)
**Phase:** 5 (pipeline + outreach + commission)
**Depends on:** Slice 2 (leads surface, shipped `b66f2dd`) — reuses the `/leads/[id]` detail page, `getLeadDetail` / `LeadDetail`, `OutreachMode` / `OUTREACH_LABELS`, and the stage-advance quartet as the template (pure `schema.ts` / injected-DB `data.ts` / `"use server"` auth-gated action / `"use client"` control).

## Goal

Give the operator, on the lead detail page, the ability to **act on a lead**: pick an outreach mode, generate an LLM-drafted outreach message from the lead's reverse brief, track its status, and — ultimately — send it for real. Today `outreachMode` is displayed read-only and nothing else about outreach is actionable; the brief and contacts are rendered but there is no path from "here is a qualified lead" to "I have reached out."

## Decomposition — two independently-shippable sub-slices

This feature is built and shipped in two slices. Each ships to `main` on its own, is independently testable, and leaves the app working.

- **Slice A — Draft + mode + status (internal, no external calls).** All of outreach *except* real sending: the data model, LLM draft generation, mode switching, status tracking, and the detail-page panel. The operator generates a draft, copies it to send manually elsewhere, and marks the lead as sent/handed-off. Fully autonomous — no provider account, no network egress, no credentials.
- **Slice B — Real send (external egress).** A provider-adapter seam plus one concrete email adapter, gated on a configured provider key. A send action resolves the recipient email from the contact block, sends via the adapter, and records the send. Tests use a mock adapter; no real message is ever sent during the build.

**This spec fully specifies Slice A** and outlines Slice B (its plan is written after Slice A ships). One Slice-B decision is deliberately deferred to build time — see *Deferred decisions*.

---

# Slice A — Draft + mode + status

## Scope

**In scope**
- An additive DB migration adding outreach state to `leads`: a draft, a status, and two timestamps.
- A new pure module `src/lib/outreach/schema.ts` owning the `OutreachStatus` type + labels, the `OutreachDraft` type + `outreachDraftSchema` (Zod), and status guards.
- A new server data module `src/lib/outreach/data.ts` with injected-`DB` writes: set mode, save draft, set status.
- A DB-free LLM generator `src/ai/outreach/` (`generateOutreach`) mirroring `src/ai/brief/`, producing `{ subject, body }` from the lead's brief + company/vendor context.
- Auth-gated server actions (`src/app/(app)/leads/actions.ts`): set outreach mode, generate draft, set status.
- An `OutreachPanel` client component on `/leads/[id]` — mode switcher, "Generate draft" (gated on a brief existing), draft display, status control.
- Extending `getLeadDetail` / `LeadDetail` to surface the new outreach columns (additive).

**Out of scope (Slice B or later)**
- Any real message sending, provider adapter, or recipient-email resolution (Slice B).
- Editing the generated draft in-app before sending (display + copy only; YAGNI for A).
- A per-lead outreach *history* / multiple messages — one current draft + one status per lead.
- A batch outreach-draft generator script — drafting is interactive per lead.
- Commission tracking (separate Phase 5 slice).

## Architecture

Mirrors the shipped pipeline/leads layering exactly.

- **Migration.** Add to `src/db/schema/enums.ts` a `pgEnum("outreach_status", ["pending","drafted","sent"])`; add to `src/db/schema/leads.ts` four columns: `outreachStatus` (notNull, default `"pending"`), `outreachDraft` (jsonb, nullable), `outreachDraftGeneratedAt` (timestamptz, nullable), `outreachSentAt` (timestamptz, nullable). Generate with `npm run db:generate` (writes a numbered SQL file + snapshot) and apply with `npm run db:migrate`. Purely additive — the one notNull column carries a default, so existing rows backfill to `"pending"`; no data loss, no column drops.
- **Pure module** `src/lib/outreach/schema.ts` — DB-free, client-safe (no `@/db`, no `server-only`, no `@/ai` value imports). Owns `OutreachStatus` (`"pending" | "drafted" | "sent"`), `OUTREACH_STATUS_LABELS`, `OutreachDraft` (`{ subject: string; body: string }`) + `outreachDraftSchema` (Zod, both fields non-empty), and status guards (`canMarkSent(status)`, `nextStatuses(status)`).
- **Server data module** `src/lib/outreach/data.ts` — `import type { DB } from "@/db/client"` (type-only, load-bearing). Three writes, each UUID-guarded, each returning a discriminated `{ ok: true } | { ok: false; error: string }`, each using parameterized Drizzle `eq()` only:
  - `setOutreachMode(db, leadId, mode: OutreachMode)`
  - `saveOutreachDraft(db, leadId, draft: OutreachDraft)` — sets `outreachDraft`, `outreachStatus = "drafted"`, `outreachDraftGeneratedAt = now`.
  - `setOutreachStatus(db, leadId, status: OutreachStatus)` — when moving to `"sent"`, also stamps `outreachSentAt = now`.
- **AI generator** `src/ai/outreach/` — `generate.ts` `generateOutreach(input: OutreachInput): Promise<LlmResult<OutreachDraft>>` calling `generateObject(outreachDraftSchema, buildOutreachMessages(input))` from `@/ai/llm`; `schema.ts` owning `OutreachInput` + its own `outreachDraftSchema` (Zod, `{subject, body}` non-empty); `prompts.ts` (`buildOutreachMessages`); `index.ts`. DB-free — imports only `zod` and `@/ai/llm`, never `@/lib` or `@/db`. This is a deliberate mirror of `src/ai/brief` (which defines `leadBriefDraftSchema` separately from the pure module's `leadBriefSchema`): the AI module keeps its own draft schema so the one-directional `src/lib → src/ai` (type-only) dependency is never inverted. The two `outreachDraftSchema`s (this one and the pure module's read-validator) are structurally identical `{subject, body}` shapes and their inferred types are mutually assignable to `OutreachDraft`. Inherits the existing multi-provider fallback and the "no provider configured → `AllProvidersFailedError`" behavior.
- **Server actions** `src/app/(app)/leads/actions.ts` (`"use server"`) — auth-gate via `auth()`, validate enum client-input, then orchestrate. The generate action is the one place that bridges AI and DB: it imports `@/ai/outreach` (value) **and** `@/lib/outreach/data` (value), loads the lead's brief context via a read, calls `generateOutreach`, then persists via `saveOutreachDraft` — keeping `@/ai` out of the data layer and the DB out of `@/ai`. Each action calls `revalidatePath("/leads/${leadId}")` on success and returns `{ ok, error? }`.
- **UI** `src/app/(app)/leads/[id]/outreach-panel.tsx` (`"use client"`) — mirrors `StageControls`: `useTransition` + `router.refresh()` after each action. Props are the current outreach state from `LeadDetail`. Slots as a `<section>` on the detail page between the summary `<dl>` and `BriefView`.

## Data flow

```
/leads/[id] (RSC) → getLeadDetail(db, id) → LeadDetail (now incl. outreachStatus, outreachDraft, …)
                     └ <OutreachPanel mode status draft leadId hasBrief …/>  (client)

OutreachPanel:
  set mode   → setOutreachModeAction(leadId, mode)            → setOutreachMode(db, …)      → revalidate
  generate   → generateOutreachDraftAction(leadId)            → read brief context
                                                               → generateOutreach(input)    (LLM)
                                                               → saveOutreachDraft(db, …)    → revalidate
  mark sent  → setOutreachStatusAction(leadId, "sent")        → setOutreachStatus(db, …)    → revalidate
```

The detail RSC is already dynamic (the `(app)` layout's `auth()` opts the segment out of static prerender), so `router.refresh()` re-runs it with fresh outreach state — no route cache to go stale, no `export const dynamic` needed.

## Components

- **`OutreachPanel`** (`src/app/(app)/leads/[id]/outreach-panel.tsx`, client) — props `{ leadId: string; mode: OutreachMode | null; status: OutreachStatus; draft: OutreachDraft | null; hasBrief: boolean }`. Semantic sections: a mode switcher (two buttons for the two modes, current highlighted), a status badge, a "Generate draft" button (disabled with an inline note when `hasBrief` is false — the draft is generated *from* the brief), the drafted `subject`/`body` when present (read-only, in a form that is easy to copy), and a "Mark as sent" control when `status !== "sent"`. All actions run through `useTransition`; disabled while pending. Keyboard-native `<button>`s with focus states.
- **`/leads/[id]/page.tsx`** (RSC) — insert `<OutreachPanel … />` as a section after the summary `<dl>`. The read-only Outreach `<dt>/<dd>` in the summary is removed in favor of the panel's live mode switcher (the panel becomes the single source of outreach UI).

## Error handling & validation

- Every data write UUID-guards `leadId` and returns `{ ok: false, error }` for a bad id or a failed update — no throw crosses into the page; no stack trace reaches the client.
- The generate action wraps `generateOutreach` in try/catch: a provider failure (missing/invalid key, all-providers-failed) returns `{ ok: false, error: "Draft generation failed. Check the LLM provider configuration." }` — a sanitized message, never the raw provider error.
- `outreachDraft` JSONB is parsed on read via `outreachDraftSchema.safeParse`; a malformed payload degrades to `draft: null` (panel shows "no draft yet") rather than crashing the page.
- The generate action is a no-op guarded error when the lead has no brief (`{ ok: false, error: "Generate the brief first." }`) — the button is also disabled client-side, but the action re-checks server-side.
- All Drizzle access is parameterized `eq()`; no user string is interpolated into SQL.

## Testing

- **Unit** (`tests/unit/outreach/schema.test.ts`): `outreachDraftSchema` accepts `{subject, body}` and rejects empty/missing fields; `OUTREACH_STATUS_LABELS` completeness; `canMarkSent` / `nextStatuses` transitions.
- **Unit** (`tests/unit/ai/outreach-generate.test.ts`): `generateOutreach` with the AI SDK mocked (following `tests/unit/ai/brief-generate.test.ts`) — returns a validated draft; surfaces provider failure.
- **Integration** (`tests/integration/outreach-data.test.ts`, real Neon): `setOutreachMode` persists; `saveOutreachDraft` sets draft + status `"drafted"` + `generatedAt`; `setOutreachStatus("sent")` stamps `sentAt`; bad UUID → `{ ok: false }`. Follows the `leads-data.test.ts` migrate/seed/truncate pattern.
- **Integration** (`tests/integration/leads-data.test.ts`, extend): `getLeadDetail` surfaces the new outreach columns; malformed `outreachDraft` JSONB → `draft: null` with the rest intact.
- **Component** (jsdom, `tests/unit/components/outreach-panel.test.tsx`): renders current mode/status/draft; "Generate draft" disabled when `hasBrief` is false; actions invoked with the right args (server actions mocked, following `pipeline-stage-controls.test.tsx`).
- RSC pages remain covered by typecheck + `next build` (repo convention — no async-RSC unit tests).

## Global constraints (from the project standards)

- Data-module split: pure `src/lib/outreach/schema.ts` (no `@/db`, no `server-only`, no `@/ai` value imports) + server `src/lib/outreach/data.ts`.
- Injected-DB data layer uses `import type { DB }` (type-only, load-bearing).
- `src/ai/outreach/` has **no** DB access — orchestration lives in the action layer, which injects nothing into `@/ai` and imports `@/ai` only in the action, never in `src/lib/*/data.ts`.
- Mobile-first (375 → 768 → 1280), semantic HTML, keyboard-native controls, focus states.
- No `console.log`, no TODOs, no silent empty catches; explicit error handling; no stack traces to the client.
- Parameterized queries only; validate inputs.
- Tests live in the mirroring test dir; every new pure function is unit-tested.
- Additive only — new `src/lib/outreach/*`, new `src/ai/outreach/*`, new `src/app/(app)/leads/[id]/outreach-panel.tsx`, new `src/app/(app)/leads/actions.ts`, appended CSS, plus additive edits to `src/db/schema/{enums,leads}.ts`, `src/lib/leads/{schema,data}.ts` (extend `LeadDetail` + `getLeadDetail`), and `src/app/(app)/leads/[id]/page.tsx` (insert the panel). No edits to shipped pipeline/AI-brief modules.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

# Slice B — Real send (outline)

Built and shipped after Slice A. Full spec written at that time; the shape:

- **Migration:** add `outreachProviderMessageId` (text, nullable) and `outreachSendError` (text, nullable) to `leads`.
- **Provider seam** `src/lib/outreach/provider/` — an `OutreachSender` interface (`send({ to, subject, body }): Promise<{ ok: true; messageId } | { ok: false; error }>`), one concrete adapter gated on an env key, and a `NullSender` used both in tests and when the provider is unconfigured (so the app degrades to "sending not configured" instead of crashing).
- **Recipient resolution** — a pure helper in `src/lib/outreach/schema.ts`: given a `ContactBlock`, return the first `decision_makers[].paths[]` entry with `type === "email"` and a non-null `val`, or `null`. Only the `operator_handles` path has an email today; `handed_to_vendor` has no vendor email in the data model (a later enrichment).
- **Send action** `sendOutreachAction(leadId)` — auth-gate; load lead; guard (a draft exists, a recipient email resolves, the provider is configured); call the adapter; on success `recordOutreachSend(db, leadId, { messageId, sentAt })` + status `"sent"`; on failure persist `outreachSendError` and return a sanitized `{ ok: false, error }`.
- **UI:** a "Send" button in `OutreachPanel`, shown only when a draft exists, a recipient resolves, and the provider is configured; sent state + last-error display.
- **Tests:** unit (recipient resolver; adapter against a mock/fake HTTP layer), integration (send flow with a mock `OutreachSender`), component (send button visibility/behavior). No real egress in any test.

## Deferred decisions

- **Slice-B email provider (Resend vs generic SMTP/nodemailer vs SendGrid).** The `OutreachSender` interface makes the choice swappable; the concrete adapter + its env var (e.g. `RESEND_API_KEY` or SMTP settings) and the one new dependency are confirmed with the operator at Slice-B build time, since it implies an account/credential on their side. Slice A does not depend on this.
