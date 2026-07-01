"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { nextQuestion, extractProfile } from "@/ai/sia";
import { getVendor, updateVendorProfile } from "@/lib/vendors/data";
import {
  createInterview,
  getInterview,
  getActiveInterview,
  appendMessages,
  completeInterview,
  abandonInterview,
} from "@/lib/interviews/data";
import { turnView } from "./view";
import type { SaveResult, TurnResult } from "./types";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

// Generate the next question from the current stored transcript and persist it.
// Shared by startInterview / submitAnswer / advanceInterview. Throws on engine
// failure — callers catch and translate to a { ok: false } result.
async function askAndPersist(interviewId: string, vendorId: string): Promise<TurnResult> {
  const vendor = await getVendor(vendorId);
  if (!vendor) return { ok: false, error: "Vendor not found." };
  const interview = await getInterview(interviewId);
  if (!interview || interview.status !== "in_progress") {
    return { ok: false, error: "This interview is no longer active." };
  }
  const next = await nextQuestion({ messages: interview.messages, existingProfile: vendor });
  await appendMessages(interviewId, [next.transcriptEntry]);
  return turnView(interviewId, [...interview.messages, next.transcriptEntry], vendor);
}

export async function startInterview(vendorId: string): Promise<TurnResult> {
  if (!(await signedIn())) return { ok: false, error: "You must be signed in." };
  const vendor = await getVendor(vendorId);
  if (!vendor) return { ok: false, error: "Vendor not found." };

  const active = await getActiveInterview(vendorId);
  const interview = active ?? (await createInterview(vendorId));

  // Already has a pending question (resume) — return the current view as-is.
  const last = interview.messages[interview.messages.length - 1];
  if (last && last.role === "assistant") {
    return turnView(interview.interviewId, interview.messages, vendor);
  }
  try {
    return await askAndPersist(interview.interviewId, vendorId);
  } catch {
    return { ok: false, error: "SIA is unavailable right now. Please try again." };
  }
}

export async function submitAnswer(interviewId: string, answer: string): Promise<TurnResult> {
  if (!(await signedIn())) return { ok: false, error: "You must be signed in." };
  const trimmed = answer.trim();
  if (!trimmed) return { ok: false, error: "Enter the vendor's answer first." };

  const interview = await getInterview(interviewId);
  if (!interview || interview.status !== "in_progress") {
    return { ok: false, error: "This interview is no longer active." };
  }
  // Persist the answer BEFORE the LLM call so a provider failure can't lose it.
  await appendMessages(interviewId, [{ role: "user", content: trimmed }]);
  try {
    return await askAndPersist(interviewId, interview.vendorId);
  } catch {
    return { ok: false, error: "SIA is unavailable right now. Press retry to continue." };
  }
}

// Generate the next question without appending a new answer. Used to resume a
// session whose last turn is an answer, or to retry after an engine failure.
export async function advanceInterview(interviewId: string): Promise<TurnResult> {
  if (!(await signedIn())) return { ok: false, error: "You must be signed in." };
  const interview = await getInterview(interviewId);
  if (!interview || interview.status !== "in_progress") {
    return { ok: false, error: "This interview is no longer active." };
  }
  try {
    return await askAndPersist(interviewId, interview.vendorId);
  } catch {
    return { ok: false, error: "SIA is unavailable right now. Please try again." };
  }
}

export async function saveInterview(interviewId: string): Promise<SaveResult> {
  if (!(await signedIn())) return { ok: false, error: "You must be signed in." };
  const interview = await getInterview(interviewId);
  if (!interview || interview.status !== "in_progress") {
    return { ok: false, error: "This interview is no longer active." };
  }
  const vendor = await getVendor(interview.vendorId);
  if (!vendor) return { ok: false, error: "Vendor not found." };
  try {
    const { value, provider } = await extractProfile({
      messages: interview.messages,
      existingProfile: vendor,
    });
    const updated = await updateVendorProfile(interview.vendorId, value, {
      kind: "interview",
      interviewId,
    });
    await completeInterview(interviewId, updated.version, provider);
    revalidatePath(`/vendors/${interview.vendorId}`);
    revalidatePath(`/vendors/${interview.vendorId}/interview`);
    return { ok: true, version: updated.version };
  } catch {
    return { ok: false, error: "Could not save the profile. Please try again." };
  }
}

export async function endInterview(interviewId: string): Promise<void> {
  if (!(await signedIn())) return;
  const interview = await getInterview(interviewId);
  if (!interview || interview.status !== "in_progress") return;
  await abandonInterview(interviewId);
  revalidatePath(`/vendors/${interview.vendorId}`);
  revalidatePath(`/vendors/${interview.vendorId}/interview`);
}
