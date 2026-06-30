import { describe, it, expect } from "vitest";
import type { LlmMessage } from "@/ai/llm";
import type { InterviewArea } from "@/ai/sia/types";
import {
  assessCoverage,
  appendAreaTag,
  stripAreaTag,
  parseAreaTag,
  AREA_ORDER,
} from "@/ai/sia/coverage";

function exchange(area: InterviewArea, answer: string): LlmMessage[] {
  return [
    { role: "assistant", content: appendAreaTag("What can you do?", area) },
    { role: "user", content: answer },
  ];
}

describe("tag helpers", () => {
  it("appends and parses an area tag round-trip", () => {
    const tagged = appendAreaTag("Tell me more.", "knownGoodSignals");
    expect(tagged).toContain("[area:knownGoodSignals]");
    expect(parseAreaTag(tagged)).toBe("knownGoodSignals");
    expect(stripAreaTag(tagged)).toBe("Tell me more.");
  });

  it("parseAreaTag returns null when there is no tag", () => {
    expect(parseAreaTag("just a plain question")).toBeNull();
  });

  it("parseAreaTag returns null for an unknown tag word", () => {
    expect(parseAreaTag("Question?\n[area:bogus]")).toBeNull();
  });
});

describe("assessCoverage", () => {
  it("reports all areas remaining for an empty transcript", () => {
    const report = assessCoverage({ messages: [] });
    expect(report.covered).toEqual([]);
    expect(report.remaining).toEqual(AREA_ORDER);
    expect(report.isComplete).toBe(false);
  });

  it("marks an area covered only with a substantive answer", () => {
    const messages: LlmMessage[] = [
      ...exchange("capabilities", "We do pallet racking up to 5 tonnes and CCTV."),
      ...exchange("constraints", "no"), // too short → not covered
    ];
    const report = assessCoverage({ messages });
    expect(report.covered).toEqual(["capabilities"]);
    expect(report.remaining).toEqual([
      "constraints",
      "idealCustomer",
      "knownGoodSignals",
      "differentiators",
    ]);
    expect(report.isComplete).toBe(false);
  });

  it("is complete when every area has a substantive answer", () => {
    const longAnswer = "This is a detailed and substantive answer about the topic.";
    const messages: LlmMessage[] = AREA_ORDER.flatMap((a) => exchange(a, longAnswer));
    const report = assessCoverage({ messages });
    expect(report.remaining).toEqual([]);
    expect(report.isComplete).toBe(true);
  });
});
