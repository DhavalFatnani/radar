import { vi, describe, it, expect, beforeEach } from "vitest";
import type { BriefInput } from "@/ai/brief/schema";
import { leadBriefDraftSchema } from "@/ai/brief/schema";
import { buildBriefMessages } from "@/ai/brief/prompts";

const { mockGenerateObject } = vi.hoisted(() => ({ mockGenerateObject: vi.fn() }));
vi.mock("@/ai/llm", () => ({ generateObject: mockGenerateObject }));

import { generateBrief } from "@/ai/brief/generate";

const input: BriefInput = {
  company: { name: "NorthPort Foods", description: "Cold-chain distributor" },
  vendor: {
    name: "RackPro Infra",
    vendorType: "Infra",
    capabilities: ["pallet racking up to 5t", "mezzanine floors"],
    idealCustomer: null,
    differentiators: "48-hour install crews",
  },
  intent: "Warehouse racking fit-out",
  mappingName: "New DC -> racking",
  score: 88,
  signals: [
    {
      signalId: "SIG-EXP-NEW-FACILITY",
      signalName: "New facility announced",
      strength: "very_high",
      detectedAt: "2026-06-01T00:00:00.000Z",
      source: "press-release",
      evidence: ["https://example.com/pr"],
      freshnessVerdict: "recent",
    },
  ],
};

const draft = {
  why_them: "They just announced a new DC and need racking fast.",
  why_now: [{ signalId: "SIG-EXP-NEW-FACILITY", claim: "New DC announced — racking window is open now." }],
  what_they_need: "Pallet racking for a new cold-chain distribution centre.",
  hook: "Saw NorthPort's new DC announcement — we install racking in 48h.",
  why_this_vendor: "RackPro's 48-hour crews match the tight fit-out window.",
  objections: [{ objection: "May already have a supplier", response: "Offer a rapid-install second-source quote." }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateObject.mockResolvedValue({ value: draft, provider: "anthropic" });
});

describe("buildBriefMessages", () => {
  it("emits a grounded system message and a JSON context user message", () => {
    const messages = buildBriefMessages(input);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Do NOT invent");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("SIG-EXP-NEW-FACILITY");
    expect(messages[1].content).toContain("NorthPort Foods");
  });
});

describe("generateBrief", () => {
  it("calls generateObject with the draft schema and returns the result", async () => {
    const result = await generateBrief(input);
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    expect(mockGenerateObject.mock.calls[0][0]).toBe(leadBriefDraftSchema);
    expect(result.value).toEqual(draft);
    expect(result.provider).toBe("anthropic");
  });
});

describe("leadBriefDraftSchema", () => {
  it("accepts a well-formed draft", () => {
    expect(leadBriefDraftSchema.safeParse(draft).success).toBe(true);
  });
  it("rejects a why_now entry missing signalId", () => {
    const bad = { ...draft, why_now: [{ claim: "no id" }] };
    expect(leadBriefDraftSchema.safeParse(bad).success).toBe(false);
  });
});
