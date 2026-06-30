# Phase 2 · Slice 2.2a — Provider-Agnostic LLM Layer — Design Spec

**Status:** Approved by operator 2026-06-30.
**Scope:** Phase 2, Slice 2.2a only — the flexible LLM provider foundation. The SIA interview engine that consumes it is Slice 2.2b (separate spec).
**Source spec:** `Phase0_Platform_Specification.md` §7.1 (SIA) / §10 (dedicated AI-orchestration layer); `AGENTS.md` (`src/ai/` = SIA orchestration, no direct DB).
**Builds on:** Slice 2.1 (`vendorProfileSchema` is the structured-extraction target the SIA engine will use 2.2a for).

## Why this is its own slice

Slice 2.2 ("SIA engine") turned out to contain two subsystems: a reusable multi-provider LLM abstraction, and the SIA interview logic on top of it. They are split:

| Slice | Scope |
|-------|-------|
| **2.2a Provider-agnostic LLM layer** (this spec) | `src/ai/llm/` — one interface over many providers + a fallback chain. No SIA logic. |
| 2.2b SIA interview engine | `src/ai/sia/` — adaptive question generation + profile extraction, built on 2.2a. |
| 2.3 SIA interview UI | Operator-co-piloted chat that drives 2.2b. |

## Goal

A single, provider-agnostic way to call an LLM — `generateText` (free-form, e.g. the next interview question) and `generateObject(schema)` (zod-validated structured extraction, e.g. a vendor profile) — that transparently falls back across multiple providers so the platform runs **free/local by default** and escalates to paid providers only when configured and needed.

## Pivotal decisions (operator chose)

- **Unify with the Vercel AI SDK, not the AI Gateway.** The AI SDK is used purely as the normalization layer (`generateText` / `generateObject` are identical across providers, and zod schemas work uniformly). Each provider is pointed at its **own** API (or local Ollama) — **no AI Gateway is required and no Gateway cost is incurred**. The AI Gateway is supported as *one optional provider entry*, not a dependency. This directly answers the operator's cost concern.
- **Multi-provider with a fallback chain.** Adapters for Anthropic, OpenAI, DeepSeek, xAI/Grok, Ollama (local), and (optional) AI Gateway. Each is active only if configured.
- **Default fallback order: free/local first** — `ollama → deepseek → grok → openai → anthropic`. Dev runs at $0; paid providers are the escalation path. Overridable per-env.
- **Mock-provider testing.** The layer and its fallback logic are unit-tested with a deterministic in-memory provider — **no API key is needed to build or test**. Real keys matter only at actual interview runtime.

## Architecture

`src/ai/llm/` is a pure, DB-free module (per AGENTS.md). It exposes two functions and a small set of types; everything else is internal.

```
src/ai/llm/
├── types.ts        # LlmMessage, LlmProvider, LlmResult<T>, AllProvidersFailedError
├── config.ts       # parse env → ordered list of provider specs (name, model, isConfigured)
├── providers.ts    # provider name → Vercel AI SDK model factory (+ isConfigured check)
├── fallback.ts     # generateTextWithFallback / generateObjectWithFallback over a provider list
└── index.ts        # public API: generateText(), generateObject(schema), listActiveProviders()
```

**Data flow:** `generateObject(schema, messages)` → `config` resolves the ordered, *configured* provider list → `fallback` tries each provider's AI SDK model in order; first success returns `{ value, provider }`; each failure (auth, network, rate-limit, unsupported, refusal, schema-validation) is recorded and the chain advances; if all fail, throw `AllProvidersFailedError` carrying the per-provider error summary (no secrets). `generateText` is identical without the schema.

**Provider injection for testing.** `fallback.ts`'s functions take an explicit provider list, so tests pass in mock providers (or the AI SDK's `MockLanguageModelV2`) and assert ordering/fall-through deterministically. `index.ts` is the thin wrapper that builds the real list from `config.ts`.

## Providers & configuration

A provider is **active** only when its required config is present; inactive providers are skipped in the chain (not an error). All model IDs are env-overridable.

| Provider | Activation | Default model (env-overridable) |
|----------|-----------|----------------------------------|
| `ollama` (local, free) | `OLLAMA_MODEL` set (operator opts in by naming a locally pulled model; `OLLAMA_BASE_URL` defaults to `http://localhost:11434/v1`) | `OLLAMA_MODEL` |
| `deepseek` | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODEL` (default `deepseek-chat`) |
| `grok` (xAI) | `XAI_API_KEY` | `XAI_MODEL` |
| `openai` | `OPENAI_API_KEY` | `OPENAI_MODEL` |
| `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` (default `claude-opus-4-8`) |
| `gateway` (optional) | `AI_GATEWAY_API_KEY` | `AI_GATEWAY_MODEL` (`provider/model` string) |

- `AI_PROVIDER_ORDER` — CSV, default `ollama,deepseek,grok,openai,anthropic`. Only names in this list participate; reorder/trim per-env. `gateway` is omitted from the default order (opt-in).
- Auth env vars are validated where used (not in the global `src/lib/env.ts`) — absence means "provider inactive," never a crash. **`ANTHROPIC_API_KEY` here is the LLM key and is distinct from auth's `AUTH_SECRET`/`OPERATOR_*`.** Note: this is a *different* `ANTHROPIC_API_KEY` usage than the operator-login bcrypt env; no overlap.
- Exact AI SDK package names/versions and the per-provider model-factory calls are pinned in the implementation plan and verified against the installed packages at build time (write → run → fix), not asserted here.

## Structured output

`generateObject(schema, messages)` wraps the AI SDK's object-generation with the same fallback chain and returns the zod-validated value plus which provider produced it. This is the mechanism Slice 2.2b uses to turn an interview transcript into a `vendorProfileSchema` object. Schema-validation failure on a provider is treated like any other failure — the chain advances.

## Error handling

- Per-provider failures are caught and accumulated; the loop continues. Secrets are never logged or included in error messages.
- All-providers-failed → `AllProvidersFailedError` with a list of `{ provider, errorType, message }`. Callers (2.2b, route handlers) surface a generic operator-facing message; no stack traces leak.
- No provider configured (empty active list) → the same error type with a clear "no LLM provider configured" message, so the operator knows to set a key or start Ollama.

## Testing (TDD, unit-level — no API key required)

- `config`: parses `AI_PROVIDER_ORDER`; marks providers active/inactive from env presence; default order when unset.
- `fallback` (with injected mock providers): returns the first success; falls through on a throwing provider to the next; skips inactive providers; all-fail → `AllProvidersFailedError` listing each attempt; `generateObject` returns the validated object from a mock and falls through on a schema/throw failure.
- `index`: builds the active list from env and delegates (one happy-path test with a mock injected via the seam).
- Tests live in `tests/unit/ai/` and use the AI SDK test double; no network, no keys.

## Out of scope (YAGNI / later slices)

The SIA interview logic (2.2b); the interview UI (2.3); streaming responses (add when 2.3's chat needs it); real-provider integration tests that require live keys (the mock provider is the automated evidence; a manual smoke against Ollama is the human check); retries/backoff within a single provider (the chain *is* the resilience story for now); cost/usage accounting and observability dashboards; prompt-caching tuning.

## Acceptance criteria

1. `generateText` and `generateObject(schema)` are callable through one module-level API regardless of which provider serves the request.
2. With several providers configured, a failing provider transparently falls through to the next in the configured order; the result reports which provider served it.
3. Inactive (unconfigured) providers are skipped, not errored.
4. With **no** key configured, the layer still **builds and all tests pass** (mock provider); calling it with no active provider yields a clear `AllProvidersFailedError`.
5. `generateObject` returns a value validated against the supplied zod schema.
6. The default order is free/local-first and is env-overridable.

## Done gate

All tests green (Slice 2.1's 59 + this slice's new unit tests), `npm run lint`/`typecheck`/`test`/`build` green, README documents the provider env vars + the "runs free on Ollama, paid optional" model, per-task commits on `feature/phase2-slice2a-llm-provider-layer`. Surface for operator merge (do not merge unprompted). **No git tag** (mid-Phase-2). A manual smoke against a real provider (local Ollama, or any one key the operator sets) is recommended but not required for the gate — the mock-based tests + build are the automated evidence.
