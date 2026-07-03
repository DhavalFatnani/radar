// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// next/link needs the app-router context at runtime; stub it to a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { LeadsList } from "@/app/(app)/leads/leads-list";
import type { LeadCard } from "@/lib/pipeline/schema";

const base: Omit<LeadCard, "leadId" | "companyName" | "stage"> = {
  vendorName: "Acme Infra",
  intent: "Warehouse buildout",
  score: 8.5,
  hasBrief: true,
  hasContactBlock: false,
  createdAt: new Date("2026-06-01T00:00:00Z"),
};

const leads: LeadCard[] = [
  { ...base, leadId: "10000000-0000-4000-8000-000000000001", companyName: "Zephyr Retail", stage: "sourced" },
  { ...base, leadId: "10000000-0000-4000-8000-000000000002", companyName: "Meridian Logistics", stage: "won" },
];

describe("LeadsList", () => {
  it("renders a linked row per lead pointing at its detail page", () => {
    render(<LeadsList leads={leads} />);
    const zephyr = screen.getByRole("link", { name: /Zephyr Retail/ });
    expect(zephyr).toHaveAttribute("href", "/leads/10000000-0000-4000-8000-000000000001");
    const meridian = screen.getByRole("link", { name: /Meridian Logistics/ });
    expect(meridian).toHaveAttribute("href", "/leads/10000000-0000-4000-8000-000000000002");
  });

  it("shows the stage label and score for each lead", () => {
    render(<LeadsList leads={leads} />);
    expect(screen.getByText("Sourced")).toBeInTheDocument();
    expect(screen.getByText("Won")).toBeInTheDocument();
    expect(screen.getAllByText("8.5").length).toBe(2);
  });

  it("shows a brief tag only where a brief is present", () => {
    render(<LeadsList leads={leads} />);
    expect(screen.getAllByText("brief").length).toBe(2);
    expect(screen.queryByText("contacts")).not.toBeInTheDocument();
  });
});
