import { z } from "zod";

export const MONTH_OPTS = [1, 2, 3, 6, 12, 24] as const;
export const ROUND_OPTS = [
  { value: "any", label: "Any" }, { value: "seed", label: "Seed" },
  { value: "seriesA", label: "Series A" }, { value: "seriesB", label: "Series B" }, { value: "seriesCplus", label: "Series C+" },
] as const;
export const SIZE_OPTS = [
  { value: "any", label: "Any size" }, { value: "lt50", label: "Under 50" },
  { value: "50to200", label: "50–200" }, { value: "200to1000", label: "200–1,000" }, { value: "gt1000", label: "1,000+" },
] as const;
export const MINSCORE_OPTS = [
  { value: "0", label: "No minimum" }, { value: "40", label: "≥ 40 (watch+)" },
  { value: "60", label: "≥ 60 (pursue)" }, { value: "75", label: "≥ 75 (strong)" },
] as const;
export const SORT_OPTS = [
  { value: "score", label: "Score (high → low)" }, { value: "funding", label: "Funding recency" }, { value: "headcount", label: "Headcount growth" },
] as const;

/** Funded-within chip (months) → a days window for CompanyQuery.fundedSinceDays. */
export function fundedMonthsToDays(months: number): number {
  return months * 30;
}

export const newCampaignSchema = z.object({
  vendorId: z.string().uuid(),
  geography: z.string().min(2).max(8).default("IND"),
  companySize: z.enum(["any", "lt50", "50to200", "200to1000", "gt1000"]).default("any"),
  target: z.coerce.number().int().min(1).max(25),
  fundedMonths: z.coerce.number().int().refine((m) => (MONTH_OPTS as readonly number[]).includes(m), "bad window").default(12),
  roundType: z.enum(["any", "seed", "seriesA", "seriesB", "seriesCplus"]).default("any"),
  industries: z.array(z.string()).default([]),
  minScore: z.coerce.number().int().min(0).max(100).default(0),
  sortBy: z.enum(["score", "funding", "headcount"]).default("score"),
  excludeSeen: z.coerce.boolean().default(true),
  source: z.enum(["crustdata", "company-fixture"]).default("crustdata"),
  enrichTop: z.coerce.number().int().min(0).max(25).default(0),
});
export type NewCampaignInput = z.infer<typeof newCampaignSchema>;

/** The object persisted into campaigns.config — full form + derived fundedSinceDays. */
export function buildCampaignConfig(input: NewCampaignInput): Record<string, unknown> {
  return { ...input, fundedSinceDays: fundedMonthsToDays(input.fundedMonths) };
}
