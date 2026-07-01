"use server";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { createSignalSchema } from "@/lib/signals/schema";
import { createSignal, setSignalStatus } from "@/lib/signals/data";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export type SignalFormState = { ok: boolean; error?: string };

export async function createSignalAction(
  _prev: SignalFormState,
  formData: FormData,
): Promise<SignalFormState> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };

  const raw = {
    signalId: formData.get("signalId"),
    name: formData.get("name"),
    family: formData.get("family"),
    strength: formData.get("strength"),
    falsePositiveRisk: formData.get("falsePositiveRisk"),
    description: formData.get("description") || undefined,
    sources: formData.get("sources") || undefined,
    detectionMethod: formData.get("detectionMethod") || undefined,
    triggerRule: formData.get("triggerRule") || undefined,
    polarity: formData.get("polarity") || undefined,
    entityType: formData.get("entityType") || undefined,
    freshnessWindowDays: formData.get("freshnessWindowDays") || undefined,
    example: formData.get("example") || undefined,
  };

  const parsed = createSignalSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid signal." };
  }

  const r = await createSignal(parsed.data);
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath("/signals");
  return { ok: true };
}

export async function approveSignalAction(
  signalId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };

  const r = await setSignalStatus(signalId, "approved");
  if (r.ok) {
    revalidatePath("/signals");
    revalidatePath(`/signals/${signalId}`);
  }
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function retireSignalAction(
  signalId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };

  const r = await setSignalStatus(signalId, "retired");
  if (r.ok) {
    revalidatePath("/signals");
    revalidatePath(`/signals/${signalId}`);
  }
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
