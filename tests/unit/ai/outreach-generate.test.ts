import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockGenerateObject } = vi.hoisted(() => ({ mockGenerateObject: vi.fn() }));
vi.mock("@/ai/llm", () => ({ generateObject: mockGenerateObject }));

import { generateOutreach } from "@/ai/outreach/generate";
import { buildOutreachMessages } from "@/ai/outreach/prompts";
import { outreachDraftSchema, type OutreachInput } from "@/ai/outreach/schema";

const input: OutreachInput = {
  company: { name: "NorthPort Foods", description: "Cold-chain distributor" },
  vendor: { name: "RackPro Infra", vendorType: "Infra" },
  intent: "Warehouse racking fit-out",
  mode: "operator_handles",
  brief: {
    why_them: "They just announced a new DC and need racking fast.",
    what_they_need: "Pallet racking for a new cold-chain distribution centre.",
    hook: "Saw NorthPort's new DC announcement — we install racking in 48h.",
    why_this_vendor: "RackPro's 48-hour crews match the tight fit-out window.",
  },
};

const draft = {
  subject: "Racking for your new NorthPort DC",
  body: "Hi — saw the new DC announcement. RackPro installs pallet racking in 48h.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateObject.mockResolvedValue({ value: draft, provider: "anthropic" });
});

describe("buildOutreachMessages", () => {
  it("emits a grounded system message and a JSON context user message", () => {
    const messages = buildOutreachMessages(input);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Do NOT invent");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("NorthPort Foods");
    expect(messages[1].content).toContain("Saw NorthPort's new DC announcement");
  });
});

describe("generateOutreach", () => {
  it("calls generateObject with the draft schema and returns the result", async () => {
    const result = await generateOutreach(input);
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    expect(mockGenerateObject.mock.calls[0][0]).toBe(outreachDraftSchema);
    expect(mockGenerateObject.mock.calls[0][1]).toEqual(buildOutreachMessages(input));
    expect(result.value).toEqual(draft);
    expect(result.provider).toBe("anthropic");
  });

  it("surfaces a provider failure (does not swallow the throw)", async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error("all providers down"));
    await expect(generateOutreach(input)).rejects.toThrow("all providers down");
  });
});

describe("outreachDraftSchema", () => {
  it("accepts a well-formed draft", () => {
    expect(outreachDraftSchema.safeParse(draft).success).toBe(true);
  });
  it("rejects an empty body", () => {
    expect(outreachDraftSchema.safeParse({ subject: "x", body: "" }).success).toBe(false);
  });
  it("rejects an empty subject", () => {
    expect(outreachDraftSchema.safeParse({ subject: "", body: "x" }).success).toBe(false);
  });
});
