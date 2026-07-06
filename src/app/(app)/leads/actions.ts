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
import {
  createCommissionTerms,
  updateCommissionTerms,
  activateCommission,
  markCyclePaid,
  markCycleMissed,
  waiveCycle,
  addNextCycle,
  appendDisclosure,
  appendIntroduction,
  openDispute,
  resolveDispute,
  getCommissionForLead,
} from "@/lib/commission/data";
import {
  commissionTermsSchema,
  disclosureEntrySchema,
  introductionEntrySchema,
  isCommissionEligible,
} from "@/lib/commission/schema";

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

// Server clock — kept in the action so the pure + data layers stay clock-free.
function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function serverNow(): string {
  return new Date().toISOString();
}

export async function setCommissionTermsAction(
  leadId: string,
  termsInput: unknown,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const parsed = commissionTermsSchema.safeParse(termsInput);
  if (!parsed.success) return { ok: false, error: "Invalid commission terms." };

  const lead = await getLeadDetail(db, leadId);
  if (!lead) return { ok: false, error: "Lead not found." };
  if (!isCommissionEligible(lead.stage)) return { ok: false, error: "Set commission terms once the deal is won." };

  const existing = await getCommissionForLead(db, leadId);
  const r = existing
    ? await updateCommissionTerms(db, leadId, parsed.data, serverToday())
    : await createCommissionTerms(db, leadId, parsed.data, serverToday());
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function activateCommissionAction(leadId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const lead = await getLeadDetail(db, leadId);
  if (!lead) return { ok: false, error: "Lead not found." };
  if (lead.stage !== "delivered" && lead.stage !== "paid") return { ok: false, error: "Mark the deal delivered first." };

  const r = await activateCommission(db, leadId);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function markCyclePaidAction(leadId: string, seq: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(seq)) return { ok: false, error: "Invalid cycle." };
  const r = await markCyclePaid(db, leadId, seq, serverNow());
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function markCycleMissedAction(leadId: string, seq: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(seq)) return { ok: false, error: "Invalid cycle." };
  const r = await markCycleMissed(db, leadId, seq);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function waiveCycleAction(leadId: string, seq: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(seq)) return { ok: false, error: "Invalid cycle." };
  const r = await waiveCycle(db, leadId, seq);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function addNextCycleAction(leadId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const r = await addNextCycle(db, leadId);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function appendDisclosureAction(
  leadId: string,
  contactField: string,
  disclosedTo: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const parsed = disclosureEntrySchema.safeParse({ at: serverNow(), contactField, disclosedTo, note });
  if (!parsed.success) return { ok: false, error: "Invalid disclosure entry." };
  const r = await appendDisclosure(db, leadId, parsed.data);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function appendIntroductionAction(
  leadId: string,
  channel: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const parsed = introductionEntrySchema.safeParse({ at: serverNow(), channel, note });
  if (!parsed.success) return { ok: false, error: "Invalid introduction entry." };
  const r = await appendIntroduction(db, leadId, parsed.data);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function openDisputeAction(leadId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  if (!reason || reason.trim().length === 0) return { ok: false, error: "A dispute reason is required." };
  const r = await openDispute(db, leadId, reason.trim(), serverNow());
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function resolveDisputeAction(leadId: string, resolution: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  if (!resolution || resolution.trim().length === 0) return { ok: false, error: "A resolution note is required." };
  const r = await resolveDispute(db, leadId, resolution.trim(), serverNow());
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}
