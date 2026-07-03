import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { leads, companies, vendorProfiles } from "@/db/schema";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
});

describe("outreach columns migration", () => {
  it("defaults outreachStatus to 'pending' and round-trips the new columns", async () => {
    const [company] = await testDb
      .insert(companies)
      .values({ name: "Zephyr Retail", normalizedName: "zephyr retail" })
      .returning();
    const [vendor] = await testDb
      .insert(vendorProfiles)
      .values({ name: "Acme Infra" })
      .returning();

    const [inserted] = await testDb
      .insert(leads)
      .values({ companyId: company.companyId, vendorId: vendor.vendorId })
      .returning();

    // NOT NULL default backfills to "pending"; the three timestamps/jsonb are null.
    expect(inserted.outreachStatus).toBe("pending");
    expect(inserted.outreachDraft).toBeNull();
    expect(inserted.outreachDraftGeneratedAt).toBeNull();
    expect(inserted.outreachSentAt).toBeNull();

    const generatedAt = new Date("2026-07-03T10:00:00.000Z");
    const sentAt = new Date("2026-07-03T11:00:00.000Z");
    await testDb
      .update(leads)
      .set({
        outreachStatus: "sent",
        outreachDraft: { subject: "Hello", body: "World" },
        outreachDraftGeneratedAt: generatedAt,
        outreachSentAt: sentAt,
      })
      .where(eq(leads.leadId, inserted.leadId));

    const [read] = await testDb
      .select()
      .from(leads)
      .where(eq(leads.leadId, inserted.leadId));
    expect(read.outreachStatus).toBe("sent");
    expect(read.outreachDraft).toEqual({ subject: "Hello", body: "World" });
    expect(read.outreachDraftGeneratedAt?.getTime()).toBe(generatedAt.getTime());
    expect(read.outreachSentAt?.getTime()).toBe(sentAt.getTime());
  });
});
