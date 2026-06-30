# Phase 2 · Slice 2.2b — SIA Interview Engine — Design Spec

**Status:** Approved by operator 2026-06-30.
**Scope:** Phase 2, Slice 2.2b only — the SIA interview engine. The interview UI that drives it is Slice 2.3 (separate spec).
**Source spec:** `Phase0_Platform_Specification.md` §3 (system loop, step 1), §7.1 (Vendor Intake Interview / SIA), §4.4 (Vendor Profile data model); `AGENTS.md` (`src/ai/` = SIA orchestration, **no direct DB**).
**Builds on:** Slice 2.1 (`vendorProfileSchema`, `getVendor`, `updateVendorProfile` in `src/lib/vendors/data.ts`) and Slice 2.2a (`generateText` / `generateObject(schema)` in `src/ai/llm/`).

## Prerequisite refactor — extract a DB-free schema module

`vendorProfileSchema` and the vendor types currently live in `src/lib/vendors/data.ts`, which imports `@/db/client` at the top — and `db/client.ts` opens the Postgres connection at module load. So importing the schema transitively boots the DB. The SIA engine must import the schema yet stay DB-free (per `AGENTS.md`), and its unit tests must not need a database.

**Fix (Task 1 of the plan):** move the pure pieces — `vendorStubSchema`, `vendorProfileSchema`, the internal zod helpers (`stringList`, `optionalText`, `constraintsSchema`), and the types (`VendorStubInput`, `VendorListItem`, `VendorConstraints`, `InterviewHistoryEntry`, `VendorProfile`, `VendorProfileInput`) — into a new, import-side-effect-free `src/lib/vendors/schema.ts`. `data.ts` imports from `./schema` and **re-exports** all of them, so every existing importer (`actions.ts`, `page.tsx`, the tests, etc.) keeps working with zero changes. The SIA engine and its tests import `vendorProfileSchema` and the types **only** from `@/lib/vendors/schema`, never from `@/lib/vendors/data`.

## Goal

A pure, DB-free engine in `src/ai/sia/` that (1) generates the **next adaptive, precision-probing interview question** given the conversation so far, and (2) **extracts a `vendorProfileSchema`-valid profile** from a completed transcript — built entirely on the Slice 2.2a LLM layer, and unit-tested at $0 by mocking that layer.

The engine embodies the SIA behaviour from §7.1: open broad, drill on vague answers, probe for precision ("all of India, or only supply in some regions?"), and cover the five interview areas. It does **not** own a chat UI, a session store, or any DB write — those belong to higher layers.

## Pivotal decisions (operator chose)

- **Pure stateless engine (Approach A).** `src/ai/sia/` exposes pure functions that take an explicit `InterviewState` (messages + optional existing profile) and return either the next question or an extracted profile. The caller (a server action / service in Slice 2.3) holds the conversation state, loads the vendor via `getVendor`, and persists via `updateVendorProfile`. The engine **never imports a DB module** — this honours the `AGENTS.md` layer rule and makes the engine trivially unit-testable by mocking `@/ai/llm`, exactly like Slice 2.2a's fallback tests. Rejected: injecting `getVendor`/`updateVendorProfile` as dependencies (couples the engine to the persistence contract; YAGNI), and an engine-owned session table (that is interview *session management*, a Slice 2.3 concern).
- **Heuristic coverage tracking, not a per-turn LLM call.** Which of the five areas still need depth is derived from the transcript by a pure, deterministic function (`assessCoverage`) — no extra LLM round-trip per turn. This keeps each turn to a single `generateText` call (cheap, fast, testable without network). Rejected: asking the model to self-assess coverage each turn (more accurate, but one extra call per turn and non-deterministic to test).
- **`knownGoodSignals` is captured as a profile text field only.** §7.1 calls it the "growth engine for the library," but turning those statements into formal, operator-approvable *signal definitions* requires the signal library, which does not exist until Slice 2.4+. Here SIA elicits and extracts `knownGoodSignals` as the `vendorProfileSchema` text field; formal signal-candidate proposals are explicitly deferred.

## The five interview areas (from §7.1)

The engine drives coverage across exactly these areas, each mapped to a `vendorProfileSchema` field group:

| Area | Maps to profile field(s) | Precision goal |
|------|--------------------------|----------------|
| `capabilities` | `capabilities: string[]` | Granular ("racking up to X tonnes, CCTV, networking"), not vague ("warehouse setups") |
| `constraints` | `constraints` (7 sub-fields) | What they cannot/will not do, geographies, project-size bounds, capacity, capital, lead times |
| `idealCustomer` | `idealCustomer` | Who they serve best; help define it if the vendor doesn't know |
| `knownGoodSignals` | `knownGoodSignals` | The vendor's own "when a company does X, that's when they need us" moments |
| `differentiators` | `differentiators` + `credibility` | Proof, case studies, what sets them apart |

## Architecture — `src/ai/sia/`

A pure, DB-free module (per `AGENTS.md`). It exposes three functions plus a small set of types; everything else is internal.

```
src/ai/sia/
├── types.ts        # InterviewArea, InterviewState, CoverageReport, NextQuestion
├── prompts.ts      # SIA system prompt + per-area probe fragments + extraction prompt
├── coverage.ts     # assessCoverage(state): pure, deterministic; no LLM, no DB
├── interview.ts    # nextQuestion(state): builds messages → generateText
├── extract.ts      # extractProfile(state): builds messages → generateObject(vendorProfileSchema)
└── index.ts        # public API: nextQuestion, extractProfile, assessCoverage (+ type re-exports)
```

### Types (`types.ts`)

```ts
export type InterviewArea =
  | "capabilities" | "constraints" | "idealCustomer"
  | "knownGoodSignals" | "differentiators";

// Reuses the LLM layer's message shape; one transcript turn.
export type InterviewState = {
  messages: LlmMessage[];                 // full conversation so far (system msg is added by the engine, not stored here).
                                          // Assistant turns carry an engine-appended [area:X] tag line; user turns are raw answers.
  existingProfile?: VendorProfile | null; // the vendor's CURRENT persisted profile. A vendor always exists before an interview
                                          // (created via createVendorStub), so the caller passes getVendor(vendorId) here — at
                                          // minimum the stub (name set, other fields empty) on a first interview, a fuller profile
                                          // on a re-interview. Supplies the authoritative name and prior-knowledge context.
};

export type CoverageReport = {
  covered: InterviewArea[];               // areas with enough signal in the transcript
  remaining: InterviewArea[];             // areas still thin — drilled next, in this order
  isComplete: boolean;                    // remaining.length === 0
};

export type NextQuestion = {
  question: string;                       // CLEAN question to display to the vendor (tag line stripped)
  transcriptEntry: LlmMessage;            // EXACT assistant turn to append to state.messages (tag retained) — feeds next turn's coverage
  targetArea: InterviewArea;              // which area this question is drilling
  coverage: CoverageReport;               // so the caller can show progress / decide to stop
};
```

`LlmMessage` is imported from `@/ai/llm`; `VendorProfile` and `VendorProfileInput` from `@/lib/vendors/schema` (the DB-free module from the prerequisite refactor) — never from `@/lib/vendors/data`.

## Data flow

**Next question** — `nextQuestion(state): Promise<NextQuestion>`
1. `assessCoverage(state)` inspects the transcript and returns a `CoverageReport`; the first `remaining` area is the `targetArea` (if `remaining` is empty, the target is the last area for a closing/confirmation probe and `coverage.isComplete` is `true`).
2. `prompts.ts` builds an `LlmMessage[]`: the SIA system prompt (personality + precision rules + the existing profile, when present) + a **tag-stripped view of the transcript** (the engine removes its internal `[area:…]` tag lines from assistant turns so the model never sees them) + a final instruction biased to probe `targetArea` for precision. The model is **not** told about tags — it just writes a question.
3. `generateText(messages)` produces the question text.
4. The engine builds the outputs: `question` is the model's text verbatim (for display); `transcriptEntry` is `{ role: "assistant", content: question + "\n[area:" + targetArea + "]" }` — the **engine itself appends** the deterministic tag. Return `{ question, transcriptEntry, targetArea, coverage }`. The caller displays `question`, appends `transcriptEntry` to `state.messages`, then appends the vendor's answer (`{ role: "user", content: … }`) — so the next turn's `assessCoverage` reads the engine-written tags. Because the engine owns the tag, coverage never depends on the model remembering to emit it.

**Extract profile** — `extractProfile(state): Promise<LlmResult<VendorProfileInput>>`
1. `prompts.ts` builds an extraction `LlmMessage[]`: a system prompt instructing structured extraction across the five areas + the tag-stripped transcript + the existing profile (so unchanged fields are preserved rather than blanked, and the known vendor name is given as context).
2. `generateObject(vendorProfileSchema, messages)` returns a zod-validated `VendorProfileInput` plus the `provider` that served it.
3. **Name pinning.** `name` is authoritative from the persisted profile, not the transcript. When `state.existingProfile?.name` is set, the engine overrides the returned `value.name` with it before returning — so a model that mis-reads or invents a name can never cause `updateVendorProfile` to rename the vendor. (With no `existingProfile`, the model-extracted name stands as a fallback.)
4. Return the `LlmResult` (with the pinned name). The caller passes `.value` to `updateVendorProfile(vendorId, value)`, which already handles field-diffing, version bump, and `interviewHistory` append.

**Re-interview** — the caller loads the current profile via `getVendor(vendorId)` and sets `state.existingProfile`. The engine injects it into both system prompts so SIA opens *knowing what's on file* and asks only what's new or changed. Versioning/history is downstream (`updateVendorProfile`), unchanged.

## Coverage heuristic (`coverage.ts`)

`assessCoverage` is pure and deterministic — no LLM, no DB, directly unit-testable.

- **Mechanism — engine-written area tags.** The engine is stateless across turns, so coverage must be re-derivable from the transcript alone. The engine therefore **appends a tag line of the form `[area:capabilities]`** to each assistant turn it produces (in `transcriptEntry`) — see the next-question data flow. `coverage.ts` reads those tags by exact string match (one regex, `/\[area:(\w+)\]\s*$/m`), so "which areas have been asked about" is a deterministic string operation over `state.messages`. Crucially the **engine** writes the tag, not the model — coverage cannot break because a model forgot or reformatted it. The model never sees the tags (they are stripped from the transcript before every LLM call).
- **Substantively addressed.** An area counts as `covered` only when a tagged assistant turn for that area is **immediately followed by a user turn whose trimmed length clears a minimal threshold** (the plan fixes the exact value — e.g. ≥ 15 characters). A tagged question with no answer yet, or a one-word answer, does not count.
- **Tag visibility.** The tag lives only in the stored transcript (`state.messages`). It is never displayed (the UI shows `nextQuestion`'s clean `question`) and never sent to the model (stripped before each LLM call). It exists solely as coverage's deterministic marker.
- **Ordering.** `remaining` is returned in the fixed area order above (capabilities → constraints → idealCustomer → knownGoodSignals → differentiators), so questioning has a stable, sensible progression. `isComplete` is `true` when every area has a tagged-turn + substantive-answer pair.

## Error handling

- The engine does **not** swallow LLM errors. `AllProvidersFailedError` from the LLM layer propagates to the caller, which surfaces a generic operator-facing message (no stack traces, no secrets — already guaranteed by Slice 2.2a's sanitisation).
- Extraction validation failures are handled inside Slice 2.2a (a provider that returns a schema-invalid object is a failure; the chain advances; all-fail → `AllProvidersFailedError`). The engine adds no extra try/catch around this.
- `nextQuestion` on an empty transcript (first turn) returns an opening, broad question targeting `capabilities` — never an error.

## Testing (TDD, unit-level — no API key required)

All tests live in `tests/unit/ai/` and mock `@/ai/llm` (`generateText` / `generateObject`) via `vi.mock` + `vi.hoisted()`, matching Slice 2.2a's pattern. No network, no keys.

- **`coverage.ts` (pure, no mocking):** empty transcript → all areas remaining, `isComplete:false`; a transcript whose assistant turns carry `[area:X]` tags followed by substantive answers → those areas covered, the rest remaining in fixed order; trivial/short user answers do not count as covered; all five covered → `isComplete:true`.
- **`interview.ts` (mock `generateText`):** first turn targets `capabilities` and asks a broad opener; mid-interview targets the first remaining area; the messages passed to the mock contain **no** `[area:…]` tags (history is stripped) yet **do** include the existing profile on a re-interview; the returned `question` equals the mock's text verbatim (no tag) while `transcriptEntry.content` ends with `\n[area:<targetArea>]`; `targetArea` matches coverage's first remaining area.
- **`extract.ts` (mock `generateObject`):** returns the mock's validated `VendorProfileInput` and propagates `provider`; the extraction `messages` include the transcript and the existing profile; **name pinning** — when `existingProfile.name` is set, the returned `value.name` equals it even if the mock returned a different name; with no `existingProfile`, the mock's name stands; an `AllProvidersFailedError` from the mock propagates (not swallowed).
- **`index.ts` (smoke):** the three public functions delegate to the right internal modules with the right arguments.
- **`schema.ts` (prerequisite refactor):** the existing Slice 2.1 vendor tests (`vendors-data`, `vendors-profile-data`) still pass unchanged against the re-exporting `data.ts`; a new unit test imports `vendorProfileSchema` from `@/lib/vendors/schema` and parses a sample object **without** any DB connection (proving the module is DB-free).

## Out of scope (YAGNI / later slices)

The interview UI / operator-co-piloted chat (2.3); persisting interview sessions or transcripts to the DB (2.3 decides storage); turning `knownGoodSignals` into formal, operator-approvable signal-library candidates (needs the signal library, 2.4+); the catalogue graph and computed `signal_recipe` (2.4); streaming responses (add when 2.3's chat needs it); multi-vendor or archetype-specific question flows (§12 defers these); cost/usage accounting. The DB write itself stays in the caller — the engine returns the profile, it does not save it.

## Acceptance criteria

1. `nextQuestion(state)` returns the model's `question` verbatim (for display), a `transcriptEntry` whose content has an engine-appended `\n[area:<targetArea>]` tag, the `targetArea` it drills, and a `CoverageReport`. The model never sees tags (history is stripped before the call).
2. On an empty transcript, `nextQuestion` returns a broad opening question targeting `capabilities` (never an error).
3. `assessCoverage` is pure and deterministic: same transcript → same report; areas whose tagged assistant turn is followed by a substantive answer are `covered`, the rest are `remaining` in fixed area order; all covered → `isComplete:true`.
4. `extractProfile(state)` returns a `vendorProfileSchema`-validated `VendorProfileInput` plus the serving `provider`, suitable to pass straight to `updateVendorProfile`; `name` is pinned from `existingProfile` when present (never taken from a model hallucination).
5. On a re-interview (`existingProfile` populated beyond the stub), both `nextQuestion` and `extractProfile` include the existing profile in the prompt sent to the LLM layer.
6. The engine imports **no** DB module: schema and types come from `@/lib/vendors/schema` (DB-free) and `@/ai/llm`; nothing under `src/ai/sia/` imports `@/db/*` or `@/lib/vendors/data`. All persistence is the caller's job.
7. `AllProvidersFailedError` propagates to the caller; no secrets or stack traces are added by the engine.
8. The whole engine builds and **all tests pass with no API key** (mocked LLM layer), and the prerequisite schema refactor leaves all Slice 2.1 vendor tests green.

## Done gate

All tests green (main's current suite + this slice's new unit tests), `npm run lint` / `typecheck` / `test` / `build` green, README documents the SIA engine module and its public API, per-task commits on `feature/phase2-slice2b-sia-interview-engine`. Surface for operator merge (do not merge unprompted). **No git tag** (mid-Phase-2). Because the operator is providing Anthropic API access, a **manual smoke** — run one short real interview turn and one extraction against the live Anthropic provider — is recommended as the human check; the mock-based unit tests + build are the automated evidence and are sufficient for the gate.
