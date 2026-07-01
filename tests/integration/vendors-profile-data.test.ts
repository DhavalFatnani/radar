import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import {
  createVendorStub,
  getVendor,
  updateVendorProfile,
  type VendorProfileInput,
} from "@/lib/vendors/data";

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

function baseInput(name: string): VendorProfileInput {
  return {
    name,
    capabilities: ["racking"],
    constraints: { geographies: ["Maharashtra"] },
    idealCustomer: "3PLs",
    knownGoodSignals: undefined,
    differentiators: undefined,
    credibility: undefined,
  };
}

describe("getVendor", () => {
  it("returns the full profile for an existing vendor", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const v = await getVendor(vendorId);
    expect(v).not.toBeNull();
    expect(v!.name).toBe("Acme");
    expect(v!.version).toBe(1);
    expect(v!.capabilities).toEqual([]);
    expect(v!.constraints).toBeNull();
    expect(v!.interviewHistory).toEqual([]);
  });

  it("returns null for a missing vendor", async () => {
    expect(await getVendor("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("updateVendorProfile", () => {
  it("updates fields, bumps version, and appends a history entry", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const updated = await updateVendorProfile(vendorId, {
      name: "Acme Logistics",
      capabilities: ["racking", "cctv"],
      constraints: { geographies: ["Maharashtra"], maxProjectSize: "100000 sqft" },
      idealCustomer: "Mid-size 3PLs",
      knownGoodSignals: "New warehouse lease",
      differentiators: "In-house install crew",
      credibility: "30+ installs",
    });
    expect(updated.version).toBe(2);
    expect(updated.name).toBe("Acme Logistics");
    expect(updated.capabilities).toEqual(["racking", "cctv"]);
    expect(updated.constraints).toEqual({ geographies: ["Maharashtra"], maxProjectSize: "100000 sqft" });
    expect(updated.idealCustomer).toBe("Mid-size 3PLs");
    expect(updated.credibility).toBe("30+ installs");
    expect(updated.interviewHistory).toHaveLength(1);
    expect(updated.interviewHistory[0]).toMatchObject({ actor: "operator", kind: "manual_edit", version: 2 });
    expect(updated.interviewHistory[0].changed).toEqual(
      expect.arrayContaining([
        "name", "capabilities", "constraints", "idealCustomer",
        "knownGoodSignals", "differentiators", "credibility",
      ]),
    );
  });

  it("does not bump version on a no-op save", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    await updateVendorProfile(vendorId, baseInput("Acme")); // version → 2
    const again = await updateVendorProfile(vendorId, baseInput("Acme")); // identical
    expect(again.version).toBe(2);
    expect(again.interviewHistory).toHaveLength(1);
  });
});
