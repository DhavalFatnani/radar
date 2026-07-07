// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SurfacedLeadsTable } from "@/app/(app)/campaigns/surfaced-leads-table";
import type { SurfacedLeadRow } from "@/app/(app)/campaigns/view-model";

const rows: SurfacedLeadRow[] = [
  { leadId: "l1", companyName: "RackPro", domain: "rackpro.io", signals: 4, funding: "2026-03-01", headcount: 180, score: 72, wasNew: true },
  { leadId: "l2", companyName: "Acme", domain: null, signals: null, funding: null, headcount: null, score: 88, wasNew: false },
];

describe("SurfacedLeadsTable", () => {
  it("renders companies, an Open link, and '—' for missing cells", () => {
    render(<SurfacedLeadsTable rows={rows} />);
    expect(screen.getByText("RackPro")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Open/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
  it("sorts by score descending by default (Acme 88 before RackPro 72)", () => {
    render(<SurfacedLeadsTable rows={rows} />);
    const bodyRows = document.querySelectorAll("tbody tr");
    expect(bodyRows[0].textContent).toContain("Acme");
  });
  it("filters to new-only when that segment is chosen", async () => {
    render(<SurfacedLeadsTable rows={rows} />);
    await userEvent.click(screen.getByRole("button", { name: "New only" }));
    expect(screen.getByText("RackPro")).toBeInTheDocument();
    expect(screen.queryByText("Acme")).toBeNull();
  });
});
