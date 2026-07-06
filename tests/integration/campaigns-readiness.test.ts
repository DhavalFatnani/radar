import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { seedSignals } from "@/db/seed-signals";
import { seedOpsSignals } from "@/db/seed-ops-signals";
import { vendorProfiles } from "@/db/schema";
import { getSourcingReadiness } from "@/lib/campaigns/readiness";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["mappings", "signal_definitions", "vendor_profiles"]); });
afterAll(async () => { await closeTestDb(); });

describe("getSourcingReadiness", () => {
  it("is runnable for an Infra vendor once the ops config is seeded", async () => {
    await seedSignals(testDb); await seedOpsSignals(testDb);
    const [v] = await testDb.insert(vendorProfiles).values({ name: "RackPro", vendorType: "Infra" }).returning();
    const r = await getSourcingReadiness(testDb, v.vendorId);
    expect(r.found).toBe(true);
    expect(r.runnable).toBe(true);
    expect(r.signalFamilies.length).toBeGreaterThan(0);
  });

  it("is not runnable for a vendor whose type matches no approved mapping", async () => {
    await seedSignals(testDb); await seedOpsSignals(testDb);
    const [v] = await testDb.insert(vendorProfiles).values({ name: "Mktg Co", vendorType: "Mktg" }).returning();
    const r = await getSourcingReadiness(testDb, v.vendorId);
    expect(r.found).toBe(true);
    expect(r.runnable).toBe(false);
  });

  it("reports not-found for a missing vendor", async () => {
    const r = await getSourcingReadiness(testDb, "00000000-0000-0000-0000-000000000000");
    expect(r.found).toBe(false);
    expect(r.runnable).toBe(false);
  });
});
