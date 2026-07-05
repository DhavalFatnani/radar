import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { projects, leads, companies, vendorProfiles } from "@/db/schema";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["projects", "leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
});

async function seedLead(): Promise<{ leadId: string; vendorId: string }> {
  const [company] = await testDb.insert(companies).values({ name: "Zephyr Retail", normalizedName: "zephyr retail" }).returning();
  const [vendor] = await testDb.insert(vendorProfiles).values({ name: "Acme Infra" }).returning();
  const [lead] = await testDb
    .insert(leads)
    .values({ companyId: company.companyId, vendorId: vendor.vendorId, pipelineStage: "won" })
    .returning();
  return { leadId: lead.leadId, vendorId: vendor.vendorId };
}

describe("projects commission schema", () => {
  it("inserts a project row with commission defaults", async () => {
    const { leadId, vendorId } = await seedLead();
    const [row] = await testDb.insert(projects).values({ leadId, vendorId }).returning();
    expect(row.commissionStatus).toBe("pending");
    expect(row.commissionCycles).toEqual({ cycles: [] });
    expect(row.disclosureLog).toEqual([]);
    expect(row.introductionLog).toEqual([]);
    expect(row.disputeLog).toEqual([]);
    expect(row.commissionTerms).toBeNull();
  });

  it("round-trips a populated terms + cycles payload", async () => {
    const { leadId, vendorId } = await seedLead();
    await testDb.insert(projects).values({
      leadId,
      vendorId,
      commissionStatus: "active",
      commissionTerms: { type: "one_time", basis: "flat", amountInr: 250000 },
      commissionCycles: { cycles: [{ seq: 1, dueDate: "2026-07-05", amountInr: 250000, status: "due", paidAt: null, paidAmountInr: null }] },
    });
    const [row] = await testDb.select().from(projects).where(eq(projects.leadId, leadId));
    expect(row.commissionStatus).toBe("active");
    expect((row.commissionTerms as { amountInr: number }).amountInr).toBe(250000);
    expect((row.commissionCycles as { cycles: unknown[] }).cycles).toHaveLength(1);
  });

  it("enforces one project per lead (unique lead_id)", async () => {
    const { leadId, vendorId } = await seedLead();
    await testDb.insert(projects).values({ leadId, vendorId });
    await expect(testDb.insert(projects).values({ leadId, vendorId })).rejects.toThrow();
  });
});
