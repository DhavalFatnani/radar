import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { companies, signalDefinitions, signalObservations } from "@/db/schema";
import { ingestJobObservations } from "@/lib/sourcing/jobs";
import type { JobSourceAdapter, JobPostingRecord } from "@/lib/sourcing/jobs-schema";
import {
  SIG_HIRING_OPS_SURGE,
  SIG_HIRING_SENIOR_OPS,
  OPS_SURGE_THRESHOLD,
} from "@/lib/sourcing/jobs-schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["signal_observations", "signal_definitions", "companies"]); });
afterAll(async () => { await closeTestDb(); });

async function approvedHiringSignal(signalId: string, freshnessWindowDays: number | null = null) {
  await testDb.insert(signalDefinitions).values({
    signalId, name: `S ${signalId}`, family: "hiring",
    strength: "medium", falsePositiveRisk: "low",
    freshnessWindowDays, status: "approved", origin: "seed",
  }).onConflictDoNothing();
}

function adapterFrom(records: JobPostingRecord[], skippedMalformed = 0): JobSourceAdapter {
  return { sourceName: "test", async fetch() { return { records, skippedMalformed }; } };
}

function posting(over: Partial<JobPostingRecord> = {}): JobPostingRecord {
  return {
    ref: "J-x", title: "Warehouse Operations Executive", company: "Meridian Logistics",
    postedAt: "2026-06-20T00:00:00Z", sourceName: "jobboard-fixture", ...over,
  };
}

function opsPostings(n: number, company = "Meridian Logistics"): JobPostingRecord[] {
  return Array.from({ length: n }, (_, i) =>
    posting({ ref: `O-${i}`, title: "Warehouse Operations Associate", company, postedAt: `2026-06-${10 + i}T00:00:00Z` }));
}

describe("ingestJobObservations", () => {
  it("writes a senior-ops observation with all mandatory proof fields", async () => {
    await approvedHiringSignal(SIG_HIRING_SENIOR_OPS);
    const now = new Date();
    const res = await ingestJobObservations(
      testDb,
      adapterFrom([posting({ ref: "J-1", title: "Head of Supply Chain", company: "Zephyr Retail", postedAt: now.toISOString() })]),
      now,
    );
    expect(res.detected).toBe(1);
    expect(res.written).toBe(1);
    const [obs] = await testDb.select().from(signalObservations);
    expect(obs.signalId).toBe(SIG_HIRING_SENIOR_OPS);
    expect(obs.detectedAt).not.toBeNull();
    expect(obs.source).toBe("jobboard-fixture");
    expect(obs.evidence.length).toBeGreaterThan(0);
    expect(obs.companyId).toBeTruthy();
    expect(obs.entityMatchConfidence).toBe(1);
    expect(obs.sourceRef).toBe("J-1");
  });

  it("writes one aggregate ops-surge observation for a company over the threshold", async () => {
    await approvedHiringSignal(SIG_HIRING_OPS_SURGE);
    const res = await ingestJobObservations(testDb, adapterFrom(opsPostings(OPS_SURGE_THRESHOLD)), new Date("2026-06-30T00:00:00Z"));
    expect(res.written).toBe(1);
    const rows = await testDb.select().from(signalObservations);
    expect(rows).toHaveLength(1);
    expect(rows[0].signalId).toBe(SIG_HIRING_OPS_SURGE);
    expect(rows[0].sourceRef).toBe(`O-${OPS_SURGE_THRESHOLD - 1}`); // anchored to most-recent posting
  });

  it("computes a recent freshness verdict when the definition sets a window", async () => {
    await approvedHiringSignal(SIG_HIRING_SENIOR_OPS, 90);
    const now = new Date();
    await ingestJobObservations(
      testDb,
      adapterFrom([posting({ ref: "J-1", title: "VP Operations", company: "Zephyr Retail", postedAt: now.toISOString() })]),
      now,
    );
    const [obs] = await testDb.select().from(signalObservations);
    expect(obs.freshnessVerdict).toBe("recent");
  });

  it("does not write a hiring signal that is not approved", async () => {
    // OPS-SURGE approved, SENIOR-OPS intentionally NOT approved.
    await approvedHiringSignal(SIG_HIRING_OPS_SURGE);
    const posts = [posting({ ref: "J-1", title: "Head of Supply Chain", company: "Zephyr Retail" }), ...opsPostings(OPS_SURGE_THRESHOLD)];
    await ingestJobObservations(testDb, adapterFrom(posts), new Date("2026-06-30T00:00:00Z"));
    const rows = await testDb.select().from(signalObservations);
    expect(rows.map((r) => r.signalId)).toEqual([SIG_HIRING_OPS_SURGE]);
  });

  it("is idempotent — a second run writes 0 rows", async () => {
    await approvedHiringSignal(SIG_HIRING_OPS_SURGE);
    const adapter = adapterFrom(opsPostings(OPS_SURGE_THRESHOLD));
    const now = new Date("2026-06-30T00:00:00Z");
    const first = await ingestJobObservations(testDb, adapter, now);
    const second = await ingestJobObservations(testDb, adapter, now);
    expect(first.written).toBe(1);
    expect(second.written).toBe(0);
    expect(second.skippedDuplicates).toBe(1);
    const rows = await testDb.select().from(signalObservations);
    expect(rows).toHaveLength(1);
  });

  it("resolves the same company across postings to one row", async () => {
    await approvedHiringSignal(SIG_HIRING_OPS_SURGE);
    await ingestJobObservations(testDb, adapterFrom(opsPostings(OPS_SURGE_THRESHOLD)), new Date("2026-06-30T00:00:00Z"));
    const cos = await testDb.select().from(companies).where(eq(companies.normalizedName, "meridian logistics"));
    expect(cos).toHaveLength(1);
  });

  it("counts adapter-reported malformed postings in scanned", async () => {
    await approvedHiringSignal(SIG_HIRING_OPS_SURGE);
    const res = await ingestJobObservations(testDb, adapterFrom(opsPostings(OPS_SURGE_THRESHOLD), 2), new Date("2026-06-30T00:00:00Z"));
    expect(res.skippedMalformed).toBe(2);
    expect(res.scanned).toBe(OPS_SURGE_THRESHOLD + 2);
  });
});
