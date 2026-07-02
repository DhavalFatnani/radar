# Phase 4 Slice 1 — Tender Source Adapter + Signal Observation Capture (Design)

**Date:** 2026-07-02
**Phase:** 4 (Sourcing engine + reverse brief) — Slice 1 of the phase.
**Source of truth:** `Phase0_Platform_Specification.md` §3 (proof principle), §4.2 (signal observation model), §9 (sourcing reality), §11 (build sequence); `Prompt_Playbook.md` Part 4 (Phase 4 slice-shaping).

## Context

Phase 4 is the sourcing engine — "the heart and the hardest." Its ordered concerns are: (1) one source integration → (2) signal detection with evidence capture → (3) entity resolution → (4) scoring → (5) reverse-brief generation → (6) contact block. This slice is **concern 1 + 2** (with a minimal, deterministic slice of concern 3): wire the **first** source and populate `signal_observations` for the first time with real, proof-carrying records. **No scoring, no reverse briefs, no contact block** — those are later slices.

### Decisions locked with the operator (2026-07-02)

- **First source: tenders.** Public gov/PSU tender portals — the spec's "cleanest, highest-yield, build first"; serves both current vendor types; no locked API.
- **Access: fixture-first.** Build the full detection pipeline against a *recorded sample* of tender records committed to the repo. Live network fetch is a deliberate, thin follow-up slice once the operator picks the exact portal + access method. **No credentials or external calls in this slice.**
- **Trigger: on-demand.** An operator-run script (mirrors the existing `db:seed:*` scripts). No cron / job queue (not in the Phase 1 stack). `recheck_cadence` is honored only as a "due" hint, not automated.

### What already exists (verified against the code, not just the docs)

The Phase 1 data layer already scaffolded the tables this slice populates — this slice **does not create them**:

- `signal_observations` (`src/db/schema/signals.ts:36`): `observationId` (uuid PK), `signalId` (FK → `signal_definitions`), `companyId` (FK → `companies`), `detectedAt` (tz timestamp, **NOT NULL**), `source` (text, **NOT NULL**), `evidence` (text[], **NOT NULL**), `freshnessVerdict` (text, computed), `entityMatchConfidence` (real, computed).
- `companies` (`src/db/schema/companies.ts:3`): `companyId` (uuid PK), `name` (text NOT NULL), `description`, `profile` (jsonb), `createdAt`.
- `signal_definitions` seeded with three approved tender signals (family `procurement`): `SIG-TENDER-LIVE` (very_high), `SIG-TENDER-AMENDED` (high), `SIG-TENDER-RECURRING` (medium).

## Goal

An operator can run one command that reads a committed fixture of tender records, detects `SIG-TENDER-LIVE` and `SIG-TENDER-AMENDED` matches against **approved** signal definitions using vendor keywords, resolves each tender's issuing body to a deduplicated `companies` row, and writes idempotent `signal_observations` — each carrying mandatory proof (`detected_at`, `source`, non-empty `evidence`), a computed `freshness_verdict`, and an `entity_match_confidence`. Re-running the command produces **zero** new rows.

Out of scope (explicitly deferred): live network fetch, scheduling, `SIG-TENDER-RECURRING` (needs prior-year history), scoring/mapping evaluation, reverse briefs, contacts, and any UI (observations-viewing UI is the next slice).

## Architecture

New domain `src/lib/sourcing/`, following the established `schema.ts` (pure, DB-free, client-safe) + `data.ts` (server-only) split:

```
src/lib/sourcing/
  schema.ts              # PURE: TenderRecord + Zod, SourceAdapter interface, DetectedObservation type,
                         #       pure fns: normalizeCompanyName, computeFreshnessVerdict, detectTenderSignals
  data.ts                # SERVER-ONLY: resolveCompany (find-or-create by normalized name),
                         #       ingestTenderObservations (orchestrator: adapter -> detect -> resolve -> upsert)
  adapters/
    tenders.ts           # tenderFixtureAdapter: reads the fixture, normalizes raw JSON -> TenderRecord[]
  fixtures/
    tenders-sample.json  # recorded sample of ~6-8 tender records (a superset: matches, non-matches, an amendment, a duplicate)
src/db/source-tenders.ts # on-demand runner script (tsx), mirrors seed-*.ts (direct-run guard)
```

### Schema changes (additive, applied via a generated migration)

Two nullable columns + supporting unique indexes give robust, idempotent dedup. Both are nullable so existing demo rows (from `db:seed`) are unaffected; the sourcing layer always populates them. **Workflow:** edit the schema files, then `npm run db:generate` (writes `src/db/migrations/0010_*.sql` + snapshot/journal), then `npm run db:migrate` (applies to the dev DB via `DIRECT_URL`). Integration tests pick the migration up automatically through `migrateTestDb()` (which runs `migrate()` against `./src/db/migrations`). **Not `db:push`** — the test branch's schema comes from applied migration files, so a generated migration is mandatory here.

1. `companies.normalized_name text` + a unique index on it. **Entity dedup key** = `normalizeCompanyName(name)` (lower-case, trim, collapse internal whitespace, strip trailing punctuation). Nullable-unique in Postgres permits multiple existing nulls.
2. `signal_observations.source_ref text` + a unique index on `(signal_id, company_id, source_ref)`. **Observation dedup key** = the tender's stable reference id. Makes re-runs idempotent via `onConflictDoNothing`.

`freshness_verdict` and `source` stay `text` (no new enum) — the pure layer constrains their values via Zod unions/constants.

### Data flow (on-demand ingest)

```
db:source:tenders
  -> tenderFixtureAdapter.fetch()            # read fixtures/tenders-sample.json -> { records: TenderRecord[], skippedMalformed }
  -> load approved tender signal defs         # listApprovedTenderSignals() from signals data layer
  -> build approvedIds:Set<signalId> and windowBySignalId:Map<signalId,freshnessWindowDays> from the defs
  -> for each TenderRecord:
       detectTenderSignals(record, approvedIds, KEYWORDS)   # PURE -> DetectedObservation[]
       for each DetectedObservation:
         resolveCompany(record.issuingBody)   # find-or-create by normalized_name -> {companyId, confidence}
         computeFreshnessVerdict(detectedAt, signalDef.freshnessWindowDays, now)  # PURE -> "recent"|"stale"|null
         upsert signal_observation (onConflictDoNothing on (signal_id, company_id, source_ref))
  -> return { scanned, detected, written, skippedDuplicates }
```

### Component contracts

**`schema.ts` (pure):**

- `TenderRecord` (Zod-validated): `{ ref: string; title: string; issuingBody: string; description?: string; keywordsText?: string; publishedAt: string /* ISO */; deadline?: string; url?: string; isAmendment?: boolean; sourceName: string }`. `ref` + `issuingBody` + `title` + `publishedAt` + `sourceName` required.
- `interface SourceAdapter { readonly sourceName: string; fetch(): Promise<{ records: TenderRecord[]; skippedMalformed: number }>; }` — validation happens at the adapter boundary: `fetch()` returns the validated `TenderRecord`s plus a count of raw entries that failed `TenderRecord` parsing. The extensibility seam; later sources (job boards) implement the same interface.
- `type DetectedObservation = { signalId: string; sourceRef: string; source: string; detectedAt: string; evidence: string[]; issuingBody: string }`.
- `normalizeCompanyName(name: string): string` — deterministic normalization for dedup.
- `computeFreshnessVerdict(detectedAt: Date, windowDays: number | null, now: Date): "recent" | "stale" | null` — `null` when `windowDays` is null/undefined (undetermined); `"recent"` when `now - detectedAt <= windowDays`; else `"stale"`.
- `detectTenderSignals(record: TenderRecord, approvedTenderSignalIds: Set<string>, keywords: string[]): DetectedObservation[]` — PURE. Matches `record` text (`title` + `description` + `keywordsText`, case-insensitive) against `keywords`. On a keyword hit AND `SIG-TENDER-LIVE` approved → emit a LIVE observation. If `record.isAmendment` AND `SIG-TENDER-AMENDED` approved AND there was a keyword hit → additionally emit an AMENDED observation. Evidence array always non-empty: `[title, "ref: "+ref, matched-keyword summary, url?]`. Emits nothing when no keyword matches or the corresponding signal isn't approved.
- `KEYWORDS` constant for slice 1: the vendor keywords named in the `SIG-TENDER-LIVE` seed trigger rule (`racking, CCTV, IT hardware, signage, printing`). Documented as a stopgap — later slices derive keywords from the vendor catalogue.

**`data.ts` (server-only):**

- `resolveCompany(name: string): Promise<{ companyId: string; entityMatchConfidence: number }>` — normalize → select by `normalized_name`; if found return `{companyId, confidence: 1.0}`; else insert `{name, normalizedName}` and return the new id with `confidence: 1.0` (exact canonical). Never throws on duplicate insert (handles the unique-index race via `onConflictDoNothing` + re-select).
- `listApprovedTenderSignals(): Promise<SignalDefRow[]>` — approved defs whose `signalId` starts with `SIG-TENDER-`. (Thin reuse of the signals data layer / a scoped query.)
- `ingestTenderObservations(adapter: SourceAdapter): Promise<{ scanned: number; detected: number; written: number; skippedDuplicates: number; skippedMalformed: number }>` — the orchestrator above. `scanned` counts raw records from the adapter, `skippedMalformed` counts records that failed `TenderRecord` validation (skipped before detection), `detected` counts emitted `DetectedObservation`s, `written` counts rows inserted, `skippedDuplicates` counts `onConflictDoNothing` no-ops. Uses parameterized Drizzle queries only.

### Error handling

- A malformed fixture record (fails `TenderRecord` Zod parse) is **skipped with a counted warning**, not fatal — one bad record must not abort the run. The run returns counts including `skipped`.
- No stack traces or internal errors surface to any client (this slice has no client surface; the script logs a concise summary to stdout).
- The script exits non-zero only on a genuinely fatal error (e.g., DB unreachable), zero on a clean run even if some records were skipped.

## Testing

- **Unit (pure, DB-free)** `tests/unit/lib/sourcing-schema.test.ts`: `normalizeCompanyName` (case/whitespace/punctuation), `computeFreshnessVerdict` (recent / stale / null-window / exact-boundary), `detectTenderSignals` (keyword hit → LIVE; amendment + hit → LIVE+AMENDED; no hit → none; signal-not-approved → none; evidence always non-empty), `TenderRecord` Zod (valid / missing-required / bad-date).
- **Integration (real Neon)** `tests/integration/sourcing-data.test.ts`: `resolveCompany` creates once and reuses on the same normalized name (dedup); `ingestTenderObservations` writes the expected observations with all mandatory proof fields populated, computes `freshness_verdict`, sets `entity_match_confidence`; **idempotency** — a second run writes 0 new rows (`skippedDuplicates` == prior `written`); malformed record is skipped and counted, run still succeeds. Follows the existing integration-test `truncateAll([...])` discipline (include `signalObservations`, `companies`, and the tender signal defs it seeds).
- Fixture doubles as the test fixture (superset: ≥1 match, ≥1 non-match, ≥1 amendment, ≥1 duplicate ref, ≥1 malformed for the skip path — the malformed one may live in a test-local variant to keep the committed fixture clean).

## Acceptance criteria

1. `npm run db:source:tenders` runs against the committed fixture and prints `{ scanned, detected, written, skippedDuplicates, skippedMalformed }`.
2. Every written `signal_observation` has non-null `detected_at`, non-empty `evidence[]`, non-null `source`, a resolved `company_id`, a populated `entity_match_confidence`, and a `freshness_verdict` of `recent | stale | null`.
3. Detected signals are only ever `SIG-TENDER-LIVE` / `SIG-TENDER-AMENDED`, only for **approved** definitions, only on a keyword match.
4. Re-running writes **0** new rows (idempotent via `(signal_id, company_id, source_ref)`).
5. The same issuing body across multiple tenders resolves to **one** `companies` row (normalized-name dedup).
6. A malformed fixture record is skipped and counted; the run still completes successfully.
7. `src/lib/sourcing/schema.ts` imports no `@/db/*` (client-safe boundary holds); `data.ts` is the only server-only module. Full suite green.

## Global constraints (bind every task)

- **Data-module split:** `schema.ts` pure (no `@/db`); `data.ts` server-only. No client component in this slice.
- Parameterized Drizzle queries only; never string-interpolated SQL. Paginate/limit any unbounded read.
- No secrets in code; no external network calls in this slice; no credentials handled.
- No `console.log` in committed library code (the runner **script** may print its summary to stdout — that is its interface, not debug logging); no TODO; no silent empty catch (skips are explicit + counted).
- Always write tests for new functions; test file next to nothing — under `tests/unit` / `tests/integration` per repo convention; ≥80% on new code.
- Schema changes via a **generated Drizzle migration** (`db:generate` → `db:migrate`), keep additive + nullable so shipped tables/rows are unaffected. Never `db:push` for this slice.
- Commit only explicit paths (never `git add .`/`-A`).
