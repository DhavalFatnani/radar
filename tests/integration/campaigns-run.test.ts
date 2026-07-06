import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { seedSignals } from "@/db/seed-signals";
import { seedOpsSignals } from "@/db/seed-ops-signals";
import { vendorProfiles, leads, campaignLeads, companySnapshots } from "@/db/schema";
import { createCampaign, getCampaign } from "@/lib/campaigns/data";
import { runCampaign } from "@/lib/campaigns/run";
import { createCompanyFixtureAdapter } from "@/lib/sourcing/adapters/company-fixture";
import { eq } from "drizzle-orm";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["campaign_leads", "company_snapshots", "leads", "campaigns", "signal_observations", "mappings", "signal_definitions", "companies", "vendor_profiles"]);
});
afterAll(async () => { await closeTestDb(); });

async function setup() {
  await seedSignals(testDb);       // SIG-MONEY-FUNDING, SIG-HIRING-OPS-SURGE, ...
  await seedOpsSignals(testDb);    // headcount + in-house counter + "Ops expansion — pursue" (Infra)
  const [v] = await testDb.insert(vendorProfiles).values({ name: "RackPro Infra", vendorType: "Infra" }).returning();
  return v.vendorId;
}

describe("runCampaign", () => {
  it("sources real-shaped companies and produces scored leads for the vendor", async () => {
    const vendorId = await setup();
    const { campaignId } = await createCampaign(testDb, { vendorId, label: "RackPro · India · 10", source: "company-fixture", config: { geography: "IND", target: 10 } });

    const stats = await runCampaign(testDb, { campaignId, adapter: createCompanyFixtureAdapter() });

    expect(stats.companiesFetched).toBeGreaterThan(0);
    expect(stats.leadsCreated).toBeGreaterThan(0);

    const c = await getCampaign(testDb, campaignId);
    expect(c!.status).toBe("done");

    const vendorLeads = await testDb.select().from(leads).where(eq(leads.vendorId, vendorId));
    expect(vendorLeads.length).toBe(stats.leadsCreated);
    // Anveshan fires funding + ops-hiring (both required) → a lead exists, tagged to this campaign.
    expect(vendorLeads.every((l) => l.sourceCampaignId === campaignId)).toBe(true);

    const links = await testDb.select().from(campaignLeads).where(eq(campaignLeads.campaignId, campaignId));
    expect(links.length).toBe(vendorLeads.length);
    expect(links.every((l) => l.wasNew)).toBe(true);

    const snaps = await testDb.select().from(companySnapshots).where(eq(companySnapshots.campaignId, campaignId));
    expect(snaps.length).toBeGreaterThan(0);
  });

  it("marks the campaign failed and rethrows when the adapter throws", async () => {
    const vendorId = await setup();
    const { campaignId } = await createCampaign(testDb, { vendorId, label: "x", source: "company-fixture", config: {} });
    const boom = { sourceName: "boom", async fetch() { throw new Error("provider down"); } };

    await expect(runCampaign(testDb, { campaignId, adapter: boom })).rejects.toThrow("provider down");
    const c = await getCampaign(testDb, campaignId);
    expect(c!.status).toBe("failed");
    expect(c!.error).toContain("provider down");
  });
});
