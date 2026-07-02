import { and, eq, like } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — erased at runtime, never loads the env-eager client
import { signalDefinitions, signalObservations } from "@/db/schema";
import { computeFreshnessVerdict } from "@/lib/sourcing/schema";
import { resolveCompany } from "@/lib/sourcing/data";
import { detectHiringSignals, type JobSourceAdapter } from "@/lib/sourcing/jobs-schema";

export type IngestResult = {
  scanned: number;
  detected: number;
  written: number;
  skippedDuplicates: number;
  skippedMalformed: number;
};

/** Approved signal definitions in the hiring family, with their freshness window. */
export async function listApprovedHiringSignals(
  db: DB,
): Promise<{ signalId: string; freshnessWindowDays: number | null }[]> {
  return db
    .select({
      signalId: signalDefinitions.signalId,
      freshnessWindowDays: signalDefinitions.freshnessWindowDays,
    })
    .from(signalDefinitions)
    .where(and(eq(signalDefinitions.status, "approved"), like(signalDefinitions.signalId, "SIG-HIRING-%")))
    .limit(100);
}

/**
 * Orchestrate one on-demand job-board sourcing run: fetch → detect hiring signals → resolve entity →
 * upsert observation. Idempotent via the (signal_id, company_id, source_ref) unique index +
 * onConflictDoNothing. Writes ONLY companies (find-or-create) and signal_observations.
 */
export async function ingestJobObservations(
  db: DB,
  adapter: JobSourceAdapter,
  now: Date = new Date(),
): Promise<IngestResult> {
  const { records, skippedMalformed } = await adapter.fetch();
  const defs = await listApprovedHiringSignals(db);
  const approvedIds = new Set(defs.map((d) => d.signalId));
  const windowBySignal = new Map(defs.map((d) => [d.signalId, d.freshnessWindowDays]));

  const observations = detectHiringSignals(records, approvedIds, windowBySignal, now);

  let written = 0;
  let skippedDuplicates = 0;

  for (const obs of observations) {
    const { companyId, entityMatchConfidence } = await resolveCompany(db, obs.companyName);
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

  return { scanned: records.length + skippedMalformed, detected: observations.length, written, skippedDuplicates, skippedMalformed };
}
