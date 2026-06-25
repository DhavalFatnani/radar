import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { testDb, migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { leads, companies, vendorProfiles, mappings } from "@/db/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["leads", "mappings", "vendor_profiles", "companies"]);
});
afterAll(async () => { await closeTestDb(); });

describe("leads", () => {
  it("creates a lead wired to company/vendor/mapping with jsonb brief", async () => {
    const [co] = await testDb.insert(companies).values({ name: "Acme" }).returning();
    const [v] = await testDb.insert(vendorProfiles).values({ name: "RackPro" }).returning();
    const [m] = await testDb.insert(mappings).values({ name: "Warehouse expansion" }).returning();

    const [lead] = await testDb.insert(leads).values({
      companyId: co.companyId, vendorId: v.vendorId, matchedMappingId: m.mappingId,
      intent: "Expanding warehouse capacity", score: 0.82,
      brief: { why_them: "new lease", why_now: [{ signal: "SIG-EXP-LARGE-LEASE", proof: "doc" }] },
      contactBlock: { decision_makers: [{ name: "R. Shah", role: "Head of Ops" }] },
    }).returning();

    expect(lead.leadId).toBeTruthy();
    expect(lead.pipelineStage).toBe("sourced");
    expect((lead.brief as { why_them: string }).why_them).toBe("new lease");
  });

  it("rejects a lead with no company (FK integrity)", async () => {
    const [v] = await testDb.insert(vendorProfiles).values({ name: "RackPro" }).returning();
    // @ts-expect-error companyId omitted on purpose
    await expect(testDb.insert(leads).values({
      vendorId: v.vendorId,
    })).rejects.toThrow();
  });
});
