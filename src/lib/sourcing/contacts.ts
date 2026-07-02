import { eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — erased at runtime, never loads the env-eager client
import { leads, companies, vendorProfiles } from "@/db/schema";
import {
  buildContactBlock,
  type ContactResolver,
  type ContactResolutionInput,
} from "@/lib/sourcing/contacts-schema";

export type ResolveContactsResult = {
  leadsScanned: number;      // leads with contact_block IS NULL processed this run
  contactsResolved: number;  // blocks written with status "resolved" (resolver returned >=1 DM)
  pendingEnrichment: number; // blocks written with status "pending_enrichment" (resolver returned 0)
  failures: number;          // resolver threw or a company/vendor row was missing → lead left NULL
};

export const CONTACT_LEAD_LIMIT = 200;

/**
 * Populate leads.contact_block for un-resolved leads by delegating to an injected
 * ContactResolver. Pass-through integrity: decision_makers is the resolver output
 * verbatim; the data layer adds only status / resolvedBy / resolvedAt. A resolver
 * that throws (or a lead with a missing company/vendor row) counts in `failures`,
 * leaves that lead's contact_block NULL, and the batch continues. Idempotent via the
 * isNull(contact_block) selection. `now` is injected so persisted timestamps are testable.
 */
export async function resolveContactsForLeads(
  db: DB,
  resolver: ContactResolver,
  now: Date = new Date(),
): Promise<ResolveContactsResult> {
  const pending = await db
    .select({
      leadId: leads.leadId,
      companyId: leads.companyId,
      vendorId: leads.vendorId,
      intent: leads.intent,
    })
    .from(leads)
    .where(isNull(leads.contactBlock))
    .limit(CONTACT_LEAD_LIMIT);

  const result: ResolveContactsResult = {
    leadsScanned: pending.length,
    contactsResolved: 0,
    pendingEnrichment: 0,
    failures: 0,
  };
  if (pending.length === 0) return result;

  const companyIds = [...new Set(pending.map((l) => l.companyId))];
  const vendorIds = [...new Set(pending.map((l) => l.vendorId))];

  const companyRows = await db
    .select({ companyId: companies.companyId, name: companies.name, description: companies.description })
    .from(companies)
    .where(inArray(companies.companyId, companyIds));
  const vendorRows = await db
    .select({ vendorId: vendorProfiles.vendorId, name: vendorProfiles.name, vendorType: vendorProfiles.vendorType })
    .from(vendorProfiles)
    .where(inArray(vendorProfiles.vendorId, vendorIds));

  const companyById = new Map(companyRows.map((c) => [c.companyId, c]));
  const vendorById = new Map(vendorRows.map((v) => [v.vendorId, v]));

  for (const lead of pending) {
    const company = companyById.get(lead.companyId);
    const vendor = vendorById.get(lead.vendorId);
    if (!company || !vendor) {
      result.failures++;
      continue;
    }

    const input: ContactResolutionInput = {
      company: { name: company.name, description: company.description ?? null },
      vendor: { name: vendor.name, vendorType: vendor.vendorType ?? null },
      intent: lead.intent ?? null,
    };

    let decisionMakers;
    try {
      ({ decisionMakers } = await resolver.resolve(input));
    } catch {
      result.failures++;
      continue;
    }

    const block = buildContactBlock(decisionMakers, resolver.sourceName, now);
    await db.update(leads).set({ contactBlock: block }).where(eq(leads.leadId, lead.leadId));

    if (block.status === "resolved") result.contactsResolved++;
    else result.pendingEnrichment++;
  }

  return result;
}
