import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { db, queryClient } from "@/db/client";
import { mappings } from "@/db/schema";
import { seedMappings } from "@/db/seed-mappings";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["mappings"]); });
afterAll(async () => { await closeTestDb(); await queryClient.end(); });

describe("seedMappings", () => {
  it("inserts 2 mappings all with status 'approved'", async () => {
    const result = await seedMappings(db);
    expect(result).toEqual({ inserted: 2, total: 2 });
    const rows = await db.select({ status: mappings.status, name: mappings.name }).from(mappings);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.status).toBe("approved");
    expect(rows.map((r) => r.name).sort()).toEqual(["Offline marketing push", "Warehouse expansion"]);
  });
  it("is idempotent — second run inserts 0, table stays at 2 rows", async () => {
    await seedMappings(db);
    const second = await seedMappings(db);
    expect(second).toEqual({ inserted: 0, total: 2 });
    const rows = await db.select().from(mappings);
    expect(rows).toHaveLength(2);
  });
  it("Warehouse expansion references the expected required signals", async () => {
    await seedMappings(db);
    const [row] = await db.select({ req: mappings.requiredSignals }).from(mappings).where(eq(mappings.name, "Warehouse expansion"));
    expect(row.req).toContain("SIG-EXP-NEW-FACILITY");
    expect(row.req).toContain("SIG-TENDER-LIVE");
  });
});
