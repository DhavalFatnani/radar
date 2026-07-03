# Outreach Slice B — Real Email Send (Resend) — Design Spec

**Date:** 2026-07-03
**Status:** Approved (autonomous build under the standing "build the whole platform" directive)
**Phase:** 5 (pipeline + outreach + commission)
**Depends on:** Outreach Slice A (draft + mode + status, shipped `a0abbed`) — reuses `OutreachPanel`, `getLeadDetail`, `setOutreachStatus`, the `outreach_*` columns, and the `generateOutreachDraftAction` orchestration pattern.

> **Directional fork resolved:** the send transport was the one genuine directional decision (it requires the operator to create an account and hold a credential). The operator chose **Resend**. Everything else in this slice follows the Slice A precedent, so it is designed and built autonomously without a separate human-approval pause (the standing directive overrides the brainstorming / writing-plans approval gates).

## Goal

Let the operator **send a drafted outreach email for real** from the lead detail page, through a provider adapter wrapping Resend. The send is operator-initiated (an explicit click with an inline confirm), gated on a configured API key, and marks the lead `sent` on success. Tests use a mocked sender — **no real email is ever sent to a real recipient during the build.**

## Scope

**In scope**
- A server-only **sender adapter** `src/lib/outreach/sender.ts` — `isSendConfigured()` + `sendEmail({to, subject, body})` wrapping the `resend` SDK, returning a sanitized `SendResult`.
- A pure **recipient helper** `primaryRecipientEmail(block)` in `src/lib/outreach/schema.ts` — extracts the first usable email from a contact block.
- A new auth-gated **server action** `sendOutreachAction(leadId)` in `src/app/(app)/leads/actions.ts` — orchestrates auth → load → guards → send → mark sent (mirrors `generateOutreachDraftAction`).
- **`OutreachPanel` "Send now"** control (inline two-step confirm showing the recipient) + `page.tsx` wiring that computes `sendConfigured` / `recipientEmail` server-side and passes them down. Append-only CSS.
- Optional env vars `RESEND_API_KEY` + `OUTREACH_FROM_EMAIL` (both `.optional()`), documented in `.env.example`. New dependency: `resend`.

**Out of scope (YAGNI / later)**
- HTML email bodies, templates, attachments, CC/BCC — plain-text `text` body only.
- Retry queues, delivery-status webhooks, open/click tracking, bounce handling.
- Sending for `handed_to_vendor` leads (the vendor sends; the operator only tracks — the manual "Mark as sent" from Slice A covers that).
- Multi-recipient / choosing among several decision-makers — send to the single primary email; refine later if needed.
- Editing the draft before sending (Slice A generates it; a re-generate is the edit path).
- No database migration — `outreach_status`, `outreach_sent_at`, and `contact_block` all already exist.

## Architecture

Mirrors Slice A's layering exactly.

- **Pure domain module** `src/lib/outreach/schema.ts` (client-safe, extended) — gains `primaryRecipientEmail(block: ContactBlock | null): string | null`. Imports `ContactBlock` **type-only** from `@/lib/sourcing/contacts-schema` (itself a DB-free Zod module), so the module stays client-safe. Scans `block.decision_makers[*].paths` and returns the first `path.val` where `path.type === "email" && path.val !== null`, else `null`.
- **Sender adapter** `src/lib/outreach/sender.ts` (server-only — reads secret env, does external HTTPS I/O; imported only by the server action, the RSC page, and tests, never by a client component). Imports the `resend` SDK (value) and `env` from `@/lib/env`. Exposes:
  - `type SendResult = { ok: true; id: string } | { ok: false; error: string }`
  - `isSendConfigured(): boolean` — `Boolean(env.RESEND_API_KEY && env.OUTREACH_FROM_EMAIL)`.
  - `sendEmail(input: { to: string; subject: string; body: string }): Promise<SendResult>` — if not configured, returns `{ ok: false, error: "Email sending is not configured." }`; else constructs `new Resend(env.RESEND_API_KEY)`, calls `resend.emails.send({ from: env.OUTREACH_FROM_EMAIL, to, subject, text: body })`, returns `{ ok: true, id }` on success. **Never throws** — any provider error or SDK-reported error is caught and returned as `{ ok: false, error: "Sending failed. Check the email provider configuration." }`. No raw provider message, key, or stack ever reaches the caller.
- **Server action** `sendOutreachAction` — the only place importing both `@/lib/outreach/sender` (value) and `@/lib/outreach/data` (value), analogous to how `generateOutreachDraftAction` bridges `@/ai/outreach` and the data layer. Keeps external I/O out of the data layer.
- **RSC page** `/leads/[id]/page.tsx` computes `isSendConfigured()` and `primaryRecipientEmail(lead.contactBlock)` server-side and passes them to `OutreachPanel`. The action independently re-validates both (never trusts the client props).
- **Client component** `OutreachPanel` gains two props and a Send control; it imports only the pure schema + the server action (never `@/db`, `@/lib/*/data`, or the sender).

## Data flow

```
/leads/[id] (RSC) → getLeadDetail(db,id) → LeadDetail
                    sendConfigured = isSendConfigured()
                    recipientEmail = primaryRecipientEmail(lead.contactBlock)
                    → <OutreachPanel ... sendConfigured recipientEmail />

OutreachPanel "Send now" (operator_handles + drafted only)
  click → inline confirm "Send to {recipientEmail}?"
  confirm → sendOutreachAction(leadId)
             ├ auth fail                → {ok:false,"Not signed in."}
             ├ !lead                    → {ok:false,"Lead not found."}
             ├ !lead.outreachDraft      → {ok:false,"Generate the draft first."}
             ├ status === "sent"        → {ok:false,"Already sent."}
             ├ mode === handed_to_vendor→ {ok:false,"This lead is handed to the vendor; sending is disabled."}
             ├ !isSendConfigured()      → {ok:false,"Email sending is not configured."}
             ├ !primaryRecipientEmail   → {ok:false,"No email address on file for this lead."}
             ├ sendEmail → {ok:false,e} → {ok:false,e}   (status NOT changed)
             └ sendEmail → {ok:true}    → setOutreachStatus(db,id,"sent")  (sets outreach_sent_at)
                                         → revalidatePath(`/leads/${id}`) → {ok:true}
  on {ok:true} → router.refresh() (status → sent)
  on {ok:false} → role="alert" error, no refresh
```

`setOutreachStatus(db, id, "sent")` already stamps `outreach_sent_at` (Slice A) and returns `{ok:false,"Lead not found."}` on a vanished row (the Slice A fast-follow).

## Components

- **`sender.ts`** — as above. The `mode` gate and all guards live in the action, not here; the adapter is a thin, dumb transport so it is trivially mockable and reusable.
- **`sendOutreachAction(leadId)`** — return `Promise<{ ok: boolean; error?: string }>`. Auth guard first (`signedIn()`), then the guard ladder above, in that order (cheap/authanswer checks before external I/O). `mode` derived as `lead.outreachMode ?? "operator_handles"` (null = default operator-handles, consistent with `generateOutreachDraftAction`). Sends, then persists, then `revalidatePath`.
- **`OutreachPanel`** — two new props: `sendConfigured: boolean`, `recipientEmail: string | null`. New Send control, rendered **only** when `status === "drafted"` and the effective mode is operator-handles (`mode === "operator_handles" || mode === null`):
  - Idle: a `<button>Send now</button>`, `disabled={pending || !sendConfigured || !recipientEmail}`. When disabled for a config/recipient reason, a sibling hint (`<p class="outreach-hint">`) explains why ("Email sending isn't configured." / "No email address on file for this lead."). When enabled, a line shows the target: `To: {recipientEmail}`.
  - Confirm: clicking Send swaps to an inline confirm — `Send to {recipientEmail}?` with **Confirm** (calls `sendOutreachAction` via the existing `run()` helper) and **Cancel** (returns to idle). No native `confirm()` dialog (blocking / discouraged). This satisfies the "irreversible outward-facing control needs a confirm" guidance while keeping the operator's explicit click as the authorization.
  - The Slice A manual "Mark as sent" button stays unchanged (the non-app-send tracking path).
- **`/leads/[id]/page.tsx`** — add `import { isSendConfigured } from "@/lib/outreach/sender";` and `import { primaryRecipientEmail } from "@/lib/outreach/schema";`; compute both above the render and pass them to `OutreachPanel`. Surgical: only the two computed consts + two new props on the existing element.

## Error handling & validation

- The action **re-validates** configuration and recipient server-side; the client props are display hints only. No user string is interpolated into SQL (Drizzle `eq()`), and `leadId` flows through the existing UUID-guarded data layer.
- The adapter never throws and never leaks provider internals — a single sanitized string per failure class, matching the Slice A LLM-error precedent.
- Idempotency: a lead already `sent` is rejected (`"Already sent."`) so a double-click cannot double-send.
- No stack traces / internal errors to the client; no `console.log`, no TODOs, no silent empty catches.

## Testing

All external calls mocked — **no real Resend request runs in any test.**

- **Unit — recipient helper** (`tests/unit/outreach/schema.test.ts`, extend): first email path returned; a `val: null` email path skipped in favour of the next; non-email `type`s ignored; no email path → `null`; empty `decision_makers` → `null`; `block === null` → `null`.
- **Unit — sender** (`tests/unit/outreach/sender.test.ts`, new): `vi.mock("resend", …)` with a mock `emails.send`; a **mutable** `vi.mock("@/lib/env", …)` object toggled per test. Cases: not configured → `{ok:false,"Email sending is not configured."}` and `send` never called; configured + success → `{ok:true,id}` and `send` called once with `{from, to, subject, text}`; provider throws → sanitized `{ok:false}` (no raw message); SDK returns an `error` field → sanitized `{ok:false}`.
- **Integration — action** (`tests/integration/outreach-send-action.test.ts`, new, real Neon): `vi.mock` for `@/lib/auth`, `next/cache`, and `@/lib/outreach/sender` (both `sendEmail` and `isSendConfigured`). Seed a lead with a drafted outreach + a contact block containing an email path + `outreachMode: "operator_handles"`. Cases: unauth → `{ok:false}` + `sendEmail` not called + `revalidatePath` not called + status unchanged; unknown valid UUID → "Lead not found."; no draft → "Generate the draft first."; already `sent` → "Already sent." + `sendEmail` not called; `handed_to_vendor` → disabled error + not sent; no email on file → "No email address on file for this lead."; `isSendConfigured` false → "Email sending is not configured." + `sendEmail` not called; `sendEmail`→`{ok:false}` → same error surfaced + status **not** `sent`; success → `sendEmail` called with `{to, subject, body}`, status becomes `sent`, `outreach_sent_at` set, `revalidatePath` called, `{ok:true}`. `closeTestDb()` + `queryClient.end()` in `afterAll`.
- **Component** (`tests/unit/components/outreach-panel.test.tsx`, extend): Send control absent when `status !== "drafted"` or mode `handed_to_vendor`; present+enabled when drafted + operator_handles + configured + recipient; present+disabled with hint when `!sendConfigured` or `!recipientEmail`; confirm flow — click Send → confirm prompt with recipient → Confirm invokes `sendOutreachAction` and refreshes on success; Cancel returns to idle; failure → `role="alert"` and no refresh. Server actions + `next/navigation` mocked.

## Global constraints (from the project standards)

- Secrets via env only — `RESEND_API_KEY` / `OUTREACH_FROM_EMAIL` never appear in code; the operator sets them in `.env.local` (never read or modified by the build).
- Data-module split preserved: pure `schema.ts` (no `@/db`, no `server-only`, no `@/ai`/sender **value** imports) + server modules. The sender is server-only by import graph (only the action/page/tests import it).
- `src/ai/` untouched; the AI layer keeps no DB and no email access.
- HTTPS-only external calls (Resend SDK is HTTPS); parameterized queries only; validate inputs; no stack traces to the client.
- Mobile-first (375 → 768 → 1280), semantic HTML, real `<button>`s, keyboard-navigable, focus states, `role="alert"` for errors.
- Tests live in the mirroring test dir; every new pure function is unit-tested; ≥80% coverage on new code.
- Additive only — new `sender.ts`, extended `schema.ts` / `actions.ts` / `OutreachPanel` / `page.tsx` / env / `.env.example` / appended CSS. No edits to shipped pipeline/AI/Slice-A-data modules beyond the additive action + panel extension.
- Real send is operator-initiated; the build never fires a message at a real recipient — every test mocks the sender, and `sendEmail` only issues a request when a real key is configured at runtime.
