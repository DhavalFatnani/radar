# Job-Board Sourcing (Floating Add-On) — Design Spec

**Date:** 2026-07-03
**Phase:** Floating add-on between Phase 4 (sourcing engine + reverse brief) and Phase 5 (pipeline + outreach).
**Status:** Design approved (autonomous build per standing directive).

## 1. Purpose

Detect hiring-growth signals from job postings and persist them as `signal_observations`,
so the existing leads pipeline (matching → scoring → brief → contacts) picks up
hiring-driven leads with no downstream change. This activates the `hiring` signal family,
which already has four **approved** seeded definitions but no ingestion machinery.

The data source is a **pluggable adapter with a deterministic fixture now**; a real
job-board API (Naukri / LinkedIn Jobs / company careers) is a later drop-in — exactly the
pattern already used for tenders (`createTenderFixtureAdapter`) and contacts
(`contactsStubResolver`).

## 2. Scope — which hiring signals this slice detects

The `hiring` family has four seeded, approved signals. This slice detects **three**; the
fourth is deliberately excluded on principle.

| Signal | Detection | In scope? |
|--------|-----------|-----------|
| `SIG-HIRING-SENIOR-OPS` | **Per-posting**: role title matches a senior-ops leadership pattern (Head/VP/Director/Chief of Supply Chain / Operations / Logistics). | ✅ |
| `SIG-HIRING-OPS-SURGE` | **Per-company aggregate**: ≥ `OPS_SURGE_THRESHOLD` (5, from the seed trigger rule) postings matching ops-role keywords (warehouse / operations / logistics / supply chain) for one company, within the signal's freshness window. | ✅ |
| `SIG-HIRING-FIELD-MKTG` | **Per-company aggregate**: ≥ `FIELD_MKTG_THRESHOLD` (3, chosen default — a tunable code constant) postings matching field-marketing keywords (promoter / field marketing / store launch / BTL) for one company, within the freshness window. | ✅ |
| `SIG-HIRING-NEW-CITY` | Would require knowing the company's **existing** city presence to decide a posting is in a *new* city. We have no authoritative company-presence data. Detecting it would require fabricating presence context. | ❌ **Excluded** — no-fabrication thesis. Revisit when a company-presence data source exists. |

Thresholds and role-keyword taxonomies are **code constants** (in `jobs-schema.ts`),
mirroring the existing `TENDER_KEYWORDS` precedent — not data, not config. The ops-surge
threshold (5) and rolling window come from the seeded `trigger_rule` /
`freshness_window_days`; the field-marketing threshold (3) is a documented default that a
one-line edit can tune.

## 3. No-fabrication integrity (the core thesis, in the hiring domain)

Every persisted observation must be a **defensible receipt** built only from real posting
data. The discipline:

- `evidence[]` contains only real values pulled from the postings: actual role titles,
  posting URLs, and a count/summary line for aggregates. Never a synthesized claim.
- `detected_at` is a **real** posting timestamp — for a per-posting signal, that posting's
  `postedAt`; for an aggregate, the **most-recent** qualifying posting's `postedAt`. Never a
  fabricated or `now()` timestamp.
- `source_ref` (the dedup key) is a **real posting id**: for per-posting, that posting's
  `ref`; for an aggregate, the `ref` of the most-recent qualifying posting (a real id that
  anchors the receipt and gives natural idempotency — same postings → same anchor → deduped;
  genuinely newer surge data → a fresh, re-confirmed receipt).
- `entity_match_confidence` comes from `resolveCompany` (1.0 on exact normalized-name match),
  never guessed.
- Only signals present in the approved set (`status = 'approved'` AND
  `signal_id LIKE 'SIG-HIRING-%'`) can emit an observation. A posting that matches nothing
  produces nothing — never a placeholder observation.

## 4. Architecture — three layers, parallel to the tender path, purely additive

The tender path (`schema.ts` + `data.ts` + `adapters/tenders.ts` + `source-tenders.ts`) is
**not modified**. Job-board sourcing is a parallel set of new files that reuse the exported
pure helpers.

### 4.1 Pure schema — `src/lib/sourcing/jobs-schema.ts` (imports only `zod`)

- `jobPostingRecordSchema` (Zod) / `JobPostingRecord`:
  `{ ref: string(min1); title: string(min1); company: string(min1); city: string|optional; url: string(url)|optional; postedAt: <ISO-parseable date string>; sourceName: string(min1) }`.
- `JobSourceAdapter` interface (the new seam, shaped like `SourceAdapter`):
  `{ readonly sourceName: string; fetch(): Promise<{ records: JobPostingRecord[]; skippedMalformed: number }> }`.
- `DetectedHiringObservation` type (parallel to `DetectedObservation`, with honest naming):
  `{ signalId: string; sourceRef: string; source: string; detectedAt: string; evidence: string[]; companyName: string }`.
- Code constants: `SENIOR_OPS_TITLE_PATTERNS`, `OPS_ROLE_KEYWORDS`, `FIELD_MKTG_KEYWORDS`
  (all `as const`), `OPS_SURGE_THRESHOLD = 5`, `FIELD_MKTG_THRESHOLD = 3`, and the three
  signal-id constants (`SIG-HIRING-SENIOR-OPS`, `SIG-HIRING-OPS-SURGE`, `SIG-HIRING-FIELD-MKTG`).
- Pure function `detectHiringSignals(postings, approvedIds, windowBySignal, now)`:
  → `DetectedHiringObservation[]`. Emits senior-ops per matching posting; groups the remaining
  ops / field-mktg matches by normalized company name, applies the window (drop postings
  older than the signal's `freshnessWindowDays` relative to `now`, when the window is set)
  and threshold, and emits one aggregate observation per qualifying company. Only emits for
  signals in `approvedIds`. Uses `normalizeCompanyName` (imported from `schema.ts`) as the
  grouping key.

### 4.2 Fixture adapter — `src/lib/sourcing/adapters/jobs-fixture.ts` + `src/lib/sourcing/fixtures/jobs-sample.json`

`createJobBoardFixtureAdapter(raw = rawJobs): JobSourceAdapter`, `sourceName: "jobboard-fixture"`.
`fetch()` runs `jobPostingRecordSchema.safeParse` on each raw entry, collecting valid records
and counting `skippedMalformed`. No network. The sample fixture contains enough postings to
trigger a senior-ops match, an ops surge (≥5 for one company), a field-mktg surge, and some
non-matching / malformed rows.

### 4.3 Server data — `src/lib/sourcing/jobs.ts` (`import type { DB }`, injected adapter)

- `listApprovedHiringSignals(db): Promise<{ signalId, freshnessWindowDays }[]>` — mirrors
  `listApprovedTenderSignals` but `LIKE 'SIG-HIRING-%'`.
- `ingestJobObservations(db, adapter: JobSourceAdapter, now = new Date()): Promise<IngestResult>`
  where `IngestResult = { scanned, detected, written, skippedDuplicates, skippedMalformed }`
  (same shape as the tender `IngestResult`, re-declared locally — additive, no import from the
  tender module's result type required):
  1. `adapter.fetch()` → `{ records, skippedMalformed }`.
  2. `listApprovedHiringSignals(db)` → `approvedIds: Set`, `windowBySignal: Map`.
  3. `detectHiringSignals(records, approvedIds, windowBySignal, now)` → observations.
  4. For each observation: `resolveCompany(db, obs.companyName)` (imported from `data.ts`) →
     `{ companyId, entityMatchConfidence }`; `computeFreshnessVerdict(new Date(obs.detectedAt),
     windowBySignal.get(obs.signalId) ?? null, now)`; insert into `signal_observations`
     (`signalId, companyId, detectedAt, source, evidence, freshnessVerdict, entityMatchConfidence,
     sourceRef`) with `onConflictDoNothing({ target: [signalId, companyId, sourceRef] })`;
     tally `written` vs `skippedDuplicates`.
  5. Return `{ scanned: records.length + skippedMalformed, detected: observations.length,
     written, skippedDuplicates, skippedMalformed }`.

Writes ONLY to `companies` (via `resolveCompany`, find-or-create) and `signal_observations`.
Never touches `signal_definitions`, `leads`, or the tender path.

### 4.4 Runner — `src/db/source-jobs.ts` + `package.json`

`runJobSourcing(db): Promise<IngestResult>` = `ingestJobObservations(db, createJobBoardFixtureAdapter())`,
mirroring `source-tenders.ts` exactly (argv guard `endsWith("source-jobs.ts")`, `.env.local`
load, `DATABASE_URL ?? DIRECT_URL`, `postgres({ prepare:false, max:1 })`, summary
`console.log`/`console.error`). `package.json`: add one line `"db:source:jobs": "tsx src/db/source-jobs.ts"`
after `db:source:tenders`.

## 5. Data flow

```
job postings (fixture)
  → JobSourceAdapter.fetch()               (validate, count malformed)
  → detectHiringSignals(...)               (per-posting senior-ops + per-company surge aggregates, approved-only, windowed)
  → resolveCompany(...)                    (find-or-create by normalized name; reused)
  → INSERT signal_observations             (dedup on (signal_id, company_id, source_ref))
  → [existing] generateLeads / scoring / brief / contacts pick up SIG-HIRING observations unchanged
```

## 6. Error handling & bounds

- Adapter self-validates; malformed rows are counted (`skippedMalformed`), never persisted.
- `resolveCompany` handles the insert race via re-select (existing behaviour, reused).
- Idempotent: the `(signal_id, company_id, source_ref)` unique index + `onConflictDoNothing`
  makes re-runs safe.
- No unbounded query: reads only approved hiring signal definitions and writes per detected
  observation. Fixture size is bounded; a real adapter is responsible for its own paging.
- No `console.log` / TODO / silent empty catch in module code — except the runner's sanctioned
  summary lines.

## 7. Testing

- **Unit** `tests/unit/sourcing/jobs-schema.test.ts`: `jobPostingRecordSchema` accept/reject;
  `createJobBoardFixtureAdapter` (`sourceName`, parses valid, counts malformed); and
  `detectHiringSignals` exhaustively — senior-ops per-posting match; ops-surge fires at
  exactly the threshold and not below; field-mktg surge; unapproved signal id suppressed;
  window drops stale postings; aggregate `detectedAt`/`sourceRef` = most-recent qualifying
  posting; evidence is real and non-empty.
- **Integration** `tests/integration/sourcing-jobs.test.ts` (harness: `migrateTestDb` /
  `truncateAll(["signal_observations","signal_definitions","companies"])` / `closeTestDb` /
  `testDb`; seed approved hiring signal definitions with `family:"hiring"`): observations
  persisted with correct columns; dedup on re-run; only-approved emit; freshness verdict
  computed; malformed skipped; company find-or-create.
- Full suite (`npm test`) is the pre-merge gate.

## 8. Dependency boundaries

- `jobs-schema.ts` imports only `zod` and (pure) `normalizeCompanyName` from `schema.ts` —
  client-safe, no `@/db`, no `server-only`.
- `adapters/jobs-fixture.ts` imports only the schema module + the fixture JSON.
- `jobs.ts` imports `@/db/client` **type-only** (`import type { DB }`), `@/db/schema`,
  `resolveCompany` from `./data`, `computeFreshnessVerdict` from `./schema`, the pure detection
  from `./jobs-schema`, and `drizzle-orm` operators. No `@/ai`, no `server-only`.
- `source-jobs.ts` mirrors `source-tenders.ts`.

## 9. Out of scope (YAGNI)

- Real job-board API client / scraping / auth — later drop-in adapter.
- `SIG-HIRING-NEW-CITY` detection (needs a company-presence data source).
- Any sourcing/admin UI (no mockup exists; downstream leads UI already renders the resulting
  leads).
- Refactoring the tender path to share an ingestion core — the parallel `jobs.ts` reuses only
  the already-exported pure helpers; a shared-core refactor is a separate, non-additive change.
- Data-driven thresholds via `signal_definitions.parameters` — thresholds stay code constants,
  consistent with `TENDER_KEYWORDS`.

## 10. Impact / risk

Purely additive: 4 new source/test files + 1 fixture JSON + 1 runner + 1 `package.json` line.
No existing symbol modified (the tender path, scoring, leads, and schema are untouched; only
the already-exported `resolveCompany` / `computeFreshnessVerdict` / `normalizeCompanyName` are
**imported**). No migration (`signal_observations`, `companies`, `signal_definitions` already
exist; the four `SIG-HIRING-*` definitions are already seeded and approved). Risk **LOW**.
