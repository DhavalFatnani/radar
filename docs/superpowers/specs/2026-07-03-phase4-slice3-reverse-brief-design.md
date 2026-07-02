# Phase 4 Slice 3 — Reverse Brief Generation (Design Spec)

**Date:** 2026-07-03
**Status:** Approved (self-driven per standing "build everything autonomously" directive)
**Phase:** 4 (Sourcing engine + reverse brief) — concern 5 of the sequence
`source → detection → resolution → scoring → **reverse-brief** → contact_block`

## 1. Goal

Turn a scored lead into an operator-facing **reverse brief** — the persuasive, *dated-and-sourced* case for why a vendor should pursue a specific company right now — and persist it to `leads.brief` (jsonb). This is the first LLM generation type after SIA; it reuses the `src/ai/llm/` provider layer wholesale and mirrors the SIA `extract.ts` shape.

The brief is what the Leads hero UI (`mockups/leads.html`) renders. Getting the persisted jsonb shape right now means the Phase 5 Leads UI is drop-in.

## 2. Scope

**In scope:**
- A pure, DB-free brief generator: `src/ai/brief/` (schema + prompts + generate + barrel), mirroring `src/ai/sia/`.
- A server-side data layer: `src/lib/sourcing/brief.ts` — loads un-briefed leads + their company/vendor/contributing-signal context, calls the generator, expands the draft into the persisted brief, writes it back. Injected `db: DB` (type-only import) **and** an injected `generate` function (the testability seam).
- A batch operator runner: `src/db/brief-generate.ts` + `db:brief:generate` npm script, mirroring `src/db/source-leads.ts`. This is the **only** place a live LLM is invoked.
- Unit tests (generator, `@/ai/llm` mocked) + integration tests (data layer, `generate` stubbed).

**Out of scope (later slices):**
- `contact_block` / decision-maker resolution — Phase 4 concern 6, a separate slice.
- Job-board sourcing — floating add-on, later.
- On-demand UI-triggered generation — Phase 5 (pipeline/outreach UI). This slice ships batch generation only.
- Brief *regeneration* / refresh — this slice generates only for leads whose `brief IS NULL`. A `--force` path is future scope (YAGNI).

**No schema change.** The `brief jsonb` column already exists on `leads` (migration from an earlier slice). This slice is code-only — no new migration.

## 3. Architecture

Three layers, following the locked project split (pure schema → server data → runner), each independently testable:

```
src/ai/brief/           PURE, DB-free, client-safe (no @/db, no server-only)
  schema.ts             Zod schemas + types: BriefInput, LeadBriefDraft, LeadBrief
  prompts.ts            buildBriefMessages(input): LlmMessage[]  (+ BRIEF_SYSTEM grounding)
  generate.ts           generateBrief(input): Promise<LlmResult<LeadBriefDraft>>
  index.ts              barrel

src/lib/sourcing/       SERVER, injected DB (type-only import), NO @/ai import
  brief.ts              generateBriefsForLeads(db, generate, now?): Promise<GenerateBriefsResult>

src/db/                 RUNNER, owns connection + the live LLM wiring
  brief-generate.ts     db:brief:generate — wires real generateBrief → generateBriefsForLeads
```

**Dependency boundary (both directions clean):**
- `src/ai/brief/` imports NOTHING from `@/db`, `@/lib/*/data`, or `server-only` — it is pure (imports only `@/ai/llm` types + `zod`). Matches the locked "src/ai/ = no direct DB access" rule.
- `src/lib/sourcing/brief.ts` imports NOTHING from `@/ai/*` at runtime — only `type { BriefInput, LeadBriefDraft, LeadBrief }` from `@/ai/brief/schema` (types erase at runtime) and takes the `generate` function as a **required parameter**. The runner composes ai→data. This keeps the data layer free of the env-eager provider chain and makes the LLM call trivially stubbable in tests.

## 4. The brief shape (the data contract)

Two shapes, because proof integrity is the product's core thesis — dates and sources on the "why now" receipts must be **facts from the DB, never LLM output**.

### 4.1 What the LLM produces — `LeadBriefDraft` (the generateObject schema)

The LLM writes prose + interpretation only. It references signals by id; it never emits dates or sources.

```ts
LeadBriefDraft = {
  why_them: string;                    // the case for this company as a fit
  why_now: Array<{
    signalId: string;                  // MUST be one of the provided observation signalIds
    claim: string;                     // one-line interpretation of what this signal means for the company
  }>;
  what_they_need: string;              // the specific need the vendor can serve
  hook: string;                        // suggested outreach opener — a DRAFT, flagged as such
  why_this_vendor: string;             // why THIS vendor fits (uses vendor capabilities/differentiators)
  objections: Array<{
    objection: string;                 // a likely objection / thing to watch for
    response: string;                  // how the vendor counters it
  }>;
}
```

### 4.2 What we persist — `LeadBrief` (the jsonb the UI reads)

The data layer expands each `why_now` entry's factual receipt fields (`date`, `source`, `evidence`) by joining the LLM's `signalId` back to the authoritative `signal_observations` row it already loaded — pinning receipts to the DB exactly as `extract.ts` pins the vendor name. Entries whose `signalId` is not in the input are dropped (defensive; the LLM can't invent a receipt).

```ts
LeadBrief = {
  why_them: string;
  why_now: Array<{
    signalId: string;
    claim: string;                     // from the LLM
    date: string;                      // ISO — pinned from observation.detectedAt
    source: string;                    // pinned from observation.source
    evidence: string[];                // pinned from observation.evidence
  }>;
  what_they_need: string;
  hook: string;
  why_this_vendor: string;
  objections: Array<{ objection: string; response: string }>;
  disqualifier_check_passed: true;     // always true: a persisted lead fired AND was not disqualified (Slice 2)
  generatedAt: string;                 // ISO provenance stamp (from the injected `now`)
}
```

The mockup's terse prototype keys (`sig`, `o`, `c`) are NOT the production contract — the real React Leads UI (Phase 5) maps this jsonb to the display. Self-documenting keys here; the mapping to the hero layout is trivial (`signalId`→`sig`, `objection`→`o`, `response`→`c`).

## 5. Data flow (`generateBriefsForLeads`)

```
1. Load leads WHERE brief IS NULL, LIMIT BRIEF_LEAD_LIMIT (200).            [bounded]
2. Batch-load, over the distinct ids in that lead set:
     companies (companyId → {name, description})                            [bounded]
     vendorProfiles (vendorId → {name, vendorType, capabilities,
                                 idealCustomer, differentiators})            [bounded]
     mappings (matchedMappingId → {name, requiredSignals, supportingSignals})[bounded]
     signal_observations ⨝ signal_definitions for the companies             [bounded]
       (companyId, signalId, name, strength, detectedAt, source, evidence, freshnessVerdict)
3. For each lead:
     a. contributing obs = company's obs WHERE signalId ∈ (required ∪ supporting).
     b. if contributing obs is empty → skip (count skippedNoSignals) — cannot ground a "why now".
     c. shape BriefInput { company, vendor, intent, mappingName, score, signals[] }.
     d. draft = await generate(input)         (throws → count failures, continue).
     e. expand draft → LeadBrief: pin why_now receipts from contributing obs by signalId,
        drop entries whose signalId ∉ contributing, set disqualifier_check_passed=true,
        stamp generatedAt = now.toISOString().
     f. UPDATE leads SET brief = <LeadBrief> WHERE lead_id = <id>.          [never touches
                                                                             pipeline_stage/score/intent]
     g. count briefsGenerated.
4. return { leadsScanned, briefsGenerated, skippedNoSignals, failures }.
```

`intent` for the brief comes from `lead.intent` (already the mapping's intent from Slice 2). Vendor/mapping/company are looked up from pre-built Maps (no N+1 selects inside the loop; one bounded query per table). The only per-lead write is one UPDATE.

### Result type

```ts
GenerateBriefsResult = {
  leadsScanned: number;        // leads with brief IS NULL considered this run
  briefsGenerated: number;     // briefs written
  skippedNoSignals: number;    // leads with no contributing observation → cannot ground
  failures: number;            // generate() threw; lead left un-briefed, batch continues
};
```

## 6. Groundedness (the prompt contract)

`BRIEF_SYSTEM` mirrors SIA's `EXTRACTION_SYSTEM` discipline — the platform's whole value is *defensible, sourced* claims, so hallucinated facts are fatal:

- Use ONLY the facts in the provided input (company, vendor, signals). Do NOT invent capabilities, geographies, clients, dates, or events.
- `why_now`: for each provided signal observation that matters, write a one-line `claim` of what it means for this company, and reference it by its exact `signalId`. Do not reference a signalId that was not provided. Do not state dates or sources in the claim — those are attached from the record.
- `hook` is a **suggested draft** the operator will edit — keep it short, specific, non-cringe; no invented familiarity.
- `why_this_vendor` must draw on the vendor's stated capabilities/differentiators, not generic praise.
- `objections`: realistic, specific to this pairing; each paired with a grounded response.

The generator is otherwise a thin `buildBriefMessages(input)` → `generateObject(leadBriefDraftSchema, messages)` → return `LlmResult<LeadBriefDraft>`, matching `extractProfile`.

## 7. Testing

**Unit — `tests/unit/ai/brief-generate.test.ts`** (mocks `@/ai/llm` via `vi.hoisted` + `vi.mock`, exactly like `sia-interview.test.ts`):
- `buildBriefMessages` emits a system message containing the grounding rules and a user message carrying the input as JSON; signals appear in the context.
- `generateBrief` calls `generateObject` with `leadBriefDraftSchema` and returns the mocked `{ value, provider }`.
- The schema validates a well-formed draft and rejects a malformed one (e.g. `why_now` entry missing `signalId`).

**Integration — `tests/integration/sourcing-brief.test.ts`** (real test DB via `helpers/db`; `generate` **stubbed** — no LLM, no keys):
- Happy path: seed a company + typed vendor + approved mapping + observations + a null-brief lead; run with a stub `generate` returning a fixed draft; assert `leads.brief` is written, `why_now` receipts are **pinned from the observations** (dates/sources match the DB, not the stub's echo), `disqualifier_check_passed === true`, `generatedAt` set. Result `briefsGenerated === 1`.
- Idempotent re-run: second run scans 0 (brief no longer null) → `briefsGenerated === 0`.
- Skip-no-signals: a null-brief lead whose company has no observation in the mapping's required∪supporting sets → `skippedNoSignals === 1`, brief stays null.
- Failure isolation: a stub `generate` that throws for one lead → that lead counted in `failures`, brief stays null, the batch still processes the others.
- Receipt integrity: a stub draft that references a `signalId` NOT among the contributing observations → that `why_now` entry is dropped (never persisted with a fabricated receipt).

**Green gate:** full `npm test` before merge (re-run 2–3× on transient Neon flakiness per the known-flakiness memory). Typecheck `npx tsc --noEmit`.

## 8. Operator runner + end-to-end

`src/db/brief-generate.ts` mirrors `source-leads.ts` line-for-line: exports `runBriefGeneration(db)` that composes the real `generateBrief` into `generateBriefsForLeads(db, generateBrief)`; a direct-run guard (`process.argv[1].endsWith("brief-generate.ts")`) opens its own `postgres` (`prepare:false, max:1`) + drizzle, logs the result JSON (sanctioned operator interface), `client.end()`, exit 0/1. `package.json` gains `"db:brief:generate": "tsx src/db/brief-generate.ts"`.

End-to-end proof (Task 3): run `db:source:leads` then `db:brief:generate`. If a provider key is configured in the dev env, capture a real generated brief and confirm the receipts are dated/sourced from the DB. If no key is configured, the runner surfaces the sanitized `AllProvidersFailedError` — which still proves the wiring end-to-end; note the key requirement in the report. The *correctness* of brief assembly is proven by the integration test (stubbed generate), independent of any live key.

## 9. Risks / decisions locked

- **Draft-vs-persisted split (two types):** deliberate, not gold-plating — it's the groundedness boundary that guarantees `why_now` dates/sources are real. Cheap to maintain; central to the product thesis.
- **Injected `generate` (required param, no default):** keeps `src/lib/sourcing/brief.ts` free of any `@/ai` runtime import and makes the LLM call stubbable without touching env/providers. The runner owns composition.
- **`brief IS NULL` filter:** cheap idempotent re-runs; refresh/regeneration deferred.
- **`disqualifier_check_passed` is a constant `true`:** a lead only exists because Slice 2's scoring fired it and found no disqualifier — re-deriving would duplicate scoring logic. The badge is honest by construction.
- **Batch cap 200:** briefs are paid LLM calls; bound the batch. Larger backfills are repeated runs.
