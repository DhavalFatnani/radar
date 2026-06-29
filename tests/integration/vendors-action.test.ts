import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { vendorProfiles } from "@/db/schema";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createVendor } from "@/app/(app)/vendors/actions";
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

function form(name: string): FormData {
  const fd = new FormData();
  fd.set("name", name);
  return fd;
}

describe("createVendor action", () => {
  it("persists a vendor from form data and revalidates", async () => {
    const result = await createVendor(undefined, form("RackPro Infra"));
    expect(result).toBeUndefined();
    const rows = await testDb.select().from(vendorProfiles);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("RackPro Infra");
    expect(revalidatePath).toHaveBeenCalledWith("/vendors");
  });

  it("returns an error and inserts nothing for an empty name", async () => {
    const result = await createVendor(undefined, form("   "));
    expect(result).toBe("Vendor name is required.");
    const rows = await testDb.select().from(vendorProfiles);
    expect(rows).toHaveLength(0);
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const result = await createVendor(undefined, form("Acme"));
    expect(result).toBe("You must be signed in.");
    const rows = await testDb.select().from(vendorProfiles);
    expect(rows).toHaveLength(0);
  });
});
