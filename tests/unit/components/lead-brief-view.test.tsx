// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BriefView } from "@/app/(app)/leads/[id]/brief-view";
import type { LeadBrief } from "@/ai/brief/schema";

const brief: LeadBrief = {
  why_them: "Expanding to three new regions.",
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
  why_this_vendor: "You automated a comparable site",
  objections: [{ objection: "Too expensive", response: "ROI within 6 months" }],
  disqualifier_check_passed: true,
  generatedAt: "2026-06-02T09:30:00Z",
};

describe("BriefView", () => {
  it("renders the narrative fields", () => {
    render(<BriefView brief={brief} />);
    expect(screen.getByText("Expanding to three new regions.")).toBeInTheDocument();
    expect(screen.getByText("Congrats on the Ohio expansion")).toBeInTheDocument();
    expect(screen.getByText("Warehouse automation partner")).toBeInTheDocument();
  });

  it("renders each why-now proof and its objection", () => {
    render(<BriefView brief={brief} />);
    expect(screen.getByText("Opened a new distribution centre")).toBeInTheDocument();
    expect(screen.getByText(/press release/)).toBeInTheDocument();
    expect(screen.getByText("Too expensive")).toBeInTheDocument();
    expect(screen.getByText("ROI within 6 months")).toBeInTheDocument();
  });

  it("renders a generated-at footer", () => {
    render(<BriefView brief={brief} />);
    expect(screen.getByText(/Brief generated/)).toBeInTheDocument();
  });
});
