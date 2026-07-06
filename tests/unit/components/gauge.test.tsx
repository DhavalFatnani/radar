// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Gauge } from "@/app/components/ui/gauge";

describe("Gauge", () => {
  it("draws the accent arc proportional to value/max", () => {
    const { container } = render(<Gauge value={12.6} max={600} />);
    const arc = container.querySelector(".gauge-arc") as SVGPathElement;
    // 12.6/600 = 2.1% → dasharray first value ≈ 2.1 (of ~100 circumference scale)
    expect(arc.getAttribute("stroke-dasharray")).toMatch(/^2\.1 /);
  });
});
