# Phase 2 · Slice 2.2a — Provider-Agnostic LLM Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `src/ai/llm/` — a single, provider-agnostic module over Anthropic, OpenAI, DeepSeek, xAI/Grok, Ollama, and an optional AI Gateway — that exposes `generateText` and `generateObject(schema)` with a free/local-first fallback chain, and runs at $0 (all tests pass with no API key via mocks).

**Architecture:** Five focused files under `src/ai/llm/`: types → config → providers → fallback → index. Config parses env vars into an ordered `ProviderSpec[]` (each with `isConfigured`). Fallback iterates the already-resolved provider list, accumulates per-provider failures, and throws `AllProvidersFailedError` only when all fail. The public `index.ts` wires config → providers → fallback; tests mock at the module boundary, never touching real APIs.

**Tech Stack:** Vercel AI SDK (`ai`) · `@ai-sdk/anthropic` · `@ai-sdk/openai` · `@ai-sdk/deepseek` · `@ai-sdk/xai` · `ollama-ai-provider` · Zod (already installed) · Vitest (already installed, `vi.mock`)

## Global Constraints

- Branch: `feature/phase2-slice2a-llm-provider-layer` (already exists — work on it throughout)
- `src/ai/llm/` is DB-free and Next.js-free; no imports from `@/db/`, `@/lib/auth`, or `next/*`
- `ANTHROPIC_API_KEY` here is the LLM key — distinct from the operator-login env vars (`AUTH_SECRET`, `OPERATOR_*`, `OPERATOR_PASSWORD_HASH`)
- All error messages sent to callers must never include API keys or raw secrets
- Default Anthropic model: `claude-opus-4-8` (verbatim)
- Default fallback order: `ollama,deepseek,grok,openai,anthropic` (CSV, verbatim)
- Ollama activation env: `OLLAMA_MODEL` (operator names a locally pulled model); `OLLAMA_BASE_URL` defaults to `http://localhost:11434/v1`
- Test files live in `tests/unit/ai/` and import via `@/ai/llm/...` aliases
- Run all tests with: `npm test` (or `npx vitest run`)
- After each task: `npm run lint && npm run typecheck` must be green before committing

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `src/ai/llm/types.ts` | Create | `LlmMessage`, `LlmProviderName`, `ProviderSpec`, `LlmResult<T>`, `ResolvedProvider`, `ProviderFailure`, `AllProvidersFailedError` |
| `src/ai/llm/config.ts` | Create | `getProviderChain()` — parses env → ordered `ProviderSpec[]` with `isConfigured` |
| `src/ai/llm/fallback.ts` | Create | `generateTextWithFallback`, `generateObjectWithFallback` — loop over `ResolvedProvider[]` |
| `src/ai/llm/providers.ts` | Create | `getModel(spec)` — maps `ProviderSpec` → `LanguageModelV1` via AI SDK provider factories |
| `src/ai/llm/index.ts` | Create | Public API: `generateText`, `generateObject`, `listActiveProviders`, re-exports `AllProvidersFailedError` |
| `tests/unit/ai/llm-config.test.ts` | Create | Unit tests for `config.ts` (env-var parsing) |
| `tests/unit/ai/llm-fallback.test.ts` | Create | Unit tests for `fallback.ts` (ordering, fall-through, error accumulation) |
| `tests/unit/ai/llm-index.test.ts` | Create | Smoke tests for `index.ts` (wiring check via mocked deps) |
| `.env.example` | Modify | Add LLM provider env vars section |
| `README.md` | Modify | Add LLM provider setup section |

---

### Task 1: Install AI SDK packages and scaffold `src/ai/llm/types.ts`

**Files:**
- Create: `src/ai/llm/types.ts`
- (No test file — pure types + one custom Error class; tested implicitly in Task 3)

**Interfaces:**
- Produces: `LlmMessage`, `LlmProviderName`, `ProviderSpec`, `LlmResult<T>`, `ResolvedProvider`, `ProviderFailure`, `AllProvidersFailedError` — used by every subsequent task

---

- [ ] **Step 1: Install AI SDK packages**

Run from the project root:

```bash
npm install ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/deepseek @ai-sdk/xai ollama-ai-provider
```

Expected: packages appear in `package.json` `dependencies`. If any package is not found on npm, check the exact name at [npmjs.com](https://www.npmjs.com) — package names may change between AI SDK releases.

- [ ] **Step 2: Verify the installation compiles**

```bash
npm run typecheck
```

Expected: no errors related to the new packages (there may be pre-existing unrelated errors — those are fine).

- [ ] **Step 3: Create `src/ai/llm/types.ts`**

Create the file with this exact content:

```ts
export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmProviderName =
  | "ollama"
  | "deepseek"
  | "grok"
  | "openai"
  | "anthropic"
  | "gateway";

export type LlmResult<T> = {
  value: T;
  provider: LlmProviderName;
};

export type ProviderSpec = {
  name: LlmProviderName;
  model: string;
  isConfigured: boolean;
};

export type ProviderFailure = {
  provider: LlmProviderName;
  errorType: string;
  message: string;
};

export class AllProvidersFailedError extends Error {
  readonly failures: ProviderFailure[];

  constructor(failures: ProviderFailure[]) {
    const msg =
      failures.length === 0
        ? "No LLM provider configured. Set AI_PROVIDER_ORDER and at least one provider key (or OLLAMA_MODEL for local)."
        : `All ${failures.length} LLM provider(s) failed: ${failures
            .map((f) => `${f.provider}(${f.errorType})`)
            .join(", ")}`;
    super(msg);
    this.name = "AllProvidersFailedError";
    this.failures = failures;
  }
}
```

Note: `ResolvedProvider` (which pairs a `ProviderSpec` with its live AI SDK model object) is defined in `fallback.ts`, not here, to avoid importing `LanguageModelV1` from `ai` into a pure types file.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no new errors from `src/ai/llm/types.ts`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/ai/llm/types.ts
git commit -m "feat(ai): install Vercel AI SDK packages and define LLM layer types"
```

---

### Task 2: Config module (`getProviderChain`) with unit tests

**Files:**
- Create: `src/ai/llm/config.ts`
- Create: `tests/unit/ai/llm-config.test.ts`

**Interfaces:**
- Consumes: `LlmProviderName`, `ProviderSpec` from `@/ai/llm/types`
- Produces: `getProviderChain(): ProviderSpec[]` — returns ALL providers in configured order, each with `isConfigured: boolean`. Callers filter to `isConfigured === true` before use.

---

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/ai/llm-config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Snapshot env before any test touches it so we can restore it after.
const ORIGINAL_ENV = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
}

beforeEach(() => {
  // Clear all provider keys so each test starts from a blank slate.
  setEnv({
    OLLAMA_MODEL: undefined,
    DEEPSEEK_API_KEY: undefined,
    XAI_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    AI_GATEWAY_API_KEY: undefined,
    DEEPSEEK_MODEL: undefined,
    XAI_MODEL: undefined,
    OPENAI_MODEL: undefined,
    ANTHROPIC_MODEL: undefined,
    AI_GATEWAY_MODEL: undefined,
    AI_GATEWAY_BASE_URL: undefined,
    OLLAMA_BASE_URL: undefined,
    AI_PROVIDER_ORDER: undefined,
  });
});

afterEach(resetEnv);

// Import AFTER env setup so the module reads fresh env on each test
// (vitest re-evaluates dynamic imports when the module cache is cleared).
// With static imports the env is read at import-time; to avoid that,
// we call getProviderChain() directly in each test — it reads env at call time.
import { getProviderChain } from "@/ai/llm/config";

describe("getProviderChain", () => {
  it("returns an empty configured list when no provider env vars are set", () => {
    const chain = getProviderChain();
    expect(chain.filter((p) => p.isConfigured)).toHaveLength(0);
  });

  it("marks openai as configured when OPENAI_API_KEY is set", () => {
    setEnv({ OPENAI_API_KEY: "sk-test" });
    const chain = getProviderChain();
    const openai = chain.find((p) => p.name === "openai");
    expect(openai?.isConfigured).toBe(true);
  });

  it("marks openai as unconfigured when OPENAI_API_KEY is absent", () => {
    const chain = getProviderChain();
    const openai = chain.find((p) => p.name === "openai");
    expect(openai?.isConfigured).toBe(false);
  });

  it("marks ollama as configured when OLLAMA_MODEL is set (not OLLAMA_BASE_URL)", () => {
    setEnv({ OLLAMA_MODEL: "llama3.2" });
    const chain = getProviderChain();
    const ollama = chain.find((p) => p.name === "ollama");
    expect(ollama?.isConfigured).toBe(true);
    expect(ollama?.model).toBe("llama3.2");
  });

  it("does NOT mark ollama configured when only OLLAMA_BASE_URL is set", () => {
    setEnv({ OLLAMA_BASE_URL: "http://localhost:11434/v1" });
    const chain = getProviderChain();
    const ollama = chain.find((p) => p.name === "ollama");
    expect(ollama?.isConfigured).toBe(false);
  });

  it("returns providers in default order: ollama,deepseek,grok,openai,anthropic", () => {
    const chain = getProviderChain();
    const names = chain.map((p) => p.name);
    expect(names).toEqual(["ollama", "deepseek", "grok", "openai", "anthropic"]);
  });

  it("respects AI_PROVIDER_ORDER override", () => {
    setEnv({
      ANTHROPIC_API_KEY: "sk-ant",
      OPENAI_API_KEY: "sk-oai",
      AI_PROVIDER_ORDER: "anthropic,openai",
    });
    const chain = getProviderChain();
    const names = chain.map((p) => p.name);
    expect(names).toEqual(["anthropic", "openai"]);
  });

  it("uses default model claude-opus-4-8 for anthropic when ANTHROPIC_MODEL is unset", () => {
    setEnv({ ANTHROPIC_API_KEY: "sk-ant" });
    const chain = getProviderChain();
    const anthropic = chain.find((p) => p.name === "anthropic");
    expect(anthropic?.model).toBe("claude-opus-4-8");
  });

  it("uses ANTHROPIC_MODEL override when set", () => {
    setEnv({ ANTHROPIC_API_KEY: "sk-ant", ANTHROPIC_MODEL: "claude-haiku-4-5-20251001" });
    const chain = getProviderChain();
    expect(chain.find((p) => p.name === "anthropic")?.model).toBe("claude-haiku-4-5-20251001");
  });

  it("uses default model deepseek-chat when DEEPSEEK_MODEL is unset", () => {
    setEnv({ DEEPSEEK_API_KEY: "sk-ds" });
    const chain = getProviderChain();
    expect(chain.find((p) => p.name === "deepseek")?.model).toBe("deepseek-chat");
  });

  it("uses DEEPSEEK_MODEL override when set", () => {
    setEnv({ DEEPSEEK_API_KEY: "sk-ds", DEEPSEEK_MODEL: "deepseek-reasoner" });
    const chain = getProviderChain();
    expect(chain.find((p) => p.name === "deepseek")?.model).toBe("deepseek-reasoner");
  });

  it("skips unknown provider names in AI_PROVIDER_ORDER", () => {
    setEnv({ OPENAI_API_KEY: "sk-oai", AI_PROVIDER_ORDER: "openai,unknown-provider" });
    const chain = getProviderChain();
    const names = chain.map((p) => p.name);
    expect(names).toEqual(["openai"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (module not yet created)**

```bash
npx vitest run tests/unit/ai/llm-config.test.ts
```

Expected: FAIL — `Cannot find module '@/ai/llm/config'`

- [ ] **Step 3: Create `src/ai/llm/config.ts`**

```ts
import type { LlmProviderName, ProviderSpec } from "./types";

const VALID_NAMES = new Set<LlmProviderName>([
  "ollama",
  "deepseek",
  "grok",
  "openai",
  "anthropic",
  "gateway",
]);

const DEFAULT_ORDER: LlmProviderName[] = [
  "ollama",
  "deepseek",
  "grok",
  "openai",
  "anthropic",
];

function isConfigured(name: LlmProviderName): boolean {
  switch (name) {
    case "ollama":
      return Boolean(process.env.OLLAMA_MODEL);
    case "deepseek":
      return Boolean(process.env.DEEPSEEK_API_KEY);
    case "grok":
      return Boolean(process.env.XAI_API_KEY);
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY);
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY);
    case "gateway":
      return Boolean(process.env.AI_GATEWAY_API_KEY);
  }
}

function resolveModel(name: LlmProviderName): string {
  switch (name) {
    case "ollama":
      return process.env.OLLAMA_MODEL ?? "";
    case "deepseek":
      return process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    case "grok":
      return process.env.XAI_MODEL ?? "grok-3-mini";
    case "openai":
      return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    case "anthropic":
      return process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
    case "gateway":
      return process.env.AI_GATEWAY_MODEL ?? "";
  }
}

function parseOrder(): LlmProviderName[] {
  const raw = process.env.AI_PROVIDER_ORDER;
  if (!raw) return DEFAULT_ORDER;
  return raw
    .split(",")
    .map((s) => s.trim() as LlmProviderName)
    .filter((name) => VALID_NAMES.has(name));
}

/**
 * Returns the full ordered provider chain — every provider in the configured
 * order, each with isConfigured=true/false. Callers filter to isConfigured
 * before building model instances.
 */
export function getProviderChain(): ProviderSpec[] {
  return parseOrder().map((name) => ({
    name,
    model: resolveModel(name),
    isConfigured: isConfigured(name),
  }));
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npx vitest run tests/unit/ai/llm-config.test.ts
```

Expected: all tests PASS. If any fail, check that `process.env` mutations in `beforeEach` propagate correctly (Vitest runs tests in the same process by default — direct `process.env` mutation works).

- [ ] **Step 5: Run lint and typecheck**

```bash
npm run lint && npm run typecheck
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/ai/llm/config.ts tests/unit/ai/llm-config.test.ts
git commit -m "feat(ai): config module — env-driven provider chain with isConfigured flags"
```

---

### Task 3: Fallback engine with unit tests

**Files:**
- Create: `src/ai/llm/fallback.ts`
- Create: `tests/unit/ai/llm-fallback.test.ts`

**Interfaces:**
- Consumes: `LlmMessage`, `LlmProviderName`, `LlmResult`, `ProviderFailure`, `AllProvidersFailedError` from `@/ai/llm/types`; `generateText` and `generateObject` from `ai`
- Produces:
  - `type ResolvedProvider = { name: LlmProviderName; model: string; llm: LanguageModelV1 }`
  - `generateTextWithFallback(providers: ResolvedProvider[], messages: LlmMessage[]): Promise<LlmResult<string>>`
  - `generateObjectWithFallback<T>(providers: ResolvedProvider[], schema: z.ZodType<T>, messages: LlmMessage[]): Promise<LlmResult<T>>`

**Testing note:** The tests mock the `ai` module's `generateText` and `generateObject` functions via `vi.mock`. The `ResolvedProvider.llm` field is not called by the real AI SDK (since `ai` is mocked), so tests pass `null as unknown as LanguageModelV1` for it — the cast is documented below.

---

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/ai/llm-fallback.test.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { LanguageModelV1 } from "ai";
import type { LlmProviderName } from "@/ai/llm/types";
import { AllProvidersFailedError } from "@/ai/llm/types";

// Mock the `ai` module BEFORE importing anything that imports it.
const mockGenerateText = vi.fn();
const mockGenerateObject = vi.fn();

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  generateObject: mockGenerateObject,
}));

// Import after vi.mock so the mocked version is used.
import {
  generateTextWithFallback,
  generateObjectWithFallback,
  type ResolvedProvider,
} from "@/ai/llm/fallback";
import { z } from "zod";

// In tests, `llm` is unused (ai is mocked). The cast is intentional.
function fakeProvider(name: LlmProviderName): ResolvedProvider {
  return { name, model: "test-model", llm: null as unknown as LanguageModelV1 };
}

const messages = [{ role: "user" as const, content: "hello" }];

describe("generateTextWithFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the first provider's text on success", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "hello from openai" });

    const result = await generateTextWithFallback(
      [fakeProvider("openai"), fakeProvider("anthropic")],
      messages,
    );

    expect(result).toEqual({ value: "hello from openai", provider: "openai" });
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("falls through to the next provider when the first throws", async () => {
    mockGenerateText
      .mockRejectedValueOnce(new Error("openai rate limit"))
      .mockResolvedValueOnce({ text: "hello from anthropic" });

    const result = await generateTextWithFallback(
      [fakeProvider("openai"), fakeProvider("anthropic")],
      messages,
    );

    expect(result).toEqual({ value: "hello from anthropic", provider: "anthropic" });
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("throws AllProvidersFailedError when all providers throw", async () => {
    mockGenerateText
      .mockRejectedValueOnce(new Error("openai down"))
      .mockRejectedValueOnce(new Error("anthropic down"));

    await expect(
      generateTextWithFallback(
        [fakeProvider("openai"), fakeProvider("anthropic")],
        messages,
      ),
    ).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it("AllProvidersFailedError lists each failed provider", async () => {
    mockGenerateText
      .mockRejectedValueOnce(Object.assign(new Error("rate limit"), { name: "RateLimitError" }))
      .mockRejectedValueOnce(new Error("timeout"));

    let caught: unknown;
    try {
      await generateTextWithFallback(
        [fakeProvider("openai"), fakeProvider("anthropic")],
        messages,
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AllProvidersFailedError);
    const e = caught as AllProvidersFailedError;
    expect(e.failures).toHaveLength(2);
    expect(e.failures[0].provider).toBe("openai");
    expect(e.failures[0].errorType).toBe("RateLimitError");
    expect(e.failures[1].provider).toBe("anthropic");
  });

  it("throws AllProvidersFailedError with no-providers message when list is empty", async () => {
    await expect(generateTextWithFallback([], messages)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof AllProvidersFailedError &&
        err.message.includes("No LLM provider configured"),
    );
  });

  it("does not include API key strings in error messages", async () => {
    const longSecret = "sk-" + "x".repeat(50);
    mockGenerateText.mockRejectedValueOnce(new Error(`Invalid API key: ${longSecret}`));

    let caught: unknown;
    try {
      await generateTextWithFallback([fakeProvider("openai")], messages);
    } catch (err) {
      caught = err;
    }

    const e = caught as AllProvidersFailedError;
    expect(e.failures[0].message).not.toContain(longSecret);
  });
});

describe("generateObjectWithFallback", () => {
  const schema = z.object({ name: z.string(), score: z.number() });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the validated object from the first provider", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { name: "Acme", score: 9 } });

    const result = await generateObjectWithFallback(
      [fakeProvider("openai")],
      schema,
      messages,
    );

    expect(result).toEqual({ value: { name: "Acme", score: 9 }, provider: "openai" });
  });

  it("falls through on object generation failure", async () => {
    mockGenerateObject
      .mockRejectedValueOnce(new Error("schema parse error"))
      .mockResolvedValueOnce({ object: { name: "Acme", score: 9 } });

    const result = await generateObjectWithFallback(
      [fakeProvider("openai"), fakeProvider("anthropic")],
      schema,
      messages,
    );

    expect(result.provider).toBe("anthropic");
    expect(result.value.name).toBe("Acme");
  });

  it("throws AllProvidersFailedError when all providers fail", async () => {
    mockGenerateObject
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"));

    await expect(
      generateObjectWithFallback(
        [fakeProvider("openai"), fakeProvider("anthropic")],
        schema,
        messages,
      ),
    ).rejects.toBeInstanceOf(AllProvidersFailedError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (module not yet created)**

```bash
npx vitest run tests/unit/ai/llm-fallback.test.ts
```

Expected: FAIL — `Cannot find module '@/ai/llm/fallback'`

- [ ] **Step 3: Create `src/ai/llm/fallback.ts`**

```ts
import { generateText as aiGenerateText, generateObject as aiGenerateObject } from "ai";
import type { LanguageModelV1 } from "ai";
import type { z } from "zod";
import type {
  LlmMessage,
  LlmProviderName,
  LlmResult,
  ProviderFailure,
  ProviderSpec,
} from "./types";
import { AllProvidersFailedError } from "./types";

/**
 * A ProviderSpec paired with its resolved AI SDK model instance.
 * Built by index.ts; injected directly so tests can pass MockLanguageModelV1
 * or (when the ai module is vi.mocked) a null placeholder.
 */
export type ResolvedProvider = {
  name: LlmProviderName;
  model: string;
  llm: LanguageModelV1;
};

/** Strip long alphanumeric tokens (potential secrets) from error messages. */
function sanitize(msg: string): string {
  return msg.replace(/[a-zA-Z0-9_-]{20,}/g, "[REDACTED]");
}

export async function generateTextWithFallback(
  providers: ResolvedProvider[],
  messages: LlmMessage[],
): Promise<LlmResult<string>> {
  const failures: ProviderFailure[] = [];

  for (const p of providers) {
    try {
      const result = await aiGenerateText({ model: p.llm, messages });
      return { value: result.text, provider: p.name };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      failures.push({
        provider: p.name,
        errorType: error.name,
        message: sanitize(error.message),
      });
    }
  }

  throw new AllProvidersFailedError(failures);
}

export async function generateObjectWithFallback<T>(
  providers: ResolvedProvider[],
  schema: z.ZodType<T>,
  messages: LlmMessage[],
): Promise<LlmResult<T>> {
  const failures: ProviderFailure[] = [];

  for (const p of providers) {
    try {
      const result = await aiGenerateObject({ model: p.llm, schema, messages });
      return { value: result.object, provider: p.name };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      failures.push({
        provider: p.name,
        errorType: error.name,
        message: sanitize(error.message),
      });
    }
  }

  throw new AllProvidersFailedError(failures);
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npx vitest run tests/unit/ai/llm-fallback.test.ts
```

Expected: all tests PASS.

If `vi.mock("ai", ...)` is not hoisted correctly, move the `vi.mock(...)` call to the very top of the file — before any import statements. Vitest hoists `vi.mock` automatically but only for static imports declared in the module scope.

- [ ] **Step 5: Run lint and typecheck**

```bash
npm run lint && npm run typecheck
```

Expected: green. If TypeScript complains about `generateText`/`generateObject` call signatures (the AI SDK may type `messages` as `CoreMessage[]` not `LlmMessage[]`), cast:

```ts
const result = await aiGenerateText({
  model: p.llm,
  messages: messages as Parameters<typeof aiGenerateText>[0]["messages"],
});
```

Or more simply, ensure `LlmMessage` extends `CoreMessage` (add `import type { CoreMessage } from "ai"` and verify `LlmMessage` is assignment-compatible — it should be since both have `role` and `content`).

- [ ] **Step 6: Commit**

```bash
git add src/ai/llm/fallback.ts tests/unit/ai/llm-fallback.test.ts
git commit -m "feat(ai): fallback engine — ordered provider chain with AllProvidersFailedError"
```

---

### Task 4: Providers factory, public index, env docs, and smoke tests

**Files:**
- Create: `src/ai/llm/providers.ts`
- Create: `src/ai/llm/index.ts`
- Create: `tests/unit/ai/llm-index.test.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `ProviderSpec` from `@/ai/llm/types`; AI SDK provider factories from the installed packages; `getProviderChain` from `@/ai/llm/config`; `generateTextWithFallback`, `generateObjectWithFallback`, `ResolvedProvider` from `@/ai/llm/fallback`
- Produces (public API from `@/ai/llm`):
  - `generateText(messages: LlmMessage[]): Promise<LlmResult<string>>`
  - `generateObject<T>(schema: z.ZodType<T>, messages: LlmMessage[]): Promise<LlmResult<T>>`
  - `listActiveProviders(): LlmProviderName[]`
  - `AllProvidersFailedError` (re-export)
  - `type LlmMessage`, `type LlmResult`, `type LlmProviderName` (re-exports)

---

- [ ] **Step 1: Create `src/ai/llm/providers.ts`**

This file has no unit tests — it is a thin factory over the AI SDK providers, exercised by the full suite smoke test in Step 4 and confirmed by `typecheck`. A manual Ollama smoke is the human verification.

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createXai } from "@ai-sdk/xai";
import { createOllama } from "ollama-ai-provider";
import type { LanguageModelV1 } from "ai";
import type { ProviderSpec } from "./types";

export function getModel(spec: ProviderSpec): LanguageModelV1 {
  switch (spec.name) {
    case "anthropic": {
      const p = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      return p(spec.model) as LanguageModelV1;
    }
    case "openai": {
      const p = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });
      return p(spec.model) as LanguageModelV1;
    }
    case "deepseek": {
      const p = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY! });
      return p(spec.model) as LanguageModelV1;
    }
    case "grok": {
      const p = createXai({ apiKey: process.env.XAI_API_KEY! });
      return p(spec.model) as LanguageModelV1;
    }
    case "ollama": {
      const p = createOllama({
        baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      });
      return p(spec.model) as LanguageModelV1;
    }
    case "gateway": {
      const p = createOpenAI({
        apiKey: process.env.AI_GATEWAY_API_KEY!,
        baseURL: process.env.AI_GATEWAY_BASE_URL!,
      });
      return p(spec.model) as LanguageModelV1;
    }
  }
}
```

If any provider factory's TypeScript signature returns a more specific type than `LanguageModelV1`, the `as LanguageModelV1` cast is safe — all AI SDK providers implement that interface.

If an import fails at build time (e.g., `@ai-sdk/deepseek` changed its export name), check the package's own `index.d.ts` for the correct export name:

```bash
cat node_modules/@ai-sdk/deepseek/dist/index.d.ts | grep "^export"
cat node_modules/@ai-sdk/xai/dist/index.d.ts | grep "^export"
cat node_modules/ollama-ai-provider/dist/index.d.ts | grep "^export"
```

- [ ] **Step 2: Create `src/ai/llm/index.ts`**

```ts
import { z } from "zod";
import { getProviderChain } from "./config";
import { getModel } from "./providers";
import { generateTextWithFallback, generateObjectWithFallback } from "./fallback";
import type { LlmMessage, LlmProviderName, LlmResult } from "./types";

export { AllProvidersFailedError } from "./types";
export type { LlmMessage, LlmResult, LlmProviderName };

function activeProviders() {
  return getProviderChain()
    .filter((s) => s.isConfigured)
    .map((s) => ({ name: s.name, model: s.model, llm: getModel(s) }));
}

export async function generateText(
  messages: LlmMessage[],
): Promise<LlmResult<string>> {
  return generateTextWithFallback(activeProviders(), messages);
}

export async function generateObject<T>(
  schema: z.ZodType<T>,
  messages: LlmMessage[],
): Promise<LlmResult<T>> {
  return generateObjectWithFallback(activeProviders(), schema, messages);
}

export function listActiveProviders(): LlmProviderName[] {
  return getProviderChain()
    .filter((s) => s.isConfigured)
    .map((s) => s.name);
}
```

- [ ] **Step 3: Write the smoke tests for `index.ts`**

Create `tests/unit/ai/llm-index.test.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock the three internal modules so no env vars or real models are needed.
vi.mock("@/ai/llm/config", () => ({
  getProviderChain: vi.fn(() => [
    { name: "openai", model: "gpt-4o-mini", isConfigured: true },
    { name: "anthropic", model: "claude-opus-4-8", isConfigured: false },
  ]),
}));

vi.mock("@/ai/llm/providers", () => ({
  getModel: vi.fn(() => ({})), // opaque; not called directly by index.ts logic
}));

vi.mock("@/ai/llm/fallback", () => ({
  generateTextWithFallback: vi.fn(async (providers: { name: string }[]) => ({
    value: "mocked text",
    provider: providers[0].name,
  })),
  generateObjectWithFallback: vi.fn(async (providers: { name: string }[]) => ({
    value: { name: "Acme", score: 8 },
    provider: providers[0].name,
  })),
}));

import { generateText, generateObject, listActiveProviders } from "@/ai/llm/index";
import { z } from "zod";

const msgs = [{ role: "user" as const, content: "hi" }];

describe("generateText", () => {
  it("passes only configured providers to the fallback and returns its result", async () => {
    const result = await generateText(msgs);
    expect(result.value).toBe("mocked text");
    expect(result.provider).toBe("openai");
  });
});

describe("generateObject", () => {
  it("passes schema and messages through to the fallback", async () => {
    const schema = z.object({ name: z.string(), score: z.number() });
    const result = await generateObject(schema, msgs);
    expect(result.value.name).toBe("Acme");
    expect(result.provider).toBe("openai");
  });
});

describe("listActiveProviders", () => {
  it("returns only the names of configured providers", () => {
    expect(listActiveProviders()).toEqual(["openai"]);
  });
});
```

- [ ] **Step 4: Run smoke tests and verify they pass**

```bash
npx vitest run tests/unit/ai/llm-index.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all previous tests (59 from Slice 2.1) plus the new LLM unit tests pass. The integration tests may briefly contact the test Neon DB — that is expected.

- [ ] **Step 6: Run lint and typecheck**

```bash
npm run lint && npm run typecheck
```

Expected: green. Common typecheck issues and fixes:

**Issue:** `generateText` / `generateObject` from `ai` — `messages` parameter typed as `CoreMessage[]` not compatible with `LlmMessage[]`.

**Fix:** Add an import and cast in `fallback.ts`:
```ts
import type { CoreMessage } from "ai";
// In the call:
messages: messages as CoreMessage[],
```

**Issue:** `createDeepSeek`, `createXai`, or `createOllama` not found at the expected import path.

**Fix:** Check the actual export names:
```bash
node -e "console.log(Object.keys(require('@ai-sdk/deepseek')))"
node -e "console.log(Object.keys(require('@ai-sdk/xai')))"
node -e "console.log(Object.keys(require('ollama-ai-provider')))"
```

Use whatever name the package actually exports.

- [ ] **Step 7: Update `.env.example` — add LLM provider section**

Open `.env.example` and append after the existing `OPERATOR_PASSWORD_HASH` block:

```
# --- LLM Providers (Phase 2 · Slice 2.2a) ---
# Fallback order: free/local first. Set any combination; unconfigured providers
# are silently skipped. At least one must be configured to run interviews.
# Override the order with a CSV (default: ollama,deepseek,grok,openai,anthropic):
# AI_PROVIDER_ORDER=ollama,deepseek,grok,openai,anthropic

# Ollama (local, free) — start ollama, pull a model, then set:
# OLLAMA_MODEL=llama3.2
# OLLAMA_BASE_URL=http://localhost:11434/v1

# DeepSeek — https://platform.deepseek.com/api_keys
# DEEPSEEK_API_KEY=sk-...
# DEEPSEEK_MODEL=deepseek-chat

# xAI / Grok — https://console.x.ai/
# XAI_API_KEY=xai-...
# XAI_MODEL=grok-3-mini

# OpenAI — https://platform.openai.com/api-keys
# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4o-mini

# Anthropic — https://console.anthropic.com/
ANTHROPIC_API_KEY=replace-with-anthropic-key
# ANTHROPIC_MODEL=claude-opus-4-8

# AI Gateway (optional, opt-in — add 'gateway' to AI_PROVIDER_ORDER to use)
# AI_GATEWAY_API_KEY=...
# AI_GATEWAY_BASE_URL=https://your-gateway-url
# AI_GATEWAY_MODEL=provider/model-name
```

- [ ] **Step 8: Update `README.md` — add LLM provider section**

Open `README.md` and insert the following section after the `### Vendor profiles (Phase 2 · Slice 2.1)` section:

```markdown
### LLM providers (Phase 2 · Slice 2.2a)

The platform uses a provider-agnostic LLM layer (`src/ai/llm/`) that falls back
across providers in order. No API key is needed for dev/test — all tests pass via
mocks. You only need a key when actually running an interview.

**Free/local first fallback order (default):** `ollama → deepseek → grok → openai → anthropic`

Override with `AI_PROVIDER_ORDER=comma,separated,names` in `.env.local`.

**Quickstart with Ollama (free, local):**

```bash
# Install Ollama: https://ollama.com
ollama pull llama3.2
# Add to .env.local:
echo 'OLLAMA_MODEL=llama3.2' >> .env.local
```

**Quickstart with a paid provider:**

```bash
# .env.local — add whichever you have:
ANTHROPIC_API_KEY=sk-ant-...
# or: OPENAI_API_KEY=sk-...
# or: DEEPSEEK_API_KEY=sk-...  (very cheap)
```

All other providers are optional. Unconfigured providers are silently skipped.
```

- [ ] **Step 9: Run the full test suite one final time**

```bash
npm test
```

Expected: all tests PASS (59 prior + the new unit tests, no regressions).

- [ ] **Step 10: Run build to verify the Next.js build is not broken**

```bash
npm run build
```

Expected: build succeeds. The `src/ai/llm/` module is not imported by any Next.js page yet (that's Slice 2.2b), so no server-side module issues should appear.

- [ ] **Step 11: Commit**

```bash
git add src/ai/llm/providers.ts src/ai/llm/index.ts tests/unit/ai/llm-index.test.ts .env.example README.md
git commit -m "feat(ai): providers factory, public index, and LLM provider env docs"
```

---

## Done Gate Checklist

Before surfacing this branch for operator review:

- [ ] `npm test` — all tests pass (prior 59 + new unit tests)
- [ ] `npm run lint` — clean
- [ ] `npm run typecheck` — clean
- [ ] `npm run build` — succeeds
- [ ] `.env.example` documents all 6 provider env vars
- [ ] `README.md` has LLM provider setup section
- [ ] All commits are on `feature/phase2-slice2a-llm-provider-layer`
- [ ] (Optional) Manual smoke: `OLLAMA_MODEL=llama3.2 npx tsx -e "import('@/ai/llm').then(m => m.generateText([{role:'user',content:'ping'}]).then(r => console.log(r)))"` — returns `{value: '...', provider: 'ollama'}`

Do **not** merge to `main` without operator sign-off.
