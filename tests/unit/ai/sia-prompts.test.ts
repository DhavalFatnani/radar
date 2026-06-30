import { describe, it, expect } from "vitest";
import type { LlmMessage } from "@/ai/llm";
import type { VendorProfile } from "@/lib/vendors/schema";
import { appendAreaTag } from "@/ai/sia/coverage";
import { buildQuestionMessages, buildExtractionMessages } from "@/ai/sia/prompts";

const stubProfile: VendorProfile = {
  vendorId: "v1",
  name: "Acme Storage",
  capabilities: [],
  constraints: null,
  idealCustomer: null,
  knownGoodSignals: null,
  differentiators: null,
  credibility: null,
  version: 1,
  interviewHistory: [],
};

function noTags(messages: LlmMessage[]): boolean {
  return messages.every((m) => !m.content.includes("[area:"));
}

describe("buildQuestionMessages", () => {
  it("starts with a system message and opens broadly on an empty transcript", () => {
    const messages = buildQuestionMessages({ messages: [] }, "capabilities");
    expect(messages[0].role).toBe("system");
    expect(messages[0].content.toLowerCase()).toContain("what their company does");
    expect(messages).toHaveLength(1); // system only, no history yet
  });

  it("focuses on the target area mid-interview and strips tags from history", () => {
    const history: LlmMessage[] = [
      { role: "assistant", content: appendAreaTag("What do you do?", "capabilities") },
      { role: "user", content: "We install pallet racking and CCTV across warehouses." },
    ];
    const messages = buildQuestionMessages({ messages: history }, "constraints");
    expect(messages[0].content.toUpperCase()).toContain("CONSTRAINTS");
    expect(noTags(messages)).toBe(true); // the assistant tag was stripped
    expect(messages.at(-1)?.content).toContain("pallet racking");
  });

  it("includes existing profile context when the profile has content", () => {
    const filled: VendorProfile = { ...stubProfile, capabilities: ["racking"], idealCustomer: "3PLs" };
    const messages = buildQuestionMessages({ messages: [], existingProfile: filled }, "constraints");
    expect(messages[0].content).toContain("already on file");
    expect(messages[0].content).toContain("racking");
  });
});

describe("buildExtractionMessages", () => {
  it("pins the name in context, includes the transcript, and ends with an extract instruction", () => {
    const history: LlmMessage[] = [
      { role: "assistant", content: appendAreaTag("What do you do?", "capabilities") },
      { role: "user", content: "Pallet racking up to 5 tonnes in Maharashtra." },
    ];
    const messages = buildExtractionMessages({ messages: history, existingProfile: stubProfile });
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain('"Acme Storage"');
    expect(noTags(messages)).toBe(true);
    expect(messages.at(-1)?.role).toBe("user");
    expect(messages.at(-1)?.content.toLowerCase()).toContain("produce");
    expect(messages.some((m) => m.content.includes("Maharashtra"))).toBe(true);
  });
});
