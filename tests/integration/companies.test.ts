import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { companies } from "@/db/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["companies"]); });
afterAll(async () => { await closeTestDb(); });

describe("companies", () => {
  it("creates and reads back a company", async () => {
    const [row] = await testDb
      .insert(companies)
      .values({ name: "Acme Logistics", description: "3PL operator" })
      .returning();

    expect(row.companyId).toBeTruthy();
    expect(row.createdAt).toBeInstanceOf(Date);

    const found = await testDb.select().from(companies).where(eq(companies.companyId, row.companyId));
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("Acme Logistics");
  });
});
