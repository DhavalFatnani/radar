import { eq } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only
import { mappings, signalDefinitions, vendorProfiles } from "@/db/schema";
import { buildSourcingPlan, type PlanMapping, type PlanSignalDef, type SourcingPlan } from "@/lib/campaigns/plan";
import type { SignalFamily } from "@/lib/sourcing/company-schema";

/**
 * Gather everything buildSourcingPlan needs for a vendor: the vendor's type, its type-matched
 * approved mappings, and the approved signal defs. Returns null when the vendor doesn't exist.
 * Shared by runCampaign and the readiness helper so the query logic lives in ONE place.
 */
export async function gatherPlanInputs(
  db: DB, vendorId: string,
): Promise<{ vendorType: string | null; plan: SourcingPlan } | null> {
  const [vendor] = await db
    .select({ vendorType: vendorProfiles.vendorType })
    .from(vendorProfiles).where(eq(vendorProfiles.vendorId, vendorId)).limit(1);
  if (!vendor) return null;

  const vType = (vendor.vendorType ?? "").toLowerCase();
  const approved = await db
    .select({
      requiredSignals: mappings.requiredSignals,
      supportingSignals: mappings.supportingSignals,
      timingWindowDays: mappings.timingWindowDays,
      servesVendorType: mappings.servesVendorType,
    })
    .from(mappings).where(eq(mappings.status, "approved"));
  const vendorMappings: PlanMapping[] = approved
    .filter((m) => (m.servesVendorType ?? "").toLowerCase() === vType)
    .map((m) => ({ requiredSignals: m.requiredSignals, supportingSignals: m.supportingSignals, timingWindowDays: m.timingWindowDays }));

  const defRows = await db
    .select({ signalId: signalDefinitions.signalId, family: signalDefinitions.family, freshnessWindowDays: signalDefinitions.freshnessWindowDays })
    .from(signalDefinitions).where(eq(signalDefinitions.status, "approved"));
  const signalDefs: PlanSignalDef[] = defRows.map((d) => ({ signalId: d.signalId, family: d.family as SignalFamily, freshnessWindowDays: d.freshnessWindowDays }));

  return { vendorType: vendor.vendorType, plan: buildSourcingPlan({ vendorType: vendor.vendorType }, vendorMappings, signalDefs) };
}
