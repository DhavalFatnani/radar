"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createVendorStub, vendorStubSchema } from "@/lib/vendors/data";

// Returns an error message string on failure, or undefined on success.
// Never leaks internals.
export async function createVendor(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user) return "You must be signed in.";

  const parsed = vendorStubSchema.safeParse({ name: String(formData.get("name") ?? "") });
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Invalid vendor.";
  }

  await createVendorStub(parsed.data);
  revalidatePath("/vendors");
  return undefined;
}
