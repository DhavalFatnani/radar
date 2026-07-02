import { z } from "zod";

// ── Input the generator receives (assembled by the data layer; DB-free here) ──

export type BriefSignal = {
  signalId: string;
  signalName: string;
  strength: string | null;
  detectedAt: string; // ISO
  source: string;
  evidence: string[];
  freshnessVerdict: string | null;
};

export type BriefInput = {
  company: { name: string; description: string | null };
  vendor: {
    name: string;
    vendorType: string | null;
    capabilities: string[] | null;
    idealCustomer: unknown;
    differentiators: string | null;
  };
  intent: string;
  mappingName: string;
  score: number | null;
  signals: BriefSignal[];
};

// ── What the LLM produces (validated by generateObject) ──

export const leadBriefDraftSchema = z.object({
  why_them: z.string(),
  why_now: z.array(
    z.object({
      signalId: z.string(),
      claim: z.string(),
    }),
  ),
  what_they_need: z.string(),
  hook: z.string(),
  why_this_vendor: z.string(),
  objections: z.array(
    z.object({
      objection: z.string(),
      response: z.string(),
    }),
  ),
});

export type LeadBriefDraft = z.infer<typeof leadBriefDraftSchema>;

// ── What the data layer persists to leads.brief (receipts pinned from the DB) ──

export type BriefProof = {
  signalId: string;
  claim: string;
  date: string; // ISO — pinned from observation.detectedAt
  source: string; // pinned from observation.source
  evidence: string[]; // pinned from observation.evidence
};

export type LeadBrief = {
  why_them: string;
  why_now: BriefProof[];
  what_they_need: string;
  hook: string;
  why_this_vendor: string;
  objections: Array<{ objection: string; response: string }>;
  disqualifier_check_passed: true;
  generatedAt: string; // ISO
};
