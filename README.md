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

## Getting started

```bash
npm install
cp .env.example .env.local   # NODE_ENV is enough for Slice 1; add DATABASE_URL at Slice 2
npm run dev                  # http://localhost:3000  (healthcheck: /api/v1/health)
npm run lint && npm run typecheck && npm test && npm run build
```

### Auth (Slice 3)

Single operator, env-based. Set in `.env.local`:

```bash
AUTH_SECRET="$(openssl rand -base64 33)"
OPERATOR_EMAIL=you@example.com
OPERATOR_PASSWORD_HASH="$(node scripts/hash-password.mjs 'your-password')"
```

Then `npm run dev` and sign in at `/login`. Unauthenticated requests to app routes redirect to `/login`.

### Database (Slice 2)

```bash
npm run db:generate   # generate SQL migrations from src/db/schema
npm run db:migrate    # apply migrations to DATABASE_URL
npm run db:seed       # insert one sample row per table
```

Set `DATABASE_URL` (Neon main branch) and `TEST_DATABASE_URL` (Neon test branch) in `.env.local`.

## Key MCPs for this project

- **Neon** — Postgres branches and SQL
- **Context7** — Next.js, Drizzle, Auth.js docs
- **Bright Data / Exa** — signal sourcing research
- **Vercel** — deployment
- **GitNexus** — refactor impact analysis
