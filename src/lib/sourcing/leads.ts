import { eq, isNotNull } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — erased at runtime, never loads the env-eager client
import { leads, mappings, signalDefinitions, signalObservations, vendorProfiles } from "@/db/schema";
import { scoreMapping, type ScoredObservation, type ScoringMapping } from "@/lib/sourcing/scoring";

const VENDOR_LIMIT = 500;
const MAPPING_LIMIT = 500;
const OBSERVATION_SCAN_LIMIT = 5000;
const EXISTING_LEAD_LIMIT = 10000;

export type GenerateLeadsResult = {
  vendorsProcessed: number;
  mappingsEvaluated: number;
  companiesConsidered: number;
  leadsWritten: number;
  leadsUpdated: number;
  skippedNoFire: number;
  skippedDisqualified: number;
};

function leadKey(vendorId: string, companyId: string, mappingId: string): string {
  return `${vendorId}|${companyId}|${mappingId}`;
}

/**
 * Matching + scoring pass: evaluate each vendor's approved mappings (matched to the vendor's
 * vendor_type, case-insensitively) against every company's observations, then upsert a scored
 * lead for each fired, non-disqualified (vendor, company, mapping). Idempotent via the
 * leads (vendor_id, company_id, matched_mapping_id) unique index. Caller owns the connection.
 */
export async function generateLeads(db: DB, now: Date = new Date()): Promise<GenerateLeadsResult> {
  const vendors = await db
    .select({ vendorId: vendorProfiles.vendorId, vendorType: vendorProfiles.vendorType })
    .from(vendorProfiles)
    .where(isNotNull(vendorProfiles.vendorType))
    .limit(VENDOR_LIMIT);

  const approvedMappings = await db
    .select({
      mappingId: mappings.mappingId,
      intentDescription: mappings.intentDescription,
      name: mappings.name,
      servesVendorType: mappings.servesVendorType,
      requiredSignals: mappings.requiredSignals,
      supportingSignals: mappings.supportingSignals,
      timingWindowDays: mappings.timingWindowDays,
    })
    .from(mappings)
    .where(eq(mappings.status, "approved"))
    .limit(MAPPING_LIMIT);

  const obsRows = await db
    .select({
      companyId: signalObservations.companyId,
      signalId: signalObservations.signalId,
      detectedAt: signalObservations.detectedAt,
      freshnessVerdict: signalObservations.freshnessVerdict,
      strength: signalDefinitions.strength,
      polarity: signalDefinitions.polarity,
    })
    .from(signalObservations)
    .innerJoin(signalDefinitions, eq(signalObservations.signalId, signalDefinitions.signalId))
    .limit(OBSERVATION_SCAN_LIMIT);

  const obsByCompany = new Map<string, ScoredObservation[]>();
  for (const r of obsRows) {
    const list = obsByCompany.get(r.companyId) ?? [];
    list.push({
      signalId: r.signalId,
      detectedAt: r.detectedAt,
      freshnessVerdict: r.freshnessVerdict as ScoredObservation["freshnessVerdict"],
      strength: r.strength as ScoredObservation["strength"],
      polarity: r.polarity as ScoredObservation["polarity"],
    });
    obsByCompany.set(r.companyId, list);
  }

  const existing = await db
    .select({
      vendorId: leads.vendorId,
      companyId: leads.companyId,
      matchedMappingId: leads.matchedMappingId,
    })
    .from(leads)
    .limit(EXISTING_LEAD_LIMIT);
  const existingKeys = new Set(
    existing
      .filter((e) => e.matchedMappingId != null)
      .map((e) => leadKey(e.vendorId, e.companyId, e.matchedMappingId as string)),
  );

  const result: GenerateLeadsResult = {
    vendorsProcessed: 0,
    mappingsEvaluated: 0,
    companiesConsidered: 0,
    leadsWritten: 0,
    leadsUpdated: 0,
    skippedNoFire: 0,
    skippedDisqualified: 0,
  };
  const consideredCompanies = new Set<string>();

  for (const vendor of vendors) {
    if (vendor.vendorType == null) continue;
    result.vendorsProcessed++;
    const vType = vendor.vendorType.toLowerCase();
    const vendorMappings = approvedMappings.filter(
      (m) => (m.servesVendorType ?? "").toLowerCase() === vType,
    );

    for (const m of vendorMappings) {
      result.mappingsEvaluated++;
      const scoringMapping: ScoringMapping = {
        requiredSignals: m.requiredSignals ?? [],
        supportingSignals: m.supportingSignals ?? [],
        timingWindowDays: m.timingWindowDays,
      };
      const intent = m.intentDescription ?? m.name;

      for (const [companyId, observations] of obsByCompany) {
        const outcome = scoreMapping(scoringMapping, observations, now);
        if (outcome.disqualified) {
          result.skippedDisqualified++;
          continue;
        }
        if (!outcome.fired) {
          result.skippedNoFire++;
          continue;
        }
        consideredCompanies.add(companyId);

        const key = leadKey(vendor.vendorId, companyId, m.mappingId);
        const isUpdate = existingKeys.has(key);

        await db
          .insert(leads)
          .values({
            vendorId: vendor.vendorId,
            companyId,
            matchedMappingId: m.mappingId,
            intent,
            score: outcome.score,
          })
          .onConflictDoUpdate({
            target: [leads.vendorId, leads.companyId, leads.matchedMappingId],
            set: { score: outcome.score, intent },
          });

        if (isUpdate) {
          result.leadsUpdated++;
        } else {
          result.leadsWritten++;
          existingKeys.add(key); // guard against double-counting within one run
        }
      }
    }
  }

  result.companiesConsidered = consideredCompanies.size;
  return result;
}
