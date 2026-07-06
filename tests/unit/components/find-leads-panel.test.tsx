// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindLeadsPanel } from "@/app/(app)/vendors/[vendorId]/find-leads-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// Mock the server action so the real module (db/auth imports) never loads in jsdom —
// same pattern as edit-profile-form.test.tsx / mappings-add-form.test.tsx.
vi.mock("@/app/(app)/campaigns/actions", () => ({ findLeadsAction: vi.fn() }));

describe("FindLeadsPanel", () => {
  const vendorId = "10000000-0000-4000-8000-000000000001";

  it("shows the ready state and an enabled Find Leads button when runnable", () => {
    render(<FindLeadsPanel vendorId={vendorId} readiness={{ found: true, runnable: true, vendorType: "Infra", signalFamilies: ["money", "hiring"] }} />);
    expect(screen.getByText(/ready to source/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /find leads/i })).not.toBeDisabled();
  });

  it("shows a needs-a-mapping gate and no submit button when not runnable", () => {
    render(<FindLeadsPanel vendorId={vendorId} readiness={{ found: true, runnable: false, vendorType: "Infra", signalFamilies: [] }} />);
    expect(screen.getByText(/needs an approved mapping/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /find leads/i })).toBeNull();
  });
});
