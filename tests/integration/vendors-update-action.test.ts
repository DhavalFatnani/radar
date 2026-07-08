import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { vendorProfiles } from "@/db/schema";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateVendor } from "@/app/(app)/vendors/[vendorId]/actions";
import { createVendorStub } from "@/lib/vendors/data";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["catalogue_edges", "catalogue_nodes", "vendor_profiles"]);
  vi.clearAllMocks();
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

function profileForm(name: string): FormData {
  const fd = new FormData();
  fd.set("name", name);
  fd.set("capabilities", "racking\ncctv");
  fd.set("maxProjectSize", "100000 sqft");
  fd.set("geographies", "Maharashtra");
  fd.set("differentiators", "In-house crew");
  return fd;
}

describe("updateVendor action", () => {
  it("persists profile edits from form data, bumps version, and revalidates", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const result = await updateVendor(vendorId, undefined, profileForm("Acme Logistics"));
    expect(result).toBeUndefined();

    const [row] = await testDb.select().from(vendorProfiles).where(eq(vendorProfiles.vendorId, vendorId));
    expect(row.name).toBe("Acme Logistics");
    expect(row.capabilities).toEqual(["racking", "cctv"]);
    expect(row.version).toBe(2);
    expect(revalidatePath).toHaveBeenCalledWith(`/vendors/${vendorId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/vendors");
  });

  it("returns an error and writes nothing for an empty name", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const result = await updateVendor(vendorId, undefined, profileForm("   "));
    expect(result).toBe("Vendor name is required.");
    const [row] = await testDb.select().from(vendorProfiles).where(eq(vendorProfiles.vendorId, vendorId));
    expect(row.version).toBe(1);
  });

  it("rejects an unauthenticated caller", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const result = await updateVendor(vendorId, undefined, profileForm("Acme Logistics"));
    expect(result).toBe("You must be signed in.");
    const [row] = await testDb.select().from(vendorProfiles).where(eq(vendorProfiles.vendorId, vendorId));
    expect(row.version).toBe(1);
  });

  it("persists vendorType from the form and records it in the changelog", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const fd = profileForm("Acme");
    fd.set("vendorType", "Infra");
    const result = await updateVendor(vendorId, undefined, fd);
    expect(result).toBeUndefined();

    const [row] = await testDb.select().from(vendorProfiles).where(eq(vendorProfiles.vendorId, vendorId));
    expect(row.vendorType).toBe("Infra");
  });

  it("returns an error and writes nothing for an over-long vendorType", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const fd = profileForm("Acme Logistics");
    fd.set("vendorType", "x".repeat(121));
    const result = await updateVendor(vendorId, undefined, fd);
    expect(result).toBe("Vendor type is too long.");
    const [row] = await testDb.select().from(vendorProfiles).where(eq(vendorProfiles.vendorId, vendorId));
    expect(row.version).toBe(1);
  });
});
