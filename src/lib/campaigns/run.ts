import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only
import { leads, mappings, signalDefinitions, signalObservations, vendorProfiles } from "@/db/schema";
import { generateLeads } from "@/lib/sourcing/leads";
import { buildSourcingPlan, type PlanMapping, type PlanSignalDef } from "@/lib/campaigns/plan";
import { ingestCompanyObservations } from "@/lib/campaigns/ingest";
import { getCampaign, finishCampaign, failCampaign, recordCampaignLead, writeCompanySnapshot, type CampaignStats } from "@/lib/campaigns/data";
import type { CompanySourceAdapter, CompanyQuery, SignalFamily } from "@/lib/sourcing/company-schema";

type LeadKey = string;
const leadKey = (companyId: string, mappingId: string | null): LeadKey => `${companyId}|${mappingId ?? ""}`;

export async function runCampaign(
  db: DB,
  opts: { campaignId: string; adapter: CompanySourceAdapter; now?: Date },
): Promise<CampaignStats> {
  const { campaignId, adapter } = opts;
  const now = opts.now ?? new Date();
  try {
    const campaign = await getCampaign(db, campaignId);
    if (!campaign) throw new Error(`campaign ${campaignId} not found`);

    // 1. Vendor + approved mappings for this vendor's type.
    const [vendor] = await db
      .select({ vendorId: vendorProfiles.vendorId, vendorType: vendorProfiles.vendorType })
      .from(vendorProfiles).where(eq(vendorProfiles.vendorId, campaign.vendorId)).limit(1);
    if (!vendor) throw new Error("vendor not found");
    const vType = (vendor.vendorType ?? "").toLowerCase();

    const approvedMappings = await db
      .select({
        requiredSignals: mappings.requiredSignals,
        supportingSignals: mappings.supportingSignals,
        timingWindowDays: mappings.timingWindowDays,
        servesVendorType: mappings.servesVendorType,
      })
      .from(mappings).where(eq(mappings.status, "approved"));
    const vendorMappings: PlanMapping[] = approvedMappings
      .filter((m) => (m.servesVendorType ?? "").toLowerCase() === vType)
      .map((m) => ({ requiredSignals: m.requiredSignals, supportingSignals: m.supportingSignals, timingWindowDays: m.timingWindowDays }));

    const defRows = await db
      .select({ signalId: signalDefinitions.signalId, family: signalDefinitions.family, freshnessWindowDays: signalDefinitions.freshnessWindowDays })
      .from(signalDefinitions).where(eq(signalDefinitions.status, "approved"));
    const signalDefs: PlanSignalDef[] = defRows.map((d) => ({ signalId: d.signalId, family: d.family as SignalFamily, freshnessWindowDays: d.freshnessWindowDays }));

    const plan = buildSourcingPlan({ vendorType: vendor.vendorType }, vendorMappings, signalDefs);
    if (!plan.runnable) throw new Error("vendor has no approved mappings — nothing to source");

    // 2. Build the provider query from the plan + campaign config.
    const cfg = (campaign.config ?? {}) as { geography?: string; target?: number };
    const query: CompanyQuery = {
      geography: cfg.geography ?? "IND",
      target: cfg.target ?? 20,
      fundedSinceDays: plan.fundedSinceDays,
      signalFamilies: plan.signalFamilies,
    };

    // 3. Capture pre-existing lead keys for this vendor (to compute wasNew after generateLeads).
    const beforeLeads = await db
      .select({ companyId: leads.companyId, matchedMappingId: leads.matchedMappingId })
      .from(leads).where(eq(leads.vendorId, vendor.vendorId));
    const beforeKeys = new Set(beforeLeads.map((l) => leadKey(l.companyId, l.matchedMappingId)));

    // 4. Ingest company observations.
    const ingest = await ingestCompanyObservations(db, adapter, query);
    const touchedIds = ingest.touched.map((t) => t.companyId);

    // 5. Score matches (existing global matcher; idempotent upsert) — scoped to this vendor only,
    // so running this campaign doesn't (re)create leads for other same-type vendors.
    await generateLeads(db, now, vendor.vendorId);

    // 6. Record this campaign's leads (scoped to the vendor + touched companies) + wasNew + source tag.
    let leadsCreated = 0, leadsUpdated = 0;
    const bestScoreByCompany = new Map<string, number>();
    if (touchedIds.length > 0) {
      const vendorLeads = await db
        .select({ leadId: leads.leadId, companyId: leads.companyId, matchedMappingId: leads.matchedMappingId, score: leads.score })
        .from(leads)
        .where(and(eq(leads.vendorId, vendor.vendorId), inArray(leads.companyId, touchedIds)));

      for (const l of vendorLeads) {
        const wasNew = !beforeKeys.has(leadKey(l.companyId, l.matchedMappingId));
        await recordCampaignLead(db, campaignId, l.leadId, wasNew);
        if (wasNew) {
          leadsCreated++;
          await db.update(leads).set({ sourceCampaignId: campaignId }).where(eq(leads.leadId, l.leadId));
        } else {
          leadsUpdated++;
        }
        const prev = bestScoreByCompany.get(l.companyId);
        if (l.score != null && (prev == null || l.score > prev)) bestScoreByCompany.set(l.companyId, l.score);
      }
    }

    // 7. Write per-company snapshots (write-only; v2 memory reads these).
    // verdict: "qualified" if the company produced a lead for this vendor; "disqualified" if it
    // didn't but carries a negative-polarity observation from this run; "insufficient" otherwise.
    const disqualifiedIds = new Set<string>();
    if (touchedIds.length > 0) {
      const negativeRows = await db
        .select({ companyId: signalObservations.companyId })
        .from(signalObservations)
        .innerJoin(signalDefinitions, eq(signalObservations.signalId, signalDefinitions.signalId))
        .where(and(inArray(signalObservations.companyId, touchedIds), eq(signalDefinitions.polarity, "negative")));
      for (const r of negativeRows) disqualifiedIds.add(r.companyId);
    }

    for (const t of ingest.touched) {
      const qualified = bestScoreByCompany.has(t.companyId);
      const verdict = qualified ? "qualified" : disqualifiedIds.has(t.companyId) ? "disqualified" : "insufficient";
      await writeCompanySnapshot(db, campaignId, t.companyId, {
        ...t.snapshot, score: bestScoreByCompany.get(t.companyId) ?? null, verdict,
      });
    }

    // 8. Finish.
    const stats: CampaignStats = {
      companiesFetched: ingest.touched.length,
      observationsWritten: ingest.written,
      leadsCreated, leadsUpdated,
      creditsSpent: opts.adapter.creditsSpent?.() ?? 0,
    };
    await finishCampaign(db, campaignId, stats);
    return stats;
  } catch (e) {
    await failCampaign(db, campaignId, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
