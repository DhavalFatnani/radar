# Phase 4 Slice 2 — Matching & Scoring Engine (observations → scored leads)

**Date:** 2026-07-02
**Phase:** 4 (Sourcing engine + reverse brief) — the heart, the hardest part.
**Depends on:** Phase 3 (approved signals + approved mappings) and Phase 4 Slice 1 (tender `signal_observations`), both shipped.
**Roadmap ref:** `Phase0_Platform_Specification.md` §7.2 (Lead sourcing engine), §4.5 (Lead model), §12 (deferred scoring-formula precision).

---

## 1. Goal

Turn captured `signal_observations` (Slice 1) into **scored `leads`** by evaluating a vendor's applicable **approved mappings** against each company's observations: apply the required-signal gate, the mapping's timing window, and a disqualifier check, then compute a 0–100 score and persist an idempotent lead.

One sentence: *the module that makes `signal_observations` become scored `leads`.*

## 2. Scope

**In scope**
- A new `vendor_type` column on `vendor_profiles` (resolves the vendor↔mapping targeting fork — chosen by the operator).
- A **pure, DB-free scoring module** (`src/lib/sourcing/scoring.ts`): required-gate, timing-window eligibility, disqualifier check, and the 0–100 score formula. Aggressively unit-tested.
- A **DB-orchestration layer** (`src/lib/sourcing/leads.ts`) that loads vendors + approved mappings + a company's observations (joined to signal definitions for strength/polarity), calls the pure scorer, and **upserts** scored leads. Integration-tested.
- An **on-demand runner** (`src/db/source-leads.ts` + `npm run db:source:leads`) mirroring the Slice 1 tender runner.
- Seed a `vendor_type` on the demo vendor so the end-to-end path produces a real lead.

**Out of scope (later slices)**
- The **reverse brief** (§7.3, §4.5 `brief` object) — AI-generated; separate slice. `leads.brief` stays `null`.
- **Decision-maker identification / contact paths** (§4.5 `contact_block`) — separate slice. `leads.contact_block` stays `null`.
- **Computing** `vendor_profiles.signal_recipe` — this slice reads `vendor_type` directly; the recipe stays a future derivation.
- **Prose operational disqualifiers** ("Existing client", "Recently pitched") — these need CRM/pipeline data not modeled yet. Only signal-based disqualifiers (negative-polarity observations) are evaluated this slice; the seam is built and documented for the rest.
- A second source (job boards). Slice 1's tenders are the only observation producer today; the engine is source-agnostic and will pick up new signals automatically.

## 3. Data-model change

Add to `src/db/schema/vendors.ts`:

```ts
vendorType: text("vendor_type"),   // matches mappings.serves_vendor_type (case-insensitive), e.g. "Infra" | "Mktg"
```

- Nullable. Additive only — no existing query reads it, so blast radius is near-zero.
- Applied via a **generated** Drizzle migration (`npm run db:generate` → `0011_*.sql`, then `npm run db:migrate`). NOT `db:push`.
- A vendor with `vendor_type = null` matches no mapping and produces no leads (safe default).

**Vendor↔mapping link:** a vendor's applicable mappings = `status = 'approved'` mappings whose `serves_vendor_type` equals the vendor's `vendor_type`, **compared case-insensitively** (`lower(a) = lower(b)`) because seed data uses both `"Infra"` and `"infra"`.

## 4. Architecture — units

```
adapter/tenders.ts ──▶ signal_observations        (Slice 1, done)
                              │
                              ▼
  leads.ts (DB orchestration, `import type { DB }`)
    ├─ load approved mappings for a vendor_type
    ├─ load a company's observations + signal strength/polarity
    ├─ call scoring.ts (pure)  ◀── scoring.ts (DB-free): fire-gate, timing, disqualify, 0–100 score
    └─ upsert leads (idempotent on vendor_id+company_id+matched_mapping_id)
                              │
                              ▼
  source-leads.ts  (runner; owns the connection)  ──▶  npm run db:source:leads
```

**Why split scoring out of `data.ts`/`schema.ts`:** the scoring rule is the substantive, most-tested logic and must be exercisable with hand-built inputs (no DB). A dedicated pure module keeps each file single-responsibility and mirrors the existing `schema.ts` (pure) / `data.ts` (server) split. The **type-only DB import** (`import type { DB } from "@/db/client"`) is reused verbatim so the orchestration runs under Next.js / vitest / tsx without eager-loading the env-bound client.

## 5. The scoring formula (formalizes the deferred §12 rule)

§12 deliberately parks "how strength and recency combine into a number." This slice locks a **first-cut, revisable** formalization of the seed mappings' prose (`strength_logic`: *"One required signal = moderate lead. Each fresh supporting signal lifts it. Required + two or more fresh supporting signals inside 90 days = top-tier lead."*).

### 5.1 Inputs (per (mapping, company))

For a company, its observations are `{ signalId, detectedAt, freshnessVerdict, strength, polarity }` (strength + polarity joined from `signal_definitions`). The mapping supplies `requiredSignals[]`, `supportingSignals[]`, `timingWindowDays`, `disqualifiers[]`.

### 5.2 Eligibility (timing window)

An observation is **eligible** for a mapping iff:
1. its `signalId` ∈ (`requiredSignals` ∪ `supportingSignals`), **and**
2. it is within the mapping's timing window: `age(detectedAt, now) ≤ timingWindowDays` (when `timingWindowDays` is `null`, no timing filter is applied).

Non-eligible observations are ignored entirely.

### 5.3 Weights

```
strengthWeight:  very_high → 1.0   high → 0.7   medium → 0.4   low → 0.2   (null → 0.4, treat unknown as medium)
recencyMultiplier (from freshness_verdict): recent → 1.0   stale → 0.5   null → 0.75
contribution(obs) = strengthWeight(obs.strength) × recencyMultiplier(obs.freshnessVerdict)
```

`freshness_verdict` is the per-signal freshness already computed and stored in Slice 1 — reused, not recomputed.

### 5.4 Gates

- **Fire gate:** at least one **eligible required** observation (an eligible obs whose signal ∈ `requiredSignals`). No eligible required observation → the mapping does not fire → **no lead**.
- **Disqualifier gate:** if the company has **any observation for a negative-polarity signal** (`polarity = 'negative'`) within the mapping's timing window, the lead is **vetoed** → no lead. This check is **independent of the contributing-signal sets** — a distress signal is normally not in the mapping's `required`/`supporting` lists, so eligibility (§5.2) must NOT gate it; only `polarity` and the timing window do. (Signal-based disqualifiers only; prose operational disqualifiers deferred — §2.)

### 5.5 Score (0–100)

```
req  = max( contribution(o) for eligible required observations o )        // strongest required signal anchors the lead; in [0,1]
sup  = Σ  contribution(o) for eligible supporting observations o          // supporting signals lift; ≥ 0
score = round( 100 × min(1, 0.6·req + 0.4·min(1, sup / 2) ) )
```

- Required signals carry 60% of the ceiling; supporting signals carry 40%, saturating at "two fresh strong supporters."
- Deterministic, bounded [0,100], and every term is explainable in the brief later.

### 5.6 Worked examples (become unit tests)

| Scenario | req | sup | score | prose tier |
|---|---|---|---|---|
| 1 required `very_high` recent, no supporting | 1.0 | 0 | **60** | "moderate lead" |
| required `very_high` recent + 2 supporting `high` recent | 1.0 | 1.4 | **88** | "top-tier lead" |
| required `very_high` recent + 4 supporting `high` recent | 1.0 | 2.8 | **100** | saturates |
| 1 required `medium` recent | 0.4 | 0 | **24** | weak-moderate |
| 1 required `very_high` **stale** | 0.5 | 0 | **30** | stale required = weaker |
| no eligible required (only supporting present) | — | — | **no lead** | fire gate |
| required present + a negative-polarity obs in window | — | — | **no lead** | disqualified |
| required present but detected 200d ago, window 180 | — | — | **no lead** | outside timing window |

## 6. Lead persistence & idempotency

Per fired, non-disqualified (vendor, company, mapping):

```
INSERT INTO leads (company_id, vendor_id, matched_mapping_id, intent, score, pipeline_stage='sourced')
ON CONFLICT (vendor_id, company_id, matched_mapping_id)
DO UPDATE SET score = excluded.score, intent = excluded.intent
```

- `intent` = the mapping's `intent_description` (fallback: mapping `name`).
- `pipeline_stage` defaults to `'sourced'` and is **never** reset on re-run (a lead that advanced to `contacted`/`pitched`/… keeps its stage; only `score`/`intent` refresh). `brief`/`contact_block` untouched (stay `null`).
- **New unique index** `leads_vendor_company_mapping_uq` on `(vendor_id, company_id, matched_mapping_id)` (generated migration). We always write a non-null `matched_mapping_id`, so NULL-distinctness is a non-issue; the pre-existing demo lead is a single row and cannot collide.
- Idempotency proof: run twice → run 1 writes N leads; run 2 updates the same N (0 net new rows), scores identical.

## 7. On-demand runner

`src/db/source-leads.ts` mirrors `src/db/source-tenders.ts` exactly:
- `export async function runLeadSourcing(db: DB): Promise<GenerateLeadsResult>` → `generateLeads(db)` (all vendors that have a `vendor_type`).
- A direct-run guard (`process.argv[1].endsWith("source-leads.ts")`) that loads `.env.local`, opens its own `postgres` connection (`prepare:false, max:1`), runs, prints a JSON summary, closes, exits. `console.log` in the runner is its operator interface (allowed).
- `package.json`: add `"db:source:leads": "tsx src/db/source-leads.ts"` after `db:source:tenders`.

**End-to-end order:** `db:seed:signals` → `db:seed:mappings` → seed a vendor with `vendor_type` → `db:source:tenders` (creates observations) → `db:source:leads` (creates scored leads).

## 8. `generateLeads` result shape

```ts
type GenerateLeadsResult = {
  vendorsProcessed: number;
  mappingsEvaluated: number;      // (vendor, mapping) pairs considered
  companiesConsidered: number;    // distinct companies with ≥1 eligible observation
  leadsWritten: number;           // net-new lead rows
  leadsUpdated: number;           // existing leads re-scored
  skippedNoFire: number;          // (company, mapping) evaluated but fire-gate failed
  skippedDisqualified: number;    // (company, mapping) vetoed by a negative-polarity observation
};
```

## 9. Testing strategy

- **Unit (`tests/unit/lib/sourcing-scoring.test.ts`)** — the eight §5.6 rows plus edge cases: empty observations, `timingWindowDays = null` (no timing filter), unknown strength (`null`→0.4), unknown freshness (`null`→0.75), saturation at 100, disqualifier veto, fire-gate fail. Pure functions, no DB.
- **Integration (`tests/integration/sourcing-leads.test.ts`)** — against the test DB: seed approved signals (with strengths/polarity) + approved mappings + a vendor with `vendor_type`; insert observations; run `generateLeads`; assert a lead row with the expected `score`, `matched_mapping_id`, `pipeline_stage='sourced'`, `brief`/`contact_block` null. Assert: case-insensitive vendor_type match; unapproved mapping produces no lead; disqualifier veto writes no lead; fire-gate fail writes no lead; **idempotency** (second run = 0 net new, scores stable, an advanced `pipeline_stage` is preserved).
- Coverage target ≥ 80% on new code. All queries `.limit()`-bounded.

## 10. Acceptance criteria

1. `vendor_type` column added via generated migration `0011`; `npm run db:migrate` applies cleanly.
2. Pure `scoring.ts` implements eligibility, both gates, and the §5.5 formula; all §5.6 rows pass as unit tests.
3. `generateLeads(db)` upserts scored leads for approved mappings matching a vendor's `vendor_type` (case-insensitive), skipping non-firing and disqualified (company, mapping) pairs.
4. Idempotent: a second run creates 0 net-new leads, scores unchanged, `pipeline_stage` preserved.
5. `npm run db:source:leads` runs end-to-end against the dev DB and prints a `GenerateLeadsResult` JSON summary, exit 0.
6. `brief` and `contact_block` remain `null` (reverse brief is a later slice).
7. Full suite green; new code ≥ 80% covered.

## 11. Global constraints (bind every task)

- Data-module split: `scoring.ts` is pure (no `@/db` import, no `server-only`); `leads.ts` uses `import type { DB } from "@/db/client"` (type-only — erased at runtime).
- Generated Drizzle migrations only (`db:generate` → `db:migrate`), never `db:push`.
- Parameterized Drizzle queries only; every query `.limit()`-bounded where it lists.
- No `console.log`/TODO/silent empty catch in committed code (runner's summary `console.log` is its operator interface — allowed).
- Commits stage only explicit file paths (never `git add .`/`-A`). Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Always write tests for new functions; test file next to nothing — under `tests/unit` / `tests/integration` per repo convention.
