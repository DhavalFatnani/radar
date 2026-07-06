import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { seedSignals } from "@/db/seed-signals";
import { seedOpsSignals } from "@/db/seed-ops-signals";
import { vendorProfiles, campaigns, leads } from "@/db/schema";
import { runCampaignForVendor } from "@/db/campaign-run";
import { eq } from "drizzle-orm";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["campaign_leads", "company_snapshots", "leads", "campaigns", "signal_observations", "mappings", "signal_definitions", "companies", "vendor_profiles"]);
});
afterAll(async () => { await closeTestDb(); });

describe("runCampaignForVendor (fixture source — no key needed)", () => {
  it("creates and runs a campaign end-to-end, producing leads", async () => {
    await seedSignals(testDb); await seedOpsSignals(testDb);
    const [v] = await testDb.insert(vendorProfiles).values({ name: "RackPro Infra", vendorType: "Infra" }).returning();

    const { campaignId, stats } = await runCampaignForVendor(testDb, {
      vendorId: v.vendorId, source: "company-fixture", geography: "IND", target: 10,
    });

    expect(stats.leadsCreated).toBeGreaterThan(0);
    const [c] = await testDb.select().from(campaigns).where(eq(campaigns.campaignId, campaignId));
    expect(c.status).toBe("done");
    expect(c.source).toBe("company-fixture");
    expect(c.label).toContain("RackPro Infra");
    const vendorLeads = await testDb.select().from(leads).where(eq(leads.vendorId, v.vendorId));
    expect(vendorLeads.length).toBe(stats.leadsCreated);
  });

  it("throws a clear error when the vendor does not exist", async () => {
    await expect(runCampaignForVendor(testDb, {
      vendorId: "00000000-0000-0000-0000-000000000000", source: "company-fixture", geography: "IND", target: 5,
    })).rejects.toThrow(/vendor/i);
  });
});
