import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { vendorProfiles } from "@/db/schema";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createVendorAction } from "@/app/(app)/vendors/actions";
import { getVendor } from "@/lib/vendors/data";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["vendor_profiles"]);
  vi.clearAllMocks();
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

function form(name: string, vendorType?: string): FormData {
  const fd = new FormData();
  fd.set("name", name);
  if (vendorType !== undefined) fd.set("vendorType", vendorType);
  return fd;
}

describe("createVendorAction", () => {
  it("persists a vendor from form data and revalidates", async () => {
    const r = await createVendorAction({ ok: false }, form("RackPro Infra"));
    expect(r.ok).toBe(true);
    expect(r.vendorId).toBeTruthy();
    const rows = await testDb.select().from(vendorProfiles);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("RackPro Infra");
    expect(revalidatePath).toHaveBeenCalledWith("/vendors");
  });

  it("returns an error and inserts nothing for an empty name", async () => {
    const r = await createVendorAction({ ok: false }, form("   "));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Vendor name is required.");
    const rows = await testDb.select().from(vendorProfiles);
    expect(rows).toHaveLength(0);
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const r = await createVendorAction({ ok: false }, form("Acme"));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("You must be signed in.");
    const rows = await testDb.select().from(vendorProfiles);
    expect(rows).toHaveLength(0);
  });

  it("persists vendorType when provided", async () => {
    const r = await createVendorAction({ ok: false }, form("RackPro Infra", "Infra"));
    expect(r.ok).toBe(true);
    expect(r.vendorId).toBeTruthy();
    const v = await getVendor(r.vendorId!);
    expect(v!.vendorType).toBe("Infra");
  });
});
