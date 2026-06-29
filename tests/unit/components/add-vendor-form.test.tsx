// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AddVendorForm } from "@/app/(app)/vendors/add-vendor-form";

// Mock the server action so the real module (db/auth imports) never loads in jsdom.
vi.mock("@/app/(app)/vendors/actions", () => ({ createVendor: vi.fn() }));

describe("AddVendorForm", () => {
  it("renders a labeled name input and a submit button", () => {
    render(<AddVendorForm />);
    expect(screen.getByLabelText(/vendor name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add vendor/i })).toBeInTheDocument();
  });
});
