import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { companies, signalDefinitions, signalObservations, mappings, vendorProfiles, leads } from "@/db/schema";
import { generateLeads } from "@/lib/sourcing/leads";
import type { SignalStrength, SignalPolarity } from "@/lib/sourcing/scoring";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["leads", "signal_observations", "signal_definitions", "mappings", "vendor_profiles", "companies"]);
});
afterAll(async () => { await closeTestDb(); });

async function approvedSignal(
  signalId: string,
  strength: SignalStrength = "very_high",
  polarity: SignalPolarity = "positive",
) {
  await testDb.insert(signalDefinitions).values({
    signalId, name: `S ${signalId}`, family: "procurement",
    strength, polarity, falsePositiveRisk: "low", status: "approved", origin: "seed",
  }).onConflictDoNothing();
}

async function makeCompany(name: string): Promise<string> {
  const [c] = await testDb.insert(companies).values({ name, normalizedName: name.toLowerCase() }).returning();
  return c.companyId;
}

async function observe(
  companyId: string,
  signalId: string,
  opts: { detectedAt?: Date; freshnessVerdict?: string } = {},
) {
  await testDb.insert(signalObservations).values({
    signalId, companyId,
    detectedAt: opts.detectedAt ?? new Date(),
    source: "test", evidence: ["e"],
    freshnessVerdict: opts.freshnessVerdict ?? "recent",
    entityMatchConfidence: 1,
    sourceRef: `${signalId}-${companyId}`,
  });
}

async function makeVendor(name: string, vendorType: string | null): Promise<string> {
  const [v] = await testDb.insert(vendorProfiles).values({ name, vendorType }).returning();
  return v.vendorId;
}

async function approvedMapping(opts: {
  name: string; servesVendorType: string; required: string[]; supporting?: string[];
  timingWindowDays?: number | null; intentDescription?: string;
}): Promise<string> {
  const [m] = await testDb.insert(mappings).values({
    name: opts.name, servesVendorType: opts.servesVendorType, status: "approved",
    requiredSignals: opts.required, supportingSignals: opts.supporting ?? [],
    timingWindowDays: opts.timingWindowDays ?? 180,
    intentDescription: opts.intentDescription,
  }).returning();
  return m.mappingId;
}

describe("generateLeads", () => {
  it("writes a scored lead for a fired mapping matching the vendor_type", async () => {
    await approvedSignal("SIG-REQ", "very_high");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-REQ");
    const vendorId = await makeVendor("RackPro", "Infra");
    const mappingId = await approvedMapping({
      name: "Warehouse expansion", servesVendorType: "Infra",
      required: ["SIG-REQ"], intentDescription: "Expanding capacity",
    });

    const res = await generateLeads(testDb);
    expect(res.leadsWritten).toBe(1);

    const [lead] = await testDb.select().from(leads);
    expect(lead.vendorId).toBe(vendorId);
    expect(lead.companyId).toBe(companyId);
    expect(lead.matchedMappingId).toBe(mappingId);
    expect(lead.score).toBe(60);
    expect(lead.intent).toBe("Expanding capacity");
    expect(lead.pipelineStage).toBe("sourced");
    expect(lead.brief).toBeNull();
    expect(lead.contactBlock).toBeNull();
  });

  it("matches vendor_type case-insensitively", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-REQ");
    await makeVendor("RackPro", "infra");                                  // lowercase
    await approvedMapping({ name: "W", servesVendorType: "Infra", required: ["SIG-REQ"] }); // capitalized
    const res = await generateLeads(testDb);
    expect(res.leadsWritten).toBe(1);
  });

  it("writes no lead when the mapping is not approved", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-REQ");
    await makeVendor("RackPro", "Infra");
    await testDb.insert(mappings).values({
      name: "W", servesVendorType: "Infra", status: "proposed", requiredSignals: ["SIG-REQ"],
    });
    const res = await generateLeads(testDb);
    expect(res.leadsWritten).toBe(0);
    expect(await testDb.select().from(leads)).toHaveLength(0);
  });

  it("writes no lead when a negative-polarity observation disqualifies the company", async () => {
    await approvedSignal("SIG-REQ", "very_high", "positive");
    await approvedSignal("SIG-DISTRESS", "high", "negative");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-REQ");
    await observe(companyId, "SIG-DISTRESS");
    await makeVendor("RackPro", "Infra");
    await approvedMapping({ name: "W", servesVendorType: "Infra", required: ["SIG-REQ"] });
    const res = await generateLeads(testDb);
    expect(res.skippedDisqualified).toBeGreaterThan(0);
    expect(res.leadsWritten).toBe(0);
    expect(await testDb.select().from(leads)).toHaveLength(0);
  });

  it("writes no lead when the required gate is not met (supporting only)", async () => {
    await approvedSignal("SIG-REQ");
    await approvedSignal("SIG-SUP");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-SUP");
    await makeVendor("RackPro", "Infra");
    await approvedMapping({ name: "W", servesVendorType: "Infra", required: ["SIG-REQ"], supporting: ["SIG-SUP"] });
    const res = await generateLeads(testDb);
    expect(res.skippedNoFire).toBeGreaterThan(0);
    expect(res.leadsWritten).toBe(0);
  });

  it("does not produce leads for a vendor with a null vendor_type", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-REQ");
    await makeVendor("Untyped", null);
    await approvedMapping({ name: "W", servesVendorType: "Infra", required: ["SIG-REQ"] });
    const res = await generateLeads(testDb);
    expect(res.vendorsProcessed).toBe(0);
    expect(res.leadsWritten).toBe(0);
  });

  it("is idempotent and preserves an advanced pipeline_stage", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-REQ");
    await makeVendor("RackPro", "Infra");
    await approvedMapping({ name: "W", servesVendorType: "Infra", required: ["SIG-REQ"] });

    const first = await generateLeads(testDb);
    expect(first.leadsWritten).toBe(1);

    await testDb.update(leads).set({ pipelineStage: "contacted" });

    const second = await generateLeads(testDb);
    expect(second.leadsWritten).toBe(0);
    expect(second.leadsUpdated).toBe(1);

    const rows = await testDb.select().from(leads);
    expect(rows).toHaveLength(1);
    expect(rows[0].pipelineStage).toBe("contacted"); // preserved
    expect(rows[0].score).toBe(60);                   // refreshed (same value)
  });
});
