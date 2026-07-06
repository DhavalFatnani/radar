import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { seedOpsSignals } from "@/db/seed-ops-signals";
import { signalDefinitions, mappings } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["mappings", "signal_definitions"]); });
afterAll(async () => { await closeTestDb(); });

describe("seedOpsSignals", () => {
  it("inserts the headcount-growth signal, the negative in-house counter, and the approved ops mapping", async () => {
    const res = await seedOpsSignals(testDb);
    expect(res.signalsInserted).toBe(2);
    expect(res.mappingInserted).toBe(1);

    const [hc] = await testDb.select().from(signalDefinitions).where(eq(signalDefinitions.signalId, "SIG-EXP-HEADCOUNT-GROWTH"));
    expect(hc.family).toBe("expansion");
    expect(hc.status).toBe("approved");

    const [counter] = await testDb.select().from(signalDefinitions).where(eq(signalDefinitions.signalId, "SIG-HIRING-OPS-INHOUSE"));
    expect(counter.polarity).toBe("negative");

    const [m] = await testDb.select().from(mappings).where(eq(mappings.name, "Ops expansion — pursue"));
    expect(m.servesVendorType).toBe("Infra");
    expect(m.status).toBe("approved");
    expect(m.requiredSignals).toContain("SIG-MONEY-FUNDING");
    expect(m.requiredSignals).toContain("SIG-HIRING-OPS-SURGE");
    expect(m.disqualifiers).toContain("SIG-HIRING-OPS-INHOUSE");
  });

  it("is idempotent — a second run inserts nothing", async () => {
    await seedOpsSignals(testDb);
    const res = await seedOpsSignals(testDb);
    expect(res.signalsInserted).toBe(0);
    expect(res.mappingInserted).toBe(0);
  });
});
