# radar

Lead-intelligence & matchmaking platform. Phase 0 design is locked; Phase 1 build in progress.

## Docs

| File | What |
|------|------|
| `Phase0_Platform_Specification.md` | Full platform design |
| `Prompt_Playbook.md` | Build slices and prompts |
| `docs/superpowers/specs/2026-06-25-phase1-stack-design.md` | Stack + folder layout |
| `AGENTS.md` | Agent/build instructions |

## Stack

Next.js 15 · TypeScript · PostgreSQL (Neon) · Drizzle · NextAuth · Vitest · Playwright

## Cursor setup

This repo includes project-level Cursor configuration so agents use your plugins and MCPs by default:

```
.cursor/
├── mcp.json              # Neon Postgres for this project
└── rules/
    ├── radar-core.mdc    # Business rules (always on)
    ├── radar-typescript.mdc
    ├── radar-data-layer.mdc
    └── mcp-tooling.mdc   # Which MCP to use per task
.vscode/
├── settings.json         # Format/lint/TS defaults
└── extensions.json       # Recommended extensions
```

Global standards live in `~/AGENTS.md` (security, testing, MCP orchestration).

## Getting started (Slice 1 — not yet scaffolded)

```bash
# After scaffold lands:
npm install
cp .env.example .env.local   # fill Neon + auth secrets
npm run dev                  # http://localhost:3000
npm run lint && npm run typecheck && npm test
```

## Key MCPs for this project

- **Neon** — Postgres branches and SQL
- **Context7** — Next.js, Drizzle, Auth.js docs
- **Bright Data / Exa** — signal sourcing research
- **Vercel** — deployment
- **GitNexus** — refactor impact analysis
