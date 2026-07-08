// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { VendorListView } from "@/app/(app)/vendors/vendor-list-view";
import type { VendorListRow } from "@/lib/vendors/schema";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const rows: VendorListRow[] = [
  {
    vendorId: "v1",
    name: "RackPro",
    vendorType: "Infra",
    version: 3,
    capabilitiesPreview: "racking, cctv",
    lastChangeAt: null,
    mappingCount: 2,
    readiness: "runnable",
  },
  {
    vendorId: "v2",
    name: "OpsCo",
    vendorType: "Ops",
    version: 1,
    capabilitiesPreview: "—",
    lastChangeAt: null,
    mappingCount: 0,
    readiness: "needs_mapping",
  },
  {
    vendorId: "v3",
    name: "Blank",
    vendorType: null,
    version: 1,
    capabilitiesPreview: "—",
    lastChangeAt: null,
    mappingCount: 0,
    readiness: "no_type",
  },
];
const types = [
  { type: "Infra", mappingCount: 2, vendorCount: 1 },
  { type: "Ops", mappingCount: 0, vendorCount: 1 },
];

describe("VendorListView", () => {
  it("renders type + readiness for each vendor", () => {
    render(<VendorListView rows={rows} types={types} nowMs={0} />);
    // Scope to the table: "Runnable" also appears as a Segmented filter button label
    // in the command bar, so an unscoped getByText("Runnable") is ambiguous.
    const table = screen.getByRole("table");
    expect(within(table).getByText("RackPro")).toBeInTheDocument();
    expect(within(table).getByText("Runnable")).toBeInTheDocument();
    expect(within(table).getByText("Needs mapping")).toBeInTheDocument();
    expect(within(table).getByText("No type")).toBeInTheDocument();
  });

  it("filters to runnable via the segmented control", () => {
    render(<VendorListView rows={rows} types={types} nowMs={0} />);
    fireEvent.click(screen.getByRole("button", { name: /^runnable$/i }));
    expect(screen.getByText("RackPro")).toBeInTheDocument();
    expect(screen.queryByText("OpsCo")).not.toBeInTheDocument();
    expect(screen.queryByText("Blank")).not.toBeInTheDocument();
  });

  it("filters by search text", () => {
    render(<VendorListView rows={rows} types={types} nowMs={0} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ops" } });
    expect(screen.getByText("OpsCo")).toBeInTheDocument();
    expect(screen.queryByText("RackPro")).not.toBeInTheDocument();
  });

  it("navigates on whole-row click", () => {
    render(<VendorListView rows={rows} types={types} nowMs={0} />);
    fireEvent.click(screen.getByText("RackPro").closest("tr")!);
    expect(push).toHaveBeenCalledWith("/vendors/v1");
  });

  it("shows types-in-use chips in the rail", () => {
    render(<VendorListView rows={rows} types={types} nowMs={0} />);
    // Infra (vendorCount 1) and Ops (vendorCount 1) both appear as rail chips
    const rail = screen.getByRole("complementary");
    expect(within(rail).getByText(/Infra/)).toBeInTheDocument();
    expect(within(rail).getByText(/Ops/)).toBeInTheDocument();
  });
});
