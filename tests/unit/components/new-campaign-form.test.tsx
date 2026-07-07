// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/(app)/campaigns/actions", () => ({ createCampaignAction: vi.fn() }));

import { NewCampaignForm, type VendorSnapshot } from "@/app/(app)/campaigns/new-campaign-form";

const vendors: VendorSnapshot[] = [
  { vendorId: "v1", name: "Dhaval", vendorType: "Infra", version: 3, capabilities: ["WMS", "3PL"], runnable: true, signalFamilies: ["hiring", "money"], recentRuns: [{ label: "Dhaval · IND · 20", leads: 8, when: "2h" }] },
  { vendorId: "v2", name: "Nimbus", vendorType: null, version: 1, capabilities: [], runnable: false, signalFamilies: [], recentRuns: [] },
];

describe("NewCampaignForm", () => {
  it("shows the ready gate + vendor snapshot for a runnable vendor, submit enabled", () => {
    render(<NewCampaignForm vendors={vendors} />);
    expect(screen.getByRole("button", { name: /Find Leads/i })).toBeEnabled();
    expect(screen.getAllByText(/Infra/).length).toBeGreaterThan(0);     // snapshot type
    expect(screen.getAllByText(/Ready to source/i).length).toBeGreaterThan(0);
  });
  it("disables submit + shows the needs-a-mapping banner when the picked vendor is not ready", async () => {
    render(<NewCampaignForm vendors={vendors} />);
    await userEvent.selectOptions(screen.getByLabelText(/Vendor/i), "v2");
    expect(screen.getAllByText(/No approved mappings yet|no approved mappings|mapping/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Find Leads/i })).toBeDisabled();
  });
  it("marks not-yet-applied controls with a 'soon' affordance", () => {
    render(<NewCampaignForm vendors={vendors} />);
    expect(screen.getAllByText(/soon/i).length).toBeGreaterThan(0);
  });
});
