import {
  EDGE_VENDOR_GEOGRAPHY,
  type CatalogueGraph,
  type RenderModel,
  type RenderNode,
} from "@/lib/catalogue/schema";

const X_CAP = 190;
const X_VEN = 540;
const X_GEO = 880;
const W = 1080;

export function catalogueLayout(graph: CatalogueGraph): RenderModel {
  const vendors = graph.nodes.filter((n) => n.type === "vendor");
  const capabilities = graph.nodes.filter((n) => n.type === "capability");
  const geographies = graph.nodes.filter((n) => n.type === "geography");

  // Count incoming vendor_geography edges per geography node → "shared" when >1.
  const geoDegree = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.type === EDGE_VENDOR_GEOGRAPHY) {
      geoDegree.set(e.toNodeId, (geoDegree.get(e.toNodeId) ?? 0) + 1);
    }
  }

  const capH = 60 + capabilities.length * 64;
  const geoH = 80 + geographies.length * 70;
  const H = Math.max(640, capH + 20, geoH + 20);

  const nodes: RenderNode[] = [];

  vendors.forEach((v, i) => {
    const size = (v.metadata as { size?: string } | null)?.size;
    nodes.push({
      id: v.nodeId,
      type: "vendor",
      label: v.label,
      sub: size,
      x: X_VEN,
      y: (H * (i + 1)) / (vendors.length + 1),
      w: 156,
    });
  });

  capabilities.forEach((c, i) => {
    nodes.push({ id: c.nodeId, type: "capability", label: c.label, x: X_CAP, y: 60 + i * 64 });
  });

  geographies.forEach((g, i) => {
    const shared = (geoDegree.get(g.nodeId) ?? 0) > 1;
    nodes.push({
      id: g.nodeId,
      type: "geography",
      label: g.label,
      sub: shared ? "shared region" : undefined,
      x: X_GEO,
      y: 80 + i * 70,
      pulse: shared,
    });
  });

  const edges = graph.edges.map((e) => ({
    from: e.fromNodeId,
    to: e.toNodeId,
    kind: e.type === EDGE_VENDOR_GEOGRAPHY && (geoDegree.get(e.toNodeId) ?? 0) > 1 ? "required" : "",
  }));

  return { nodes, edges, w: W, h: H };
}
