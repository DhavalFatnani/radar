import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { companies, signalDefinitions, signalObservations, mappings, vendorProfiles, leads } from "@/db/schema";
import { generateBriefsForLeads } from "@/lib/sourcing/brief";
import type { BriefInput, LeadBrief, LeadBriefDraft } from "@/ai/brief/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["leads", "signal_observations", "signal_definitions", "mappings", "vendor_profiles", "companies"]);
});
afterAll(async () => { await closeTestDb(); });

const NOW = new Date("2026-06-15T12:00:00.000Z");
const D_JUN1 = new Date("2026-06-01T00:00:00.000Z");

async function approvedSignal(signalId: string) {
  await testDb.insert(signalDefinitions).values({
    signalId, name: `S ${signalId}`, family: "procurement",
    strength: "very_high", polarity: "positive", falsePositiveRisk: "low", status: "approved", origin: "seed",
  }).onConflictDoNothing();
}
async function makeCompany(name: string): Promise<string> {
  const [c] = await testDb.insert(companies).values({ name, normalizedName: name.toLowerCase() }).returning();
  return c.companyId;
}
async function observe(companyId: string, signalId: string, source: string, evidence: string[], detectedAt: Date) {
  await testDb.insert(signalObservations).values({
    signalId, companyId, detectedAt, source, evidence,
    freshnessVerdict: "recent", entityMatchConfidence: 1, sourceRef: `${signalId}-${companyId}`,
  });
}
async function makeVendor(name: string): Promise<string> {
  const [v] = await testDb.insert(vendorProfiles).values({ name, vendorType: "Infra" }).returning();
  return v.vendorId;
}
async function approvedMapping(name: string, required: string[], supporting: string[] = []): Promise<string> {
  const [m] = await testDb.insert(mappings).values({
    name, servesVendorType: "Infra", status: "approved",
    requiredSignals: required, supportingSignals: supporting, timingWindowDays: 180,
  }).returning();
  return m.mappingId;
}
async function makeLead(vendorId: string, companyId: string, mappingId: string, intent: string): Promise<string> {
  const [l] = await testDb.insert(leads).values({
    vendorId, companyId, matchedMappingId: mappingId, intent, score: 88,
  }).returning();
  return l.leadId;
}

const draft: LeadBriefDraft = {
  why_them: "Fits the ideal customer.",
  why_now: [{ signalId: "SIG-REQ", claim: "Signal fired — the window is open." }],
  what_they_need: "Racking.",
  hook: "Saw your announcement.",
  why_this_vendor: "Fast install crews.",
  objections: [{ objection: "Has a supplier", response: "Second-source quote." }],
};
const stubGenerate = async (_input: BriefInput) => ({ value: draft });

describe("generateBriefsForLeads", () => {
  it("writes a brief with why_now receipts pinned from the DB, not the LLM", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("NorthPort");
    await observe(companyId, "SIG-REQ", "press-release", ["https://x/pr"], D_JUN1);
    const vendorId = await makeVendor("RackPro");
    const mappingId = await approvedMapping("New DC", ["SIG-REQ"]);
    await makeLead(vendorId, companyId, mappingId, "Warehouse racking");

    const res = await generateBriefsForLeads(testDb, stubGenerate, NOW);
    expect(res).toEqual({ leadsScanned: 1, briefsGenerated: 1, skippedNoSignals: 0, failures: 0 });

    const [lead] = await testDb.select().from(leads);
    const brief = lead.brief as LeadBrief;
    expect(brief.why_them).toBe("Fits the ideal customer.");
    expect(brief.why_now).toHaveLength(1);
    expect(brief.why_now[0]).toEqual({
      signalId: "SIG-REQ",
      claim: "Signal fired — the window is open.",
      date: "2026-06-01T00:00:00.000Z", // pinned from the observation, not the stub
      source: "press-release",
      evidence: ["https://x/pr"],
    });
    expect(brief.disqualifier_check_passed).toBe(true);
    expect(brief.generatedAt).toBe("2026-06-15T12:00:00.000Z");
  });

  it("is idempotent — a second run finds no null-brief leads", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("NorthPort");
    await observe(companyId, "SIG-REQ", "press", ["e"], D_JUN1);
    const vendorId = await makeVendor("RackPro");
    const mappingId = await approvedMapping("New DC", ["SIG-REQ"]);
    await makeLead(vendorId, companyId, mappingId, "Racking");

    await generateBriefsForLeads(testDb, stubGenerate, NOW);
    const second = await generateBriefsForLeads(testDb, stubGenerate, NOW);
    expect(second.leadsScanned).toBe(0);
    expect(second.briefsGenerated).toBe(0);
  });

  it("skips a lead whose company has no contributing observation", async () => {
    await approvedSignal("SIG-REQ");
    await approvedSignal("SIG-OTHER");
    const companyId = await makeCompany("NorthPort");
    await observe(companyId, "SIG-OTHER", "press", ["e"], D_JUN1); // not in the mapping's sets
    const vendorId = await makeVendor("RackPro");
    const mappingId = await approvedMapping("New DC", ["SIG-REQ"]);
    await makeLead(vendorId, companyId, mappingId, "Racking");

    const res = await generateBriefsForLeads(testDb, stubGenerate, NOW);
    expect(res.skippedNoSignals).toBe(1);
    expect(res.briefsGenerated).toBe(0);
    const [lead] = await testDb.select().from(leads);
    expect(lead.brief).toBeNull();
  });

  it("counts a failure and continues the batch when generate throws for one lead", async () => {
    await approvedSignal("SIG-REQ");
    const cBoom = await makeCompany("Boom");
    const cGood = await makeCompany("Good");
    await observe(cBoom, "SIG-REQ", "press", ["e"], D_JUN1);
    await observe(cGood, "SIG-REQ", "press", ["e"], D_JUN1);
    const vendorId = await makeVendor("RackPro");
    const mappingId = await approvedMapping("New DC", ["SIG-REQ"]);
    await makeLead(vendorId, cBoom, mappingId, "Racking");
    await makeLead(vendorId, cGood, mappingId, "Racking");

    const selective = async (input: BriefInput) => {
      if (input.company.name === "Boom") throw new Error("provider down");
      return { value: draft };
    };
    const res = await generateBriefsForLeads(testDb, selective, NOW);
    expect(res.failures).toBe(1);
    expect(res.briefsGenerated).toBe(1);
  });

  it("drops a why_now entry whose signalId is not among the contributing observations", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("NorthPort");
    await observe(companyId, "SIG-REQ", "press", ["e"], D_JUN1);
    const vendorId = await makeVendor("RackPro");
    const mappingId = await approvedMapping("New DC", ["SIG-REQ"]);
    await makeLead(vendorId, companyId, mappingId, "Racking");

    const ghost = async (_input: BriefInput) => ({
      value: {
        ...draft,
        why_now: [
          { signalId: "SIG-GHOST", claim: "fabricated" },
          { signalId: "SIG-REQ", claim: "real" },
        ],
      },
    });
    await generateBriefsForLeads(testDb, ghost, NOW);
    const [lead] = await testDb.select().from(leads);
    const brief = lead.brief as LeadBrief;
    expect(brief.why_now).toHaveLength(1);
    expect(brief.why_now[0].signalId).toBe("SIG-REQ");
  });
});
