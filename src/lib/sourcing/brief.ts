import { eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — erased at runtime, never loads the env-eager client
import {
  companies,
  leads,
  mappings,
  signalDefinitions,
  signalObservations,
  vendorProfiles,
} from "@/db/schema";
import type {
  BriefInput,
  BriefProof,
  BriefSignal,
  LeadBrief,
  LeadBriefDraft,
} from "@/ai/brief/schema";

const BRIEF_LEAD_LIMIT = 200;
const OBSERVATION_SCAN_LIMIT = 5000;

export type GenerateBriefsResult = {
  leadsScanned: number;
  briefsGenerated: number;
  skippedNoSignals: number;
  failures: number;
};

// The generator is injected so this module never imports @/ai at runtime and the
// LLM call is trivially stubbable in tests. A real LlmResult<LeadBriefDraft> is
// structurally assignable to { value: LeadBriefDraft }.
type GenerateFn = (input: BriefInput) => Promise<{ value: LeadBriefDraft }>;

/**
 * Generate a reverse brief for each scored lead that does not have one yet, and
 * persist it to leads.brief. why_now receipts (date/source/evidence) are pinned
 * from the authoritative signal_observations rows — the LLM supplies only prose.
 * Caller owns the connection.
 */
export async function generateBriefsForLeads(
  db: DB,
  generate: GenerateFn,
  now: Date = new Date(),
): Promise<GenerateBriefsResult> {
  const result: GenerateBriefsResult = {
    leadsScanned: 0,
    briefsGenerated: 0,
    skippedNoSignals: 0,
    failures: 0,
  };

  const pending = await db
    .select({
      leadId: leads.leadId,
      companyId: leads.companyId,
      vendorId: leads.vendorId,
      matchedMappingId: leads.matchedMappingId,
      intent: leads.intent,
      score: leads.score,
    })
    .from(leads)
    .where(isNull(leads.brief))
    .limit(BRIEF_LEAD_LIMIT);

  result.leadsScanned = pending.length;
  if (pending.length === 0) return result;

  const companyIds = [...new Set(pending.map((l) => l.companyId))];
  const vendorIds = [...new Set(pending.map((l) => l.vendorId))];
  const mappingIds = [
    ...new Set(
      pending.map((l) => l.matchedMappingId).filter((id): id is string => id != null),
    ),
  ];

  const companyRows = await db
    .select({ companyId: companies.companyId, name: companies.name, description: companies.description })
    .from(companies)
    .where(inArray(companies.companyId, companyIds));
  const companyById = new Map(companyRows.map((c) => [c.companyId, c]));

  const vendorRows = await db
    .select({
      vendorId: vendorProfiles.vendorId,
      name: vendorProfiles.name,
      vendorType: vendorProfiles.vendorType,
      capabilities: vendorProfiles.capabilities,
      idealCustomer: vendorProfiles.idealCustomer,
      differentiators: vendorProfiles.differentiators,
    })
    .from(vendorProfiles)
    .where(inArray(vendorProfiles.vendorId, vendorIds));
  const vendorById = new Map(vendorRows.map((v) => [v.vendorId, v]));

  const mappingById = new Map<
    string,
    { mappingId: string; name: string; requiredSignals: string[] | null; supportingSignals: string[] | null }
  >();
  if (mappingIds.length > 0) {
    const mappingRows = await db
      .select({
        mappingId: mappings.mappingId,
        name: mappings.name,
        requiredSignals: mappings.requiredSignals,
        supportingSignals: mappings.supportingSignals,
      })
      .from(mappings)
      .where(inArray(mappings.mappingId, mappingIds));
    for (const m of mappingRows) mappingById.set(m.mappingId, m);
  }

  const obsRows = await db
    .select({
      companyId: signalObservations.companyId,
      signalId: signalObservations.signalId,
      signalName: signalDefinitions.name,
      strength: signalDefinitions.strength,
      detectedAt: signalObservations.detectedAt,
      source: signalObservations.source,
      evidence: signalObservations.evidence,
      freshnessVerdict: signalObservations.freshnessVerdict,
    })
    .from(signalObservations)
    .innerJoin(signalDefinitions, eq(signalObservations.signalId, signalDefinitions.signalId))
    .where(inArray(signalObservations.companyId, companyIds))
    .limit(OBSERVATION_SCAN_LIMIT);
  const obsByCompany = new Map<string, typeof obsRows>();
  for (const o of obsRows) {
    const list = obsByCompany.get(o.companyId) ?? [];
    list.push(o);
    obsByCompany.set(o.companyId, list);
  }

  for (const lead of pending) {
    const company = companyById.get(lead.companyId);
    const vendor = vendorById.get(lead.vendorId);
    const mapping = lead.matchedMappingId ? mappingById.get(lead.matchedMappingId) : undefined;
    if (!company || !vendor || !mapping) {
      result.skippedNoSignals++;
      continue;
    }

    const contributingIds = new Set<string>([
      ...(mapping.requiredSignals ?? []),
      ...(mapping.supportingSignals ?? []),
    ]);
    const companyObs = obsByCompany.get(lead.companyId) ?? [];
    const contributing = companyObs.filter((o) => contributingIds.has(o.signalId));
    if (contributing.length === 0) {
      result.skippedNoSignals++;
      continue;
    }

    // Authoritative receipt map: signalId -> the observation record (pinned facts).
    const obsBySignal = new Map(contributing.map((o) => [o.signalId, o]));

    const signals: BriefSignal[] = contributing.map((o) => ({
      signalId: o.signalId,
      signalName: o.signalName,
      strength: o.strength,
      detectedAt: o.detectedAt.toISOString(),
      source: o.source,
      evidence: o.evidence,
      freshnessVerdict: o.freshnessVerdict,
    }));

    const input: BriefInput = {
      company: { name: company.name, description: company.description },
      vendor: {
        name: vendor.name,
        vendorType: vendor.vendorType,
        capabilities: vendor.capabilities,
        idealCustomer: vendor.idealCustomer,
        differentiators: vendor.differentiators,
      },
      intent: lead.intent ?? mapping.name,
      mappingName: mapping.name,
      score: lead.score,
      signals,
    };

    let draft: LeadBriefDraft;
    try {
      const generated = await generate(input);
      draft = generated.value;
    } catch {
      result.failures++;
      continue;
    }

    // Pin why_now receipts from the DB; drop entries the LLM could not ground.
    const why_now: BriefProof[] = [];
    for (const entry of draft.why_now) {
      const obs = obsBySignal.get(entry.signalId);
      if (!obs) continue;
      why_now.push({
        signalId: entry.signalId,
        claim: entry.claim,
        date: obs.detectedAt.toISOString(),
        source: obs.source,
        evidence: obs.evidence,
      });
    }

    const brief: LeadBrief = {
      why_them: draft.why_them,
      why_now,
      what_they_need: draft.what_they_need,
      hook: draft.hook,
      why_this_vendor: draft.why_this_vendor,
      objections: draft.objections,
      disqualifier_check_passed: true,
      generatedAt: now.toISOString(),
    };

    await db.update(leads).set({ brief }).where(eq(leads.leadId, lead.leadId));
    result.briefsGenerated++;
  }

  return result;
}
