import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { signalDefinitions, signalObservations, companies } from "@/db/schema";
import { ingestCompanyObservations } from "@/lib/campaigns/ingest";
import { createCompanyFixtureAdapter } from "@/lib/sourcing/adapters/company-fixture";
import { FUNDING_SIGNAL, HEADCOUNT_SIGNAL, OPS_HIRING_SIGNAL, type CompanyQuery } from "@/lib/sourcing/company-schema";
import { eq } from "drizzle-orm";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["signal_observations", "signal_definitions", "companies"]); });
afterAll(async () => { await closeTestDb(); });

const QUERY: CompanyQuery = { geography: "IND", target: 10, fundedSinceDays: 365, signalFamilies: ["money", "hiring", "expansion"] };

async function approve(signalId: string, family: string, freshnessWindowDays: number | null, polarity = "positive") {
  await testDb.insert(signalDefinitions).values({
    signalId, name: `S ${signalId}`, family: family as never, strength: "medium",
    falsePositiveRisk: "medium", polarity: polarity as never, freshnessWindowDays, status: "approved", origin: "seed",
  }).onConflictDoNothing();
}

describe("ingestCompanyObservations", () => {
  it("writes grounded observations, resolves companies, and returns touched companies with a snapshot", async () => {
    await approve(FUNDING_SIGNAL, "money", 365);
    await approve(HEADCOUNT_SIGNAL, "expansion", 365);
    await approve(OPS_HIRING_SIGNAL, "hiring", 60);

    const res = await ingestCompanyObservations(testDb, createCompanyFixtureAdapter(), QUERY);

    expect(res.written).toBeGreaterThan(0);
    expect(res.touched.length).toBeGreaterThan(0);

    // Anveshan: funding + headcount(30%) + ops-hiring(5 operators) all fire, and it has a snapshot.
    const anveshan = res.touched.find((t) => t.name === "Anveshan");
    expect(anveshan).toBeTruthy();
    expect(anveshan!.snapshot.fundraiseDate).toBe("2026-05-29");
    expect(anveshan!.snapshot.headcountTotal).toBe(162);
    expect(anveshan!.snapshot.opsPostings).toBe(5);

    const obs = await testDb.select().from(signalObservations).where(eq(signalObservations.companyId, anveshan!.companyId));
    expect(obs.map((o) => o.signalId).sort()).toContain(FUNDING_SIGNAL);
    expect(obs.every((o) => o.evidence.length > 0)).toBe(true);
    expect((await testDb.select().from(companies)).length).toBe(res.touched.length);
  });

  it("is idempotent — a second run writes 0 new observations", async () => {
    await approve(FUNDING_SIGNAL, "money", 365);
    const first = await ingestCompanyObservations(testDb, createCompanyFixtureAdapter(), QUERY);
    const second = await ingestCompanyObservations(testDb, createCompanyFixtureAdapter(), QUERY);
    expect(first.written).toBeGreaterThan(0);
    expect(second.written).toBe(0);
    expect(second.skippedDuplicates).toBe(first.written);
  });

  it("leaves snapshot.opsPostings null (not 0) when a record has no jobPostings field at all", async () => {
    await approve(FUNDING_SIGNAL, "money", 365);
    const adapter = createCompanyFixtureAdapter([
      { name: "NoJobs Co", sourceName: "fixture", sourceRef: "nojobs.com", funding: { date: "2026-05-01" } },
    ]);

    const res = await ingestCompanyObservations(testDb, adapter, QUERY);

    const noJobsCo = res.touched.find((t) => t.name === "NoJobs Co");
    expect(noJobsCo).toBeTruthy();
    expect(noJobsCo!.snapshot.opsPostings).toBeNull();
  });
});
