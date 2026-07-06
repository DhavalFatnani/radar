import type { DB } from "@/db/client"; // type-only
import { gatherPlanInputs } from "@/lib/campaigns/plan-inputs";
import type { SignalFamily } from "@/lib/sourcing/company-schema";

export type SourcingReadiness = {
  found: boolean;
  runnable: boolean;
  vendorType: string | null;
  signalFamilies: SignalFamily[];
};

/** UI-facing "ready to source?" for a vendor. runnable === the vendor has ≥1 type-matched approved mapping whose signals resolve. */
export async function getSourcingReadiness(db: DB, vendorId: string): Promise<SourcingReadiness> {
  const inputs = await gatherPlanInputs(db, vendorId);
  if (!inputs) return { found: false, runnable: false, vendorType: null, signalFamilies: [] };
  return {
    found: true,
    runnable: inputs.plan.runnable,
    vendorType: inputs.vendorType,
    signalFamilies: inputs.plan.signalFamilies,
  };
}
