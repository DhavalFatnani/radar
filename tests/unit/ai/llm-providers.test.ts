import { describe, it, expect } from "vitest";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { getModel } from "@/ai/llm/providers";
import type { ProviderSpec } from "@/ai/llm/types";

/**
 * No-network guard: each provider's model factory must return a model whose
 * specificationVersion is one of the values ai@7 actually supports (v2/v3/v4).
 * A "v1" model (e.g. from ollama-ai-provider@1.x) would be silently wrapped
 * by a Proxy that lies about its version but passes incompatible call-options
 * to the underlying doGenerate — causing a runtime crash on first real call.
 *
 * These tests use fake/placeholder keys; no network is contacted.
 */

const SUPPORTED_SPEC_VERSIONS = ["v2", "v3", "v4"];

function spec(overrides: Partial<ProviderSpec>): ProviderSpec {
  return { name: "openai", model: "test-model", isConfigured: true, ...overrides };
}

describe("getModel — specificationVersion guard", () => {
  it("ollama model reports a v7-supported specificationVersion", () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434/v1";
    const model = getModel(spec({ name: "ollama", model: "llama3.2" }));
    expect(SUPPORTED_SPEC_VERSIONS).toContain((model as unknown as LanguageModelV4).specificationVersion);
    delete process.env.OLLAMA_BASE_URL;
  });

  it("anthropic model reports a v7-supported specificationVersion", () => {
    process.env.ANTHROPIC_API_KEY = "sk-fake-ant";
    const model = getModel(spec({ name: "anthropic", model: "claude-opus-4-8" }));
    expect(SUPPORTED_SPEC_VERSIONS).toContain((model as unknown as LanguageModelV4).specificationVersion);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("openai model reports a v7-supported specificationVersion", () => {
    process.env.OPENAI_API_KEY = "sk-fake-oai";
    const model = getModel(spec({ name: "openai", model: "gpt-4o-mini" }));
    expect(SUPPORTED_SPEC_VERSIONS).toContain((model as unknown as LanguageModelV4).specificationVersion);
    delete process.env.OPENAI_API_KEY;
  });

  it("deepseek model reports a v7-supported specificationVersion", () => {
    process.env.DEEPSEEK_API_KEY = "sk-fake-ds";
    const model = getModel(spec({ name: "deepseek", model: "deepseek-chat" }));
    expect(SUPPORTED_SPEC_VERSIONS).toContain((model as unknown as LanguageModelV4).specificationVersion);
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("grok model reports a v7-supported specificationVersion", () => {
    process.env.XAI_API_KEY = "xai-fake";
    const model = getModel(spec({ name: "grok", model: "grok-3-mini" }));
    expect(SUPPORTED_SPEC_VERSIONS).toContain((model as unknown as LanguageModelV4).specificationVersion);
    delete process.env.XAI_API_KEY;
  });

  it("gateway model reports a v7-supported specificationVersion", () => {
    process.env.AI_GATEWAY_API_KEY = "gw-fake";
    process.env.AI_GATEWAY_BASE_URL = "https://my-gateway.example.com/v1";
    const model = getModel(
      spec({ name: "gateway", model: "provider/model-name" }),
    );
    expect(SUPPORTED_SPEC_VERSIONS).toContain((model as unknown as LanguageModelV4).specificationVersion);
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.AI_GATEWAY_BASE_URL;
  });
});
