import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { companies, signalDefinitions, signalObservations } from "@/db/schema";
import { resolveCompany, ingestTenderObservations } from "@/lib/sourcing/data";
import type { SourceAdapter, TenderRecord } from "@/lib/sourcing/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["signal_observations", "signal_definitions", "companies"]); });
afterAll(async () => { await closeTestDb(); });

async function approvedTenderSignal(signalId: string, freshnessWindowDays: number | null = null) {
  await testDb.insert(signalDefinitions).values({
    signalId, name: `S ${signalId}`, family: "procurement",
    strength: "high", falsePositiveRisk: "low",
    freshnessWindowDays, status: "approved", origin: "seed",
  }).onConflictDoNothing();
}

function adapterFrom(records: TenderRecord[], skippedMalformed = 0): SourceAdapter {
  return { sourceName: "test", async fetch() { return { records, skippedMalformed }; } };
}

const liveRecord: TenderRecord = {
  ref: "T-1", title: "CCTV surveillance supply", issuingBody: "Pune Municipal Corporation",
  publishedAt: "2026-06-25T00:00:00Z", sourceName: "GeM",
};

describe("resolveCompany", () => {
  it("creates once and reuses the same company for normalized-equal names", async () => {
    const a = await resolveCompany(testDb, "Acme Corp.");
    const b = await resolveCompany(testDb, "acme corp");
    expect(b.companyId).toBe(a.companyId);
    expect(a.entityMatchConfidence).toBe(1);
    const rows = await testDb.select().from(companies);
    expect(rows).toHaveLength(1);
  });
});

describe("ingestTenderObservations", () => {
  it("writes an observation with all mandatory proof fields", async () => {
    await approvedTenderSignal("SIG-TENDER-LIVE", 90);
    const now = new Date();
    const res = await ingestTenderObservations(
      testDb,
      adapterFrom([{ ...liveRecord, publishedAt: now.toISOString() }]),
    );
    expect(res.written).toBe(1);
    expect(res.detected).toBe(1);
    const [obs] = await testDb.select().from(signalObservations);
    expect(obs.signalId).toBe("SIG-TENDER-LIVE");
    expect(obs.detectedAt).not.toBeNull();
    expect(obs.source).toBe("GeM");
    expect(obs.evidence.length).toBeGreaterThan(0);
    expect(obs.companyId).toBeTruthy();
    expect(obs.entityMatchConfidence).toBe(1);
    expect(obs.freshnessVerdict).toBe("recent");
    expect(obs.sourceRef).toBe("T-1");
  });

  it("marks an old tender 'stale' against the freshness window", async () => {
    await approvedTenderSignal("SIG-TENDER-LIVE", 90);
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    await ingestTenderObservations(testDb, adapterFrom([{ ...liveRecord, publishedAt: old }]));
    const [obs] = await testDb.select().from(signalObservations);
    expect(obs.freshnessVerdict).toBe("stale");
  });

  it("emits LIVE + AMENDED for a matching amendment when both are approved", async () => {
    await approvedTenderSignal("SIG-TENDER-LIVE", 90);
    await approvedTenderSignal("SIG-TENDER-AMENDED", 90);
    const res = await ingestTenderObservations(
      testDb,
      adapterFrom([{ ...liveRecord, isAmendment: true }]),
    );
    expect(res.written).toBe(2);
    const rows = await testDb.select().from(signalObservations);
    expect(rows.map((r) => r.signalId).sort()).toEqual(["SIG-TENDER-AMENDED", "SIG-TENDER-LIVE"]);
  });

  it("does not write a signal that is not approved", async () => {
    await approvedTenderSignal("SIG-TENDER-AMENDED", 90); // LIVE intentionally NOT approved
    const res = await ingestTenderObservations(
      testDb,
      adapterFrom([{ ...liveRecord, isAmendment: true }]),
    );
    const rows = await testDb.select().from(signalObservations);
    expect(rows.map((r) => r.signalId)).toEqual(["SIG-TENDER-AMENDED"]);
    expect(res.written).toBe(1);
  });

  it("is idempotent — a second run writes 0 rows", async () => {
    await approvedTenderSignal("SIG-TENDER-LIVE", 90);
    const adapter = adapterFrom([liveRecord]);
    const first = await ingestTenderObservations(testDb, adapter);
    const second = await ingestTenderObservations(testDb, adapter);
    expect(first.written).toBe(1);
    expect(second.written).toBe(0);
    expect(second.skippedDuplicates).toBe(1);
    const rows = await testDb.select().from(signalObservations);
    expect(rows).toHaveLength(1);
  });

  it("resolves the same issuing body across records to one company", async () => {
    await approvedTenderSignal("SIG-TENDER-LIVE", 90);
    await ingestTenderObservations(testDb, adapterFrom([
      { ...liveRecord, ref: "T-1" },
      { ...liveRecord, ref: "T-2", title: "signage boards supply" },
    ]));
    const cos = await testDb.select().from(companies).where(eq(companies.normalizedName, "pune municipal corporation"));
    expect(cos).toHaveLength(1);
  });

  it("skips malformed records reported by the adapter and still succeeds", async () => {
    await approvedTenderSignal("SIG-TENDER-LIVE", 90);
    const res = await ingestTenderObservations(testDb, adapterFrom([liveRecord], 2));
    expect(res.skippedMalformed).toBe(2);
    expect(res.scanned).toBe(3); // 1 valid + 2 malformed
    expect(res.written).toBe(1);
  });
});
