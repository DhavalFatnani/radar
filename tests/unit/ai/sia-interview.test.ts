import { vi, describe, it, expect, beforeEach } from "vitest";
import type { LlmMessage } from "@/ai/llm";
import { appendAreaTag } from "@/ai/sia/coverage";

const { mockGenerateText } = vi.hoisted(() => ({ mockGenerateText: vi.fn() }));
vi.mock("@/ai/llm", () => ({ generateText: mockGenerateText }));

import { nextQuestion } from "@/ai/sia/interview";

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateText.mockResolvedValue({ value: "What exactly do you install?", provider: "anthropic" });
});

describe("nextQuestion", () => {
  it("targets capabilities first and tags the stored turn", async () => {
    const result = await nextQuestion({ messages: [] });
    expect(result.targetArea).toBe("capabilities");
    expect(result.question).toBe("What exactly do you install?");
    expect(result.transcriptEntry.role).toBe("assistant");
    expect(result.transcriptEntry.content).toContain("[area:capabilities]");
    expect(result.coverage.isComplete).toBe(false);
  });

  it("advances to the next uncovered area", async () => {
    const messages: LlmMessage[] = [
      { role: "assistant", content: appendAreaTag("What do you do?", "capabilities") },
      { role: "user", content: "We install pallet racking and CCTV across warehouses." },
    ];
    const result = await nextQuestion({ messages });
    expect(result.targetArea).toBe("constraints");
  });

  it("never sends [area:X] tags to the LLM", async () => {
    const messages: LlmMessage[] = [
      { role: "assistant", content: appendAreaTag("What do you do?", "capabilities") },
      { role: "user", content: "We install pallet racking and CCTV across warehouses." },
    ];
    await nextQuestion({ messages });
    const sent = mockGenerateText.mock.calls[0][0] as LlmMessage[];
    expect(sent.every((m) => !m.content.includes("[area:"))).toBe(true);
  });
});
