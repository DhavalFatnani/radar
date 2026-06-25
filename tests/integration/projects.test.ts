import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { testDb, migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { projects, leads, companies, vendorProfiles } from "@/db/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["projects", "leads", "vendor_profiles", "companies"]);
});
afterAll(async () => { await closeTestDb(); });

describe("projects (commission)", () => {
  it("creates a project with recurring commission terms", async () => {
    const [co] = await testDb.insert(companies).values({ name: "Acme" }).returning();
    const [v] = await testDb.insert(vendorProfiles).values({ name: "RackPro" }).returning();
    const [lead] = await testDb.insert(leads)
      .values({ companyId: co.companyId, vendorId: v.vendorId }).returning();

    const [p] = await testDb.insert(projects).values({
      leadId: lead.leadId, vendorId: v.vendorId,
      commissionTerms: { type: "recurring", rate_or_amount: "5%", cadence: "monthly" },
    }).returning();

    expect(p.projectId).toBeTruthy();
    expect((p.commissionTerms as { type: string }).type).toBe("recurring");
  });
});
