# Phase 1 Stack & Project Structure Design

**Date:** 2026-06-25  
**Status:** Approved (operator, 2026-06-25). Hosting decided: Vercel (app) + Neon (Postgres).  
**Scope:** Phase 1 Slice 0 only (stack decision + folder layout). No scaffolding yet.  
**Source of truth:** `Phase0_Platform_Specification.md` §10, §11; `Prompt_Playbook.md` Part 3 Slice 0.

---

## Context

Radar is a single-operator lead-intelligence platform. Phase 0 design is locked; the repo has spec docs only and no code. The first build action (Playbook Slice 0) is to turn the stack *leaning* in §10 into a concrete decision before any scaffold.

**Non-negotiables from Phase 0:**
- Dated, sourced proof on every signal observation
- Approval gate (`proposed` → `approved`) on signals and mappings
- Postgres at the core; graph-shaped catalogue data
- Distinct layers: UI, backend services, AI orchestration, integrations
- Performance matters; thin vertical slices with tests

---

## Approaches Considered

### A — Next.js full-stack monorepo (recommended)

One repo, one deployable app. Next.js App Router for UI and API routes. Internal packages or `src/` folders enforce the service layers from the spec. Drizzle ORM + Postgres (Neon or local). Auth via a minimal session (e.g. NextAuth credentials or a single shared operator password in env).

| Pros | Cons |
|------|------|
| Fastest path to Phase 1 “spine” — one `npm run dev`, one test runner | AI/sourcing workloads may eventually need extraction to workers |
| Matches spec leaning (React/Next.js) and Cursor/Claude buildability | Monolith discipline required so layers don’t tangle |
| Graph catalogue modeled in Postgres without a second database | |
| Easy to split later: `integrations/` and `ai/` become packages or services | |

### B — Split frontend + standalone API service

Next.js frontend + separate Node (Hono/Fastify) or Python (FastAPI) API repo or `apps/api` in a turborepo.

| Pros | Cons |
|------|------|
| Hard boundary between UI and API from day one | Two processes, two deploy configs, slower Slice 1 |
| Python API attractive if sourcing engine is Python-heavy | Spec and playbook assume Next.js-first; split adds coordination cost for a solo-operator tool |
| | Overkill before Phase 4 sourcing complexity |

### C — Next.js + dedicated graph database (Neo4j, etc.)

Postgres for transactional data; Neo4j (or similar) for catalogue graph.

| Pros | Cons |
|------|------|
| Native graph queries for bundling/gap detection | Second datastore, ops burden, YAGNI for Phase 1–2 |
| | Spec explicitly says “Postgres with appropriate modeling or graph extension; confirm during build” — extension deferred |

**Recommendation: A.** It satisfies Phase 1’s goal (prove architecture holds) with the least surface area. Layers stay explicit in folder structure; graph stays in Postgres until query pain justifies otherwise.

---

## Locked Stack (if Approach A approved)

| Layer | Choice | Notes |
|-------|--------|-------|
| Runtime | Node 22 LTS | Aligns with Next.js ecosystem |
| Framework | Next.js 15 (App Router) | UI + `/api/v1/*` route handlers |
| Language | TypeScript (strict) | End-to-end types from DB to UI |
| Database | PostgreSQL 16 | Neon for hosted dev/prod; Docker locally |
| ORM / migrations | Drizzle ORM + drizzle-kit | SQL-transparent; good for constraint-heavy spec |
| Auth | NextAuth.js v5 (Auth.js), credentials provider | Single operator; no sign-up |
| Testing | Vitest + Playwright | Unit/integration via Vitest; E2E for Slice 5 |
| Lint/format | ESLint + Prettier | Standard |
| Env | `.env.local` + validated `env.ts` (zod) | No secrets in repo |

**Deferred (not Phase 1):** job queue, vector DB, separate AI service, Apollo/tender integrations.

---

## Catalogue Graph in Postgres

Model the catalogue (§4.6) as **typed nodes + edges**, not a separate graph DB.

```
catalogue_nodes (node_id, type, label, metadata jsonb)
catalogue_edges (edge_id, from_node_id, to_node_id, type)
```

- **Node types:** `vendor`, `capability`, `sub_capability`, `geography`, `project_size_range`
- **Edge types:** as in spec (e.g. `vendor_capability`, `capability_sub_capability`, …)
- **Queries:** recursive CTEs for “vendors satisfying capability + geography + size”; materialized paths only if profiling shows need (Phase 6).

Indexes: `(type)`, `(from_node_id, type)`, `(to_node_id, type)`.

---

## Project Structure

```
radar/
├── docs/
│   ├── Phase0_Platform_Specification.md   # move from root when scaffolding
│   ├── Prompt_Playbook.md
│   └── superpowers/specs/                 # design docs from brainstorming
├── src/
│   ├── app/                    # Next.js routes, layouts, pages
│   │   ├── api/v1/             # versioned API (per AGENTS.md)
│   │   └── (app)/              # authenticated shell: vendors, signals, …
│   ├── components/             # UI components
│   ├── db/
│   │   ├── schema/             # Drizzle table definitions (one file per domain)
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── services/               # backend business logic (no HTTP here)
│   │   ├── signals/
│   │   ├── mappings/
│   │   ├── vendors/
│   │   ├── leads/
│   │   ├── catalogue/
│   │   └── pipeline/
│   ├── ai/                     # SIA, reverse-brief prompts & orchestration
│   ├── integrations/           # pluggable source adapters (stubs in Phase 1)
│   └── lib/                    # auth, env, errors, shared utils
├── tests/
│   ├── unit/
│   └── integration/
├── drizzle.config.ts
├── package.json
└── vitest.config.ts
```

**Layer rules:**
- `app/api` → thin handlers: validate input, call `services/*`, return `{ error, code }` shapes on failure
- `services/*` → spec business logic; unit-tested
- `ai/*` and `integrations/*` → no direct DB access; go through services
- `db/schema` → mirrors §4 data models field-for-field

---

## API Conventions (Phase 1 onward)

- Prefix: `/api/v1/`
- Errors: `{ error: string, code: string }` with correct HTTP status
- Pagination default: `page=1`, `limit=20`, max `100` on list endpoints (when added)

---

## Phase 1 Slice Mapping

| Playbook slice | This design enables |
|----------------|---------------------|
| Slice 0 | Stack + structure (this doc) |
| Slice 1 | Scaffold Next.js + healthcheck at `/api/v1/health` |
| Slice 2 | Drizzle schema for all §4 models + seed + integration tests |
| Slice 3 | Auth.js credentials gate on `(app)` routes |
| Slice 4 | Empty nav sections in `(app)` layout |
| Slice 5 | Vendor stub CRUD through `services/vendors` → API → UI |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Monolith layers bleed together | Enforce import direction: `app` → `services` → `db`; no `services` importing from `app` |
| Graph queries slow at scale | Start with indexed adjacency; profile in Phase 2–3 with real vendor count |
| GST/funding sources unverified (§9) | `integrations/*` stubs; flag signals as `source_unconfirmed` until wired |
| AI costs in later phases | `ai/` isolated so calls are metered and testable with mocks |

---

## Operator Decisions

**Hosting target for Phase 1 — DECIDED (2026-06-25):** Vercel (app) + Neon (Postgres). Neon env wiring is introduced at scaffold time (validated `env.ts`, `.env.example` Neon placeholder); the actual data layer lands in Slice 2.

---

## Approval

Once approved, next step per superpowers flow: invoke **writing-plans** to produce the Slice 1 scaffold implementation plan (not build until that plan is approved).
