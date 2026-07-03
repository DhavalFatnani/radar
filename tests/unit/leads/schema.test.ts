import { describe, it, expect } from "vitest";
import {
  formatScore,
  formatBriefDate,
  OUTREACH_LABELS,
  leadBriefSchema,
} from "@/lib/leads/schema";

const validBrief = {
  why_them: "Expanding to three new regions this year.",
  why_now: [
    {
      signalId: "sig-1",
      claim: "Opened a new distribution centre",
      date: "2026-06-01T00:00:00Z",
      source: "press release",
      evidence: ["https://example.com/dc"],
    },
  ],
  what_they_need: "Warehouse automation partner",
  hook: "Congrats on the Ohio expansion",
  why_this_vendor: "You automated a comparable 200k sqft site",
  objections: [{ objection: "Too expensive", response: "ROI within 6 months" }],
  disqualifier_check_passed: true,
  generatedAt: "2026-06-02T09:30:00Z",
};

describe("formatScore", () => {
  it("renders a dash for null", () => {
    expect(formatScore(null)).toBe("—");
  });
  it("renders one decimal place", () => {
    expect(formatScore(8.5)).toBe("8.5");
    expect(formatScore(87)).toBe("87.0");
  });
});

describe("formatBriefDate", () => {
  it("formats an ISO date deterministically in UTC", () => {
    expect(formatBriefDate("2026-06-01T00:00:00Z")).toBe("Jun 1, 2026");
    expect(formatBriefDate("2026-12-31T23:59:59Z")).toBe("Dec 31, 2026");
  });
  it("returns the raw string when the date is unparseable", () => {
    expect(formatBriefDate("not-a-date")).toBe("not-a-date");
  });
});

describe("OUTREACH_LABELS", () => {
  it("maps every outreach mode to a human label", () => {
    expect(OUTREACH_LABELS.operator_handles).toBe("Operator handles");
    expect(OUTREACH_LABELS.handed_to_vendor).toBe("Handed to vendor");
  });
});

describe("leadBriefSchema", () => {
  it("accepts a well-formed persisted brief", () => {
    expect(leadBriefSchema.safeParse(validBrief).success).toBe(true);
  });
  it("rejects a brief missing required fields", () => {
    expect(leadBriefSchema.safeParse({ hook: "just a hook" }).success).toBe(false);
  });
  it("rejects a brief whose disqualifier check did not pass", () => {
    expect(
      leadBriefSchema.safeParse({ ...validBrief, disqualifier_check_passed: false }).success,
    ).toBe(false);
  });
});
