# Phase 2 · Slice 2c — SIA Interview UI (design)

**Status:** approved-in-session (approach chosen: dedicated interview-session table, persisted turn-by-turn)
**Source of truth:** `Phase0_Platform_Specification.md` §4.4 (vendor profile), §7.1 (SIA interview), `UIUX_Specification.md`; mockup `mockups/v2/command/interview.html`.
**Depends on (all merged):** `src/ai/sia/` (SIA engine — `nextQuestion`/`extractProfile`/`assessCoverage`), `src/ai/llm/` (provider fallback), `src/lib/vendors/` (profile persistence + versioning).

---

## 1. Goal

Give the merged-but-idle SIA engine an operator-facing home: a co-piloted interview screen (matching the v2 `interview.html` mockup) where the operator relays SIA's questions to a vendor, answers are captured turn-by-turn, coverage of the five interview areas fills visibly, and on completion the transcript is extracted into a **new versioned vendor profile** (append-and-amend). Each interview is persisted as a **session**, so: (a) a long first sitting survives a crash/refresh, and (b) a vendor accrues **multiple interviews over time** (periodic re-interviews) as durable history.

This is the Phase 2 deliverable the playbook calls *"the first real interview producing a real profile."*

## 2. Scope

**In scope**
- New persisted interview-session store (`vendor_interviews` table + `src/lib/interviews/` data module).
- Server Actions orchestrating the SIA engine + persistence (server-side, env-gated).
- The interview screen: server `page.tsx` + `"use client"` interview component matching the mockup; ported mockup CSS.
- Entry point: a "Start / Continue interview" link on the vendor detail page.
- Re-interview: a new session seeded with the current profile as `existingProfile` (engine handles append-and-amend).
- An `interview` history-kind on `vendor_profiles.interview_history`, cross-linked to the session.

**Out of scope (explicit)**
- **Candidate-signal surfacing** (mockup `#cand-wrap`, "growth engine for the library"). Feeds a Signals library that does not exist until Phase 3. Deferred; this is the Phase 2→3 seam.
- **Live per-turn profile extraction.** The right panel shows *deterministic coverage* (from `assessCoverage`, free) over the *current on-file profile* values; the LLM extraction runs **once, on save**.
- **The "↳ push deeper" nudge / probe-flag** as distinct engine calls. The engine already probes adaptively; these mockup affordances are cosmetic and deferred.
- **Differentiators as a right-panel section.** The engine still covers it as area #5 (coverage dot shown); the panel layout follows the mockup (capabilities, constraints, ideal customer).
- A top-level rail nav item for interviews (interviews are per-vendor; the entry point is the vendor detail page).

## 3. Architecture

Three layers, each independently testable:

```
UI (client)         interview-screen.tsx  ── calls ──▶  Server Actions
                    page.tsx (server)                        │
                                                             ▼
Orchestration       actions.ts  ── SIA engine (@/ai/sia) ──▶ LLM providers
                        │
                        ├─ persistence: @/lib/interviews (sessions/transcripts)
                        └─ persistence: @/lib/vendors     (profile + version + history)
```

**Engine contract (unchanged, reused):** `state = { messages: LlmMessage[]; existingProfile }`. `nextQuestion(state)` → `{ question, transcriptEntry (assistant turn carrying a hidden [area:X] tag), targetArea, coverage }`. `extractProfile(state)` → `{ value: VendorProfileInput, provider }`. `assessCoverage(state)` → `{ covered, remaining, isComplete }` (synchronous, no LLM). **Invariant: every engine call is seeded with `existingProfile = getVendor(vendorId)`** — that is what makes re-interviews append-and-amend (the engine's prompts preserve on-file fields).

## 4. Data model

### 4.1 `interview_status` pgEnum
Added to `src/db/schema/enums.ts` (matching the codebase's enum convention): `'in_progress' | 'completed' | 'abandoned'`.

### 4.2 `vendor_interviews` table (`src/db/schema/interviews.ts`, added to the barrel `index.ts`)

| column | type | notes |
|---|---|---|
| `interview_id` | uuid PK default random | |
| `vendor_id` | uuid NOT NULL | FK → `vendor_profiles(vendor_id)` ON DELETE CASCADE |
| `status` | `interview_status` NOT NULL default `'in_progress'` | |
| `messages` | jsonb NOT NULL default `'[]'` | `LlmMessage[]` — full transcript, `[area:X]` tags retained |
| `started_at` | timestamptz NOT NULL default now() | |
| `completed_at` | timestamptz | set on complete / abandon |
| `resulting_version` | integer | the `vendor_profiles.version` this interview produced on save |
| `provider` | text | LLM provider used for the extraction (audit) |

Indexes:
- `INDEX (vendor_id)` — list a vendor's interviews.
- **`UNIQUE (vendor_id) WHERE status = 'in_progress'`** (partial) — at most **one open interview per vendor**. This is the integrity backbone: resume is unambiguous, and two browser tabs can't fork a session.

Migration: `npm run db:generate` → committed `0009_*.sql` (repo uses generate→migrate, not push).

### 4.3 Vendor data-layer change (blast radius: 1 type + 1 signature; existing caller untouched)
- `InterviewHistoryEntry` (`src/lib/vendors/schema.ts`): widen `kind` to `"manual_edit" | "interview"`; add optional `interviewId?: string`. `actor` stays `"operator"`.
- `updateVendorProfile(vendorId, input, source: { kind: "manual_edit" | "interview"; interviewId?: string } = { kind: "manual_edit" })`. The appended history entry uses `source.kind` + `source.interviewId`. The existing `updateVendor` action calls with no third arg → **behavior identical**. The early-return-on-no-change path is preserved: if extraction yields nothing new, the profile is returned unchanged and the interview records `resulting_version` = the unchanged version.

## 5. Persistence module — `src/lib/interviews/`

Mirrors `src/lib/vendors/` conventions: `db` from `@/db/client`, tables from the `@/db/schema` barrel, Drizzle query builder, explicit column selects (no `SELECT *`), throws plain `Error` on missing rows, trusts caller-validated input.

**`schema.ts`** (pure types, no DB import):
- `InterviewStatus = "in_progress" | "completed" | "abandoned"`
- `Interview = { interviewId, vendorId, status, messages: LlmMessage[], startedAt, completedAt: string | null, resultingVersion: number | null, provider: string | null }`
- `InterviewSummary = { interviewId, status, startedAt, completedAt, resultingVersion, messageCount }` (no transcript)

**`data.ts`** (re-exports the schema types, like `vendors/data.ts`):
- `createInterview(vendorId): Promise<Interview>` — insert, status `in_progress`, `messages: []`.
- `getInterview(interviewId): Promise<Interview | null>`
- `getActiveInterview(vendorId): Promise<Interview | null>` — the `in_progress` row, for resume.
- `listInterviews(vendorId): Promise<InterviewSummary[]>` — newest-first; selects metadata + `jsonb_array_length(messages)` as `messageCount`; **does not load transcripts** (keeps the history list cheap as re-interviews accumulate).
- `appendMessages(interviewId, msgs: LlmMessage[]): Promise<void>` — **atomic** `set({ messages: sql\`\${vendorInterviews.messages} || \${JSON.stringify(msgs)}::jsonb\` })`. DB-side concat, no read-modify-write → a crash or a racing write can't lose turns.
- `completeInterview(interviewId, resultingVersion, provider): Promise<void>` — status `completed`, `completed_at` now, set `resulting_version` + `provider`.
- `abandonInterview(interviewId): Promise<void>` — status `abandoned`, `completed_at` now (frees the open slot).

## 6. Orchestration — Server Actions (`src/app/(app)/vendors/[vendorId]/interview/actions.ts`)

All `"use server"`, all `auth()`-gated (return an unauthorized error shape if no session; the route also sits behind the `(app)` auth shell + middleware). Unlike the existing `string | undefined` action pattern, these **return structured data** because the interview is interactive — an explicit, justified departure noted for reviewers.

Shared return type:
```ts
type DisplayTurn = { role: "sia" | "vendor"; text: string };   // [area:X] tags stripped, system removed
type TurnResult =
  | { ok: true; interviewId: string; transcript: DisplayTurn[]; pendingQuestion: string; coverage: CoverageReport; isComplete: boolean }
  | { ok: false; error: string };
type SaveResult = { ok: true; version: number } | { ok: false; error: string };
```

**Turn state machine.** The transcript ends either with an assistant turn (a *pending question* awaiting an answer) or with a user turn / empty (ready to generate the next question). Questions are appended to the store **as soon as generated**, so a refresh re-displays the pending question without re-calling the LLM.

Actions:
- `startInterview(vendorId): TurnResult` — resume the active session or `createInterview`; if there is no pending question, seed `state = { messages, existingProfile: getVendor(vendorId) }`, call `nextQuestion(state)`, `appendMessages([transcriptEntry])`, return the turn.
- `submitAnswer(interviewId, answer): TurnResult` — load interview (guard `status === "in_progress"`); build `state` with `existingProfile`; `appendMessages([{ role: "user", content: answer }])`; `nextQuestion(state')`; `appendMessages([transcriptEntry])`; return. **The answer is persisted before the LLM call**, so an LLM failure cannot lose it — the client retries via `advanceInterview`.
- `advanceInterview(interviewId): TurnResult` — generate the next question from the current stored state **without** appending a new answer. Used to (a) resume a session whose last turn is a user answer (crash between answer-append and question-gen) and (b) retry after an LLM failure. `submitAnswer` = append answer, then this.
- `saveInterview(interviewId): SaveResult` — build `state` with `existingProfile`; `extractProfile(state)` → `{ value, provider }`; `updateVendorProfile(vendorId, value, { kind: "interview", interviewId })` → profile; `completeInterview(interviewId, profile.version, provider)`; `revalidatePath` the vendor detail + interview routes; return `{ version }`.
- `endInterview(interviewId): void` — `abandonInterview`; `revalidatePath`; the client redirects to the vendor detail.

**Tag stripping.** Add `export { stripAreaTag } from "./coverage"` to `src/ai/sia/index.ts` (single source of truth for the tag format lives in the engine). The actions use it to build `DisplayTurn[]` from stored assistant turns; the *current* pending question uses the clean `question` the engine returns.

## 7. UI

### 7.1 Route & data (server)
`src/app/(app)/vendors/[vendorId]/interview/page.tsx` — server component, mirrors `[vendorId]/page.tsx`:
```
const { vendorId } = await params;
const vendor = await getVendor(vendorId);       if (!vendor) notFound();
const active = await getActiveInterview(vendorId);
const past   = await listInterviews(vendorId);
return <InterviewScreen vendor={vendor} active={active} past={past} />;
```
Renders **only** the content inside the shell's `<main className="v2-content">` (the `(app)/layout.tsx` shell provides rail/topbar/frame).

### 7.2 `interview-screen.tsx` (`"use client"`)
Mirrors `edit-profile-form.tsx`'s client pattern (`useActionState`/`useTransition`).

- **No active interview →** launch state: a "Start interview" button (calls `startInterview`) and a **past-interviews list** from `past` (each row: started date, status, `→ vN` resulting version). Re-interview = start a new session.
- **Active interview →** the mockup `.sia-layout` (2-col grid):
  - **Left** `section.interview.card.card-pad`:
    - `.iv-head`: `span.brand-mark` "SIA" + vendor name + `.faint` eyebrow (`"Re-interview · append & amend"` when the profile already has content, else `"First interview"`) + `span.ver-chip` (`v{version} → v{version+1}`).
    - `.thread#thread`: map `transcript` → `.msg.sia` / `.msg.vendor` rows (`.av`, `.who-line`, `.bubble`). While a question is generating, show a `.msg.sia` "thinking" placeholder (driven by `isPending`).
    - `.composer`: `input#ci` (placeholder *"Type the vendor's answer, or press Continue…"*, `aria-label="Vendor answer"`) + `button.btn.btn-primary#send`. Label is **"Continue interview"**, switching to **"Save & version v{n+1}"** once `coverage.isComplete` (operator may also save earlier via the same control state). Enter in the input submits.
  - **Right** `aside.side`:
    - "Profile forming" card: for each area (capabilities, constraints, ideal customer) a `.prof-section` — `.eyebrow` (area label + `.dots` where a dot is `.on` when the area is in `coverage.covered`) and `.prof-item`s rendered from the **current on-file profile** (`vendor` prop). Unpinned/empty areas show `.prof-item#thin` with `span.thin` "● not yet pinned".
    - "Operator co-pilot" helper card (`.card.inset.card-pad`) with static guidance.
    - (`#cand-wrap` candidate-signal card **omitted** — Phase 3.)
  - **Controls:** primary button (continue/save), a quiet **"End interview"** control (calls `endInterview` → redirect to detail).

### 7.3 CSS
Port the mockup's inline `<style>` (interview.html lines 15–44) into `src/app/styles/command.css`, only the classes actually used: `sia-layout, interview, iv-head, who, ver-chip, thread, msg (.sia/.vendor), av, who-line, bubble, composer, side, prof-section, prof-item (+.added), thin, dots (i.on)`. All referenced tokens already exist in `tokens.css`. (Skip `probe-flag`, `nudge`, `cand-wrap` — deferred features.)

### 7.4 Entry point
On `src/app/(app)/vendors/[vendorId]/page.tsx`, add a link/button **"Start interview"** (or **"Continue interview"** when an active session exists) → `/vendors/[vendorId]/interview`, styled `btn btn-primary`.

## 8. Error handling

- **LLM / all-providers-down:** `nextQuestion`/`extractProfile` throw; actions catch and return `{ ok: false, error }`. Because `submitAnswer` persists the answer **before** the LLM call, no answer is lost; the client shows the error and a "Retry" that calls `advanceInterview`.
- **Auth:** actions call `auth()`; unauthenticated → `{ ok: false, error }`. The route is also behind the `(app)` shell + middleware.
- **Not found:** `getVendor`/`getInterview` null → `notFound()` (page) / `{ ok:false }` (action).
- **Concurrency:** the partial unique index guarantees one open interview per vendor; `startInterview` resumes the existing active session rather than failing.
- **Empty answers:** trimmed and ignored client-side; the engine's `MIN_ANSWER_LENGTH` governs whether an answer counts toward coverage.
- **Extraction validation:** `generateObject` validates against `vendorProfileSchema`; `updateVendorProfile` trusts the validated value. `name` is pinned by the engine.

## 9. Testing

- **Integration (real Neon branch)** — `src/lib/interviews/data.ts`: create + `getActiveInterview`; `appendMessages` atomic concat (append twice → order preserved, both present); `listInterviews` returns summaries with correct `messageCount` and **no** transcript field; `completeInterview`/`abandonInterview` set fields and free the in-progress slot; the **partial unique index blocks a second `in_progress`** for one vendor.
- **Integration** — vendors change: `updateVendorProfile(..., { kind: "interview", interviewId })` writes an `interview`-kind history entry carrying the `interviewId`; the default call still writes `manual_edit`.
- **Integration** — server actions (mock `@/ai/sia`, `@/lib/auth`, `next/cache`; real db): `startInterview` creates a row + persists Q1; `submitAnswer` appends the answer + next question; `saveInterview` extracts → bumps profile version → completes the interview with the `resulting_version` link; `endInterview` abandons.
- **Unit (jsdom)** — `interview-screen.tsx` (mock `./actions`): renders launch state with the past-interviews list; renders an active transcript distinguishing `.msg.sia` vs `.msg.vendor` with tags stripped; submitting an answer calls `submitAnswer` and renders the returned question; coverage dots reflect `coverage.covered`; the primary control calls `saveInterview`.
- **Unit** — `@/ai/sia` barrel exposes `stripAreaTag`.

Coverage target ≥ 80% on new code. Test files live beside source under `tests/unit/**` and `tests/integration/**` per the existing layout.

## 10. File structure

```
src/db/schema/enums.ts                                  (M) + interview_status enum
src/db/schema/interviews.ts                             (C) vendor_interviews table
src/db/schema/index.ts                                  (M) export * from "./interviews"
src/db/migrations/0009_*.sql                            (C, generated)
src/lib/interviews/schema.ts                            (C) pure types
src/lib/interviews/data.ts                              (C) session data layer
src/lib/vendors/schema.ts                               (M) widen InterviewHistoryEntry
src/lib/vendors/data.ts                                 (M) updateVendorProfile source param
src/ai/sia/index.ts                                     (M) export stripAreaTag
src/app/(app)/vendors/[vendorId]/interview/page.tsx     (C) server component
src/app/(app)/vendors/[vendorId]/interview/interview-screen.tsx  (C) "use client"
src/app/(app)/vendors/[vendorId]/interview/actions.ts   (C) server actions
src/app/(app)/vendors/[vendorId]/page.tsx               (M) add "Start/Continue interview" link
src/app/styles/command.css                              (M) port interview CSS
tests/unit/app/interview-screen.test.tsx                (C)
tests/unit/ai/sia-index.test.ts                         (M) stripAreaTag export
tests/integration/interviews-data.test.ts               (C)
tests/integration/interview-actions.test.ts             (C)
tests/integration/vendors-interview-history.test.ts     (C)
```

## 11. Non-blocking notes

- `signal_recipe` on `vendor_profiles` remains unused (computed later, Phase 3/4).
- A live-provider smoke (one real `nextQuestion` + one `extractProfile`) is a recommended manual check once the UI is up; the mocked tests + build are the automated gate.
