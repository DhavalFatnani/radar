import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — never load the env-eager client
import { signalDefinitions, signalObservations } from "@/db/schema";
import { resolveCompany } from "@/lib/sourcing/data";
import { computeFreshnessVerdict } from "@/lib/sourcing/schema";
import {
  detectCompanySignals, classifyOpsTitle,
  FUNDING_SIGNAL, HEADCOUNT_SIGNAL, OPS_HIRING_SIGNAL, OPS_INHOUSE_SIGNAL,
  type CompanySourceAdapter, type CompanyQuery, type CompanyRecord,
} from "@/lib/sourcing/company-schema";

const COMPANY_SIGNAL_IDS = [FUNDING_SIGNAL, HEADCOUNT_SIGNAL, OPS_HIRING_SIGNAL, OPS_INHOUSE_SIGNAL];

export type RawSnapshot = { fundraiseDate: string | null; headcountTotal: number | null; opsPostings: number | null };
export type TouchedCompany = { companyId: string; name: string; snapshot: RawSnapshot };
export type CompanyIngestResult = {
  scanned: number; detected: number; written: number;
  skippedDuplicates: number; skippedMalformed: number; touched: TouchedCompany[];
};

export async function listApprovedCompanySignals(db: DB): Promise<{ signalId: string; freshnessWindowDays: number | null }[]> {
  return db
    .select({ signalId: signalDefinitions.signalId, freshnessWindowDays: signalDefinitions.freshnessWindowDays })
    .from(signalDefinitions)
    .where(and(eq(signalDefinitions.status, "approved"), inArray(signalDefinitions.signalId, COMPANY_SIGNAL_IDS)));
}

function rawSnapshot(record: CompanyRecord): RawSnapshot {
  const opsPostings = (record.jobPostings ?? []).filter((p) => classifyOpsTitle(p.title) === "operator").length;
  return {
    fundraiseDate: record.funding?.date ?? null,
    headcountTotal: record.headcount?.total ?? null,
    opsPostings: record.jobPostings ? opsPostings : null,   // null (not 0) when we never saw postings
  };
}

/**
 * One company sourcing run: fetch → detect → resolve entity → upsert observation.
 * Idempotent via the (signal_id, company_id, source_ref) unique index. Caller owns the connection.
 */
export async function ingestCompanyObservations(
  db: DB, adapter: CompanySourceAdapter, query: CompanyQuery,
): Promise<CompanyIngestResult> {
  const { records, skippedMalformed } = await adapter.fetch(query);
  const defs = await listApprovedCompanySignals(db);
  const approvedIds = new Set(defs.map((d) => d.signalId));
  const windowBySignal = new Map(defs.map((d) => [d.signalId, d.freshnessWindowDays]));
  const now = new Date();

  let detected = 0, written = 0, skippedDuplicates = 0;
  const touched = new Map<string, TouchedCompany>();

  for (const record of records) {
    const observations = detectCompanySignals(record, approvedIds, now);
    if (observations.length === 0) continue;

    const { companyId } = await resolveCompany(db, record.name);
    if (!touched.has(companyId)) touched.set(companyId, { companyId, name: record.name, snapshot: rawSnapshot(record) });

    for (const obs of observations) {
      detected++;
      const detectedAt = new Date(obs.detectedAt);
      const freshnessVerdict = computeFreshnessVerdict(detectedAt, windowBySignal.get(obs.signalId) ?? null, now);
      const ins = await db
        .insert(signalObservations)
        .values({
          signalId: obs.signalId, companyId, detectedAt, source: obs.source,
          evidence: obs.evidence, freshnessVerdict, entityMatchConfidence: 1, sourceRef: obs.sourceRef,
        })
        .onConflictDoNothing({
          target: [signalObservations.signalId, signalObservations.companyId, signalObservations.sourceRef],
        })
        .returning({ id: signalObservations.observationId });
      if (ins.length > 0) written++; else skippedDuplicates++;
    }
  }

  return {
    scanned: records.length + skippedMalformed,
    detected, written, skippedDuplicates, skippedMalformed,
    touched: [...touched.values()],
  };
}
