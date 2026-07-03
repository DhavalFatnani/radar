import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { leads, companies, vendorProfiles } from "@/db/schema";
import { contactBlockSchema } from "@/lib/sourcing/contacts-schema";
import type { PipelineStage } from "@/lib/pipeline/schema";
import { leadBriefSchema, type LeadDetail } from "./schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One lead joined to its company and vendor, with the two JSONB columns
 * validated and parsed. A malformed payload degrades to null rather than
 * throwing. Returns null for a malformed or unknown id.
 */
export async function getLeadDetail(
  db: DB,
  leadId: string,
): Promise<LeadDetail | null> {
  if (!UUID_RE.test(leadId)) return null;

  const rows = await db
    .select({
      leadId: leads.leadId,
      companyName: companies.name,
      companyDescription: companies.description,
      vendorName: vendorProfiles.name,
      vendorType: vendorProfiles.vendorType,
      intent: leads.intent,
      score: leads.score,
      stage: leads.pipelineStage,
      outreachMode: leads.outreachMode,
      brief: leads.brief,
      contactBlock: leads.contactBlock,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.companyId))
    .innerJoin(vendorProfiles, eq(leads.vendorId, vendorProfiles.vendorId))
    .where(eq(leads.leadId, leadId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const briefParsed =
    row.brief == null ? null : leadBriefSchema.safeParse(row.brief);
  const contactParsed =
    row.contactBlock == null ? null : contactBlockSchema.safeParse(row.contactBlock);

  return {
    leadId: row.leadId,
    companyName: row.companyName,
    companyDescription: row.companyDescription,
    vendorName: row.vendorName,
    vendorType: row.vendorType,
    intent: row.intent,
    score: row.score,
    stage: row.stage as PipelineStage,
    outreachMode: row.outreachMode,
    brief: briefParsed && briefParsed.success ? briefParsed.data : null,
    contactBlock: contactParsed && contactParsed.success ? contactParsed.data : null,
    createdAt: row.createdAt,
  };
}
