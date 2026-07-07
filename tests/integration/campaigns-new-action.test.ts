import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { seedSignals } from "@/db/seed-signals";
import { seedOpsSignals } from "@/db/seed-ops-signals";
import { vendorProfiles, campaigns } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createCampaignAction } from "@/app/(app)/campaigns/actions";
import { auth } from "@/lib/auth";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["campaign_leads", "company_snapshots", "leads", "campaigns", "signal_observations", "mappings", "signal_definitions", "companies", "vendor_profiles"]);
  vi.clearAllMocks();
});
afterAll(async () => { await closeTestDb(); await queryClient.end(); });

async function infraVendor() {
  await seedSignals(testDb); await seedOpsSignals(testDb);
  const [v] = await testDb.insert(vendorProfiles).values({ name: "RackPro", vendorType: "Infra" }).returning();
  return v.vendorId;
}
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) Array.isArray(v) ? v.forEach((x) => fd.append(k, x)) : fd.set(k, v);
  return fd;
}

describe("createCampaignAction", () => {
  it("runs a fixture campaign for a ready vendor and persists the full config", async () => {
    const vendorId = await infraVendor();
    const res = await createCampaignAction({ ok: false }, form({
      vendorId, geography: "IND", target: "20", source: "company-fixture",
      fundedMonths: "6", roundType: "seed", industries: ["Logistics", "SaaS"], minScore: "40", sortBy: "score", excludeSeen: "true",
    }));
    expect(res.ok).toBe(true);
    expect(res.campaignId).toBeTruthy();
    const [c] = await testDb.select().from(campaigns).where(eq(campaigns.campaignId, res.campaignId!));
    expect(c.config).toMatchObject({ fundedSinceDays: 180, roundType: "seed", industries: ["Logistics", "SaaS"] });
  });

  it("refuses a vendor that is not ready to source", async () => {
    await seedSignals(testDb); await seedOpsSignals(testDb);
    const [v] = await testDb.insert(vendorProfiles).values({ name: "Mktg", vendorType: "Mktg" }).returning();
    const res = await createCampaignAction({ ok: false }, form({ vendorId: v.vendorId, geography: "IND", target: "20", source: "company-fixture" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/mapping/i);
    expect(await testDb.select().from(campaigns)).toHaveLength(0);
  });

  it("rejects an unauthenticated caller", async () => {
    const vendorId = await infraVendor();
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const res = await createCampaignAction({ ok: false }, form({ vendorId, geography: "IND", target: "20", source: "company-fixture" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/signed in/i);
  });
});
