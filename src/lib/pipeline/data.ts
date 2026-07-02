import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — erased at runtime; a value import would eagerly open Postgres
import { leads, companies, vendorProfiles } from "@/db/schema";
import { canAdvance, type LeadCard, type PipelineStage } from "@/lib/pipeline/schema";

const PIPELINE_LEAD_LIMIT = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * All leads as board cards, joined to company + vendor names. brief/contactBlock
 * are reduced to booleans in SQL — the jsonb payloads are never pulled into the
 * board. Ordered score desc (nulls last) then newest first, so the strongest lead
 * heads each column once the UI groups by stage. Caller owns the connection.
 */
export async function listPipelineLeads(db: DB): Promise<LeadCard[]> {
  const rows = await db
    .select({
      leadId: leads.leadId,
      companyName: companies.name,
      vendorName: vendorProfiles.name,
      intent: leads.intent,
      score: leads.score,
      stage: leads.pipelineStage,
      hasBrief: sql<boolean>`(${leads.brief} is not null)`,
      hasContactBlock: sql<boolean>`(${leads.contactBlock} is not null)`,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.companyId))
    .innerJoin(vendorProfiles, eq(leads.vendorId, vendorProfiles.vendorId))
    .orderBy(sql`${leads.score} desc nulls last`, sql`${leads.createdAt} desc`)
    .limit(PIPELINE_LEAD_LIMIT);

  return rows.map((r) => ({
    leadId: r.leadId,
    companyName: r.companyName,
    vendorName: r.vendorName,
    intent: r.intent,
    score: r.score,
    stage: r.stage as PipelineStage,
    hasBrief: Boolean(r.hasBrief),
    hasContactBlock: Boolean(r.hasContactBlock),
    createdAt: r.createdAt,
  }));
}

/**
 * Move one lead to a validated next stage. Rejects a malformed id, an unknown
 * lead, and any move canAdvance() disallows — the DB is left untouched on
 * rejection. Caller owns the connection.
 */
export async function setLeadStage(
  db: DB,
  leadId: string,
  to: PipelineStage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };

  const [current] = await db
    .select({ stage: leads.pipelineStage })
    .from(leads)
    .where(eq(leads.leadId, leadId))
    .limit(1);

  if (!current) return { ok: false, error: "Lead not found." };

  const from = current.stage as PipelineStage;
  if (!canAdvance(from, to)) {
    return { ok: false, error: `Cannot move a ${from} lead to ${to}.` };
  }

  await db.update(leads).set({ pipelineStage: to }).where(eq(leads.leadId, leadId));
  return { ok: true };
}
