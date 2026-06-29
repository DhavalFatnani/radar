"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateVendorProfile, vendorProfileSchema } from "@/lib/vendors/data";

// Bound with vendorId via .bind(null, vendorId) so the form sees (prevState, formData).
// Returns an error message string on failure, or undefined on success. Never leaks internals.
export async function updateVendor(
  vendorId: string,
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user) return "You must be signed in.";

  const parsed = vendorProfileSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    capabilities: String(formData.get("capabilities") ?? ""),
    constraints: {
      minProjectSize: String(formData.get("minProjectSize") ?? ""),
      maxProjectSize: String(formData.get("maxProjectSize") ?? ""),
      geographies: String(formData.get("geographies") ?? ""),
      capacity: String(formData.get("capacity") ?? ""),
      currentLoad: String(formData.get("currentLoad") ?? ""),
      workingCapitalLimit: String(formData.get("workingCapitalLimit") ?? ""),
      leadTimes: String(formData.get("leadTimes") ?? ""),
    },
    idealCustomer: String(formData.get("idealCustomer") ?? ""),
    knownGoodSignals: String(formData.get("knownGoodSignals") ?? ""),
    differentiators: String(formData.get("differentiators") ?? ""),
    credibility: String(formData.get("credibility") ?? ""),
  });
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Invalid vendor profile.";
  }

  try {
    await updateVendorProfile(vendorId, parsed.data);
  } catch {
    return "Could not save the vendor profile.";
  }
  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath("/vendors");
  return undefined;
}
