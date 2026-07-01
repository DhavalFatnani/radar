import { describe, it, expect } from "vitest";
import {
  EDGE_VENDOR_CAPABILITY,
  EDGE_VENDOR_GEOGRAPHY,
  type CatalogueGraph,
  type RenderModel,
} from "@/lib/catalogue/schema";

describe("catalogue schema", () => {
  it("pins the edge-type constants shared by the data layer and the UI", () => {
    expect(EDGE_VENDOR_CAPABILITY).toBe("vendor_capability");
    expect(EDGE_VENDOR_GEOGRAPHY).toBe("vendor_geography");
  });

  it("describes a persisted graph as nodes + edges", () => {
    const g: CatalogueGraph = { nodes: [], edges: [] };
    expect(g).toEqual({ nodes: [], edges: [] });
  });

  it("describes a render model as positioned nodes + edges + canvas size", () => {
    const m: RenderModel = { nodes: [], edges: [], w: 1080, h: 640 };
    expect(m.w).toBe(1080);
    expect(m.h).toBe(640);
  });
});
