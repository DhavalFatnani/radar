import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { projects, leads, companies, vendorProfiles } from "@/db/schema";
import {
  getCommissionForLead,
  createCommissionTerms,
  updateCommissionTerms,
  activateCommission,
} from "@/lib/commission/data";
import type { CommissionTerms } from "@/lib/commission/schema";

const flat: CommissionTerms = { type: "one_time", basis: "flat", amountInr: 250_000 };
const recurring: CommissionTerms = { type: "recurring", basis: "flat", amountInr: 100_000, cadence: "monthly" };

async function seedLead(stage: string = "won"): Promise<string> {
  const [company] = await testDb.insert(companies).values({ name: "Zephyr", normalizedName: "zephyr" }).returning();
  const [vendor] = await testDb.insert(vendorProfiles).values({ name: "Acme" }).returning();
  const [lead] = await testDb
    .insert(leads)
    .values({ companyId: company.companyId, vendorId: vendor.vendorId, pipelineStage: stage as never })
    .returning();
  return lead.leadId;
}

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["projects", "leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
});

describe("getCommissionForLead", () => {
  it("returns null for a malformed id", async () => {
    expect(await getCommissionForLead(testDb, "nope")).toBeNull();
  });
  it("returns null when no project exists", async () => {
    const leadId = await seedLead();
    expect(await getCommissionForLead(testDb, leadId)).toBeNull();
  });
});

describe("createCommissionTerms", () => {
  it("creates a pending project with one scheduled cycle", async () => {
    const leadId = await seedLead();
    const r = await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.status).toBe("pending");
    expect(rec?.terms?.amountInr).toBe(250_000);
    expect(rec?.cycles).toEqual([
      { seq: 1, dueDate: "2026-07-05", amountInr: 250_000, status: "scheduled", paidAt: null, paidAmountInr: null },
    ]);
    const [row] = await testDb.select().from(projects).where(eq(projects.leadId, leadId));
    expect(row.vendorId).toBeTruthy();
  });
  it("rejects a second create for the same lead", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    const r = await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    expect(r).toEqual({ ok: false, error: "Commission terms already exist for this deal." });
  });
  it("rejects an unknown lead", async () => {
    const r = await createCommissionTerms(testDb, "10000000-0000-4000-8000-000000000009", flat, "2026-07-05");
    expect(r).toEqual({ ok: false, error: "Lead not found." });
  });
});

describe("updateCommissionTerms", () => {
  it("rebuilds cycles while status is pending", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    const r = await updateCommissionTerms(testDb, leadId, recurring, "2026-07-06");
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.terms?.type).toBe("recurring");
    expect(rec?.cycles[0].dueDate).toBe("2026-07-06");
  });
  it("refuses to edit once active", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await updateCommissionTerms(testDb, leadId, recurring, "2026-07-06");
    expect(r).toEqual({ ok: false, error: "Terms can only be edited before the deal is delivered." });
  });
});

describe("activateCommission", () => {
  it("flips scheduled cycles to due and sets status active", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    const r = await activateCommission(testDb, leadId);
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.status).toBe("active");
    expect(rec?.cycles[0].status).toBe("due");
  });
  it("rejects activating a non-pending commission", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await activateCommission(testDb, leadId);
    expect(r).toEqual({ ok: false, error: "Commission is already active." });
  });
  it("rejects when there is no commission", async () => {
    const leadId = await seedLead();
    const r = await activateCommission(testDb, leadId);
    expect(r).toEqual({ ok: false, error: "No commission for this deal." });
  });
});
