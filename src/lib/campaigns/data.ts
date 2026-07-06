import { desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only
import { campaigns, campaignLeads, companySnapshots } from "@/db/schema";

export type CampaignStats = {
  companiesFetched: number; observationsWritten: number;
  leadsCreated: number; leadsUpdated: number; creditsSpent: number;
};
export type NewCampaignInput = { vendorId: string; label: string; source: string; config: unknown };

export async function createCampaign(db: DB, input: NewCampaignInput): Promise<{ campaignId: string }> {
  const [row] = await db
    .insert(campaigns)
    .values({
      vendorId: input.vendorId, label: input.label, source: input.source,
      config: input.config as never, status: "running", startedAt: new Date(),
    })
    .returning({ campaignId: campaigns.campaignId });
  return { campaignId: row.campaignId };
}

export async function finishCampaign(db: DB, campaignId: string, stats: CampaignStats): Promise<void> {
  await db.update(campaigns)
    .set({ status: "done", stats: stats as never, finishedAt: new Date() })
    .where(eq(campaigns.campaignId, campaignId));
}

export async function failCampaign(db: DB, campaignId: string, error: string): Promise<void> {
  await db.update(campaigns)
    .set({ status: "failed", error, finishedAt: new Date() })
    .where(eq(campaigns.campaignId, campaignId));
}

export async function recordCampaignLead(db: DB, campaignId: string, leadId: string, wasNew: boolean): Promise<void> {
  await db.insert(campaignLeads)
    .values({ campaignId, leadId, wasNew })
    .onConflictDoNothing({ target: [campaignLeads.campaignId, campaignLeads.leadId] });
}

export async function writeCompanySnapshot(db: DB, campaignId: string, companyId: string, snapshot: unknown): Promise<void> {
  await db.insert(companySnapshots).values({ campaignId, companyId, snapshot: snapshot as never });
}

export async function getCampaign(db: DB, campaignId: string) {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.campaignId, campaignId)).limit(1);
  return row ?? null;
}

export async function listCampaigns(db: DB, vendorId?: string) {
  const base = db.select().from(campaigns).orderBy(desc(campaigns.createdAt));
  return vendorId ? base.where(eq(campaigns.vendorId, vendorId)) : base;
}
