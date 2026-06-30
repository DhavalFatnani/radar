# Phase 2 · Slice 2.2b — SIA Interview Engine — Design Spec

**Status:** Approved by operator 2026-06-30.
**Scope:** Phase 2, Slice 2.2b only — the SIA interview engine. The interview UI that drives it is Slice 2.3 (separate spec).
**Source spec:** `Phase0_Platform_Specification.md` §3 (system loop, step 1), §7.1 (Vendor Intake Interview / SIA), §4.4 (Vendor Profile data model); `AGENTS.md` (`src/ai/` = SIA orchestration, **no direct DB**).
**Builds on:** Slice 2.1 (`vendorProfileSchema`, `getVendor`, `updateVendorProfile` in `src/lib/vendors/data.ts`) and Slice 2.2a (`generateText` / `generateObject(schema)` in `src/ai/llm/`).

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
  messages: LlmMessage[];                 // full conversation so far (system msg is added by the engine, not stored here)
  existingProfile?: VendorProfile | null; // present on a re-interview; null/undefined on a first interview
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

`LlmMessage` is imported from `@/ai/llm`; `VendorProfile` and `VendorProfileInput` from `@/lib/vendors/data`.

## Data flow

**Next question** — `nextQuestion(state): Promise<NextQuestion>`
1. `assessCoverage(state)` inspects the transcript and returns a `CoverageReport`; the first `remaining` area is the `targetArea` (if `remaining` is empty, the target is the last area for a closing/confirmation probe and `coverage.isComplete` is `true`).
2. `prompts.ts` builds an `LlmMessage[]`: the SIA system prompt (personality + precision rules + the existing profile, if re-interviewing) + the transcript + a final instruction biased to probe `targetArea` for precision.
3. `generateText(messages)` produces the raw question text (ending in an `[area:…]` tag line).
4. Return `{ question, transcriptEntry, targetArea, coverage }`: `question` is the clean string with the tag line stripped (for display); `transcriptEntry` is the **raw** assistant turn (`{ role: "assistant", content: <raw, tag retained> }`). The caller displays `question`, appends `transcriptEntry` to `state.messages`, then appends the vendor's answer (`{ role: "user", content: … }`) — so the next turn's `assessCoverage` can read the tags.

**Extract profile** — `extractProfile(state): Promise<LlmResult<VendorProfileInput>>`
1. `prompts.ts` builds an extraction `LlmMessage[]`: a system prompt instructing structured extraction across the five areas + the full transcript (+ the existing profile for a re-interview, so unchanged fields are preserved rather than blanked).
2. `generateObject(vendorProfileSchema, messages)` returns a zod-validated `VendorProfileInput` plus the `provider` that served it.
3. Return the `LlmResult` unchanged. The caller passes `.value` to `updateVendorProfile(vendorId, value)`, which already handles field-diffing, version bump, and `interviewHistory` append.

**Re-interview** — the caller loads the current profile via `getVendor(vendorId)` and sets `state.existingProfile`. The engine injects it into both system prompts so SIA opens *knowing what's on file* and asks only what's new or changed. Versioning/history is downstream (`updateVendorProfile`), unchanged.

## Coverage heuristic (`coverage.ts`)

`assessCoverage` is pure and deterministic — no LLM, no DB, directly unit-testable.

- **Mechanism — hidden area tags.** The engine is stateless across turns, so coverage must be re-derivable from the transcript alone. The SIA system prompt therefore instructs the model to **end every question with a hidden area tag** on its own final line, of the form `[area:capabilities]`. `coverage.ts` reads those tags from assistant turns by exact string match — no fragile free-text heuristics. This makes "which areas have been asked about" a deterministic string-matching operation over `state.messages`.
- **Substantively addressed.** An area counts as `covered` only when a tagged question for that area is **followed by a user turn whose trimmed length clears a minimal threshold** (a non-trivial answer). A tagged question with no answer yet, or a one-word answer, does not count.
- **Tag stripping.** `nextQuestion` returns the clean `question` (tag line removed) for display **and** the raw `transcriptEntry` (tag retained) for the caller to append to `state.messages`. The tag therefore never reaches the UI but always survives in the stored transcript for the next call's coverage pass.
- **Ordering.** `remaining` is returned in the fixed area order above (capabilities → constraints → idealCustomer → knownGoodSignals → differentiators), so questioning has a stable, sensible progression. `isComplete` is `true` when every area has a tagged-question + substantive-answer pair.

## Error handling

- The engine does **not** swallow LLM errors. `AllProvidersFailedError` from the LLM layer propagates to the caller, which surfaces a generic operator-facing message (no stack traces, no secrets — already guaranteed by Slice 2.2a's sanitisation).
- Extraction validation failures are handled inside Slice 2.2a (a provider that returns a schema-invalid object is a failure; the chain advances; all-fail → `AllProvidersFailedError`). The engine adds no extra try/catch around this.
- `nextQuestion` on an empty transcript (first turn) returns an opening, broad question targeting `capabilities` — never an error.

## Testing (TDD, unit-level — no API key required)

All tests live in `tests/unit/ai/` and mock `@/ai/llm` (`generateText` / `generateObject`) via `vi.mock` + `vi.hoisted()`, matching Slice 2.2a's pattern. No network, no keys.

- **`coverage.ts` (pure, no mocking):** empty transcript → all areas remaining, `isComplete:false`; a transcript with tagged questions + substantive answers for some areas → those covered, the rest remaining in fixed order; trivial/short user answers do not count as covered; all five covered → `isComplete:true`.
- **`interview.ts` (mock `generateText`):** first turn targets `capabilities` and asks a broad opener; mid-interview targets the first remaining area; the built system prompt includes the existing profile on a re-interview (assert the mock received it in `messages`); the returned `question` has the `[area:…]` tag line stripped while `transcriptEntry.content` retains it; `targetArea` matches coverage's first remaining area.
- **`extract.ts` (mock `generateObject`):** returns the mock's validated `VendorProfileInput` and propagates `provider`; the extraction `messages` include the full transcript; on a re-interview the existing profile is included in the prompt; an `AllProvidersFailedError` from the mock propagates (not swallowed).
- **`index.ts` (smoke):** the three public functions delegate to the right internal modules with the right arguments.

## Out of scope (YAGNI / later slices)

The interview UI / operator-co-piloted chat (2.3); persisting interview sessions or transcripts to the DB (2.3 decides storage); turning `knownGoodSignals` into formal, operator-approvable signal-library candidates (needs the signal library, 2.4+); the catalogue graph and computed `signal_recipe` (2.4); streaming responses (add when 2.3's chat needs it); multi-vendor or archetype-specific question flows (§12 defers these); cost/usage accounting. The DB write itself stays in the caller — the engine returns the profile, it does not save it.

## Acceptance criteria

1. `nextQuestion(state)` returns a clean question string (tag line stripped), the raw `transcriptEntry` to append, the `targetArea` it drills, and a `CoverageReport`.
2. On an empty transcript, `nextQuestion` returns a broad opening question targeting `capabilities` (never an error).
3. `assessCoverage` is pure and deterministic: same transcript → same report; areas with a tagged question + substantive answer are `covered`, the rest are `remaining` in fixed area order; all covered → `isComplete:true`.
4. `extractProfile(state)` returns a `vendorProfileSchema`-validated `VendorProfileInput` plus the serving `provider`, suitable to pass straight to `updateVendorProfile`.
5. On a re-interview (`existingProfile` set), both `nextQuestion` and `extractProfile` include the existing profile in the prompt sent to the LLM layer.
6. The engine imports **no** DB module (`src/db/*`, `@/lib/vendors/data` types only — not its DB functions); all persistence is the caller's job.
7. `AllProvidersFailedError` propagates to the caller; no secrets or stack traces are added by the engine.
8. The whole engine builds and **all tests pass with no API key** (mocked LLM layer).

## Done gate

All tests green (main's current suite + this slice's new unit tests), `npm run lint` / `typecheck` / `test` / `build` green, README documents the SIA engine module and its public API, per-task commits on `feature/phase2-slice2b-sia-interview-engine`. Surface for operator merge (do not merge unprompted). **No git tag** (mid-Phase-2). Because the operator is providing Anthropic API access, a **manual smoke** — run one short real interview turn and one extraction against the live Anthropic provider — is recommended as the human check; the mock-based unit tests + build are the automated evidence and are sufficient for the gate.
