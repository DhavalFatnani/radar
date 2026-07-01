import { describe, it, expect } from "vitest";
import { catalogueLayout } from "@/app/(app)/catalogue/graph-layout";
import type { CatalogueGraph } from "@/lib/catalogue/schema";

function graph(): CatalogueGraph {
  // 2 vendors, both serving "Maharashtra" (shared) + one unique geo; one shared capability.
  return {
    nodes: [
      { nodeId: "v1", type: "vendor", label: "Meridian", metadata: { vendorId: "vid1", size: "100000 sqft" } },
      { nodeId: "v2", type: "vendor", label: "Groundwave", metadata: { vendorId: "vid2" } },
      { nodeId: "c1", type: "capability", label: "Racking", metadata: null },
      { nodeId: "g1", type: "geography", label: "Maharashtra", metadata: null },
      { nodeId: "g2", type: "geography", label: "Gujarat", metadata: null },
    ],
    edges: [
      { edgeId: "e1", fromNodeId: "v1", toNodeId: "c1", type: "vendor_capability" },
      { edgeId: "e2", fromNodeId: "v2", toNodeId: "c1", type: "vendor_capability" },
      { edgeId: "e3", fromNodeId: "v1", toNodeId: "g1", type: "vendor_geography" },
      { edgeId: "e4", fromNodeId: "v2", toNodeId: "g1", type: "vendor_geography" },
      { edgeId: "e5", fromNodeId: "v2", toNodeId: "g2", type: "vendor_geography" },
    ],
  };
}

describe("catalogueLayout", () => {
  it("places capabilities left (x=190), vendors centre (x=540), geographies right (x=880)", () => {
    const m = catalogueLayout(graph());
    const cap = m.nodes.find((n) => n.id === "c1");
    const ven = m.nodes.find((n) => n.id === "v1");
    const geo = m.nodes.find((n) => n.id === "g1");
    expect(cap?.x).toBe(190);
    expect(ven?.x).toBe(540);
    expect(geo?.x).toBe(880);
  });

  it("marks a geography served by >1 vendor as a pulsing shared region", () => {
    const m = catalogueLayout(graph());
    const shared = m.nodes.find((n) => n.id === "g1");
    const solo = m.nodes.find((n) => n.id === "g2");
    expect(shared?.pulse).toBe(true);
    expect(shared?.sub).toBe("shared region");
    expect(solo?.pulse).toBe(false);
    expect(solo?.sub).toBeUndefined();
  });

  it("carries the vendor size into the node subtitle", () => {
    const m = catalogueLayout(graph());
    expect(m.nodes.find((n) => n.id === "v1")?.sub).toBe("100000 sqft");
    expect(m.nodes.find((n) => n.id === "v2")?.sub).toBeUndefined();
  });

  it("returns every edge, tagging shared-geography edges 'required'", () => {
    const m = catalogueLayout(graph());
    expect(m.edges).toHaveLength(5);
    const sharedEdge = m.edges.find((e) => e.from === "v1" && e.to === "g1");
    const soloEdge = m.edges.find((e) => e.from === "v2" && e.to === "g2");
    expect(sharedEdge?.kind).toBe("required");
    expect(soloEdge?.kind).toBe("");
  });
});
