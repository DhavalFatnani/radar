// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditProfileForm } from "@/app/(app)/vendors/[vendorId]/edit-profile-form";
import type { VendorProfile } from "@/lib/vendors/data";

// Mock the server action so the real module (db/auth imports) never loads in jsdom.
vi.mock("@/app/(app)/vendors/[vendorId]/actions", () => ({ updateVendor: vi.fn() }));

const vendor: VendorProfile = {
  vendorId: "v1",
  name: "Acme",
  vendorType: null,
  capabilities: ["racking"],
  constraints: null,
  idealCustomer: null,
  knownGoodSignals: null,
  differentiators: null,
  credibility: null,
  version: 1,
  interviewHistory: [],
};

describe("EditProfileForm", () => {
  it("renders the name field pre-filled and a save button", () => {
    render(<EditProfileForm vendor={vendor} types={[]} />);
    expect(screen.getByLabelText(/vendor name/i)).toHaveValue("Acme");
    expect(screen.getByRole("button", { name: /save profile/i })).toBeInTheDocument();
  });

  it("renders the vendor-type combobox seeded with the current type", () => {
    render(
      <EditProfileForm
        vendor={{ ...vendor, vendorType: "Infra" }}
        types={[{ type: "Infra", mappingCount: 3, vendorCount: 1 }]}
      />,
    );
    const combo = screen.getByRole("combobox", { name: /vendor type/i });
    expect(combo).toHaveValue("Infra");
  });
});
