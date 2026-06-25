import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { testDb, migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { signalDefinitions, signalObservations, companies } from "@/db/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["signal_observations", "signal_definitions", "companies"]); });
afterAll(async () => { await closeTestDb(); });

async function seedDefinition() {
  const [def] = await testDb.insert(signalDefinitions)
    .values({ signalId: "SIG-TEST-LIVE", name: "Test signal", family: "procurement" })
    .returning();
  return def;
}

describe("signal_definitions", () => {
  it("defaults status to 'proposed' (the approval gate)", async () => {
    const def = await seedDefinition();
    expect(def.status).toBe("proposed");
  });

  it("stores array and enum fields", async () => {
    const [def] = await testDb.insert(signalDefinitions)
      .values({ signalId: "SIG-EXP-NEW-FACILITY", name: "New facility", family: "expansion",
        sources: ["news", "tenders"], strength: "very_high", pairsWith: ["SIG-MONEY-FUNDING"] })
      .returning();
    expect(def.sources).toEqual(["news", "tenders"]);
    expect(def.strength).toBe("very_high");
  });
});

describe("signal_observations", () => {
  it("creates and reads back an observation with mandatory proof fields", async () => {
    const def = await seedDefinition();
    const [co] = await testDb.insert(companies).values({ name: "Acme" }).returning();
    const [obs] = await testDb.insert(signalObservations).values({
      signalId: def.signalId, companyId: co.companyId,
      detectedAt: new Date(), source: "tender-portal", evidence: ["https://proof/1"],
    }).returning();
    expect(obs.observationId).toBeTruthy();
    expect(obs.evidence).toEqual(["https://proof/1"]);
  });

  it("rejects an observation missing detected_at/source/evidence (proof principle)", async () => {
    const def = await seedDefinition();
    const [co] = await testDb.insert(companies).values({ name: "Acme" }).returning();
    // @ts-expect-error intentionally omit mandatory proof fields
    await expect(testDb.insert(signalObservations).values({
      signalId: def.signalId, companyId: co.companyId,
    })).rejects.toThrow();
  });
});
