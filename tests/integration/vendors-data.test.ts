import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { vendorStubSchema, createVendorStub, listVendors, getVendor } from "@/lib/vendors/data";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["vendor_profiles"]);
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
