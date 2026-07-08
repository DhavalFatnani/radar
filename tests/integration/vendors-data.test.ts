import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import {
  vendorStubSchema,
  createVendorStub,
  listVendors,
  getVendor,
  listVendorRows,
  getVendorTypeOptions,
} from "@/lib/vendors/data";
import { db } from "@/db/client";
import { mappings } from "@/db/schema";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["mappings", "vendor_profiles"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("vendor data layer", () => {
  it("createVendorStub persists and listVendors reads it back", async () => {
    const created = await createVendorStub({ name: "Acme Logistics" });
    expect(created.vendorId).toBeTruthy();
    expect(created.name).toBe("Acme Logistics");
    const all = await listVendors();
    expect(all.map((v) => v.name)).toEqual(["Acme Logistics"]);
  });

  it("listVendors returns vendors ordered by name", async () => {
    await createVendorStub({ name: "Zeta" });
    await createVendorStub({ name: "Alpha" });
    const all = await listVendors();
    expect(all.map((v) => v.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("vendorStubSchema trims valid names and rejects empty / over-long ones", () => {
    expect(vendorStubSchema.parse({ name: "  Acme  " }).name).toBe("Acme");
    expect(vendorStubSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(vendorStubSchema.safeParse({ name: "" }).success).toBe(false);
    expect(vendorStubSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
  });

  it("createVendorStub persists vendorType when provided", async () => {
    const { vendorId } = await createVendorStub({ name: "RackPro", vendorType: "Infra" });
    const v = await getVendor(vendorId);
    expect(v!.vendorType).toBe("Infra");
  });

  it("createVendorStub leaves vendorType null when omitted", async () => {
    const { vendorId } = await createVendorStub({ name: "NoType" });
    const v = await getVendor(vendorId);
    expect(v!.vendorType).toBeNull();
  });
});

describe("listVendorRows + getVendorTypeOptions", () => {
  async function approvedMapping(name: string, servesVendorType: string) {
    await db.insert(mappings).values({
      name,
      servesVendorType,
      requiredSignals: [],
      supportingSignals: [],
      status: "approved",
      origin: "operator",
    });
  }

  it("classifies readiness from type + serving approved mappings", async () => {
    await approvedMapping("Warehouse expansion", "Infra");
    await approvedMapping("Rack refit", "infra"); // case-insensitive match, 2 total
    await createVendorStub({ name: "RackPro", vendorType: "Infra" }); // runnable (2 mappings)
    await createVendorStub({ name: "OpsCo", vendorType: "Ops" }); // needs_mapping (0)
    await createVendorStub({ name: "Blank" }); // no_type

    const rows = await listVendorRows();
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName["RackPro"].readiness).toBe("runnable");
    expect(byName["RackPro"].mappingCount).toBe(2);
    expect(byName["OpsCo"].readiness).toBe("needs_mapping");
    expect(byName["Blank"].readiness).toBe("no_type");
  });

  it("returns a capabilities preview and null lastChange for a fresh stub", async () => {
    await createVendorStub({ name: "Fresh" });
    const [row] = await listVendorRows();
    expect(row.capabilitiesPreview).toBe("—");
    expect(row.lastChangeAt).toBeNull();
  });

  it("getVendorTypeOptions unions mapping + vendor types with counts", async () => {
    await approvedMapping("Warehouse expansion", "Infra");
    await approvedMapping("Growth play", "Mktg");
    await createVendorStub({ name: "RackPro", vendorType: "Infra" });
    await createVendorStub({ name: "OpsCo", vendorType: "Ops" });

    const opts = await getVendorTypeOptions();
    const byType = Object.fromEntries(opts.map((o) => [o.type, o]));
    expect(byType["Infra"]).toMatchObject({ mappingCount: 1, vendorCount: 1 });
    expect(byType["Mktg"]).toMatchObject({ mappingCount: 1, vendorCount: 0 });
    expect(byType["Ops"]).toMatchObject({ mappingCount: 0, vendorCount: 1 });
    // sorted: served types (by mappingCount desc) before unserved
    expect(opts[opts.length - 1].type).toBe("Ops");
  });
});
