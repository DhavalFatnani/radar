"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { getSourcingReadiness } from "@/lib/campaigns/readiness";
import { runCampaignForVendor } from "@/db/campaign-run";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export type FindLeadsState = { ok: boolean; campaignId?: string; error?: string };

const findLeadsSchema = z.object({
  vendorId: z.string().uuid(),
  geography: z.string().min(2).max(8).default("IND"),
  target: z.coerce.number().int().min(1).max(25),
  source: z.enum(["crustdata", "company-fixture"]).default("crustdata"),
});

export async function findLeadsAction(_prev: FindLeadsState, formData: FormData): Promise<FindLeadsState> {
  if (!(await signedIn())) return { ok: false, error: "You must be signed in." };

  const parsed = findLeadsSchema.safeParse({
    vendorId: formData.get("vendorId"),
    geography: formData.get("geography") ?? undefined,
    target: formData.get("target"),
    source: formData.get("source") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid campaign input." };

  const readiness = await getSourcingReadiness(db, parsed.data.vendorId);
  if (!readiness.found) return { ok: false, error: "Vendor not found." };
  if (!readiness.runnable) {
    return { ok: false, error: "This vendor has no approved mapping for its type yet — add one before sourcing." };
  }

  try {
    const { campaignId } = await runCampaignForVendor(db, {
      vendorId: parsed.data.vendorId,
      source: parsed.data.source,
      geography: parsed.data.geography,
      target: parsed.data.target,
    });
    revalidatePath("/campaigns");
    revalidatePath(`/vendors/${parsed.data.vendorId}`);
    return { ok: true, campaignId };
  } catch (err) {
    // runCampaign marks the campaign failed + persists the error; surface a readable message to the operator.
    return { ok: false, error: err instanceof Error ? err.message : "Campaign failed." };
  }
}
