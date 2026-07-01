// @vitest-environment jsdom
// tests/unit/components/catalogue-graph-engine.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderGraph } from "@/app/(app)/catalogue/graph-engine";
import type { RenderModel } from "@/lib/catalogue/schema";

function svgEl(): SVGSVGElement {
  return document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
}

function model(): RenderModel {
  return {
    w: 1080,
    h: 640,
    nodes: [
      { id: "v1", type: "vendor", label: "Meridian", x: 540, y: 320, w: 156 },
      { id: "c1", type: "capability", label: "Racking", x: 190, y: 60 },
      { id: "g1", type: "geography", label: "Maharashtra", x: 880, y: 80, pulse: true, sub: "shared region" },
    ],
    edges: [
      { from: "v1", to: "c1", kind: "" },
      { from: "v1", to: "g1", kind: "required" },
      { from: "v1", to: "ghost", kind: "" }, // dangling endpoint — must be skipped
    ],
  };
}

describe("renderGraph", () => {
  it("draws a <g class='gnode'> per node and a <path class='gedge'> per resolvable edge", () => {
    const svg = svgEl();
    renderGraph(svg, model());
    expect(svg.querySelectorAll("g.gnode")).toHaveLength(3);
    expect(svg.querySelectorAll("path.gedge")).toHaveLength(2); // dangling edge skipped
    expect(svg.querySelector("g.gnode.geography.pulse")).not.toBeNull();
  });

  it("calls onSelect with the node when a node is clicked", () => {
    const svg = svgEl();
    const onSelect = vi.fn();
    renderGraph(svg, model(), { onSelect });
    const vendorNode = svg.querySelector("g.gnode.vendor") as SVGGElement;
    vendorNode.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "v1", type: "vendor" }));
  });

  it("returns a controller whose zoom/reset mutate the viewBox", () => {
    const svg = svgEl();
    const ctrl = renderGraph(svg, model());
    const initial = svg.getAttribute("viewBox");
    expect(initial).toBe("0 0 1080 640");
    ctrl.zoomIn();
    expect(svg.getAttribute("viewBox")).not.toBe(initial);
    ctrl.reset();
    expect(svg.getAttribute("viewBox")).toBe("0 0 1080 640");
  });
});
