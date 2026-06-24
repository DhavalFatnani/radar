# Lead Intelligence & Matchmaking Platform
## Phase 0 Specification

**Status:** Phase 0 (design locked, pre-build)
**Audience:** Dual purpose. Written to be read by the operator to confirm the design is right, and precise enough for Claude Code / Cursor to build from.
**Scope of this document:** The complete design of every major piece of the platform, every decision and toggle locked so far, the seed signal library and mappings, the data models, the build sequence, and the known constraints.

---

## How to read this document

If you are the operator, read sections 1 to 3 and 8 to understand what we are building and every decision made. Sections 4 to 7 are the precise detail.

If you are a build tool, sections 4 (data models), 5 (seed library), 6 (seed mappings), and 10 to 11 (stack and build sequence) are the technical core. Sections 1 to 3 give the intent that everything else serves.

Three principles run through the entire system and are not negotiable:

1. **Dated, sourced proof on every claim.** The system never asserts something about a company without showing the evidence and when it happened. A claim a user cannot trace and date is not allowed.
2. **The approval gate.** Every signal and every mapping enters as `proposed` and only goes live when the operator approves it. The system is operator-governed, not autonomous.
3. **Quality over volume.** Revenue comes from vendors winning projects, not from lead counts. Every part of the engine is tuned to produce leads a vendor can actually win, not the largest possible list.

---

## 1. What we are building

### 1.1 The essence

A proprietary signal-intelligence and matchmaking engine that converts deep vendor-capability profiles into trigger-qualified, pitch-ready opportunities, with the operator positioned as the indispensable channel earning commission on every match, in any direction (business to vendor, and vendor to business).

This is not a lead-list tool. The differentiator is the intelligence layer: a living library of buying-intent signals, mapped per vendor, that no generic tool provides.

### 1.2 The operating model

- **Closed loop, single operator.** There is one user: the operator. No multi-tenancy, no public sign-up, no subscriptions.
- **Vendors are the clients.** The operator's network of vendors (manufacturing, infrastructure, marketing, and many more) are who the platform serves. The operator finds them quality leads; they win projects; the operator earns commission.
- **Commission is the revenue.** Not subscriptions. The operator is in the loop on each match.
- **India-first, global in view.** The primary market is India (tenders, funding signals, crore-scale and smaller projects). Global opportunities remain always in view, especially export-driven matchmaking for vendors who can deliver at tender scale and only need supply-chain or export support, which is itself a future commission opportunity for the operator.

### 1.3 Out of scope (deliberately parked)

To keep focus, the following are explicitly NOT being built now: multi-tenancy, subscription or billing systems, public self-serve onboarding, heavy CRM features, free-vs-paid sourcing tiers. The platform is an internal operator tool that may be productized later.

---

## 2. Core concepts (glossary)

- **Signal:** A precisely observable fact about a company (or individual) that, alone or combined, indicates buying intent. A signal is only real if it is precisely observable: it must have a source and an exact trigger rule that returns a yes or no.
- **Signal definition:** The reusable template for a signal (the recipe).
- **Signal observation:** A specific instance where a real company exhibited a signal, with dated evidence (the dish made from the recipe).
- **Mapping:** An approved rule that combines signals into a buying intent for a specific vendor or vendor type. Defines which signals are required, which are supporting, the threshold to fire, timing, strength, and disqualifiers.
- **Vendor profile:** The structured output of the intake interview: capabilities, constraints, ideal customer, differentiators. Living and versioned.
- **Signal recipe:** The set of signals and mappings that apply to a specific vendor, derived from their profile.
- **Lead:** A company matched to a vendor, carrying a reverse brief and a contact block.
- **Reverse brief:** The pitch-ready packaging of a lead: why them, why now (with proof), what they need, suggested hook, why this vendor, what to watch for.
- **Contact block:** The decision-makers on a lead, their contact paths (with confidence and source), and warm-path status.
- **Catalogue (graph):** The whole vendor network represented as connected nodes (vendors, capabilities, geographies, sizes), enabling cross-network matchmaking and bundling.
- **Contact book:** The compounding, categorized store of every contact the platform ever finds.
- **Holding pool:** Where good leads that no current vendor can fulfill are captured, for future reverse vendor-sourcing (stubbed now).

---

## 3. System architecture overview

The platform is one connected loop. The flow:

1. **Vendor intake interview (SIA)** — the front door. The operator guides; SIA probes for precision. Produces the vendor profile.
2. **Catalogue + signal recipe** — the profile populates the catalogue graph and generates the vendor's signal recipe (which signals and mappings apply).
3. **Lead sourcing engine** — the heart. Finds companies exhibiting signals, scores intent against mappings, identifies decision-makers.
4. **Pitch-ready lead** — the output. Reverse brief with dated proof, suggested hook, contact block, warm-path check.
5. **Pipeline + commission tracking** — the loop that earns and learns. Tracks each lead from sourced to paid; supports both outreach modes; handles one-time and recurring commission with leak defenses.
6. **Feedback loop** — outcomes from tracking flow back up to sharpen the signal library over time.

Two side stores collect value continuously:
- **Contact book** — every contact found on any lead flows here, categorized and owned.
- **Holding pool** — good leads no current vendor fits are captured here.

---

## 4. Data models

These are the precise schemas. Field types are indicative; the build tool should refine to the chosen stack. All `_id` fields are stable unique identifiers.

### 4.1 Signal definition

The locked model, organized in five attribute groups. Every field carries a plain-language meaning so the model is self-documenting.

**Identity and meaning**
- `signal_id` (string, e.g. `SIG-HIRING-OPS-SURGE`)
- `name` (string)
- `family` (enum: `hiring`, `procurement`, `money`, `expansion`, `leadership`, `digital`)
- `description` (text, plain language)

**Detection (how the engine finds it and proves it)**
- `sources` (array of strings — where we look)
- `detection_method` (enum: `structured_query`, `api_field`, `keyword_match`, `ai_classification`, or combination)
- `trigger_rule` (text — the precise observable rule)
- `parameters` (object — flexible, e.g. `{ threshold: 5, window_days: 60 }`)
- `proof_captured` (text — what evidence we store when it fires)
- `confirmation_rule` (text — how many independent sources or sightings before treated as real)
- `recheck_cadence` (enum: `weekly`, `monthly`, `quarterly`, etc.)

**Weighting and quality**
- `strength` (enum: `low`, `medium`, `high`, `very_high`)
- `false_positive_risk` (enum: `low`, `medium`, `high`)
- `freshness_window_days` (integer — how long it stays meaningful before decaying)

**Meaning and combination**
- `polarity` (enum: `positive`, `negative`, `contextual`)
- `entity_type` (enum: `business`, `individual`, `both`)
- `pairs_with` (array of `signal_id` — amplifying signals)
- `geography` (array or text — where it is meaningful and sourceable, e.g. `india`, `global`)

**History and track record**
- `status` (enum: `proposed`, `approved`, `retired`) — this field IS the approval gate
- `origin` (text — where it came from, e.g. surfaced in a specific vendor interview)
- `proposed_by` (text)
- `date_added` (date)
- `last_reviewed` (date)
- `example` (text — a concrete real-world instance)
- `track_record` (computed — conversion outcomes over time; empty until outcomes accumulate)

### 4.2 Signal observation

Created when a signal definition fires on a real company. Date and source are mandatory (enforces the proof principle).

- `observation_id` (string)
- `signal_id` (FK to definition)
- `company_id` (FK)
- `detected_at` (date — MANDATORY)
- `source` (text — MANDATORY)
- `evidence` (array — proof links or references, MANDATORY)
- `freshness_verdict` (computed: `recent` or `stale`, against the definition's `freshness_window_days`)
- `entity_match_confidence` (number — how confident this is the correct, single company)

### 4.3 Mapping

- `mapping_id` (string)
- `name` (string)
- `intent_description` (text — the buying intent in plain language)
- `serves_vendor_type` (FK or text — which vendor or vendor type this serves)
- `required_signals` (array of `signal_id` — at least one must be present to fire)
- `supporting_signals` (array of `signal_id` — each present one raises the score)
- `threshold_rule` (text — the minimum combination to fire, e.g. "at least one required signal")
- `timing_window_days` (integer — how close in time signals must cluster; may include a tighter bonus window)
- `strength_logic` (text — how the lead score is computed from the contributing signals, weighted by strength and recency)
- `disqualifiers` (array — signals or conditions that veto a match even when the positive cluster is present)
- `status` (enum: `proposed`, `approved`, `retired`)
- `origin` (text)
- `track_record` (computed)

### 4.4 Vendor profile

Living and versioned. Re-interviews append and amend.

- `vendor_id` (string)
- `name` (string)
- `capabilities` (array — granular capabilities and sub-capabilities)
- `constraints` (object):
  - `max_project_size`
  - `min_project_size`
  - `geographies_served` (array)
  - `capacity` / `current_load`
  - `working_capital_limit`
  - `lead_times`
- `ideal_customer` (structured or text; if the vendor does not know, SIA helps define it)
- `known_good_signals` (text — the vendor's own experience of what their best leads look like; a growth source for the signal library)
- `differentiators` (text — feeds the brief and hook)
- `credibility` (case studies, proof points)
- `signal_recipe` (computed — which mappings and signals apply to this vendor)
- `version` (integer or semantic)
- `interview_history` (array — each interview or re-interview, with date and what changed)

### 4.5 Lead

- `lead_id` (string)
- `company` (object — name, what they do, profile)
- `vendor_id` (FK — who this lead is for)
- `matched_mapping_id` (FK)
- `intent` (text)
- `score` (number)
- `pipeline_stage` (enum — see 4.7)
- `outreach_mode` (enum: `operator_handles`, `handed_to_vendor`)
- `brief` (object):
  - `why_them` (text)
  - `why_now` (array of contributing signal observations, each with dated, sourced proof)
  - `what_they_need` (text)
  - `hook` (text — flagged as a suggested draft, never final copy)
  - `why_this_vendor` (text)
  - `objections` (array — likely objection and counter)
  - `disqualifier_check` (status — confirms the quality gate ran and passed)
- `contact_block` (object):
  - `decision_makers` (array):
    - `name`, `role`, `why_target`
    - `contact_paths` (array of `{ type, value, confidence, source }`, e.g. LinkedIn, email, phone)
    - `warm_path` (status and detail — whether the operator or vendor has a connection in)
- `created_at` (date)

### 4.6 Catalogue (graph)

A graph, not a list. The connections are the point.

- **Node types:** `vendor`, `capability`, `sub_capability`, `geography`, `project_size_range`
- **Edge types:** `vendor -> capability`, `capability -> sub_capability`, `capability -> geography`, `vendor -> project_size_range`, etc.
- **Core queries the graph must answer:**
  - Given a need, which vendors (alone or combined) satisfy it within the right geography and size?
  - Bundle detection: which single client need spans multiple vendors?
  - Gap detection: which needs recur that no vendor satisfies (feeds the holding pool and reverse vendor-sourcing)?
- **`bundling_mode`** (toggle: `suggest` [default] or `automatic`). In suggest mode the graph flags a bundle and the operator decides; in automatic mode the system assembles bundles itself.

### 4.7 Pipeline and commission

**Pipeline stages** (enum on the lead): `sourced`, `contacted`, `engaged`, `pitched`, `won`, `lost`, `delivered`, `paid`.

**Project / commission record:**
- `project_id` (string)
- `lead_id` (FK)
- `vendor_id` (FK)
- `commission_terms` (object):
  - `type` (enum: `one_time`, `recurring`)
  - `rate_or_amount`
  - `cadence` (for recurring, e.g. monthly, quarterly)
- `commission_due` (computed; for recurring, tracked per cycle over time)
- `recurring_tracking` (active: reminders when a cycle is due, flags for missed payments)

**Leak defenses (features supporting the operator's chosen posture):**
- `disclosure_log` — records which contact details were unlocked to a vendor and when (staged disclosure)
- `introduction_log` — proof the operator originated each introduction (makes commission defensible)
- `dispute_record` — record of disputed or unconfirmed closes (the fallback)

The strongest protection is the operator being the channel: when the operator bills the client and passes the vendor their share, control is full and the platform simply records it. This is the default posture the platform supports first.

### 4.8 Contact book

Compounding, categorized, deduplicated.

- `contact_id` (string)
- `name`, `role`, `company`
- `categories` (object — role, industry, company, geography, relevant_vendor, source)
- `contact_paths` (array of `{ type, value, confidence, source }`)
- `warm_path_status`
- `source_lead_id` (FK — where first found)
- `dedup_key` (ensures the same person is never two entries)

---

## 5. Seed signal library

Seventeen signals across six families, all approved as the seed. The library is living: every vendor interview and re-interview is a chance to add signals, each entering as `proposed` for operator approval. "Strength / noise" reads as strength on its own, then how often it misleads. "Serves": Infra = warehouse-infrastructure vendor, Mktg = offline-marketing vendor, Both = either depending on matched keyword.

### Hiring
| signal_id | name | trigger rule | strength / noise | serves |
|---|---|---|---|---|
| SIG-HIRING-OPS-SURGE | Operations hiring surge | >= 5 open warehouse/operations/logistics/fulfilment roles, one company, rolling 60 days | High / Med | Infra |
| SIG-HIRING-NEW-CITY | New-city hiring | A company posts roles in a city where it has no current presence | High / Med | Both |
| SIG-HIRING-SENIOR-OPS | Senior ops leader sought | A posting for Head/VP/Director of Supply Chain, Operations, or Logistics | Med / Low | Infra |
| SIG-HIRING-FIELD-MKTG | Field-marketing hiring surge | A surge in promoter / field-marketing / store-launch roles across locations | Med / Med | Mktg |

### Procurement and tender
| signal_id | name | trigger rule | strength / noise | serves |
|---|---|---|---|---|
| SIG-TENDER-LIVE | Live relevant tender | An open government or PSU tender matching vendor keywords (racking, CCTV, IT hardware, signage, printing) | Very High / Low | Both |
| SIG-TENDER-RECURRING | Recurring tender cycle | A body that issued a similar tender in a prior year, window approaching | Med / Low | Both |
| SIG-TENDER-AMENDED | Tender extended or amended | An existing relevant tender gets a corrigendum or deadline extension | High / Low | Both |

### Money and funding
Note: funding alone is weak. It signals capacity to spend, not intent. Its power is as a multiplier in mappings, not as a standalone trigger.

| signal_id | name | trigger rule | strength / noise | serves |
|---|---|---|---|---|
| SIG-MONEY-FUNDING | Funding round raised | A company announces a seed, Series A, or later round | Med / Med | Infra |
| SIG-MONEY-ALLOCATION | Sector or region allocation | A PLI scheme, state budget, or subsidy directed at a relevant sector | Low / Med | Infra |

### Expansion and physical footprint
| signal_id | name | trigger rule | strength / noise | serves |
|---|---|---|---|---|
| SIG-EXP-NEW-FACILITY | New facility announced | News of a new warehouse, dark store, distribution centre, or plant | Very High / Low | Infra |
| SIG-EXP-NEW-GST | New place of business registered | A new GST registration or address for an existing company | High / Med | Infra |
| SIG-EXP-LARGE-LEASE | Large commercial lease | A sizeable warehouse or retail lease reported | High / Med | Infra |
| SIG-EXP-NEW-STORE | New store or outlet opening | An announcement of a new branch or store opening | High / Low | Mktg |

### Leadership and organizational change
| signal_id | name | trigger rule | strength / noise | serves |
|---|---|---|---|---|
| SIG-LEAD-NEW-OPS | New ops decision-maker | An actual appointment (not a posting) of a CXO/VP in operations or supply chain | Med / Low | Infra |
| SIG-LEAD-NEW-MKTG | New marketing head | An appointment of a CMO or marketing director | Med / Med | Mktg |

### Digital and market activity
| signal_id | name | trigger rule | strength / noise | serves |
|---|---|---|---|---|
| SIG-DIG-NEW-LAUNCH | New product or market launch | A company announces a new category, product line, or market | Med / Med | Both |
| SIG-DIG-CAMPAIGN-PUSH | New offline campaign push | Evidence of a new go-to-market or outdoor push | Med / High | Mktg |

---

## 6. Seed mappings

Two mappings, one per current vendor, both approved. They demonstrate the method: sort signals into required vs supporting, set the floor, make recency count, add disqualifiers to protect quality, attach the receipts.

### 6.1 Warehouse expansion (serves Infra vendor)

- **Intent:** Company is expanding physical warehouse or fulfilment capacity.
- **Required (at least one):** `SIG-EXP-NEW-FACILITY`, `SIG-EXP-NEW-GST`, `SIG-EXP-LARGE-LEASE`, `SIG-TENDER-LIVE`. These indicate building, not just growing. Without one, there is no lead.
- **Supporting (each raises score):** `SIG-HIRING-OPS-SURGE`, `SIG-HIRING-NEW-CITY`, `SIG-MONEY-FUNDING`, `SIG-LEAD-NEW-OPS`.
- **Threshold:** At least one required signal. Supporting signals are optional and act as the score multiplier.
- **Timing:** Signals within the last ~180 days, with extra weight when required and supporting signals fall within the same ~90 days.
- **Strength logic:** One required signal = moderate lead. Each fresh supporting signal lifts it. Required + two or more fresh supporting signals inside 90 days = top-tier lead.
- **Disqualifiers:** Distress signals (announced layoffs, facility shutdown) veto the match. Existing client or recently pitched is suppressed.

### 6.2 Offline marketing push (serves Mktg vendor)

- **Intent:** Company is about to run a physical, on-the-ground marketing push (posters, outdoor, store-launch promotion).
- **Required (at least one):** `SIG-EXP-NEW-STORE`, `SIG-HIRING-NEW-CITY`, `SIG-TENDER-LIVE` (signage/printing/outdoor), `SIG-DIG-NEW-LAUNCH`. These are about launching or entering, which creates the need to advertise physically.
- **Supporting (each raises score):** `SIG-HIRING-FIELD-MKTG`, `SIG-LEAD-NEW-MKTG`, `SIG-DIG-CAMPAIGN-PUSH`, `SIG-MONEY-FUNDING`.
- **Threshold:** At least one required signal.
- **Timing:** Same as 6.1 (~180 days, ~90 day bonus window).
- **Strength logic:** Same shape as 6.1.
- **Disqualifiers:** Distress signals, or existing client / recently pitched.

The key contrast: warehouse-expansion required signals are about *building* (leases, facilities); offline-marketing required signals are about *launching or entering* (new store, new city, new product). Same engine, tuned to what each vendor sells.

---

## 7. Modules in detail

### 7.1 Vendor intake interview (SIA)

The front door. Everything downstream depends on a rich vendor profile, so this step sets the ceiling on lead quality for that vendor.

- **Operator-co-piloted.** The operator sits with the vendor while SIA interviews. The operator guides the vendor toward depth, because vendors describe themselves vaguely by default.
- **Adaptive, not a fixed form.** SIA opens broad, then drills based on answers, pulling the vendor from vague ("we do warehouse setups") to precise ("racking up to X tonnes, CCTV, networking, electricals, facilities 10k–100k sq ft, Maharashtra, can float materials up to a stated limit").
- **Probes for precision.** When a vendor says "we serve all of India," SIA politely probes ("all of India, including installation, or only supply in some regions?"). The operator softens it. Precision is the goal because vague answers produce bad leads.
- **Collects across:** what they actually do (granular capabilities), what they cannot or will not do (constraints), who their ideal customer is (and helps them define it if they do not know), what a good lead means to them specifically (their own experienced buying signals), and proof / differentiators.
- **Growth engine for the library.** SIA actively listens for "when a company does X, that is when they need us" moments and flags them as candidate new signals or mappings for operator approval.
- **Re-interviews (future scope, designed in now).** SIA can re-interview any time, append and amend rather than start over, opening with knowledge of the existing profile and asking only what is new or changed. Every change is versioned.

### 7.2 Lead sourcing engine

The heart, and the hardest part to build.

- Takes a vendor's signal recipe, searches the configured sources, detects signal observations, and scores companies against the vendor's mappings.
- **Decision-maker identification is an explicit job**, not just a field. The engine identifies the role and person who owns the buying decision (often surfaced directly by leadership and senior-hiring signals), then finds contact paths.
- Every observation captures dated, sourced evidence and an entity-match confidence.
- Produces scored leads that meet a mapping's threshold and pass its disqualifiers.

### 7.3 Reverse brief

Turns a match into a pitch-ready lead, because revenue depends on the vendor winning. For each lead it auto-generates: why them, why now (with dated proof for every contributing signal), what they need, the hook (a suggested draft, clearly labeled, never final copy), why this vendor (their differentiators for this case), and what to watch for (likely objections and counters, plus disqualifier-check status). The contact block sits alongside the brief as its own section.

### 7.4 Contact book

Every contact the engine ever finds flows into a single, growing, operator-owned store, categorized by role, industry, company, geography, relevant vendor, and source, with warm-path status. Deduplicated so the same person is never two entries. A compounding asset: a contact found for one lead today is owned for any future need.

### 7.5 Catalogue as graph

The vendor network as a matchmaking surface (see 4.6). Connects capabilities, geographies, vendors, and sizes so one client need can be matched across the whole network at once. Unlocks bundling (multi-vendor commission on one client), gap detection (which vendors to recruit next), and capacity-and-fit filtering. Bundling is a toggle defaulting to suggest.

### 7.6 Pipeline, outreach, and commission

Tracks each lead from `sourced` to `paid` (see 4.7). Supports both outreach modes per lead. Commission supports one-time and recurring; recurring is actively tracked with reminders and missed-payment flags. Leak defenses (disclosure log, introduction log, dispute record) support the operator-as-channel posture, with the clean billing flow as default.

### 7.7 Holding pool (stubbed)

Good leads that have genuine business potential but that no current vendor can fulfill (wrong geography, capacity, capital, export gap) are captured here rather than discarded. Future scope: run reverse campaigns to source new vendors (offline and internet) who can fulfill these, making the operator a true bidirectional matchmaker. Captured from day one so nothing is lost; reverse-sourcing built later.

### 7.8 Feedback loop

When a lead is won or lost, the outcome flows back to the signals and mapping that produced it, filling the `track_record` fields. Over months the system learns which signal combinations actually close business for which vendors. This is the compounding moat: it sharpens with use, and nothing off-the-shelf has the operator's closed-loop outcomes. Note: this field reads empty early and pays off in months two and three.

---

## 8. Locked decisions and toggles

| Decision | Locked choice |
|---|---|
| Sourcing approach | Operator's own integrations and authorized access (e.g. Apollo on API plans), plus free sources (Google Maps, AI web search, directories, tenders, job boards). No free-vs-paid tiers for end users; operator funds what gets the best leads. |
| B2B vs B2C | Mostly B2B; B2C readiness baked in from day one via the `entity_type` field. |
| Signal model | Five-group schema, locked. Strength and false-positive-risk kept separate. Freshness is per-signal. |
| Detection strength | Hardened with proof captured, confirmation rule, entity-match confidence, and recheck cadence. |
| Proof principle | Every claim shows dated, sourced proof in plain language; recency always visible (recent vs stale). Date and source mandatory on every observation. |
| Mapping model | Required vs supporting signals, threshold, timing window, strength logic, lifecycle. Disqualifiers included. |
| Hook / pitch copy | Always a suggested draft, never final copy. |
| Bundling | Toggle, defaults to suggest. |
| Commission types | One-time and recurring both supported. |
| Recurring commission | Actively tracked (reminders, missed-payment flags). |
| Holding pool / reverse vendor-sourcing | Stubbed now (captured), fully designed later. |
| Vendor profile | Living and versioned; re-interviews append and amend. |
| Library growth | Seed now, grow continuously from interviews and outcomes. Every addition is operator-approved. |
| Contact book | First-class, categorized, deduplicated, compounding. |
| Warm-path check | Included in the contact layer. |

---

## 9. Sourcing reality and constraints

Honest assessment to guide the build:

- **Cleanest, highest-yield sources, build first:** job platforms (for hiring signals) and government tender portals (for procurement signals). These are public and reliable.
- **Sources to verify access for before relying on them:** GST-registration data (`SIG-EXP-NEW-GST`) and funding-news data (`SIG-MONEY-FUNDING`). Kept in the seed because they are valuable, flagged as "depends on a source to confirm in the build."
- **Integration model:** the operator connects accounts they already pay for (e.g. Apollo on an API-capable plan), so the platform uses the operator's authorized, compliant access. Apollo's API specifically requires their higher-tier plan; cheaper tiers do not support programmatic pulling.
- **LinkedIn:** profiles are usually findable; there is no official API for lead export, so treat as manual-assist for contact discovery, not automated bulk pull.
- **Strongest, most defensible seed signals:** live tender, new-facility announcement, operations hiring surge. **Weakest (treat as supporting evidence, candidates to retire if noisy):** sector/region allocation, new offline campaign push.
- **Compliance:** the closed-loop, single-operator, mostly-B2B model keeps the surface small. Standard care on contact data and sender reputation applies, especially if the operator does first outreach.

---

## 10. Technology stack and architecture (build leaning)

To be confirmed as the first build decision, but the recommended shape, chosen for performance, AI-buildability, the graph-shaped data, and possible future productization:

- **Frontend:** React / Next.js. Clean, fast, component-driven. Cursor is well-suited to iterating this.
- **Backend:** A clean backend service layer. Claude Code is well-suited to building this and the data layer.
- **Database:** Postgres at the core (relational for signals, mappings, leads, observations, commission). The catalogue's graph queries can be served by Postgres with appropriate modeling or a graph extension; confirm during build.
- **AI orchestration layer:** A dedicated layer for SIA (the interview), the reverse-brief generation, and the AI classification used in detection.
- **Integrations layer:** Pluggable, so new signal sources and the operator's accounts (Apollo, etc.) attach cleanly.

Performance is a first-class requirement. The architecture should keep the operator's day-to-day interactions fast and responsive.

---

## 11. Build sequence

Built in thin vertical slices, each tested against real data before moving on. Nothing stacks on an unfinished foundation.

- **Phase 0 — Foundations (this document).** Spec, data model, stack. No code.
- **Phase 1 — The spine.** Running app shell, database with the real data models, minimal single-operator access, navigable empty UI. Goal: prove the architecture holds. Claude Code enters here.
- **Phase 2 — Vendor intake (SIA) + catalogue.** The interview flow, profile storage, catalogue graph. Produces the first real vendor profiles. Real data enters.
- **Phase 3 — Signal library + mappings.** The signal model, the seed library, the mapping system with the approval gate. Mostly configuration UI.
- **Phase 4 — Sourcing engine + reverse brief.** The heart and the hardest. Wire signals to one or two sources first (tenders, job boards), run matching, generate scored pitch-ready leads. Tested most aggressively. Cursor for UI polish.
- **Phase 5 — Pipeline + outreach + commission.** Lead-to-outcome tracking, both outreach modes, one-time and active recurring commission, holding-pool capture (reverse-sourcing stubbed).
- **Phase 6 — Feedback loop + hardening + polish.** Outcomes sharpen the engine, contact-book dedup and company memory, performance tuning, final UI/UX pass.

**The test gate, applied between every phase:**
1. Acceptance criteria written before building the slice.
2. Tested with real data early, never mock data.
3. Automated tests written alongside the code (unit for logic like scoring, integration for data flows).
4. Definition-of-done gate before the next phase begins.

A Prompt Playbook (structured prompts per slice plus test instructions) keeps every interaction with the coding tools high-signal.

---

## 12. To define next (deliberately deferred)

These are known and parked, to be designed when reached:
- The detailed SIA interview question flows per vendor archetype.
- The Prompt Playbook for the coding tools.
- The UI/UX spec (design language, screens, interaction quality).
- The full reverse vendor-sourcing arc (holding pool campaigns).
- Specific source integrations and their access confirmation (GST, funding data).
- Scoring formula precision (how strength and recency combine into a number).

---

*End of Phase 0 Specification. This document is the locked design baseline. Changes should be versioned from here.*
