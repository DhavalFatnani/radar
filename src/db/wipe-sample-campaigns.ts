import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql, inArray, or } from "drizzle-orm";
import * as schema from "./schema";
import { campaigns, companies, leads, campaignLeads, companySnapshots } from "./schema";
import type { DB } from "./client";

/** Remove exactly the rows created by db:seed:campaigns (tagged sample=true). */
async function wipe(db: DB) {
  const sampleCampaigns = await db.select({ id: campaigns.campaignId }).from(campaigns).where(sql`${campaigns.config}->>'sample' = 'true'`);
  const sampleCompanies = await db.select({ id: companies.companyId }).from(companies).where(sql`${companies.profile}->>'sample' = 'true'`);
  const campIds = sampleCampaigns.map((c) => c.id);
  const coIds = sampleCompanies.map((c) => c.id);

  // FK-safe order: snapshots + campaign_leads → leads → campaigns → companies.
  if (campIds.length) {
    await db.delete(companySnapshots).where(inArray(companySnapshots.campaignId, campIds));
    await db.delete(campaignLeads).where(inArray(campaignLeads.campaignId, campIds));
  }
  // Delete leads that either belong to a sample company OR were sourced by a sample
  // campaign (guards against a stray lead landing on a real company).
  const leadConds = [
    campIds.length ? inArray(leads.sourceCampaignId, campIds) : null,
    coIds.length ? inArray(leads.companyId, coIds) : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);
  if (leadConds.length) await db.delete(leads).where(leadConds.length === 1 ? leadConds[0] : or(...leadConds));
  if (campIds.length) await db.delete(campaigns).where(inArray(campaigns.campaignId, campIds));
  if (coIds.length) await db.delete(companies).where(inArray(companies.companyId, coIds));

  console.log(`Removed ${campIds.length} sample campaigns and ${coIds.length} sample companies.`);
}

if (process.argv[1] && process.argv[1].endsWith("wipe-sample-campaigns.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:wipe:campaigns");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  wipe(db)
    .then(() => client.end())
    .then(() => process.exit(0))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); return client.end().finally(() => process.exit(1)); });
}
