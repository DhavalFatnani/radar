// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// StageControls is a client component that imports the server action (which pulls
// in @/db/client). Stub it out — the board test only covers layout + grouping.
vi.mock("@/app/(app)/pipeline/stage-controls", () => ({
  StageControls: () => null,
}));

import { PipelineBoard } from "@/app/(app)/pipeline/pipeline-board";
import type { LeadCard } from "@/lib/pipeline/schema";

const base: Omit<LeadCard, "leadId" | "companyName" | "stage"> = {
  vendorName: "Acme Infra",
  intent: "Warehouse buildout",
  score: 7.5,
  hasBrief: false,
  hasContactBlock: false,
  createdAt: new Date("2026-06-01T00:00:00Z"),
};

const leads: LeadCard[] = [
  { ...base, leadId: "10000000-0000-4000-8000-000000000001", companyName: "Zephyr Retail", stage: "sourced" },
  { ...base, leadId: "10000000-0000-4000-8000-000000000002", companyName: "Meridian Logistics", stage: "won" },
];

describe("PipelineBoard", () => {
  it("renders a column per non-empty stage and omits empty stages", () => {
    render(<PipelineBoard leads={leads} />);
    expect(screen.getByText("Sourced")).toBeInTheDocument();
    expect(screen.getByText("Won")).toBeInTheDocument();
    expect(screen.queryByText("Engaged")).not.toBeInTheDocument();
  });

  it("renders company and vendor for each lead", () => {
    render(<PipelineBoard leads={leads} />);
    expect(screen.getByText("Zephyr Retail")).toBeInTheDocument();
    expect(screen.getByText("Meridian Logistics")).toBeInTheDocument();
    expect(screen.getAllByText(/Acme Infra/).length).toBeGreaterThan(0);
  });

  it("shows brief and contacts tags only when present", () => {
    const tagged: LeadCard[] = [
      {
        ...base,
        leadId: "10000000-0000-4000-8000-000000000003",
        companyName: "Vantage Foods",
        stage: "engaged",
        hasBrief: true,
        hasContactBlock: true,
      },
    ];
    render(<PipelineBoard leads={tagged} />);
    expect(screen.getByText("brief")).toBeInTheDocument();
    expect(screen.getByText("contacts")).toBeInTheDocument();
  });
});
