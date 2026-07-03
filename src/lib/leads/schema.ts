import { z } from "zod";
import type { LeadBrief } from "@/ai/brief/schema";
import type { ContactBlock } from "@/lib/sourcing/contacts-schema";
import type { PipelineStage } from "@/lib/pipeline/schema";

/** Operator's outreach posture for a lead (mirrors the `outreach_mode` enum). */
export type OutreachMode = "operator_handles" | "handed_to_vendor";

export const OUTREACH_LABELS: Record<OutreachMode, string> = {
  operator_handles: "Operator handles",
  handed_to_vendor: "Handed to vendor",
};

// Zod validator for the persisted reverse brief. Lives here (not in the shipped
// @/ai/brief/schema) so that module stays untouched; the inferred type is
// structurally identical to LeadBrief and assignable to it (checked in data.ts).
const briefProofSchema = z.object({
  signalId: z.string(),
  claim: z.string(),
  date: z.string(),
  source: z.string(),
  evidence: z.array(z.string()),
});

export const leadBriefSchema = z.object({
  why_them: z.string(),
  why_now: z.array(briefProofSchema),
  what_they_need: z.string(),
  hook: z.string(),
  why_this_vendor: z.string(),
  objections: z.array(z.object({ objection: z.string(), response: z.string() })),
  disqualifier_check_passed: z.literal(true),
  generatedAt: z.string(),
});

/** The view model the lead detail page consumes. */
export type LeadDetail = {
  leadId: string;
  companyName: string;
  companyDescription: string | null;
  vendorName: string;
  vendorType: string | null;
  intent: string | null;
  score: number | null;
  stage: PipelineStage;
  outreachMode: OutreachMode | null;
  brief: LeadBrief | null;
  contactBlock: ContactBlock | null;
  createdAt: Date;
};

/** Score display: one decimal, or an em dash when unscored. Matches the board. */
export function formatScore(score: number | null): string {
  return score == null ? "—" : score.toFixed(1);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** UTC-deterministic date label (no locale/timezone dependence). Raw string on parse failure. */
export function formatBriefDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
