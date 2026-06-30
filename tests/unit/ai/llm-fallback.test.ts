import { vi, describe, it, expect, beforeEach } from "vitest";
import type { LanguageModel } from "ai";
import type { LlmProviderName } from "@/ai/llm/types";
import { AllProvidersFailedError } from "@/ai/llm/types";

// Use vi.hoisted so these are available when vi.mock factory runs (after hoisting).
const { mockGenerateText, mockGenerateObject } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockGenerateObject: vi.fn(),
}));

// Mock the `ai` module BEFORE importing anything that imports it.
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
  return { name, model: "test-model", llm: null as unknown as LanguageModel };
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
