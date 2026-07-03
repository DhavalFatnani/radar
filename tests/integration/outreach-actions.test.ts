import { describe, it, expect, beforeAll, afterEach, afterAll, vi, type Mock } from "vitest";
import type { OutreachMode } from "@/lib/leads/schema";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/ai/outreach", () => ({ generateOutreach: vi.fn() }));

import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { leads, companies, vendorProfiles } from "@/db/schema";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { generateOutreach } from "@/ai/outreach";
import {
  setOutreachModeAction,
  generateOutreachDraftAction,
  setOutreachStatusAction,
} from "@/app/(app)/leads/actions";

const validBrief = {
  why_them: "Expanding to three new regions.",
  why_now: [
    { signalId: "sig-1", claim: "Opened a new DC", date: "2026-06-01T00:00:00Z", source: "pr", evidence: ["https://x"] },
  ],
  what_they_need: "Warehouse automation partner",
  hook: "Congrats on the expansion",
  why_this_vendor: "You automated a comparable site",
  objections: [{ objection: "Too expensive", response: "ROI within 6 months" }],
  disqualifier_check_passed: true,
  generatedAt: "2026-06-02T09:30:00Z",
};

async function makeLead(opts: { brief?: unknown } = {}): Promise<string> {
  const [company] = await testDb
    .insert(companies)
    .values({ name: "Zephyr Retail", normalizedName: "zephyr retail", description: "Retailer" })
    .returning();
  const [vendor] = await testDb
    .insert(vendorProfiles)
    .values({ name: "Acme Infra", vendorType: "Infra" })
    .returning();
  const [lead] = await testDb
    .insert(leads)
    .values({
      companyId: company.companyId,
      vendorId: vendor.vendorId,
      intent: "Warehouse buildout",
      brief: opts.brief ?? null,
    })
    .returning();
  return lead.leadId;
}

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  vi.clearAllMocks();
  await truncateAll(["leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("setOutreachModeAction", () => {
  it("persists the mode and revalidates", async () => {
    const leadId = await makeLead();
    const r = await setOutreachModeAction(leadId, "handed_to_vendor");
    expect(r).toEqual({ ok: true });
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachMode).toBe("handed_to_vendor");
    expect(revalidatePath).toHaveBeenCalledWith(`/leads/${leadId}`);
  });

  it("rejects an unauthenticated caller", async () => {
    (auth as Mock).mockResolvedValueOnce(null);
    const leadId = await makeLead();
    const r = await setOutreachModeAction(leadId, "handed_to_vendor");
    expect(r.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an unknown mode", async () => {
    const leadId = await makeLead();
    const r = await setOutreachModeAction(leadId, "nope" as never);
    expect(r).toEqual({ ok: false, error: "Unknown mode." });
  });

  it("accepts operator_handles and persists it", async () => {
    const leadId = await makeLead();
    const r = await setOutreachModeAction(leadId, "operator_handles");
    expect(r).toEqual({ ok: true });
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachMode).toBe("operator_handles");
  });

  it("rejects a prototype-chain key as an unknown mode without touching the DB", async () => {
    const leadId = await makeLead();
    const result = await setOutreachModeAction(leadId, "toString" as OutreachMode);
    expect(result).toEqual({ ok: false, error: "Unknown mode." });
    expect(revalidatePath).not.toHaveBeenCalled();
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachMode).toBeNull();
  });
});

describe("generateOutreachDraftAction", () => {
  it("generates and saves a draft when a brief exists", async () => {
    const leadId = await makeLead({ brief: validBrief });
    (generateOutreach as Mock).mockResolvedValue({
      value: { subject: "Hi", body: "Let's talk." },
      provider: "anthropic",
    });
    const r = await generateOutreachDraftAction(leadId);
    expect(r).toEqual({ ok: true });
    expect(generateOutreach).toHaveBeenCalledTimes(1);
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachDraft).toEqual({ subject: "Hi", body: "Let's talk." });
    expect(row.outreachStatus).toBe("drafted");
    expect(revalidatePath).toHaveBeenCalledWith(`/leads/${leadId}`);
  });

  it("refuses when the lead has no brief and does not call the LLM", async () => {
    const leadId = await makeLead({ brief: null });
    const r = await generateOutreachDraftAction(leadId);
    expect(r).toEqual({ ok: false, error: "Generate the brief first." });
    expect(generateOutreach).not.toHaveBeenCalled();
  });

  it("returns a sanitized error when the provider fails", async () => {
    const leadId = await makeLead({ brief: validBrief });
    (generateOutreach as Mock).mockRejectedValue(new Error("SECRET provider key abc123 invalid"));
    const r = await generateOutreachDraftAction(leadId);
    expect(r).toEqual({
      ok: false,
      error: "Draft generation failed. Check the LLM provider configuration.",
    });
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachStatus).toBe("pending"); // nothing persisted
  });

  it("rejects an unauthenticated caller", async () => {
    (auth as Mock).mockResolvedValueOnce(null);
    const leadId = await makeLead({ brief: validBrief });
    const r = await generateOutreachDraftAction(leadId);
    expect(r.ok).toBe(false);
    expect(generateOutreach).not.toHaveBeenCalled();
  });
});

describe("setOutreachStatusAction", () => {
  it("marks the lead sent and stamps sentAt", async () => {
    const leadId = await makeLead();
    const r = await setOutreachStatusAction(leadId, "sent");
    expect(r).toEqual({ ok: true });
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachStatus).toBe("sent");
    expect(row.outreachSentAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith(`/leads/${leadId}`);
  });

  it("rejects an unknown status", async () => {
    const leadId = await makeLead();
    const r = await setOutreachStatusAction(leadId, "bogus" as never);
    expect(r).toEqual({ ok: false, error: "Unknown status." });
  });

  it("rejects an unauthenticated caller", async () => {
    (auth as Mock).mockResolvedValueOnce(null);
    const leadId = await makeLead();
    const r = await setOutreachStatusAction(leadId, "sent");
    expect(r.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
