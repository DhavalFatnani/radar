// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CampaignDetailView } from "@/app/(app)/campaigns/campaign-detail-view";
import type { SurfacedLeadRow } from "@/app/(app)/campaigns/view-model";

const leads: SurfacedLeadRow[] = [
  { leadId: "l1", companyName: "RackPro", domain: "rackpro.io", signals: 4, funding: null, headcount: 180, score: 72, wasNew: true },
  { leadId: "l2", companyName: "Acme", domain: null, signals: null, funding: null, headcount: null, score: 88, wasNew: false },
];
const stats = { companiesFetched: 24, observationsWritten: 41, leadsCreated: 8, leadsUpdated: 1, creditsSpent: 0.87 };
// Vendor value is "Initech" (not a lead company) so getByText("RackPro") stays unique to the table.
const runDetails = [{ k: "Vendor", v: "Initech" }, { k: "Geography", v: "India" }];

describe("CampaignDetailView", () => {
  it("renders the four stat tiles and the run-details kv list", () => {
    render(<CampaignDetailView stats={stats} runDetails={runDetails} leads={leads} />);
    expect(screen.getByText("Companies fetched")).toBeInTheDocument();
    expect(screen.getByText("Observations")).toBeInTheDocument();
    expect(screen.getByText("Vendor")).toBeInTheDocument();
    expect(screen.getByText("India")).toBeInTheDocument();
  });
  it("surfaces the leads table and an Actions panel", () => {
    render(<CampaignDetailView stats={stats} runDetails={runDetails} leads={leads} />);
    expect(screen.getByText("RackPro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-run/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeInTheDocument();
  });
});
