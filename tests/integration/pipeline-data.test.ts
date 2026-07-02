import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { leads, companies, vendorProfiles } from "@/db/schema";
import { listPipelineLeads, setLeadStage } from "@/lib/pipeline/data";
import type { PipelineStage } from "@/lib/pipeline/schema";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
});

async function makeCompany(name: string): Promise<string> {
  const [row] = await testDb
    .insert(companies)
    .values({ name, normalizedName: name.toLowerCase() })
    .returning();
  return row.companyId;
}

async function makeVendor(name: string): Promise<string> {
  const [row] = await testDb.insert(vendorProfiles).values({ name }).returning();
  return row.vendorId;
}

async function makeLead(opts: {
  companyId: string;
  vendorId: string;
  intent?: string | null;
  score?: number | null;
  stage?: PipelineStage;
  brief?: unknown;
  contactBlock?: unknown;
}): Promise<string> {
  const [row] = await testDb
    .insert(leads)
    .values({
      companyId: opts.companyId,
      vendorId: opts.vendorId,
      intent: opts.intent ?? null,
      score: opts.score ?? null,
      pipelineStage: opts.stage ?? "sourced",
      brief: opts.brief ?? null,
      contactBlock: opts.contactBlock ?? null,
    })
    .returning();
  return row.leadId;
}

describe("pipeline data layer", () => {
  it("listPipelineLeads returns board cards joined to company + vendor names", async () => {
    const companyId = await makeCompany("Zephyr Retail");
    const vendorId = await makeVendor("Acme Infra");
    await makeLead({
      companyId,
      vendorId,
      intent: "Warehouse buildout",
      score: 8.5,
      stage: "contacted",
    });

    const cards = await listPipelineLeads(testDb);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.companyName).toBe("Zephyr Retail");
    expect(card.vendorName).toBe("Acme Infra");
    expect(card.intent).toBe("Warehouse buildout");
    expect(card.score).toBe(8.5);
    expect(card.stage).toBe("contacted");
    expect(card.hasBrief).toBe(false);
    expect(card.hasContactBlock).toBe(false);
    expect(card.createdAt).toBeInstanceOf(Date);
  });

  it("hasBrief / hasContactBlock reflect jsonb presence", async () => {
    const companyId = await makeCompany("Meridian Logistics");
    const vendorId = await makeVendor("Beacon Marketing");
    await makeLead({
      companyId,
      vendorId,
      stage: "engaged",
      brief: { hook: "expanding fast" },
      contactBlock: { decision_makers: [] },
    });

    const [card] = await listPipelineLeads(testDb);
    expect(card.hasBrief).toBe(true);
    expect(card.hasContactBlock).toBe(true);
  });

  it("listPipelineLeads orders by score desc with nulls last", async () => {
    const companyId = await makeCompany("Vantage Foods");
    const vendorId = await makeVendor("Acme Infra");
    await makeLead({ companyId, vendorId, intent: "low", score: 2 });
    await makeLead({ companyId, vendorId, intent: "high", score: 9 });
    await makeLead({ companyId, vendorId, intent: "none", score: null });

    const cards = await listPipelineLeads(testDb);
    expect(cards.map((c) => c.intent)).toEqual(["high", "low", "none"]);
  });

  it("setLeadStage performs a legal move", async () => {
    const companyId = await makeCompany("Co One");
    const vendorId = await makeVendor("Vendor One");
    const leadId = await makeLead({ companyId, vendorId, stage: "sourced" });

    const res = await setLeadStage(testDb, leadId, "contacted");
    expect(res.ok).toBe(true);

    const [row] = await testDb
      .select({ stage: leads.pipelineStage })
      .from(leads)
      .where(eq(leads.leadId, leadId));
    expect(row.stage).toBe("contacted");
  });

  it("setLeadStage rejects an illegal move without mutating the row", async () => {
    const companyId = await makeCompany("Co Two");
    const vendorId = await makeVendor("Vendor Two");
    const leadId = await makeLead({ companyId, vendorId, stage: "sourced" });

    const res = await setLeadStage(testDb, leadId, "paid");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cannot move/i);

    const [row] = await testDb
      .select({ stage: leads.pipelineStage })
      .from(leads)
      .where(eq(leads.leadId, leadId));
    expect(row.stage).toBe("sourced");
  });

  it("setLeadStage rejects a malformed id", async () => {
    const res = await setLeadStage(testDb, "not-a-uuid", "contacted");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Lead not found.");
  });

  it("setLeadStage rejects an unknown lead", async () => {
    const res = await setLeadStage(
      testDb,
      "10000000-0000-4000-8000-000000000009",
      "contacted",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Lead not found.");
  });
});
