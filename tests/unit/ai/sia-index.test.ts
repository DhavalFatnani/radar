import { describe, it, expect } from "vitest";
import { stripAreaTag, assessCoverage } from "@/ai/sia";
import * as sia from "@/ai/sia";

describe("@/ai/sia barrel", () => {
  it("re-exports stripAreaTag, which removes the [area:X] tag", () => {
    expect(stripAreaTag("What do you do?\n[area:capabilities]")).toBe("What do you do?");
  });

  it("re-exports assessCoverage", () => {
    expect(typeof assessCoverage).toBe("function");
  });
});

describe("@/ai/sia public API", () => {
  it("exposes the three engine functions", () => {
    expect(typeof sia.nextQuestion).toBe("function");
    expect(typeof sia.extractProfile).toBe("function");
    expect(typeof sia.assessCoverage).toBe("function");
  });

  it("assessCoverage is callable without an LLM (pure)", () => {
    const report = sia.assessCoverage({ messages: [] });
    expect(report.isComplete).toBe(false);
    expect(report.remaining).toContain("capabilities");
  });
});
