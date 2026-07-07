// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignListView } from "@/app/(app)/campaigns/campaign-list";
import type { CampaignListRow } from "@/app/(app)/campaigns/view-model";

const NOW = new Date("2026-07-07T12:00:00Z").getTime();
const rows: CampaignListRow[] = [
  { campaignId: "a1", label: "RackPro · India · 20", vendorName: "RackPro", vendorType: "Infra", source: "crustdata", status: "done", companies: 20, leads: 8, credits: 0.87, yield: 40, createdAt: new Date("2026-07-07T10:00:00Z").toISOString() },
  { campaignId: "b2", label: "Acme · India · 10", vendorName: "Acme", vendorType: "Mktg", source: "company-fixture", status: "failed", companies: 10, leads: 1, credits: 0, yield: 10, createdAt: new Date("2026-07-06T10:00:00Z").toISOString() },
  { campaignId: "c3", label: "Globex · US · 15", vendorName: "Globex", vendorType: null, source: "crustdata", status: "running", companies: 5, leads: 0, credits: 0.2, yield: 0, createdAt: new Date("2026-07-07T11:00:00Z").toISOString() },
];

describe("CampaignListView", () => {
  it("renders the KPI row and all campaigns by default", () => {
    render(<CampaignListView rows={rows} nowMs={NOW} />);
    expect(screen.getByText("Leads sourced")).toBeInTheDocument();
    // Query the label links — the vendor <span> repeats the name, so getByText would be ambiguous.
    expect(screen.getByRole("link", { name: /RackPro/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acme/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Globex/ })).toBeInTheDocument();
  });

  it("filters the table by the status chips", async () => {
    render(<CampaignListView rows={rows} nowMs={NOW} />);
    await userEvent.click(screen.getByRole("button", { name: "Failed" }));
    expect(screen.getByRole("link", { name: /Acme/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /RackPro/ })).toBeNull();
  });

  it("filters by source via the segmented control", async () => {
    render(<CampaignListView rows={rows} nowMs={NOW} />);
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(screen.getByRole("link", { name: /Acme/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /RackPro/ })).toBeNull();
  });

  it("filters by the search box (label or vendor)", async () => {
    render(<CampaignListView rows={rows} nowMs={NOW} />);
    await userEvent.type(screen.getByLabelText(/Filter these campaigns/i), "globex");
    expect(screen.getByRole("link", { name: /Globex/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /RackPro/ })).toBeNull();
  });

  it("shows a credit budget gauge in the rail", () => {
    const { container } = render(<CampaignListView rows={rows} nowMs={NOW} />);
    expect(container.querySelector("svg.gauge .gauge-arc")).toBeTruthy();
  });
});
