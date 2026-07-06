// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ScoreMeter, scoreHeatVar } from "@/app/components/ui/score-meter";

describe("scoreHeatVar", () => {
  it("maps value buckets to the strength ramp (cool→hot)", () => {
    expect(scoreHeatVar(10)).toBe("--strength-low");
    expect(scoreHeatVar(24)).toBe("--strength-low");
    expect(scoreHeatVar(25)).toBe("--strength-medium");
    expect(scoreHeatVar(49)).toBe("--strength-medium");
    expect(scoreHeatVar(50)).toBe("--strength-high");
    expect(scoreHeatVar(74)).toBe("--strength-high");
    expect(scoreHeatVar(75)).toBe("--strength-vhigh");
    expect(scoreHeatVar(100)).toBe("--strength-vhigh");
  });
});

describe("ScoreMeter", () => {
  it("renders the number and a fill sized to the value with the heat color", () => {
    const { container } = render(<ScoreMeter value={72} />);
    expect(container.querySelector(".score-num")?.textContent).toBe("72");
    const fill = container.querySelector(".score-fill") as HTMLElement;
    expect(fill.style.width).toBe("72%");
    expect(fill.style.background).toContain("--strength-high");
  });
});
