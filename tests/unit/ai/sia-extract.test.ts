import { vi, describe, it, expect, beforeEach } from "vitest";
import type { LlmMessage } from "@/ai/llm";
import type { VendorProfile, VendorProfileInput } from "@/lib/vendors/schema";

const { mockGenerateObject } = vi.hoisted(() => ({ mockGenerateObject: vi.fn() }));
vi.mock("@/ai/llm", () => ({ generateObject: mockGenerateObject }));

import { extractProfile } from "@/ai/sia/extract";

const transcript: LlmMessage[] = [
  { role: "assistant", content: "What do you do?" },
  { role: "user", content: "Pallet racking up to 5 tonnes in Maharashtra." },
];

const extracted: VendorProfileInput = {
  name: "Hallucinated Name",
  capabilities: ["pallet racking"],
  constraints: { geographies: ["Maharashtra"] },
  idealCustomer: undefined,
  knownGoodSignals: undefined,
  differentiators: undefined,
  credibility: undefined,
};

const stub: VendorProfile = {
  vendorId: "v1",
  name: "Acme Storage",
  vendorType: null,
  capabilities: [],
  constraints: null,
  idealCustomer: null,
  knownGoodSignals: null,
  differentiators: null,
  credibility: null,
  version: 1,
  interviewHistory: [],
};

beforeEach(() => vi.clearAllMocks());

describe("extractProfile", () => {
  it("returns the validated value and provider", async () => {
    mockGenerateObject.mockResolvedValueOnce({ value: extracted, provider: "anthropic" });
    const result = await extractProfile({ messages: transcript });
    expect(result.provider).toBe("anthropic");
    expect(result.value.capabilities).toEqual(["pallet racking"]);
  });

  it("pins name from the existing profile over a hallucinated one", async () => {
    mockGenerateObject.mockResolvedValueOnce({ value: extracted, provider: "anthropic" });
    const result = await extractProfile({ messages: transcript, existingProfile: stub });
    expect(result.value.name).toBe("Acme Storage");
  });

  it("keeps the model name when there is no existing profile", async () => {
    mockGenerateObject.mockResolvedValueOnce({ value: extracted, provider: "anthropic" });
    const result = await extractProfile({ messages: transcript });
    expect(result.value.name).toBe("Hallucinated Name");
  });

  it("does not swallow LLM errors", async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error("all providers failed"));
    await expect(extractProfile({ messages: transcript })).rejects.toThrow("all providers failed");
  });
});
