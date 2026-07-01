import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createVendorStub, updateVendorProfile, type VendorProfileInput } from "@/lib/vendors/data";
import { getCatalogueGraph } from "@/lib/catalogue/data";

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

function profile(name: string): VendorProfileInput {
  return {
    name,
    capabilities: ["Racking"],
    constraints: { geographies: ["Maharashtra"] },
    idealCustomer: undefined,
    knownGoodSignals: undefined,
    differentiators: undefined,
    credibility: undefined,
  };
}

describe("catalogue auto-sync on profile save", () => {
  it("projects the vendor into the catalogue when its profile is saved", async () => {
    const { vendorId } = await createVendorStub({ name: "Meridian" });
    await updateVendorProfile(vendorId, profile("Meridian"));

    const { nodes, edges } = await getCatalogueGraph();
    const vendor = nodes.find((n) => n.type === "vendor");
    expect((vendor?.metadata as { vendorId?: string }).vendorId).toBe(vendorId);
    expect(nodes.filter((n) => n.type === "capability").map((n) => n.label)).toEqual(["Racking"]);
    expect(nodes.filter((n) => n.type === "geography").map((n) => n.label)).toEqual(["Maharashtra"]);
    expect(edges).toHaveLength(2);
  });
});
