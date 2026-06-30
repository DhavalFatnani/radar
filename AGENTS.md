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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **radar** (876 symbols, 1365 relationships, 37 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/radar/context` | Codebase overview, check index freshness |
| `gitnexus://repo/radar/clusters` | All functional areas |
| `gitnexus://repo/radar/processes` | All execution flows |
| `gitnexus://repo/radar/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
