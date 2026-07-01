// Catalogue graph — pure, DB-free types + constants shared by the data layer,
// the pure layout code, and the "use client" graph view. No @/db imports here:
// this module is reachable from the client bundle (like vendors/schema.ts).

export type CatalogueNodeType =
  | "vendor"
  | "capability"
  | "sub_capability"
  | "geography"
  | "project_size_range";

// Edge-type strings this slice writes and reads. Keep in sync with the DB rows.
export const EDGE_VENDOR_CAPABILITY = "vendor_capability";
export const EDGE_VENDOR_GEOGRAPHY = "vendor_geography";

// Metadata stored on a vendor node — the projection's identity key.
export type VendorNodeMetadata = { vendorId: string; size?: string };

// A persisted node/edge as read from the DB.
export type CatalogueNode = {
  nodeId: string;
  type: CatalogueNodeType;
  label: string;
  metadata: Record<string, unknown> | null;
};

export type CatalogueEdge = {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
};

export type CatalogueGraph = { nodes: CatalogueNode[]; edges: CatalogueEdge[] };

// Matchmaking (spec §4.6).
export type MatchQuery = { capability?: string; geography?: string };
export type MatchedVendor = { vendorId: string; name: string };

// Render model — positioned geometry the SVG engine draws. Pure numbers.
export type RenderNode = {
  id: string;
  type: CatalogueNodeType;
  label: string;
  sub?: string;
  x: number;
  y: number;
  w?: number;
  pulse?: boolean;
};
export type RenderEdge = { from: string; to: string; kind?: string };
export type RenderModel = { nodes: RenderNode[]; edges: RenderEdge[]; w: number; h: number };
