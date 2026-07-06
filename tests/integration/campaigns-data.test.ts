import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { campaigns, campaignLeads, companySnapshots, vendorProfiles, companies, leads } from "@/db/schema";
import { createCampaign, finishCampaign, failCampaign, recordCampaignLead, writeCompanySnapshot, getCampaign, listCampaigns } from "@/lib/campaigns/data";
import { eq } from "drizzle-orm";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["campaign_leads", "company_snapshots", "leads", "campaigns", "companies", "vendor_profiles"]);
});
afterAll(async () => { await closeTestDb(); });

async function vendor() {
  const [v] = await testDb.insert(vendorProfiles).values({ name: "V", vendorType: "Infra" }).returning();
  return v.vendorId;
}

describe("campaign data access", () => {
  it("creates a running campaign, then finishes it with stats", async () => {
    const vendorId = await vendor();
    const { campaignId } = await createCampaign(testDb, { vendorId, label: "V · India · 20", source: "company-fixture", config: { geography: "IND", target: 20 } });
    let c = await getCampaign(testDb, campaignId);
    expect(c!.status).toBe("running");
    expect(c!.startedAt).not.toBeNull();

    await finishCampaign(testDb, campaignId, { companiesFetched: 3, observationsWritten: 5, leadsCreated: 2, leadsUpdated: 1, creditsSpent: 0 });
    c = await getCampaign(testDb, campaignId);
    expect(c!.status).toBe("done");
    expect(c!.finishedAt).not.toBeNull();
    expect((c!.stats as { leadsCreated: number }).leadsCreated).toBe(2);
  });

  it("marks a campaign failed with an error message", async () => {
    const vendorId = await vendor();
    const { campaignId } = await createCampaign(testDb, { vendorId, label: "x", source: "company-fixture", config: {} });
    await failCampaign(testDb, campaignId, "adapter timeout");
    const c = await getCampaign(testDb, campaignId);
    expect(c!.status).toBe("failed");
    expect(c!.error).toBe("adapter timeout");
  });

  it("records campaign_leads idempotently and writes a snapshot", async () => {
    const vendorId = await vendor();
    const [co] = await testDb.insert(companies).values({ name: "Co", normalizedName: "co" }).returning();
    const { campaignId } = await createCampaign(testDb, { vendorId, label: "x", source: "company-fixture", config: {} });
    const [lead] = await testDb.insert(leads).values({ vendorId, companyId: co.companyId, intent: "x", score: 40 }).returning();

    await recordCampaignLead(testDb, campaignId, lead.leadId, true);
    await recordCampaignLead(testDb, campaignId, lead.leadId, true); // idempotent
    await writeCompanySnapshot(testDb, campaignId, co.companyId, { fundraiseDate: "2026-05-01", headcountTotal: 100, opsPostings: 5, score: 40 });

    const links = await testDb.select().from(campaignLeads).where(eq(campaignLeads.campaignId, campaignId));
    expect(links).toHaveLength(1);
    const snaps = await testDb.select().from(companySnapshots).where(eq(companySnapshots.campaignId, campaignId));
    expect(snaps).toHaveLength(1);

    const list = await listCampaigns(testDb, vendorId);
    expect(list).toHaveLength(1);
  });
});
