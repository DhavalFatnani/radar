"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/pipeline/schema";
import { setLeadStage } from "@/lib/pipeline/data";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export async function advanceLeadStageAction(
  leadId: string,
  to: PipelineStage,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  // Never trust the client-supplied target — validate it is a real stage before
  // touching the DB. canAdvance() in the data layer is the second gate.
  if (!PIPELINE_STAGES.includes(to)) return { ok: false, error: "Unknown stage." };

  const r = await setLeadStage(db, leadId, to);
  if (r.ok) {
    revalidatePath("/pipeline");
    return { ok: true };
  }
  return { ok: false, error: r.error };
}
