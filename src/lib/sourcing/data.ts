import { and, eq, like } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — erased at runtime, never loads the env-eager client
import { companies, signalDefinitions, signalObservations } from "@/db/schema";
import {
  normalizeCompanyName,
  computeFreshnessVerdict,
  detectTenderSignals,
  TENDER_KEYWORDS,
  type SourceAdapter,
} from "@/lib/sourcing/schema";

export type IngestResult = {
  scanned: number;
  detected: number;
  written: number;
  skippedDuplicates: number;
  skippedMalformed: number;
};

/** Find-or-create a company by normalized name. Deterministic; confidence 1 for an exact normalized match. */
export async function resolveCompany(
  db: DB,
  name: string,
): Promise<{ companyId: string; entityMatchConfidence: number }> {
  const normalized = normalizeCompanyName(name);

  const existing = await db
    .select({ id: companies.companyId })
    .from(companies)
    .where(eq(companies.normalizedName, normalized))
    .limit(1);
  if (existing.length > 0) return { companyId: existing[0].id, entityMatchConfidence: 1 };

  const inserted = await db
    .insert(companies)
    .values({ name: name.trim(), normalizedName: normalized })
    .onConflictDoNothing({ target: companies.normalizedName })
    .returning({ id: companies.companyId });
  if (inserted.length > 0) return { companyId: inserted[0].id, entityMatchConfidence: 1 };

  // Lost an insert race — re-select the winning row.
  const race = await db
    .select({ id: companies.companyId })
    .from(companies)
    .where(eq(companies.normalizedName, normalized))
    .limit(1);
  return { companyId: race[0].id, entityMatchConfidence: 1 };
}

/** Approved signal definitions in the tender family, with their freshness window. */
export async function listApprovedTenderSignals(
  db: DB,
): Promise<{ signalId: string; freshnessWindowDays: number | null }[]> {
  return db
    .select({
      signalId: signalDefinitions.signalId,
      freshnessWindowDays: signalDefinitions.freshnessWindowDays,
    })
    .from(signalDefinitions)
    .where(and(eq(signalDefinitions.status, "approved"), like(signalDefinitions.signalId, "SIG-TENDER-%")))
    .limit(100);
}

/**
 * Orchestrate one on-demand sourcing run: fetch → detect → resolve entity → upsert observation.
 * Idempotent via the (signal_id, company_id, source_ref) unique index + onConflictDoNothing.
 */
export async function ingestTenderObservations(db: DB, adapter: SourceAdapter): Promise<IngestResult> {
  const { records, skippedMalformed } = await adapter.fetch();
  const defs = await listApprovedTenderSignals(db);
  const approvedIds = new Set(defs.map((d) => d.signalId));
  const windowBySignal = new Map(defs.map((d) => [d.signalId, d.freshnessWindowDays]));
  const now = new Date();

  let detected = 0;
  let written = 0;
  let skippedDuplicates = 0;

  for (const record of records) {
    const observations = detectTenderSignals(record, approvedIds, TENDER_KEYWORDS);
    for (const obs of observations) {
      detected++;
      const { companyId, entityMatchConfidence } = await resolveCompany(db, obs.issuingBody);
      const detectedAt = new Date(obs.detectedAt);
      const freshnessVerdict = computeFreshnessVerdict(
        detectedAt,
        windowBySignal.get(obs.signalId) ?? null,
        now,
      );
      const ins = await db
        .insert(signalObservations)
        .values({
          signalId: obs.signalId,
          companyId,
          detectedAt,
          source: obs.source,
          evidence: obs.evidence,
          freshnessVerdict,
          entityMatchConfidence,
          sourceRef: obs.sourceRef,
        })
        .onConflictDoNothing({
          target: [signalObservations.signalId, signalObservations.companyId, signalObservations.sourceRef],
        })
        .returning({ id: signalObservations.observationId });
      if (ins.length > 0) written++;
      else skippedDuplicates++;
    }
  }

  return { scanned: records.length + skippedMalformed, detected, written, skippedDuplicates, skippedMalformed };
}
