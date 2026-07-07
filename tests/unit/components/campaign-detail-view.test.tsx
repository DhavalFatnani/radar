// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { CampaignDetailView } from "@/app/(app)/campaigns/campaign-detail-view";
import type { SurfacedLeadRow } from "@/app/(app)/campaigns/view-model";

const leads: SurfacedLeadRow[] = [
  { leadId: "l1", companyName: "RackPro", domain: "rackpro.io", signals: 4, funding: null, headcount: 180, score: 72, wasNew: true },
  { leadId: "l2", companyName: "Acme", domain: null, signals: null, funding: null, headcount: null, score: 88, wasNew: false },
];
const stats = { companiesFetched: 24, observationsWritten: 41, leadsCreated: 8, leadsUpdated: 1, creditsSpent: 0.87 };
// Vendor value is "Initech" (not a lead company) so getByText("RackPro") stays unique to the table.
const runDetails = [{ k: "Vendor", v: "Initech" }, { k: "Geography", v: "India" }];
const trends = {
  companies: [10, 14, 12, 18, 20, 24],
  observations: [20, 24, 22, 30, 36, 41],
  leads: [3, 5, 4, 6, 7, 8],
  credits: [0.3, 0.5, 0.4, 0.6, 0.7, 0.87],
};

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
  it("draws a trend sparkline on every stat tile", () => {
    const { container } = render(<CampaignDetailView stats={stats} runDetails={runDetails} leads={leads} trends={trends} />);
    expect(container.querySelectorAll("svg.sparkline").length).toBe(4);
  });
});
