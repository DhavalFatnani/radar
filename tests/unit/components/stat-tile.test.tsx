// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile } from "@/app/components/ui/stat-tile";

describe("StatTile", () => {
  it("renders label, value, unit, and an up-delta", () => {
    const { container } = render(<StatTile label="Leads sourced" value="142" delta="▲ 23%" deltaDir="up" points={[4,7,6,9,12]} />);
    expect(screen.getByText("Leads sourced")).toBeInTheDocument();
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(container.querySelector(".stat-delta")).toHaveClass("up");
    expect(container.querySelector("svg.sparkline path")).toBeTruthy();
  });
  it("omits the sparkline when no points given", () => {
    const { container } = render(<StatTile label="X" value="1" />);
    expect(container.querySelector("svg.sparkline")).toBeNull();
  });
});
