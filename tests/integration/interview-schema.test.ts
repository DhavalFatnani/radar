import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createVendorStub } from "@/lib/vendors/data";
import { vendorInterviews } from "@/db/schema";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["vendor_interviews", "vendor_profiles"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("vendor_interviews schema", () => {
  it("stores an in-progress interview with an empty transcript by default", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const [row] = await testDb.insert(vendorInterviews).values({ vendorId }).returning();
    expect(row.status).toBe("in_progress");
    expect(row.messages).toEqual([]);
  });

  it("allows only one in-progress interview per vendor", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    await testDb.insert(vendorInterviews).values({ vendorId });
    await expect(testDb.insert(vendorInterviews).values({ vendorId })).rejects.toThrow();
  });

  it("allows a fresh interview once the prior one is no longer in progress", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const [first] = await testDb.insert(vendorInterviews).values({ vendorId }).returning();
    await testDb
      .update(vendorInterviews)
      .set({ status: "completed" })
      .where(eq(vendorInterviews.interviewId, first.interviewId));
    await expect(testDb.insert(vendorInterviews).values({ vendorId })).resolves.toBeDefined();
  });
});
