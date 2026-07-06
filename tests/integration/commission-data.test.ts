import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { projects, leads, companies, vendorProfiles } from "@/db/schema";
import {
  getCommissionForLead,
  createCommissionTerms,
  updateCommissionTerms,
  activateCommission,
  markCyclePaid,
  markCycleMissed,
  waiveCycle,
  addNextCycle,
  appendDisclosure,
  appendIntroduction,
  openDispute,
  resolveDispute,
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

describe("markCyclePaid", () => {
  it("marks a due cycle paid at its expected amount and closes a one-time commission", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await markCyclePaid(testDb, leadId, 1, "2026-07-10T09:00:00.000Z");
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.status).toBe("closed");
    expect(rec?.cycles[0].status).toBe("paid");
    expect(rec?.cycles[0].paidAmountInr).toBe(250_000);
    expect(rec?.cycles[0].paidAt).toBe("2026-07-10T09:00:00.000Z");
  });
  it("refuses a cycle that is not due or missed", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05"); // still scheduled
    const r = await markCyclePaid(testDb, leadId, 1, "2026-07-10T09:00:00.000Z");
    expect(r).toEqual({ ok: false, error: "Only a due or missed cycle can be marked paid." });
  });
  it("rejects an unknown cycle seq", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await markCyclePaid(testDb, leadId, 99, "2026-07-10T09:00:00.000Z");
    expect(r).toEqual({ ok: false, error: "Cycle not found." });
  });
});

describe("markCycleMissed + waiveCycle", () => {
  it("marks a due cycle missed and keeps status active", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await markCycleMissed(testDb, leadId, 1);
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.cycles[0].status).toBe("missed");
    expect(rec?.status).toBe("active");
  });
  it("waives a cycle, which counts as settled and closes the commission", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await waiveCycle(testDb, leadId, 1);
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.cycles[0].status).toBe("waived");
    expect(rec?.status).toBe("closed");
  });
});

describe("addNextCycle", () => {
  it("appends the next recurring cycle one cadence interval later", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, recurring, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await addNextCycle(testDb, leadId);
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.cycles).toHaveLength(2);
    expect(rec?.cycles[1]).toMatchObject({ seq: 2, dueDate: "2026-08-05", amountInr: 100_000, status: "due" });
  });
  it("refuses on a one-time commission", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await addNextCycle(testDb, leadId);
    expect(r).toEqual({ ok: false, error: "Only recurring commissions have additional cycles." });
  });
});

describe("leak-defense logs", () => {
  it("appends disclosure and introduction entries", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await appendDisclosure(testDb, leadId, { at: "2026-07-06T10:00:00.000Z", contactField: "email", disclosedTo: "vendor" });
    await appendIntroduction(testDb, leadId, { at: "2026-07-06T11:00:00.000Z", channel: "email" });
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.disclosureLog).toHaveLength(1);
    expect(rec?.disclosureLog[0].contactField).toBe("email");
    expect(rec?.introductionLog).toHaveLength(1);
  });
});

describe("disputes", () => {
  it("opens a dispute (status disputed) then resolves it back to the cycle-derived status", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const opened = await openDispute(testDb, leadId, "Vendor went direct", "2026-07-07T09:00:00.000Z");
    expect(opened.ok).toBe(true);
    let rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.status).toBe("disputed");
    expect(rec?.disputeLog[0].status).toBe("open");

    const resolved = await resolveDispute(testDb, leadId, "Paid in full", "2026-07-09T09:00:00.000Z");
    expect(resolved.ok).toBe(true);
    rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.status).toBe("active"); // one due cycle remains
    expect(rec?.disputeLog[0].status).toBe("resolved");
    expect(rec?.disputeLog[0].resolution).toBe("Paid in full");
  });
  it("refuses to resolve when there is no open dispute", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    const r = await resolveDispute(testDb, leadId, "n/a", "2026-07-09T09:00:00.000Z");
    expect(r).toEqual({ ok: false, error: "No open dispute to resolve." });
  });
});
