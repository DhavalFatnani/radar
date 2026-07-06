// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CampaignList, type CampaignRow } from "@/app/(app)/campaigns/campaign-list";

const rows: CampaignRow[] = [
  { campaignId: "10000000-0000-4000-8000-000000000001", label: "RackPro · India · 20", source: "crustdata", status: "done",
    stats: { companiesFetched: 24, observationsWritten: 41, leadsCreated: 8, leadsUpdated: 1, creditsSpent: 0.87 } },
  { campaignId: "10000000-0000-4000-8000-000000000002", label: "Acme · India · 10", source: "company-fixture", status: "failed",
    stats: null },
];

describe("CampaignList", () => {
  it("links each campaign to its detail route and shows a status badge", () => {
    render(<CampaignList campaigns={rows} />);
    const link = screen.getByRole("link", { name: /RackPro · India · 20/ });
    expect(link).toHaveAttribute("href", "/campaigns/10000000-0000-4000-8000-000000000001");
    expect(document.querySelector(".badge-done")?.textContent).toBe("done");
    expect(document.querySelector(".badge-failed")?.textContent).toBe("failed");
  });

  it("shows leads-created for a done run", () => {
    render(<CampaignList campaigns={rows} />);
    expect(screen.getByText(/8 leads/i)).toBeInTheDocument();
  });

  it("renders an empty message for no campaigns", () => {
    render(<CampaignList campaigns={[]} />);
    expect(screen.getByText(/no campaigns/i)).toBeInTheDocument();
  });
});
