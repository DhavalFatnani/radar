// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Rail } from "@/app/components/shell/rail";

vi.mock("next/navigation", () => ({ usePathname: () => "/leads" }));

describe("Rail", () => {
  it("renders all 7 nav links grouped Operate/Build", () => {
    render(<Rail />);
    for (const label of [
      "Dashboard",
      "Leads",
      "Pipeline",
      "Contacts",
      "Vendors",
      "Signals",
      "Mappings",
    ]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getByText("Operate")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
  });

  it("marks the current route with aria-current", () => {
    render(<Rail />);
    const active = screen.getByRole("link", { name: /Leads/ });
    expect(active).toHaveAttribute("aria-current", "page");
  });
});
