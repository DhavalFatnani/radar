// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "@/app/components/ui/page-header";

describe("PageHeader", () => {
  it("renders eyebrow + title with no sub/actions (back-compat)", () => {
    render(<PageHeader eyebrow="Operate" title="Campaigns" />);
    expect(screen.getByRole("heading", { level: 1, name: "Campaigns" })).toBeInTheDocument();
    expect(screen.getByText("Operate")).toBeInTheDocument();
  });
  it("renders an optional sub line and an actions slot", () => {
    render(<PageHeader eyebrow="Operate" title="Campaigns" sub="Every sourcing run" actions={<button>New Campaign</button>} />);
    expect(screen.getByText("Every sourcing run")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Campaign" })).toBeInTheDocument();
  });
});
