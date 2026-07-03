import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { leads, companies, vendorProfiles } from "@/db/schema";
import {
  setOutreachMode,
  saveOutreachDraft,
  setOutreachStatus,
} from "@/lib/outreach/data";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
});

async function makeLead(): Promise<string> {
  const [company] = await testDb
    .insert(companies)
    .values({ name: "Zephyr Retail", normalizedName: "zephyr retail" })
    .returning();
  const [vendor] = await testDb
    .insert(vendorProfiles)
    .values({ name: "Acme Infra" })
    .returning();
  const [lead] = await testDb
    .insert(leads)
    .values({ companyId: company.companyId, vendorId: vendor.vendorId })
    .returning();
  return lead.leadId;
}

const BAD_UUID = "not-a-uuid";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

describe("setOutreachMode", () => {
  it("returns not-found for a valid-format unknown id", async () => {
    const r = await setOutreachMode(testDb, MISSING_UUID, "handed_to_vendor");
    expect(r).toEqual({ ok: false, error: "Lead not found." });
  });

  it("persists the mode", async () => {
    const leadId = await makeLead();
    const r = await setOutreachMode(testDb, leadId, "handed_to_vendor");
    expect(r.ok).toBe(true);
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachMode).toBe("handed_to_vendor");
  });

  it("rejects a malformed id without writing", async () => {
    const r = await setOutreachMode(testDb, BAD_UUID, "operator_handles");
    expect(r).toEqual({ ok: false, error: "Lead not found." });
  });
});

describe("saveOutreachDraft", () => {
  it("returns not-found for a valid-format unknown id", async () => {
    const r = await saveOutreachDraft(testDb, MISSING_UUID, { subject: "Hi", body: "x" });
    expect(r).toEqual({ ok: false, error: "Lead not found." });
  });

  it("sets the draft, status 'drafted', and generatedAt", async () => {
    const leadId = await makeLead();
    const r = await saveOutreachDraft(testDb, leadId, { subject: "Hi", body: "Let's talk." });
    expect(r.ok).toBe(true);
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachDraft).toEqual({ subject: "Hi", body: "Let's talk." });
    expect(row.outreachStatus).toBe("drafted");
    expect(row.outreachDraftGeneratedAt).toBeInstanceOf(Date);
    expect(row.outreachSentAt).toBeNull();
  });

  it("rejects a malformed id without writing", async () => {
    const r = await saveOutreachDraft(testDb, BAD_UUID, { subject: "Hi", body: "x" });
    expect(r).toEqual({ ok: false, error: "Lead not found." });
  });
});

describe("setOutreachStatus", () => {
  it("returns not-found for a valid-format unknown id", async () => {
    const r = await setOutreachStatus(testDb, MISSING_UUID, "sent");
    expect(r).toEqual({ ok: false, error: "Lead not found." });
  });

  it("stamps sentAt when moving to 'sent'", async () => {
    const leadId = await makeLead();
    const r = await setOutreachStatus(testDb, leadId, "sent");
    expect(r.ok).toBe(true);
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachStatus).toBe("sent");
    expect(row.outreachSentAt).toBeInstanceOf(Date);
  });

  it("does not stamp sentAt for a non-sent status", async () => {
    const leadId = await makeLead();
    const r = await setOutreachStatus(testDb, leadId, "drafted");
    expect(r.ok).toBe(true);
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachStatus).toBe("drafted");
    expect(row.outreachSentAt).toBeNull();
  });

  it("rejects a malformed id without writing", async () => {
    const r = await setOutreachStatus(testDb, BAD_UUID, "sent");
    expect(r).toEqual({ ok: false, error: "Lead not found." });
  });
});
