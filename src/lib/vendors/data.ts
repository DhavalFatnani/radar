import { asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { vendorProfiles } from "@/db/schema";

export const vendorStubSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required.").max(200, "Vendor name is too long."),
});
export type VendorStubInput = z.infer<typeof vendorStubSchema>;

export type VendorListItem = { vendorId: string; name: string };

// Insert a minimal vendor stub. Input is already validated by the caller.
export async function createVendorStub(input: VendorStubInput): Promise<VendorListItem> {
  const [row] = await db
    .insert(vendorProfiles)
    .values({ name: input.name })
    .returning({ vendorId: vendorProfiles.vendorId, name: vendorProfiles.name });
  return row;
}

// List vendors for display / the read API. Explicit columns + LIMIT (no SELECT *).
export async function listVendors(): Promise<VendorListItem[]> {
  return db
    .select({ vendorId: vendorProfiles.vendorId, name: vendorProfiles.name })
    .from(vendorProfiles)
    .orderBy(asc(vendorProfiles.name))
    .limit(100);
}
