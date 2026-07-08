// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NewVendorForm } from "@/app/(app)/vendors/new/new-vendor-form";

// Mock the server action + navigation so the real module (db/auth imports) never loads in jsdom.
vi.mock("@/app/(app)/vendors/actions", () => ({ createVendorAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("NewVendorForm", () => {
  it("renders a name input and a vendor-type combobox", () => {
    render(<NewVendorForm types={[{ type: "Infra", mappingCount: 3, vendorCount: 1 }]} />);
    expect(screen.getByLabelText(/vendor name/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /vendor type/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create vendor/i })).toBeInTheDocument();
  });
});
