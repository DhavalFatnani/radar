// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentStrip, type StripCampaign, type StripLead } from "@/app/(app)/dashboard/recent-strip";

const campaigns: StripCampaign[] = [
  { campaignId: "c1", label: "RackPro · India · 20", status: "done", leadsCreated: 8 },
];
const leads: StripLead[] = [
  { leadId: "l1", companyName: "Anveshan", score: 72 },
];

describe("RecentStrip", () => {
  it("renders recent campaigns and fresh leads with links", () => {
    render(<RecentStrip campaigns={campaigns} leads={leads} />);
    expect(screen.getByRole("link", { name: /RackPro · India · 20/ })).toHaveAttribute("href", "/campaigns/c1");
    expect(screen.getByRole("link", { name: /Anveshan/ })).toHaveAttribute("href", "/leads/l1");
    expect(screen.getByText(/8 leads/i)).toBeInTheDocument();
  });
});
