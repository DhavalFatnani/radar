import { describe, it, expect, beforeAll, afterEach, afterAll, vi, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { leads, companies, vendorProfiles } from "@/db/schema";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { getCommissionForLead } from "@/lib/commission/data";
import {
  setCommissionTermsAction,
  activateCommissionAction,
  markCyclePaidAction,
  openDisputeAction,
} from "@/app/(app)/leads/actions";

const flatInput = { type: "one_time", basis: "flat", amountInr: 250_000 };

async function makeLead(stage: string = "won"): Promise<string> {
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
  vi.clearAllMocks();
  await truncateAll(["projects", "leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("setCommissionTermsAction", () => {
  it("creates terms on a won lead and revalidates", async () => {
    const leadId = await makeLead("won");
    const r = await setCommissionTermsAction(leadId, flatInput);
    expect(r).toEqual({ ok: true });
    expect(await getCommissionForLead(testDb, leadId)).not.toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(`/leads/${leadId}`);
  });
  it("rejects an unauthenticated caller without writing", async () => {
    (auth as Mock).mockResolvedValueOnce(null);
    const leadId = await makeLead("won");
    const r = await setCommissionTermsAction(leadId, flatInput);
    expect(r.ok).toBe(false);
    expect(await getCommissionForLead(testDb, leadId)).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("rejects invalid terms", async () => {
    const leadId = await makeLead("won");
    const r = await setCommissionTermsAction(leadId, { type: "one_time", basis: "flat" });
    expect(r).toEqual({ ok: false, error: "Invalid commission terms." });
  });
  it("refuses when the lead is not in a commission-eligible stage", async () => {
    const leadId = await makeLead("contacted");
    const r = await setCommissionTermsAction(leadId, flatInput);
    expect(r).toEqual({ ok: false, error: "Set commission terms once the deal is won." });
  });
});

describe("activateCommissionAction", () => {
  it("refuses until the deal is delivered", async () => {
    const leadId = await makeLead("won");
    await setCommissionTermsAction(leadId, flatInput);
    const r = await activateCommissionAction(leadId);
    expect(r).toEqual({ ok: false, error: "Mark the deal delivered first." });
  });
  it("activates once delivered", async () => {
    const leadId = await makeLead("delivered");
    await setCommissionTermsAction(leadId, flatInput);
    const r = await activateCommissionAction(leadId);
    expect(r).toEqual({ ok: true });
    expect((await getCommissionForLead(testDb, leadId))?.status).toBe("active");
  });
});

describe("markCyclePaidAction + openDisputeAction", () => {
  it("marks the cycle paid", async () => {
    const leadId = await makeLead("delivered");
    await setCommissionTermsAction(leadId, flatInput);
    await activateCommissionAction(leadId);
    const r = await markCyclePaidAction(leadId, 1);
    expect(r).toEqual({ ok: true });
    expect((await getCommissionForLead(testDb, leadId))?.cycles[0].status).toBe("paid");
  });
  it("opens a dispute", async () => {
    const leadId = await makeLead("delivered");
    await setCommissionTermsAction(leadId, flatInput);
    await activateCommissionAction(leadId);
    const r = await openDisputeAction(leadId, "went direct");
    expect(r).toEqual({ ok: true });
    expect((await getCommissionForLead(testDb, leadId))?.status).toBe("disputed");
  });
  it("rejects an unauthenticated mark-paid", async () => {
    (auth as Mock).mockResolvedValueOnce(null);
    const r = await markCyclePaidAction("10000000-0000-4000-8000-000000000009", 1);
    expect(r.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
