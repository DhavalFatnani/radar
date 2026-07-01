import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createVendorStub, updateVendorProfile, type VendorProfileInput } from "@/lib/vendors/data";
import {
  getCatalogueGraph,
  populateCatalogueFromProfile,
  matchVendors,
  rebuildCatalogue,
} from "@/lib/catalogue/data";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["catalogue_edges", "catalogue_nodes", "vendor_profiles"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

function profile(name: string, capabilities: string[], geographies: string[]): VendorProfileInput {
  return {
    name,
    capabilities,
    constraints: { geographies, maxProjectSize: "100000 sqft" },
    idealCustomer: undefined,
    knownGoodSignals: undefined,
    differentiators: undefined,
    credibility: undefined,
  };
}

// Set up a vendor + profile, then project it explicitly (this task runs BEFORE
// updateVendorProfile is wired to auto-project in Task 3; an extra explicit
// populate is idempotent and stays correct after Task 3).
async function seedVendor(name: string, caps: string[], geos: string[]): Promise<string> {
  const { vendorId } = await createVendorStub({ name });
  await updateVendorProfile(vendorId, profile(name, caps, geos));
  await populateCatalogueFromProfile(vendorId);
  return vendorId;
}

describe("populateCatalogueFromProfile", () => {
  it("creates a vendor node (with vendorId + size metadata) and capability/geography nodes + edges", async () => {
    const vendorId = await seedVendor("Meridian Infra", ["Racking", "CCTV"], ["Maharashtra"]);
    const { nodes, edges } = await getCatalogueGraph();

    const vendor = nodes.find((n) => n.type === "vendor");
    expect(vendor?.label).toBe("Meridian Infra");
    expect((vendor?.metadata as { vendorId?: string; size?: string }).vendorId).toBe(vendorId);
    expect((vendor?.metadata as { size?: string }).size).toBe("100000 sqft");

    expect(nodes.filter((n) => n.type === "capability").map((n) => n.label).sort())
      .toEqual(["CCTV", "Racking"]);
    expect(nodes.filter((n) => n.type === "geography").map((n) => n.label)).toEqual(["Maharashtra"]);
    expect(edges.filter((e) => e.type === "vendor_capability")).toHaveLength(2);
    expect(edges.filter((e) => e.type === "vendor_geography")).toHaveLength(1);
  });

  it("is idempotent — projecting twice yields the same node/edge counts", async () => {
    const vendorId = await seedVendor("Meridian Infra", ["Racking", "CCTV"], ["Maharashtra"]);
    await populateCatalogueFromProfile(vendorId);
    const { nodes, edges } = await getCatalogueGraph();
    expect(nodes).toHaveLength(4); // 1 vendor + 2 capabilities + 1 geography
    expect(edges).toHaveLength(3); // 2 vendor_capability + 1 vendor_geography
  });

  it("prunes a capability node that becomes orphaned when the vendor drops it", async () => {
    const vendorId = await seedVendor("Meridian Infra", ["Racking", "CCTV"], ["Maharashtra"]);
    await updateVendorProfile(vendorId, profile("Meridian Infra", ["Racking"], ["Maharashtra"]));
    await populateCatalogueFromProfile(vendorId);
    const { nodes } = await getCatalogueGraph();
    expect(nodes.filter((n) => n.type === "capability").map((n) => n.label)).toEqual(["Racking"]);
  });

  it("reuses a shared capability node across two vendors (dedupe by type+label)", async () => {
    await seedVendor("Meridian Infra", ["Racking"], ["Maharashtra"]);
    await seedVendor("Groundwave Mktg", ["Racking"], ["Gujarat"]);
    const { nodes, edges } = await getCatalogueGraph();
    expect(nodes.filter((n) => n.type === "capability")).toHaveLength(1);
    expect(edges.filter((e) => e.type === "vendor_capability")).toHaveLength(2);
  });
});

describe("matchVendors", () => {
  it("returns vendors adjacent to BOTH a capability and a geography (intersection)", async () => {
    await seedVendor("Meridian Infra", ["Racking"], ["Maharashtra"]);
    await seedVendor("Groundwave Mktg", ["Racking"], ["Gujarat"]);
    const both = await matchVendors({ capability: "Racking", geography: "Maharashtra" });
    expect(both.map((v) => v.name)).toEqual(["Meridian Infra"]);
  });

  it("returns the adjacency set for a single dimension, case-insensitively", async () => {
    await seedVendor("Meridian Infra", ["Racking"], ["Maharashtra"]);
    await seedVendor("Groundwave Mktg", ["Racking"], ["Gujarat"]);
    const byCap = await matchVendors({ capability: "racking" });
    expect(byCap.map((v) => v.name)).toEqual(["Groundwave Mktg", "Meridian Infra"]);
  });

  it("returns [] when no query dimension is given", async () => {
    await seedVendor("Meridian Infra", ["Racking"], ["Maharashtra"]);
    expect(await matchVendors({})).toEqual([]);
  });
});

describe("rebuildCatalogue", () => {
  it("projects every vendor and reports the count", async () => {
    const { vendorId: a } = await createVendorStub({ name: "A" });
    await updateVendorProfile(a, profile("A", ["Racking"], ["Maharashtra"]));
    const { vendorId: b } = await createVendorStub({ name: "B" });
    await updateVendorProfile(b, profile("B", ["CCTV"], ["Gujarat"]));
    await truncateAll(["catalogue_edges", "catalogue_nodes"]); // clear any auto-projection
    const result = await rebuildCatalogue();
    expect(result.vendors).toBe(2);
    const { nodes } = await getCatalogueGraph();
    expect(nodes.filter((n) => n.type === "vendor")).toHaveLength(2);
  });
});
