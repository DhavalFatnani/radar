import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { db, queryClient } from "@/db/client";
import { signalDefinitions } from "@/db/schema";
import { seedSignals } from "@/db/seed-signals";
import { eq } from "drizzle-orm";

beforeAll(async () => {
  await migrateTestDb();
});

afterEach(async () => {
  await truncateAll(["signal_observations", "signal_definitions"]);
});

afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("seedSignals", () => {
  it("inserts 17 rows all with status 'approved'", async () => {
    const result = await seedSignals(db);

    expect(result).toEqual({ inserted: 17, total: 17 });

    const rows = await db
      .select({ status: signalDefinitions.status })
      .from(signalDefinitions);

    expect(rows).toHaveLength(17);
    for (const row of rows) {
      expect(row.status).toBe("approved");
    }
  });

  it("is idempotent — second run inserts 0, table stays at 17 rows", async () => {
    const first = await seedSignals(db);
    expect(first).toEqual({ inserted: 17, total: 17 });

    const second = await seedSignals(db);
    expect(second).toEqual({ inserted: 0, total: 17 });

    const rows = await db.select().from(signalDefinitions);
    expect(rows).toHaveLength(17);
  });

  it("spot-check: SIG-TENDER-LIVE has family 'procurement' and strength 'very_high'", async () => {
    await seedSignals(db);

    const [row] = await db
      .select({
        family: signalDefinitions.family,
        strength: signalDefinitions.strength,
      })
      .from(signalDefinitions)
      .where(eq(signalDefinitions.signalId, "SIG-TENDER-LIVE"));

    expect(row).toBeDefined();
    expect(row.family).toBe("procurement");
    expect(row.strength).toBe("very_high");
  });
});
