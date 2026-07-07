// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { CampaignTable } from "@/app/(app)/campaigns/campaign-table";
import type { CampaignListRow } from "@/app/(app)/campaigns/view-model";

const NOW = new Date("2026-07-07T12:00:00Z");
const rows: CampaignListRow[] = [
  { campaignId: "a1", label: "RackPro · India · 20", vendorName: "RackPro", vendorType: "Infra", source: "crustdata", status: "done", companies: 20, leads: 8, credits: 0.87, yield: 40, createdAt: new Date("2026-07-07T10:00:00Z").toISOString() },
  { campaignId: "b2", label: "Acme · India · 10", vendorName: "Acme", vendorType: "Mktg", source: "company-fixture", status: "failed", companies: 10, leads: 1, credits: 0, yield: 10, createdAt: new Date("2026-07-06T10:00:00Z").toISOString() },
];

describe("CampaignTable", () => {
  it("links the campaign label to its detail route with a source tag and status pill", () => {
    render(<CampaignTable rows={rows} now={NOW} />);
    expect(screen.getByRole("link", { name: /RackPro · India · 20/ })).toHaveAttribute("href", "/campaigns/a1");
    expect(document.querySelector(".pill-done")).toBeTruthy();
    expect(screen.getByText("live")).toBeInTheDocument();
    expect(screen.getByText("test")).toBeInTheDocument();
  });

  it("sorts by a numeric column when its header is clicked", async () => {
    render(<CampaignTable rows={rows} now={NOW} />);
    await userEvent.click(screen.getByRole("button", { name: /Leads/ }));
    const firstDataRow = document.querySelectorAll("tbody tr")[0];
    // ascending by leads → Acme (1) first. Query the label link (the vendor <span> also says "Acme").
    expect(within(firstDataRow as HTMLElement).getByRole("link", { name: /Acme/ })).toBeInTheDocument();
  });

  it("navigates to the campaign when a row (outside the checkbox) is clicked", async () => {
    push.mockClear();
    render(<CampaignTable rows={rows} now={NOW} />);
    await userEvent.click(screen.getByText("live")); // source-tag cell of the crustdata row
    expect(push).toHaveBeenCalledWith("/campaigns/a1");
  });

  it("does not navigate when the row checkbox is clicked", async () => {
    push.mockClear();
    render(<CampaignTable rows={rows} now={NOW} />);
    await userEvent.click(screen.getByLabelText("Select RackPro · India · 20"));
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the bulk action bar once rows are selected via select-all", async () => {
    render(<CampaignTable rows={rows} now={NOW} />);
    expect(document.querySelector(".bulkbar")).toBeNull();
    await userEvent.click(screen.getByLabelText("Select all campaigns"));
    expect(document.querySelector(".bulkbar")).toBeTruthy();
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
  });
});
