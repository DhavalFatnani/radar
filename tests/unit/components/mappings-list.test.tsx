// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MappingList } from "@/app/(app)/mappings/mapping-list";
import type { MappingDefinition } from "@/lib/mappings/schema";

const BASE: Omit<MappingDefinition, "mappingId" | "name" | "status"> = {
  intentDescription: null,
  servesVendorType: "Infra",
  requiredSignals: ["SIG-EXP-NEW-FACILITY"],
  supportingSignals: [],
  thresholdRule: null,
  timingWindowDays: null,
  strengthLogic: null,
  disqualifiers: null,
  origin: null,
};

const fixtures: MappingDefinition[] = [
  { ...BASE, mappingId: "10000000-0000-4000-8000-000000000001", name: "Warehouse expansion", status: "proposed" },
  { ...BASE, mappingId: "10000000-0000-4000-8000-000000000002", name: "Offline marketing push", status: "approved" },
];

describe("MappingList", () => {
  it("renders proposed mapping before approved", () => {
    render(<MappingList mappings={fixtures} />);
    const links = screen.getAllByRole("link");
    const texts = links.map((l) => l.textContent ?? "");
    const proposedIdx = texts.findIndex((t) => t.includes("Warehouse expansion"));
    const approvedIdx = texts.findIndex((t) => t.includes("Offline marketing push"));
    expect(proposedIdx).toBeGreaterThanOrEqual(0);
    expect(approvedIdx).toBeGreaterThanOrEqual(0);
    expect(proposedIdx).toBeLessThan(approvedIdx);
  });
  it("links each mapping to its detail route", () => {
    render(<MappingList mappings={fixtures} />);
    const link = screen.getByRole("link", { name: /warehouse expansion/i });
    expect(link).toHaveAttribute("href", "/mappings/10000000-0000-4000-8000-000000000001");
  });
  it("renders a status badge with text 'proposed'", () => {
    render(<MappingList mappings={fixtures} />);
    const badges = document.querySelectorAll(".badge-proposed");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0].textContent).toBe("proposed");
  });
  it("renders empty message when array is empty", () => {
    render(<MappingList mappings={[]} />);
    expect(screen.getByText("No mappings match this filter.")).toBeInTheDocument();
  });
});
