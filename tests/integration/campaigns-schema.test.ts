import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { campaigns, campaignLeads, companySnapshots, leads, companies, vendorProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["campaign_leads", "company_snapshots", "leads", "campaigns", "companies", "vendor_profiles"]);
});
afterAll(async () => { await closeTestDb(); });

describe("campaigns schema", () => {
  it("inserts a campaign, a company_snapshot, and links a lead via campaign_leads", async () => {
    const [v] = await testDb.insert(vendorProfiles).values({ name: "V", vendorType: "Infra" }).returning();
    const [co] = await testDb.insert(companies).values({ name: "Co", normalizedName: "co" }).returning();
    const [c] = await testDb.insert(campaigns).values({
      vendorId: v.vendorId, label: "V · India · 20", source: "company-fixture",
      status: "running", config: { geography: "IND", target: 20 },
    }).returning();
    expect(c.campaignId).toBeTruthy();
    expect(c.status).toBe("running");

    const [lead] = await testDb.insert(leads).values({
      vendorId: v.vendorId, companyId: co.companyId, intent: "x", score: 42,
      sourceCampaignId: c.campaignId,
    }).returning();
    expect(lead.sourceCampaignId).toBe(c.campaignId);

    await testDb.insert(campaignLeads).values({ campaignId: c.campaignId, leadId: lead.leadId, wasNew: true });
    await testDb.insert(companySnapshots).values({
      campaignId: c.campaignId, companyId: co.companyId,
      snapshot: { fundraiseDate: "2026-05-01", headcountTotal: 120, opsPostings: 6, score: 42 },
    });

    const links = await testDb.select().from(campaignLeads).where(eq(campaignLeads.campaignId, c.campaignId));
    expect(links).toHaveLength(1);
    expect(links[0].wasNew).toBe(true);
  });
});
