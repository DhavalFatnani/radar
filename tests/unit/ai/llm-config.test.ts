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
