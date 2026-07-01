// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignalList } from "@/app/(app)/signals/signal-list";
import type { SignalDefinition } from "@/lib/signals/schema";

const BASE: Omit<SignalDefinition, "signalId" | "name" | "family" | "status"> = {
  description: null,
  sources: null,
  detectionMethod: null,
  triggerRule: null,
  strength: "high",
  falsePositiveRisk: "low",
  freshnessWindowDays: null,
  polarity: null,
  entityType: null,
  example: null,
  origin: null,
  proposedBy: null,
  dateAdded: null,
  lastReviewed: null,
};

const fixtures: SignalDefinition[] = [
  { ...BASE, signalId: "SIG-HIRING-001", name: "Hiring Surge", family: "hiring", status: "proposed" },
  { ...BASE, signalId: "SIG-MONEY-001", name: "Funding Round", family: "money", status: "approved" },
  { ...BASE, signalId: "SIG-EXP-001", name: "Expansion Plan", family: "expansion", status: "approved" },
];

describe("SignalList", () => {
  it("renders proposed signal before approved signals", () => {
    render(<SignalList signals={fixtures} />);
    const links = screen.getAllByRole("link");
    const texts = links.map((l) => l.textContent ?? "");
    const proposedIdx = texts.findIndex((t) => t.includes("Hiring Surge"));
    const approvedIdx = texts.findIndex((t) => t.includes("Funding Round"));
    expect(proposedIdx).toBeGreaterThanOrEqual(0);
    expect(approvedIdx).toBeGreaterThanOrEqual(0);
    expect(proposedIdx).toBeLessThan(approvedIdx);
  });

  it("renders a signalId in the document", () => {
    render(<SignalList signals={fixtures} />);
    expect(screen.getByText(/SIG-HIRING-001/)).toBeInTheDocument();
  });

  it("renders a status badge with text 'proposed'", () => {
    render(<SignalList signals={fixtures} />);
    // Both the group heading and the badge have the text "proposed"; ensure at least one badge exists.
    const badges = document.querySelectorAll(".badge-proposed");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0].textContent).toBe("proposed");
  });

  it("renders a family label 'hiring'", () => {
    render(<SignalList signals={fixtures} />);
    expect(screen.getByText(/hiring/)).toBeInTheDocument();
  });

  it("renders empty message when signals array is empty", () => {
    render(<SignalList signals={[]} />);
    expect(screen.getByText("No signals match this filter.")).toBeInTheDocument();
  });
});
