import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { companies, signalDefinitions, signalObservations } from "@/db/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["signal_observations", "signal_definitions", "companies"]); });
afterAll(async () => { await closeTestDb(); });

describe("companies.normalized_name unique index", () => {
  it("dedupes a repeated normalized_name via onConflictDoNothing", async () => {
    const a = await testDb.insert(companies).values({ name: "Acme", normalizedName: "acme" }).returning();
    const b = await testDb
      .insert(companies)
      .values({ name: "ACME", normalizedName: "acme" })
      .onConflictDoNothing({ target: companies.normalizedName })
      .returning();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0); // conflict → skipped
  });
});

describe("signal_observations composite dedup index", () => {
  it("dedupes a repeated (signal_id, company_id, source_ref)", async () => {
    await testDb.insert(signalDefinitions).values({
      signalId: "SIG-TENDER-LIVE", name: "Live tender", family: "procurement",
      strength: "very_high", falsePositiveRisk: "low", status: "approved",
    });
    const [co] = await testDb.insert(companies).values({ name: "PMC", normalizedName: "pmc" }).returning();
    const values = {
      signalId: "SIG-TENDER-LIVE",
      companyId: co.companyId,
      detectedAt: new Date("2026-06-20T00:00:00Z"),
      source: "GeM",
      evidence: ["tender X"],
      sourceRef: "T-1",
    };
    const first = await testDb.insert(signalObservations).values(values).returning();
    const second = await testDb
      .insert(signalObservations)
      .values(values)
      .onConflictDoNothing({
        target: [signalObservations.signalId, signalObservations.companyId, signalObservations.sourceRef],
      })
      .returning();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // conflict → skipped
  });
});
