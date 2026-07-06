import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { seedSignals } from "@/db/seed-signals";
import { seedOpsSignals } from "@/db/seed-ops-signals";
import { vendorProfiles } from "@/db/schema";
import { createCampaign, getCampaign } from "@/lib/campaigns/data";
import { runCampaign } from "@/lib/campaigns/run";
import { createCompanyFixtureAdapter } from "@/lib/sourcing/adapters/company-fixture";
import { adapterForSource } from "@/lib/campaigns/adapter";
import type { CompanySourceAdapter } from "@/lib/sourcing/company-schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["campaign_leads", "company_snapshots", "leads", "campaigns", "signal_observations", "mappings", "signal_definitions", "companies", "vendor_profiles"]);
});
afterAll(async () => { await closeTestDb(); });

describe("adapterForSource", () => {
  it("returns the fixture adapter for a non-crustdata source", () => {
    expect(adapterForSource("company-fixture").sourceName).toBe("company-fixture");
  });
});

describe("runCampaign surfaces creditsSpent from the adapter", () => {
  it("reads adapter.creditsSpent() into stats", async () => {
    await seedSignals(testDb); await seedOpsSignals(testDb);
    const [v] = await testDb.insert(vendorProfiles).values({ name: "V", vendorType: "Infra" }).returning();
    const { campaignId } = await createCampaign(testDb, { vendorId: v.vendorId, label: "x", source: "company-fixture", config: { geography: "IND", target: 10 } });

    // A fixture adapter that reports a fake spend, to prove the wiring.
    const base = createCompanyFixtureAdapter();
    const metered: CompanySourceAdapter = { ...base, creditsSpent: () => 0.42 };

    const stats = await runCampaign(testDb, { campaignId, adapter: metered });
    expect(stats.creditsSpent).toBe(0.42);
    const c = await getCampaign(testDb, campaignId);
    expect((c!.stats as { creditsSpent: number }).creditsSpent).toBe(0.42);
  });
});
