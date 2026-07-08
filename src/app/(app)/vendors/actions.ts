"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createVendorStub, vendorStubSchema } from "@/lib/vendors/data";

export type CreateVendorState = { ok: boolean; vendorId?: string; error?: string };

// Create a vendor (name + optional type). Returns the new id for a client redirect.
// Never leaks internals.
export async function createVendorAction(
  _prev: CreateVendorState,
  formData: FormData,
): Promise<CreateVendorState> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "You must be signed in." };

  const parsed = vendorStubSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    vendorType: String(formData.get("vendorType") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid vendor." };
  }

  try {
    const { vendorId } = await createVendorStub(parsed.data);
    revalidatePath("/vendors");
    return { ok: true, vendorId };
  } catch {
    return { ok: false, error: "Could not create the vendor." };
  }
}
