# Radar — Agent Guide

Lead-intelligence platform. **Read the spec before building.**

## Source of truth (read first)

| Doc | Purpose |
|-----|---------|
| `Phase0_Platform_Specification.md` | Locked design: data models, seed library, business rules |
| `Prompt_Playbook.md` | Build sequence and slice prompts |
| `docs/superpowers/specs/2026-06-25-phase1-stack-design.md` | Locked stack + folder layout |

## Non-negotiables

1. **Dated, sourced proof** on every signal observation
2. **Approval gate** — signals/mappings start as `proposed`, go live only when approved
3. **Postgres at the core** — catalogue graph modeled as nodes + edges (no separate graph DB in Phase 1)
4. **Layer separation** — `app/api` thin → `services/*` logic → `db/schema` data

## Locked stack (Phase 1)

- Next.js 15 App Router + TypeScript strict
- PostgreSQL 16 via **Neon** (hosted) / Docker (local)
- Drizzle ORM + drizzle-kit
- NextAuth.js v5 credentials (single operator)
- Vitest + Playwright
- ESLint + Prettier

## Project layout

```
src/app/          → routes + /api/v1/* handlers (thin)
src/services/     → business logic (unit-tested)
src/db/schema/    → Drizzle tables
src/ai/           → SIA orchestration (no direct DB)
src/integrations/ → source adapters (stubs in Phase 1)
tests/unit/       → Vitest
tests/integration/→ API + DB tests
```

## API conventions

- Prefix: `/api/v1/`
- Errors: `{ error: string, code: string }` with correct HTTP status
- Pagination: `page=1`, `limit=20`, max `100`

## MCP for this project

| Need | Tool |
|------|------|
| Postgres / Neon branches | **Neon** MCP |
| Drizzle / SQL migrations | **Prisma-Local** or Neon SQL tools |
| Company/signal web research | **Bright Data** or **Exa** |
| Framework docs (Next.js, Drizzle, Auth.js) | **Context7** |
| Deploy | **Vercel** MCP |
| Refactor impact | **GitNexus** |

## Build sequence

Follow `Prompt_Playbook.md` slices in order. Do not skip ahead. Current phase: **Slice 0** (stack approved) → **Slice 1** (scaffold + healthcheck).
