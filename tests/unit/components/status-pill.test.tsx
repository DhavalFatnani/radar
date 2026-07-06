// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "@/app/components/ui/status-pill";
import { KvList } from "@/app/components/ui/kv-list";
import { ToggleRow } from "@/app/components/ui/toggle-row";

describe("StatusPill", () => {
  it("renders a status class + text", () => {
    const { container } = render(<StatusPill status="done" />);
    expect(container.querySelector(".pill-done")?.textContent).toBe("done");
  });
});
describe("KvList", () => {
  it("renders key/value rows", () => {
    render(<KvList rows={[{ k: "Vendor", v: "Dhaval" }, { k: "Geo", v: "IND" }]} />);
    expect(screen.getByText("Vendor")).toBeInTheDocument();
    expect(screen.getByText("Dhaval")).toBeInTheDocument();
  });
});
describe("ToggleRow", () => {
  it("renders label, helper text, and a checkbox reflecting defaultChecked", () => {
    render(<ToggleRow label="Exclude seen" description="Skip past companies" name="excludeSeen" defaultChecked />);
    expect(screen.getByText("Exclude seen")).toBeInTheDocument();
    expect(screen.getByText("Skip past companies")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});
