import { z } from "zod";

export type SignalFamily = "hiring" | "procurement" | "money" | "expansion" | "leadership" | "digital";

export const FUNDING_SIGNAL = "SIG-MONEY-FUNDING";
export const HEADCOUNT_SIGNAL = "SIG-EXP-HEADCOUNT-GROWTH";
export const OPS_HIRING_SIGNAL = "SIG-HIRING-OPS-SURGE";
export const OPS_INHOUSE_SIGNAL = "SIG-HIRING-OPS-INHOUSE";

export const HEADCOUNT_GROWTH_PCT = 15;
export const OPS_POSTINGS_MIN = 5;

// "operations" (not bare "ops") so "DevOps" never false-matches as an operator role.
export const OPS_OPERATOR_TERMS = ["operations", "warehouse", "inventory", "supply chain", "logistics", "fulfil", "dispatch", "distribution"];
const OPS_ENGINEER_TERMS = ["engineer", "developer", "software", "sde", "devops", "platform", "architect"];

const dateString = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid date" });

export const companyRecordSchema = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  country: z.string().optional(),
  funding: z.object({
    lastRoundType: z.string().optional(),
    amountUsd: z.number().nullable().optional(),
    date: dateString.optional(),
  }).nullable().optional(),
  headcount: z.object({
    total: z.number().nullable().optional(),
    growth12mPct: z.number().nullable().optional(),
  }).nullable().optional(),
  jobPostings: z.array(z.object({ title: z.string().min(1), updatedAt: dateString.optional() })).optional(),
  sourceName: z.string().min(1),
  sourceRef: z.string().min(1),
});
export type CompanyRecord = z.infer<typeof companyRecordSchema>;

/** What a campaign asks a provider for — built from the vendor's sourcing plan. */
export type CompanyQuery = {
  geography: string;
  target: number;
  fundedSinceDays?: number;
  signalFamilies: SignalFamily[];
};

export interface CompanySourceAdapter {
  readonly sourceName: string;
  fetch(query: CompanyQuery): Promise<{ records: CompanyRecord[]; skippedMalformed: number }>;
  creditsSpent?(): number;
}

export type DetectedCompanyObservation = {
  signalId: string;
  sourceRef: string;
  source: string;
  detectedAt: string;    // ISO
  evidence: string[];    // always non-empty
  companyName: string;
};

export function classifyOpsTitle(title: string): "operator" | "engineer" | null {
  const t = title.toLowerCase();
  const isDevops = t.includes("devops");
  const isOps = isDevops || OPS_OPERATOR_TERMS.some((k) => t.includes(k));
  if (!isOps) return null;
  const isEng = isDevops || OPS_ENGINEER_TERMS.some((k) => t.includes(k));
  return isEng ? "engineer" : "operator";
}

/** Run every company detector over one record. Pure. Emits only for approved signals; evidence always non-empty. */
export function detectCompanySignals(
  record: CompanyRecord,
  approvedSignalIds: Set<string>,
  now: Date,
): DetectedCompanyObservation[] {
  const out: DetectedCompanyObservation[] = [];
  const base = { sourceRef: record.sourceRef, source: record.sourceName, companyName: record.name };

  // Funding — emit when a fundraise with a date is present.
  const f = record.funding;
  if (approvedSignalIds.has(FUNDING_SIGNAL) && f?.date) {
    const amount = f.amountUsd != null ? `$${(f.amountUsd / 1_000_000).toFixed(1)}M` : "amount undisclosed";
    out.push({
      ...base, signalId: FUNDING_SIGNAL, detectedAt: f.date,
      evidence: [`Raised ${f.lastRoundType ?? "a round"} (${amount}) on ${f.date}`, `source: ${record.sourceName}`],
    });
  }

  // Headcount growth — emit at/above threshold; missing growth never fires.
  const g = record.headcount?.growth12mPct;
  if (approvedSignalIds.has(HEADCOUNT_SIGNAL) && g != null && g >= HEADCOUNT_GROWTH_PCT) {
    out.push({
      ...base, signalId: HEADCOUNT_SIGNAL, detectedAt: now.toISOString(),
      evidence: [`Headcount grew ${g}% over 12 months` + (record.headcount?.total != null ? ` (now ~${record.headcount.total})` : "")],
    });
  }

  // Ops hiring — split operator (buy signal) vs engineer (negative counter).
  const postings = record.jobPostings ?? [];
  const operatorTitles = postings.map((p) => p.title).filter((t) => classifyOpsTitle(t) === "operator");
  const engineerTitles = postings.map((p) => p.title).filter((t) => classifyOpsTitle(t) === "engineer");

  if (approvedSignalIds.has(OPS_HIRING_SIGNAL) && operatorTitles.length >= OPS_POSTINGS_MIN) {
    out.push({
      ...base, signalId: OPS_HIRING_SIGNAL, detectedAt: now.toISOString(),
      evidence: [`${operatorTitles.length} open ops-operator roles`, `e.g. ${operatorTitles.slice(0, 3).join(", ")}`],
    });
  }
  if (approvedSignalIds.has(OPS_INHOUSE_SIGNAL) && engineerTitles.length > 0) {
    out.push({
      ...base, signalId: OPS_INHOUSE_SIGNAL, detectedAt: now.toISOString(),
      evidence: [`${engineerTitles.length} ops-engineering roles (may be building ops in-house)`, `e.g. ${engineerTitles.slice(0, 3).join(", ")}`],
    });
  }

  return out;
}
