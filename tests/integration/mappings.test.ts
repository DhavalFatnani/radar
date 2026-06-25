import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { testDb, migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { mappings } from "@/db/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["mappings"]); });
afterAll(async () => { await closeTestDb(); });

describe("mappings", () => {
  it("defaults status to 'proposed' (the approval gate)", async () => {
    const [m] = await testDb.insert(mappings)
      .values({ name: "Warehouse expansion",
        requiredSignals: ["SIG-EXP-NEW-FACILITY", "SIG-TENDER-LIVE"],
        supportingSignals: ["SIG-HIRING-OPS-SURGE"] })
      .returning();
    expect(m.status).toBe("proposed");
    expect(m.requiredSignals).toContain("SIG-TENDER-LIVE");
  });
});
