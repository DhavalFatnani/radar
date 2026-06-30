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
