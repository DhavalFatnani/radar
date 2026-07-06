import type { SignalFamily } from "@/lib/sourcing/company-schema";

export type PlanVendor = { vendorType: string | null };
export type PlanMapping = {
  requiredSignals: string[] | null;
  supportingSignals: string[] | null;
  timingWindowDays: number | null;
};
export type PlanSignalDef = { signalId: string; family: SignalFamily; freshnessWindowDays: number | null };

export type SourcingPlan = {
  signalFamilies: SignalFamily[];
  fundedSinceDays: number;
  runnable: boolean;
};

const DEFAULT_FUNDED_SINCE_DAYS = 365;

/**
 * Derive what to source from the vendor's APPROVED mappings: every signal they
 * require or support resolves to a family; the union of families is what the
 * campaign fetches. Pure — the DB read happens in the caller.
 */
export function buildSourcingPlan(
  vendor: PlanVendor,
  approvedMappings: PlanMapping[],
  signalDefs: PlanSignalDef[],
): SourcingPlan {
  const familyBySignal = new Map(signalDefs.map((d) => [d.signalId, d.family]));
  const windowBySignal = new Map(signalDefs.map((d) => [d.signalId, d.freshnessWindowDays]));

  const families = new Set<SignalFamily>();
  let fundedSinceDays = DEFAULT_FUNDED_SINCE_DAYS;

  for (const m of approvedMappings) {
    for (const sig of [...(m.requiredSignals ?? []), ...(m.supportingSignals ?? [])]) {
      const fam = familyBySignal.get(sig);
      if (fam) families.add(fam);
      if (fam === "money") {
        fundedSinceDays = Math.max(fundedSinceDays, windowBySignal.get(sig) ?? DEFAULT_FUNDED_SINCE_DAYS);
      }
    }
  }

  const signalFamilies = [...families].sort();
  return { signalFamilies, fundedSinceDays, runnable: signalFamilies.length > 0 };
}
