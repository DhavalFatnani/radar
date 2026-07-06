# Campaigns — the front door that pulls real leads

**Date:** 2026-07-06
**Status:** Draft for review
**Origin:** Port the proven ideas of the `crust-data` project ("Ops Expansion Radar") into radar. crust-data auto-pulls real, freshly-funded companies from the Crustdata API and grounds every claim in a real data point; radar today runs on committed fixtures with no trigger to go find companies. This spec designs radar's missing front door: a **Campaign** — pick a vendor, give a few inputs, and radar fetches real companies showing that vendor's buying signals and turns them into scored leads.

---

## 1. Context & problem

radar has a complete downstream: `leads` list, reverse briefs, pipeline board, contacts, commission, catalogue. It has a real sourcing pipeline (`SourceAdapter.fetch()` → pure detector → `resolveCompany` → upsert `signal_observations` → `generateLeads`). **What it lacks is a way to start that pipeline from inside the app.** Sourcing is CLI-only (`db:source:tenders`, `db:source:jobs`), fed by fixtures (`tenders-sample.json`, `jobs-sample.json` with invented companies), and contact resolution is a no-op stub. So radar feels "abstract": the operator must hand-configure vendors/signals/mappings and run scripts before anything appears.

crust-data solves the same job the opposite way. Its **campaign** is a tiny `RunConfig` (`country`, `target`, `enrich_top`); the form triggers `POST /api/run`, which streams a `SCAN → SCORE → ENRICH → BRIEF` pipeline back live and produces real accounts. The vendor context (ops-infra) is hardcoded into its scoring.

**radar is the generalization of crust-data:** crust-data matches *one* deliverable (ops-infra) to companies that need it; radar matches *any vendor's* deliverables to businesses that need them. A campaign in radar is crust-data's campaign with the hardcoded persona replaced by a real `vendor_profile` + its approved `mappings`.

## 2. Goal (one sentence)

Give the operator a button — **"Find Leads"** on a vendor, plus a **Campaigns** section — that runs a per-vendor sourcing campaign against a real company-data provider (Crustdata), producing scored, grounded leads with no manual data entry, and a run history of what each campaign surfaced.

## 3. Scope

**In scope (Campaigns v1):**
- A `campaigns` domain: table, orchestrator, server actions, run history.
- "Find Leads" trigger on the vendor detail page + a top-level **Campaigns** section (list + detail).
- A **minimal campaign form**: vendor (implied when launched from a vendor) + geography + target count.
- A **sourcing plan** derived from the vendor's *approved mappings* — the signals to hunt.
- A **company `SourceAdapter`** (parallel to the tender/jobs adapters) with two implementations: a fixture adapter (Phase A) and a live **Crustdata** adapter (Phase B).
- New signal detectors for the **money** (funding recency) and **expansion** (headcount growth) families, reusing the existing **hiring** detector for ops-hiring.
- A **metered, credit-safe `CrustdataClient`** (port of crust-data's `crustdata.py` safety model).
- Seed the ops **signal + mapping config** (funding + headcount signal definitions + an ops-expansion mapping for `vendorType: Infra`) — **no fabricated vendor or company**. The operator onboards vendor #1 through radar's own interview flow and pulls real companies from the first live campaign.
- Grounding preserved end-to-end (evidence non-empty; "missing = null, not zero").

**Out of scope (explicitly deferred — future "Campaigns v2"):**
- The **enrichment funnel** (per-top-N contact resolution via Crustdata `/person/search` + reverse-brief generation inside the campaign). v1 creates leads; enrichment stays a separate existing step for now.
- **Fingerprint account memory** (New / Suppressed / Updated across runs) and the **watch-list recheck**. This is crust-data's best intelligence idea and gets its own spec next.
- **Scheduling / cron** (recurring campaigns).
- **Live SSE streaming** of per-step progress. v1 uses persisted status + polling (see §6.4).
- Providers other than Crustdata.

## 4. Approach decisions

Four forks were raised; one was answered interactively, three are proposed here as best-judgment defaults for the reviewer to confirm or overturn.

**4.1 Front door — CONFIRMED: vendor button + Campaigns section.**
A "Find Leads" button on `/vendors/[vendorId]` opens the campaign form; a new top-level **Campaigns** section (under "Operate" in the rail) lists every run with its config, status, and lead counts, and each run has a detail page. Rationale: discoverable per-vendor *and* gives crust-data's "what did this run surface" history. Alternatives (section-only; button-only) rejected for losing discoverability or run history respectively.

**4.2 Campaign inputs — CONFIRMED: minimal by default, rich available as an optional "Advanced" panel.**
The form opens **minimal**: vendor (implied) + geography + target count, with the signals auto-selected from the vendor's *approved mappings* — so a casual run stays effectively one click. An expandable **"Advanced options"** panel (collapsed by default) exposes the **rich** controls: pick *which* of the vendor's mappings to run, and add funding-window / company-size filters. Both ship in v1. Rationale: minimal matches crust-data's simple form and "custom input → fetch leads"; power users still get precision without cluttering the default path. The freeform-LLM-prompt variant stays deferred (sacrifices the determinism grounding depends on).

**4.3 Data source — PROPOSED: provider-agnostic adapter, fixtures-first then live Crustdata.**
Build the whole campaign flow against a **company fixture adapter** first (Phase A) so the UX is provable without a key or spent credits, then implement the **Crustdata adapter** behind the same `CompanySourceAdapter` interface (Phase B) and swap it in. Rationale: de-risks the UI/orchestration from the API integration; matches how radar already ships fixture-first. *Dependency resolved:* the operator will provide a valid `CRUSTDATA_API_KEY` for radar, so Phase B is unblocked (added to `src/lib/env.ts`, never in code).

**4.4 Seed data — CONFIRMED: seed the ops *config* only; no fabricated vendor or company.**
The operator does **not** want a pre-seeded vendor or company — they want to test the platform organically: onboard their own first vendor through radar's interview flow, then let the first **live** campaign pull in **real** companies. So we seed only the reusable **config**: the funding + headcount **signal definitions** (money/expansion families) and an ops-expansion **mapping** for `vendorType: Infra` (alongside radar's existing 17 seed signals + "Warehouse expansion" mapping). That makes a campaign immediately runnable the moment the operator creates an Infra-type vendor — with zero fake company data in the system. Rationale: honours "don't seed a company; I want to test the platform that way," while still giving a smooth day-one path (config is ready; the operator supplies the vendor; Crustdata supplies real companies).

**4.5 Execution model — PROPOSED: run the orchestrator *awaited* inside the trigger; persist status for history/failure.**
No SSE and no fire-and-forget background job in v1 (a detached task can be frozen after a serverless function returns its response). Instead the trigger (a route handler or server action) inserts the `campaigns` row (`running`), `await`s the orchestrator to completion, and returns when it lands on `done`/`failed`. This is safe because the hard `MAX_LIMIT = 25` row cap bounds a run to a handful of API calls, well inside Vercel's 300s function budget. The persisted `status` still exists so the Campaigns history records outcomes and a failed run is visible; the detail page can revalidate on navigation. Rationale: simplest thing that actually runs on serverless. Async queueing + live streaming is a v2 enhancement if runs ever grow beyond the cap.

## 5. Data model changes

All additive. No existing table's persisted contract changes except one nullable column on `leads`.

**5.1 New enum (`src/db/schema/enums.ts`):**
```
campaign_status: queued | running | done | failed
```

**5.2 New table `campaigns` (`src/db/schema/campaigns.ts`):**
| Column | Type | Purpose |
|---|---|---|
| `campaignId` | uuid PK | |
| `vendorId` | uuid FK → vendor_profiles | the vendor this run sources for |
| `label` | text | human label, e.g. "Acme Infra · India · 20" |
| `config` | jsonb | `{ geography, target, enrichTop?, mappingIds?, source }` — the inputs, echoed for the history view |
| `source` | text | `"company-fixture"` \| `"crustdata"` (which adapter ran) |
| `status` | campaign_status | lifecycle |
| `stats` | jsonb | `{ companiesFetched, observationsWritten, leadsCreated, leadsUpdated, creditsSpent }` (computed) |
| `error` | text (nullable) | populated on `failed` |
| `startedAt` / `finishedAt` | timestamptz (nullable) | |
| `createdAt` | timestamptz default now | |

**5.3 New join table `campaign_leads` (`campaigns.ts`):**
`(campaignId FK, leadId FK, wasNew boolean)`, unique on `(campaignId, leadId)`. Records which leads a run produced/updated — powers the campaign detail "this run surfaced N leads" view without overloading `leads`. Mirrors crust-data's append-only run archive tagging.

**5.4 `leads` — one nullable column:** `sourceCampaignId uuid (nullable) FK → campaigns` = the campaign that *first created* this lead. Cheap provenance for the leads list ("from campaign #12"); `campaign_leads` remains the full many-to-many record.

**5.5 New signal definitions + detectors (no new tables — uses existing `signal_definitions` / `signal_observations`).**
The **money** and **expansion** signal families exist in the `signal_family` enum but have no ingestion path. Add:
- `SIG-MONEY-FUNDING-RECENT` (family `money`) — detected when a company raised within a freshness window; evidence carries round type, amount, date.
- `SIG-EXP-HEADCOUNT-GROWTH` (family `expansion`) — detected when 12-month headcount growth exceeds a threshold; evidence carries the growth figure.
- Reuse the existing ops-hiring signal (`SIG-HIRING-OPS-SURGE`) and its `detectHiringSignals` for the hiring leg.
- Optional counter-signal `SIG-HIRING-OPS-INHOUSE` (`polarity: counter`) — ops-*engineering* roles = building in-house = disqualifier, per crust-data's adversarial classification.

Each new detector is a **pure function** in the sourcing layer, evidence always non-empty, emitting only for *approved* signals — identical contract to `detectTenderSignals`.

**5.6 New table `company_snapshots` (`src/db/schema/campaigns.ts`) — write-only in v1, for imminent v2.**
Append-only per-run signal snapshot so v2's fingerprint memory has history to diff without a migration/backfill: `(snapshotId PK, campaignId FK, companyId FK, snapshot jsonb, capturedAt timestamptz)`, where `snapshot = { fundraiseDate (absolute), headcountTotal, opsPostings, score, verdict }`. v1 writes one row per company per campaign in the orchestrator; nothing reads it yet. See §16.1.

## 6. Architecture & components

### 6.1 Company source adapter (`src/lib/sourcing/company-schema.ts` + `adapters/`)
A new seam parallel to `SourceAdapter`/`JobSourceAdapter`:
```ts
interface CompanySourceAdapter {
  readonly sourceName: string;
  fetch(query: CompanyQuery): Promise<{ records: CompanyRecord[]; skippedMalformed: number }>;
}
```
- `CompanyQuery` = `{ geography: string; target: number; fundedSinceDays?: number; signalFamilies: SignalFamily[] }` — built from the campaign inputs + the vendor's sourcing plan (§6.3).
- `CompanyRecord` = normalized `{ name, domain?, country?, funding?: {lastRoundType, amountUsd, date}, headcount?: {total, growth12mPct}, jobPostings?: {title, updatedAt}[], sourceName, sourceRef }`. Every numeric field **optional/nullable** — "missing = null, not zero" is enforced at the type level so *insufficient data* stays distinguishable from *bad signal*.
- Implementations: `createCompanyFixtureAdapter()` (Phase A, reads a new `fixtures/companies-sample.json` of *real ops-scaling Indian companies*), and `createCrustdataCompanyAdapter(client)` (Phase B, calls `/company/search` and, for the hiring leg, `/data_lab/job_listings`).

### 6.2 Metered Crustdata client (`src/lib/vendors/crustdata/client.ts`)
Direct port of `crust-data/crustdata.py`'s safety model to TypeScript:
- Base `https://api.crustdata.com`, `x-api-version: 2025-11-01`, Bearer auth (Token fallback for `job_listings` on 401), key from `CRUSTDATA_API_KEY` (validated in `src/lib/env.ts`, never in code).
- Hard `MAX_LIMIT = 25` row cap clamped on every request; `COST_PER_ROW = 0.03`; row-count metering accumulated to a run ledger; cost reported even on failure (a `finally`-equivalent). Failures are free by construction (only a 200-with-rows is billed).
- Timeouts + retry on `{404, 502, 503, 504}` for `job_listings`.
- `docs/CRUSTDATA_ENDPOINTS_REFERENCE.md` in crust-data is the verified integration handoff (auth-by-generation, `field` vs `column` filter dialects, `=>`/`=<` operators, per-row billing) — lift it into radar's docs.

### 6.3 Sourcing plan (`src/lib/campaigns/plan.ts`)
Pure function: `buildSourcingPlan(vendor, approvedMappings) → { signalFamilies, fundedSinceDays, keywords }`. It reads the vendor's approved mappings' `requiredSignals`/`supportingSignals`, looks up their `signal_family` + `freshnessWindowDays`, and returns which families to hunt and how fresh. This is the generalization: **the vendor's mappings declare what to source.** For the seed ops vendor it yields `{ families: [money, expansion, hiring], fundedSinceDays: 365 }`.

### 6.4 Campaign orchestrator (`src/lib/campaigns/run.ts`)
`runCampaign(db, { campaignId })` — the I/O-free-core-style spine (one function, thin callers), executing:
1. Load campaign + vendor + approved mappings; set status `running`, `startedAt`.
2. `buildSourcingPlan(...)` → `CompanyQuery`.
3. `adapter.fetch(query)` → `CompanyRecord[]`.
4. For each record: run the money/expansion/hiring detectors → `DetectedObservation[]`; `resolveCompany(db, name)` (find-or-create; also populate `companies.profile`/`description` from the record — currently unused); upsert `signal_observations` (idempotent). Enrich `companies` with real profile data.
5. `generateLeads(db)` scoped to this vendor → leads (existing function; already idempotent + scoped by `vendorType`).
6. Record `campaign_leads` rows (new vs updated) + set `leads.sourceCampaignId` for new leads.
7. **Write `company_snapshots`** — one snapshot row per company this run (v2-readiness, §16.1; write-only in v1).
8. **`enrichLeads(topN)`** — a **no-op in v1** (the seam v2 fills with contacts + brief per top-N, §16.3).
9. Compute `stats`, set status `done`, `finishedAt`. On any thrown error: status `failed`, `error` set, partial results preserved (persist wrapped so a late failure never discards delivered leads — crust-data's rule).

### 6.5 Server actions & routes
- `src/app/(app)/campaigns/actions.ts`: `startCampaign(vendorId, { geography, target })` — validates (zod), inserts a `campaigns` row (`running`), `await`s `runCampaign(db, { campaignId })` to completion (bounded by the 25-row cap; see §4.5), returns the finished `campaignId`. `getCampaign`, `listCampaigns` for the views.
- `src/app/(app)/vendors/[vendorId]/` gains a "Find Leads" control that calls `startCampaign` then routes to the campaign detail page (which now shows a completed run).
- `src/app/(app)/campaigns/page.tsx` (list) + `campaigns/[campaignId]/page.tsx` (detail: config, status/stats, and the leads it surfaced).
- Rail: add **Campaigns** under "Operate".

## 7. Data flow (end-to-end)
```
Operator on /vendors/acme → "Find Leads" (geography=India, target=20)
  → startCampaign()  inserts campaigns row (queued), starts orchestrator
    → buildSourcingPlan(vendor, approvedMappings)  → CompanyQuery
    → CompanySourceAdapter.fetch(query)            → CompanyRecord[]  (Crustdata /company/search)
    → per record: detect(money/expansion/hiring) → resolveCompany → upsert signal_observations
    → generateLeads(db)                            → scored leads (vendor × company × mapping)
    → campaign_leads + leads.sourceCampaignId; stats; status=done
  → UI polls campaigns/[id] → shows status + surfaced leads → click through to existing lead detail (brief/contacts stay as-is)
```

## 8. Seed config only — no vendor, no company (`src/db/seed-ops-signals.ts`, npm `db:seed:ops-signals`)
Idempotent seed inserting **config rows only** (extends radar's existing `seed-signals`/`seed-mappings`); it creates **no `vendor_profiles`, no `companies`, no `signal_observations`**. The operator onboards vendor #1 themselves (via the SIA interview) and the first live campaign pulls the real companies.
- **signal_definitions**: `SIG-MONEY-FUNDING-RECENT`, `SIG-EXP-HEADCOUNT-GROWTH` (both `status: approved`), reuse existing `SIG-HIRING-OPS-SURGE`, optional counter `SIG-HIRING-OPS-INHOUSE` (`polarity: counter`).
- **mappings**: "Ops expansion — pursue" `servesVendorType: "Infra"`, `requiredSignals: [SIG-MONEY-FUNDING-RECENT, SIG-HIRING-OPS-SURGE]`, `supportingSignals: [SIG-EXP-HEADCOUNT-GROWTH]`, `disqualifiers: [SIG-HIRING-OPS-INHOUSE]`, `status: approved`.
- **Result:** the moment the operator creates a vendor whose `vendorType` is `Infra`, this approved mapping applies and a campaign is runnable — pulling real companies from Crustdata, no fixtures in the operator's path.

## 9. Grounding & credit-safety (ported principles)
- **Evidence non-empty**: every detected observation carries proof (round/amount/date, growth figure, job title + url) — the existing detector contract.
- **Missing = null, not zero**: `CompanyRecord` numeric fields nullable; a company with no funding data is *insufficient*, not *zero funding*. Enables honest "insufficient data."
- **Credit discipline**: `MAX_LIMIT` cap + row-count metering + free-on-failure; `stats.creditsSpent` surfaced per campaign. (Enrichment funnel — expensive per-top-N `/person/search` — is deferred to v2 by design.)
- **Deterministic scoring**: `generateLeads` + `scoreMapping` already compute scores in code; no LLM in the campaign path. Reverse-brief generation (LLM prose over grounded facts) stays the existing, separate, grounded step.

## 10. Error handling
- Adapter `fetch` failure → campaign `failed`, `error` set, zero partial writes (fetch is first).
- Per-record detect/resolve failure → skip that record, continue (one bad company never sinks the run), counted in stats.
- `generateLeads`/persist failure after observations written → campaign `failed` but observations are preserved (idempotent; a re-run reuses them).
- Missing `CRUSTDATA_API_KEY` in Phase B → adapter construction throws a clear config error; campaign `failed` with an actionable message; fixture adapter remains available.

## 11. Testing strategy (TDD, tests colocated `foo.test.ts`)
- **Pure detectors** (`detectFundingSignals`, `detectHeadcountSignals`): unit tests — fires on/above threshold, null-safe on missing data, evidence non-empty, only-approved-signals, counter-signal classification (operator vs engineer).
- **`buildSourcingPlan`**: maps mappings → families/window correctly; empty/no-approved-mapping → empty plan (no fetch).
- **`CrustdataClient`**: mocked fetch — row cap clamp, metering math, free-on-failure, Token fallback, retry.
- **`createCrustdataCompanyAdapter`**: mocked client — response → `CompanyRecord` field mapping, nulls preserved.
- **`runCampaign`**: in-memory/test DB — end-to-end fixture adapter → observations → leads → `campaign_leads`/stats; idempotent re-run; failure path sets `failed` without dropping prior writes.
- **Server actions**: zod validation, unauthorized rejected, status transitions.
- No API key needed for any test (fixtures + mocks), per radar convention.

## 12. Build order (phasing)
- **Phase A — campaign flow, proven by tests (fixtures are test-only scaffolding).** `campaigns` schema + migration; seed ops **config** (signals + mapping, no vendor/company); funding/headcount detectors; `CompanySourceAdapter` + a **fixture adapter used only by automated tests** (fast, no credits); `buildSourcingPlan`; `runCampaign`; server actions; vendor "Find Leads" button + readiness gate; Campaigns list + detail; light dashboard strip. Verdict: the full flow is green in tests end-to-end without a key. *(The operator's own runs go straight to live — see Phase B — since they want to test with real data, not fixtures.)*
- **Phase B — live Crustdata (the operator's real first run).** `CrustdataClient` (metered) + `CRUSTDATA_API_KEY` (operator-provided); `createCrustdataCompanyAdapter` (`/company/search` + `/data_lab/job_listings`); the campaign uses it as the default `source`; `stats.creditsSpent` shown. Verdict: operator onboards a vendor, clicks Find Leads, and real live companies flow in.
- **Phase C — intelligence (IMMEDIATE follow-up, separate specs — starts right after v1).** Enrichment funnel (contacts + brief per top-N); fingerprint memory (New/Updated/Suppressed) + recheck; scheduling; SSE streaming. The operator intends to build this directly after v1, so v1 must be designed V2-ready per §16 (capture snapshots, leave enrichment/scheduling seams) to avoid rework and migrations.

## 13. Open questions / assumptions
Resolved with the operator (2026-07-06):
1. ~~Crustdata key~~ — **RESOLVED:** operator will provide `CRUSTDATA_API_KEY`; Phase B unblocked.
2. ~~Campaign inputs~~ — **RESOLVED:** minimal by default **and** a rich "Advanced" panel; both ship in v1 (§4.2).
3. ~~Seed vendor identity~~ — **RESOLVED (direction):** a real ops-infra company; exact company TBD, confirm at implementation (§4.4).
4. ~~Enrichment in v1~~ — **RESOLVED:** deferred to v2; v1 campaigns create leads that flow through the existing contact/brief steps.

Also resolved (2026-07-06, second round):
5. ~~Geography default~~ — **RESOLVED:** India-first (`IND`); more geographies later.
6. ~~Dashboard scope~~ — **RESOLVED:** light "recent campaigns + new leads" strip in v1; fuller command-center later.
7. ~~Seed company~~ — **RESOLVED:** no seed vendor/company; seed config only; operator onboards vendor #1 and the first live campaign pulls real companies (§4.4, §8).

Fully resolved — no open questions blocking the implementation plan.

## 14. Integration seams referenced (real files)
- `src/lib/sourcing/schema.ts` (`SourceAdapter`, `detectTenderSignals`, `resolveCompany` contract) — pattern to mirror for companies.
- `src/lib/sourcing/data.ts` (`ingestTenderObservations`, `resolveCompany`) — orchestration pattern; `companies.profile`/`description` enrichment target.
- `src/lib/sourcing/leads.ts` (`generateLeads`) — reused as-is for matching/scoring.
- `src/lib/sourcing/jobs-schema.ts` (`detectHiringSignals`, `SIG-HIRING-OPS-SURGE`) — reused for the hiring leg.
- `src/db/schema/{enums,leads,signals,mappings,vendors}.ts` — extended additively.
- `src/lib/env.ts` — add `CRUSTDATA_API_KEY` (Phase B).
- crust-data `crustdata.py` + `docs/CRUSTDATA_ENDPOINTS_REFERENCE.md` — ported.

## 15. Approved user journey (operator-approved 2026-07-06)
The end-to-end flow, tags: `[E]` exists · `[N]` new in this build · `[V2]` immediate follow-up.
- **Act 00 · Enter `[E]`** — branded landing → single-operator login → smart-forward to dashboard.
- **Act 01 · Dashboard `[E, light in v1]`** — command center: a light strip of your vendors, recent campaigns, fresh leads. Fuller command-center is v2.
- **Act 02 · Onboard a vendor `[E]`** — add a vendor → SIA interview draws out capabilities / ideal customer / signals → versioned profile + `vendorType` + approved mappings. **`[N]` readiness gate** on the vendor page: "Ready to source" vs "Needs a mapping first" — a campaign never dead-ends.
- **Act 03 · Run a Campaign `[N]` — the new front-door engine.** "Find Leads" → minimal form (geography + target) + optional Advanced (mapping picks, funding/size filters) → `buildSourcingPlan` → fetch real companies (Crustdata) → detect grounded signals (funding/headcount/ops-hiring; ops-engineering disqualifies) → score → leads. Campaign detail shows config + status + stats (companies · observations · leads · credits). Campaigns section = run history.
- **Act 04 · Work the leads `[E]`** — leads list (scored, tagged by campaign) → lead detail (reverse brief · contacts · outreach) → pipeline → contacts book → won → project → commission.
- **Act 05 · Steady state `[V2]`** — re-run/schedule; fingerprint memory (New/Updated/Suppressed) + watch-list recheck surface only what moved.

The through-line: seed **config** makes Act 03→04 runnable as soon as the operator onboards their first Infra vendor (Act 02); the campaign is the missing engine, everything downstream already exists. Visual reference: the approved journey artifact (radar Observatory mission-control theme).

## 16. V2-readiness constraints (V2 is imminent — build v1 so v2 is additive)
The operator will build Phase C directly after v1. To make v2 a body-change, not a rework or a data backfill, v1 MUST:
1. **Capture snapshots now, diff later.** On each run, write a per-company signal snapshot — `{ fundraiseDate, headcountTotal, opsPostings, score, verdict }` — to an append-only `company_snapshots` table (`campaignId`, `companyId`, `snapshot` jsonb, `capturedAt`). v1 only *writes* it; v2's fingerprint memory *reads and diffs* it. Storing `fundraiseDate` **absolute** (not "days ago") is what lets v2 detect a *new round*. This avoids a v2 migration + historical backfill.
2. **Preserve "missing = null, not zero"** end-to-end (already in §9) — v2's diff needs to tell *new data* from *no data*.
3. **Leave an enrichment seam.** `runCampaign` calls an `enrichLeads(topN)` step that is a **no-op in v1**; v2 fills its body (contacts via Crustdata `/person/search` + reverse-brief per top-N). Control flow doesn't change in v2, only the step's body.
4. **Keep the trigger transport-agnostic.** `runCampaign(db, { campaignId })` is callable from a UI server action *and* a scheduled job. v2 scheduling just adds a cron that inserts a `campaigns` row (status `queued` — already reserved in the enum) and calls the same function. No orchestrator rewrite.
5. **Keep the run archive.** `campaign_leads.wasNew` + `leads.sourceCampaignId` already record per-run novelty; v2's "what changed since last run" reads them directly.
6. **Provider abstraction stays.** `CompanySourceAdapter` + the persisted `campaigns.source` flag let v2 add providers/scheduling without touching the orchestrator.
