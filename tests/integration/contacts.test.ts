import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { testDb, migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { contacts } from "@/db/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["contacts"]); });
afterAll(async () => { await closeTestDb(); });

describe("contacts", () => {
  it("creates and reads back a contact with jsonb paths", async () => {
    const [c] = await testDb.insert(contacts).values({
      name: "R. Shah", role: "Head of Ops", company: "Acme",
      contactPaths: [{ type: "linkedin", value: "in/rshah", confidence: 0.9, source: "search" }],
      categories: { industry: "logistics", geography: "maharashtra" },
      dedupKey: "rshah@acme",
    }).returning();
    expect(c.contactId).toBeTruthy();
    expect((c.contactPaths as { type: string }[])[0].type).toBe("linkedin");
  });
});
