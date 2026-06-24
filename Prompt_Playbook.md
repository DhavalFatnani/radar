# Prompt Playbook
## Driving Claude Code and Cursor to build the platform

**Companion to:** Phase 0 Platform Specification (the source of truth)
**Purpose:** Turn the spec into excellent, durable code rather than fast, fragile code. This document is the rules for working with the coding tools, the reusable prompt templates, and the concrete prompts for Phase 1 (the spine).

**The one rule everything else serves:** build in thin vertical slices, test each against real data before moving on, never stack an unfinished slice on top of another.

---

## How to use this with Claude Code and Cursor

- **Keep the Phase 0 spec in the repo** (e.g. `/docs/Phase0_Platform_Specification.md`) so the tools can read it as the source of truth. Reference it in every prompt.
- **Division of labor:**
  - **Claude Code** builds the machine: scaffolding, database schema, backend logic, the sourcing engine, integrations, and the tests. It reasons across the whole codebase and runs things.
  - **Cursor** polishes what you see and touch: tight UI iteration, component-level work, visual feel.
- **One slice per session.** Finish, test, gate, commit. Then start the next.
- **The spec wins.** When a tool is unsure or something is not covered, it asks rather than assuming.

---

## Part 1 — The operating rules

These are the habits that make AI-assisted building produce something that holds together.

1. **Plan before code.** For every slice, the tool first proposes its plan (files, data shapes, how it will test). You review the plan and catch direction errors before any code is written. This is the cheapest place to fix mistakes.
2. **Scope hard.** Each prompt states exactly what is in the slice and explicitly says do not build beyond it. Sprawl is the enemy.
3. **Tests alongside, always.** Unit tests for logic (scoring, mapping evaluation, freshness), integration tests for data flows. The tool writes them with the code, not after.
4. **Run and show.** The tool runs the tests and shows the output. "It should work" is not acceptance; green tests are.
5. **Real data early.** Test with a real vendor, a real tender, a real signal as soon as the slice allows. Mock data hides the failures that matter.
6. **Review against acceptance criteria.** Before moving on, the tool walks through how the slice meets each criterion and flags anything uncertain or off-spec.
7. **The done gate.** A slice is done only when its acceptance criteria are met and its tests are green. Then commit. Nothing stacks on an unfinished slice.
8. **Ask, do not assume.** If anything conflicts with or is missing from the spec, the tool stops and asks.
9. **Commit at every green slice.** A clean checkpoint to return to if the next slice goes wrong.

---

## Part 2 — Reusable prompt templates

Copy, adapt the bracketed parts, paste. These are the workhorses for every slice in every phase.

### Template A — Slice kickoff (plan first)

```
We are building the [PROJECT NAME], following the Phase 0 specification in /docs/Phase0_Platform_Specification.md, which is the source of truth.

This session builds ONE slice: [SLICE NAME].
Scope, exactly: [WHAT IS IN THIS SLICE].
Out of scope, do not build: [WHAT IS NOT IN THIS SLICE].

Before writing any code, give me your plan:
- The files you will create or change.
- The data shapes or interfaces involved (match the spec's data models).
- How you will test this slice (unit tests for logic, integration tests for data flows).
- Anything in the spec that is unclear or that you would need to assume.

Do not write code yet. Wait for me to approve the plan.
```

### Template B — Build (after the plan is approved)

```
Plan approved. Build this slice.

Requirements:
- Write automated tests alongside the code: unit tests for any logic, integration tests for any data flow.
- Follow the data models and decisions in the Phase 0 spec exactly. If something is not covered, stop and ask rather than assuming.
- When done, run the tests and show me the full output.
- Then summarize what you built, mapped against these acceptance criteria: [PASTE ACCEPTANCE CRITERIA].
```

### Template C — Done check (the gate before moving on)

```
Before we close this slice:
- Run the full test suite and show me the results.
- Walk through each acceptance criterion and show how it is met: [PASTE ACCEPTANCE CRITERIA].
- Flag anything you are unsure about, anything that deviates from the spec, and anything you left as a shortcut.

If everything passes, propose a clear, single commit message for this slice.
```

### Template D — Debug (when something is wrong)

```
This is not working: [SYMPTOM / WHAT YOU EXPECTED VS WHAT HAPPENED].

Do not guess at a fix. Instead:
- Reproduce the problem.
- Find the root cause and explain what is actually happening.
- Propose the fix and why it addresses the root cause, not the symptom.
- Apply it, then add a test that would have caught this.
- Re-run the tests and show the output.
```

### Template E — UI polish (Cursor)

```
Refine this component / screen: [WHAT].
Goal: [THE FEEL OR BEHAVIOR YOU WANT].
Constraints: follow the UI/UX spec; keep it fast and responsive; do not change the underlying data or logic, only the presentation and interaction.
Show me the result and the specific changes you made.
```

### Template F — Spec-deviation guard (append to any prompt when you want extra discipline)

```
Important: if anything in this task conflicts with the Phase 0 spec, is ambiguous, or is not covered by it, stop and ask me before proceeding. Do not invent behavior or data shapes.
```

---

## Part 3 — Phase 1 prompt set: the spine

Phase 1 produces a running app shell with the real data models, minimal single-operator access, and a navigable empty UI. The goal is to prove the architecture holds before building anything valuable on it. Six slices. Use Template A to kick off each, Template B to build, Template C to gate.

### Slice 0 — Stack and project structure

**Goal:** Confirm the concrete stack and project layout. The spec gives a leaning (React / Next.js front end, a clean backend service, Postgres core, a dedicated AI-orchestration layer, a pluggable integrations layer). This slice turns the leaning into a decision.

**Kickoff prompt:**
```
We are starting the [PROJECT NAME], following /docs/Phase0_Platform_Specification.md (source of truth). Section 10 gives a recommended stack leaning.

Before any code, propose the concrete stack and project structure:
- Confirm or adjust the stack from section 10, with brief reasoning, optimizing for performance, your ability to build it reliably, the graph-shaped catalogue data, and possible future productization.
- Propose the repo/folder structure (frontend, backend, data layer, AI-orchestration layer, integrations layer, tests, docs).
- Note how the catalogue's graph queries will be served (Postgres modeling vs a graph extension), with a recommendation.
- Flag any decision you need from me.

Do not scaffold yet. Wait for my approval.
```

**Acceptance criteria:** A clear, agreed stack and folder structure, with the graph-data approach decided.

**Done gate:** You have approved the stack and structure in writing.

### Slice 1 — Scaffold that runs

**Goal:** The project runs locally with a healthcheck. The "hello world that holds together."

**Scope:** Project scaffold per Slice 0, runs locally, a healthcheck endpoint and a blank home route render, basic config and environment handling.
**Out of scope:** Any data models, any auth, any real UI.

**Acceptance criteria:**
- `npm run dev` (or equivalent) starts the app cleanly.
- A healthcheck endpoint returns success.
- A blank home route renders.
- A test confirms the healthcheck passes.

**Test instructions:** Integration test hitting the healthcheck; confirm the app boots in a clean environment.

**Done gate:** App boots, healthcheck green, committed.

### Slice 2 — The data layer

**Goal:** Implement the core data models from the spec as the database schema. This is the literal foundation of everything.

**Scope:** Schema and migrations for the Phase 0 data models: signal definition, signal observation, mapping, vendor profile, lead (with brief and contact block as structured fields), catalogue nodes and edges, contact book, pipeline/commission. Seed scripts that can insert a sample record per table.
**Out of scope:** UI for these, business logic, the engine. Just the schema, migrations, and the ability to read/write each table.

**Kickoff additions:** Point explicitly at spec section 4 (data models). Ask the tool to map every field, and to flag any field whose type or relationship is ambiguous before building.

**Acceptance criteria:**
- Every model in spec section 4 exists as a table with the specified fields.
- The signal observation table enforces `detected_at` and `source` as mandatory (the proof principle).
- Signal and mapping tables carry a `status` field defaulting to `proposed` (the approval gate).
- Migrations run cleanly up and down.
- A seed script inserts and reads back one record per table.
- Tests confirm create and read for each model, and confirm the mandatory-field and default-status constraints.

**Test instructions:** Integration tests against a real database (not mocked): run migrations, insert via seed, read back, assert constraints (mandatory `detected_at`/`source`, default `proposed` status).

**Done gate:** Schema matches the spec, constraints enforced, migrations reversible, tests green, committed.

### Slice 3 — Single-operator access

**Goal:** Minimal access control. There is one user: the operator.

**Scope:** A simple, secure single-operator login. Protect the app behind it.
**Out of scope:** Multi-user, roles, sign-up, password reset flows, anything from the parked SaaS list.

**Acceptance criteria:**
- The operator can log in and reach the app.
- Unauthenticated requests are blocked from protected routes.
- A test confirms protected routes reject unauthenticated access.

**Done gate:** Login works, routes protected, test green, committed.

### Slice 4 — App shell and navigation

**Goal:** The empty, navigable UI with the main sections, so the structure is visible and clickable.

**Scope:** Navigation and empty screens for: Vendors, Signals, Mappings, Leads, Contacts, Pipeline. Each shows a clear empty state. Layout, navigation, responsive shell.
**Out of scope:** Real data, forms that do anything, the engine. Empty states only.

**Cursor note:** This is a good slice to refine in Cursor for feel, using Template E, once Claude Code has built the structure.

**Acceptance criteria:**
- Each main section is reachable from navigation.
- Each section renders a clear empty state.
- The shell is responsive and fast.

**Done gate:** All sections navigable with empty states, committed.

### Slice 5 — End-to-end wiring proof

**Goal:** Prove a record flows through the whole stack: UI to backend to database and back. This is what confirms the architecture holds.

**Scope:** One thin real path. For example: create a minimal vendor stub from the Vendors screen, persist it, and list it back. UI to backend to DB to UI.
**Out of scope:** The full vendor profile, the interview, validation depth. Just prove the pipe works end to end.

**Acceptance criteria:**
- Creating the stub from the UI persists it to the database.
- The persisted record appears back in the UI after reload.
- An end-to-end test covers create-then-read through the stack.

**Done gate:** The full path works and is tested. Phase 1 is complete: the architecture is proven. Commit and tag this as the Phase 1 baseline.

---

## Part 4 — Extending to Phases 2 to 6

Every later phase follows the same shape. To generate a phase's prompt set, use this procedure:

1. **Read the phase's goal** in spec section 11.
2. **Break it into thin vertical slices.** Each slice should be independently testable and should not require a later slice to function.
3. **For each slice, write:** goal, scope, explicit out-of-scope, acceptance criteria drawn from the spec, and test instructions (unit for logic, integration for data flows, real data early).
4. **Run each slice through Templates A, B, C.**
5. **Gate and commit** before the next slice.

Slice-shaping hints per phase:

- **Phase 2 (vendor intake + catalogue):** slices for the SIA interview flow, profile persistence and versioning, the catalogue graph population, and the first real interview producing a real profile. The hardest correctness question is whether the interview pulls genuinely precise data, test with a real vendor.
- **Phase 3 (signal library + mappings):** slices for the signal-management UI with the approval gate, the seed library load, the mapping-management UI, and mapping evaluation logic. Heavily unit-test the mapping evaluation (required vs supporting, threshold, timing, disqualifiers).
- **Phase 4 (sourcing engine + reverse brief):** the heart, go slowest. Slices for one source integration first (tenders or job boards), signal detection with evidence capture, entity resolution, scoring, then reverse-brief generation, then the contact block. Test each source and the scoring math aggressively against real companies.
- **Phase 5 (pipeline + commission):** slices for pipeline stages, the two outreach modes, one-time commission, active recurring commission with reminders, the leak-defense logs, and holding-pool capture.
- **Phase 6 (feedback loop + hardening):** slices for wiring outcomes back to signal and mapping track records, contact-book dedup, company memory, performance tuning, and the final UI/UX pass.

---

## Part 5 — The session checklist

Run this mentally for every slice:

- [ ] Slice scoped, with explicit out-of-scope.
- [ ] Plan reviewed before any code (Template A).
- [ ] Built with tests alongside (Template B).
- [ ] Tests run and shown green.
- [ ] Tested against real data where possible.
- [ ] Each acceptance criterion checked (Template C).
- [ ] Deviations and shortcuts surfaced.
- [ ] Committed at green.

---

*End of Prompt Playbook. Use alongside the Phase 0 spec. As phases progress, append the concrete slice prompts you generate so the playbook grows into the full build record.*
