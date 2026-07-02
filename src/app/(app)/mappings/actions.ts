"use server";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { createMappingSchema } from "@/lib/mappings/schema";
import { createMapping, setMappingStatus } from "@/lib/mappings/data";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export type MappingFormState = { ok: boolean; error?: string };

export async function createMappingAction(
  _prev: MappingFormState,
  formData: FormData,
): Promise<MappingFormState> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };

  const raw = {
    name: formData.get("name"),
    requiredSignals: formData.getAll("requiredSignals"),
    supportingSignals: formData.getAll("supportingSignals"),
    intentDescription: formData.get("intentDescription") || undefined,
    servesVendorType: formData.get("servesVendorType") || undefined,
    thresholdRule: formData.get("thresholdRule") || undefined,
    timingWindowDays: formData.get("timingWindowDays") || undefined,
    strengthLogic: formData.get("strengthLogic") || undefined,
    disqualifiers: formData.get("disqualifiers") || undefined,
  };

  const parsed = createMappingSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid mapping." };
  }

  const r = await createMapping(parsed.data);
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath("/mappings");
  return { ok: true };
}

export async function approveMappingAction(mappingId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const r = await setMappingStatus(mappingId, "approved");
  if (r.ok) {
    revalidatePath("/mappings");
    revalidatePath(`/mappings/${mappingId}`);
  }
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function retireMappingAction(mappingId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const r = await setMappingStatus(mappingId, "retired");
  if (r.ok) {
    revalidatePath("/mappings");
    revalidatePath(`/mappings/${mappingId}`);
  }
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
