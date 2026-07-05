"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { getLeadDetail } from "@/lib/leads/data";
import { OUTREACH_LABELS, type OutreachMode } from "@/lib/leads/schema";
import { OUTREACH_STATUSES, type OutreachStatus } from "@/lib/outreach/schema";
import {
  setOutreachMode,
  saveOutreachDraft,
  setOutreachStatus,
} from "@/lib/outreach/data";
import { generateOutreach } from "@/ai/outreach";
import { sendEmail, isSendConfigured } from "@/lib/outreach/sender";
import { primaryRecipientEmail } from "@/lib/outreach/schema";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export async function setOutreachModeAction(
  leadId: string,
  mode: OutreachMode,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  // Never trust the client value — validate it is a real mode before the DB.
  if (!Object.hasOwn(OUTREACH_LABELS, mode)) return { ok: false, error: "Unknown mode." };

  const r = await setOutreachMode(db, leadId, mode);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function generateOutreachDraftAction(
  leadId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };

  const lead = await getLeadDetail(db, leadId);
  if (!lead) return { ok: false, error: "Lead not found." };
  // The draft is generated FROM the brief; re-check server-side (button is also
  // disabled client-side).
  if (!lead.brief) return { ok: false, error: "Generate the brief first." };

  let draft: { subject: string; body: string };
  try {
    const result = await generateOutreach({
      company: { name: lead.companyName, description: lead.companyDescription },
      vendor: { name: lead.vendorName, vendorType: lead.vendorType },
      intent: lead.intent,
      mode: lead.outreachMode ?? "operator_handles",
      brief: {
        why_them: lead.brief.why_them,
        what_they_need: lead.brief.what_they_need,
        hook: lead.brief.hook,
        why_this_vendor: lead.brief.why_this_vendor,
      },
    });
    draft = result.value;
  } catch {
    // Sanitized — never surface the raw provider error / key to the client.
    return {
      ok: false,
      error: "Draft generation failed. Check the LLM provider configuration.",
    };
  }

  const r = await saveOutreachDraft(db, leadId, draft);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function setOutreachStatusAction(
  leadId: string,
  status: OutreachStatus,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  if (!OUTREACH_STATUSES.includes(status)) {
    return { ok: false, error: "Unknown status." };
  }

  const r = await setOutreachStatus(db, leadId, status);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function sendOutreachAction(
  leadId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };

  const lead = await getLeadDetail(db, leadId);
  if (!lead) return { ok: false, error: "Lead not found." };
  if (!lead.outreachDraft) return { ok: false, error: "Generate the draft first." };
  if (lead.outreachStatus === "sent") return { ok: false, error: "Already sent." };

  const mode = lead.outreachMode ?? "operator_handles";
  if (mode !== "operator_handles") {
    return { ok: false, error: "This lead is handed to the vendor; sending is disabled." };
  }

  if (!isSendConfigured()) {
    return { ok: false, error: "Email sending is not configured." };
  }

  const to = primaryRecipientEmail(lead.contactBlock);
  if (!to) return { ok: false, error: "No email address on file for this lead." };

  const sent = await sendEmail({
    to,
    subject: lead.outreachDraft.subject,
    body: lead.outreachDraft.body,
  });
  if (!sent.ok) return { ok: false, error: sent.error };

  const r = await setOutreachStatus(db, leadId, "sent");
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}
