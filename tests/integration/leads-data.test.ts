import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { leads, companies, vendorProfiles } from "@/db/schema";
import { getLeadDetail } from "@/lib/leads/data";
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

async function makeCompany(name: string, description: string | null = null): Promise<string> {
  const [row] = await testDb
    .insert(companies)
    .values({ name, normalizedName: name.toLowerCase(), description })
    .returning();
  return row.companyId;
}

async function makeVendor(name: string, vendorType: string | null = null): Promise<string> {
  const [row] = await testDb.insert(vendorProfiles).values({ name, vendorType }).returning();
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
  outreachStatus?: "pending" | "drafted" | "sent";
  outreachDraft?: unknown;
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
      outreachStatus: opts.outreachStatus ?? "pending",
      outreachDraft: opts.outreachDraft ?? null,
    })
    .returning();
  return row.leadId;
}

const validBrief = {
  why_them: "Expanding to three new regions.",
  why_now: [
    {
      signalId: "sig-1",
      claim: "Opened a new DC",
      date: "2026-06-01T00:00:00Z",
      source: "press release",
      evidence: ["https://example.com/dc"],
    },
  ],
  what_they_need: "Warehouse automation partner",
  hook: "Congrats on the expansion",
  why_this_vendor: "You automated a comparable site",
  objections: [{ objection: "Too expensive", response: "ROI within 6 months" }],
  disqualifier_check_passed: true,
  generatedAt: "2026-06-02T09:30:00Z",
};

const validContacts = {
  decision_makers: [
    {
      name: "Jane Doe",
      role: "COO",
      why: "Owns the operations budget",
      paths: [{ type: "email", val: "jane@acme.com", conf: "high", source: "apollo" }],
      warm: { status: "cold", detail: null },
    },
  ],
  status: "resolved",
  resolvedBy: "apollo-resolver",
  resolvedAt: "2026-06-02T10:00:00Z",
};

describe("getLeadDetail", () => {
  it("returns a full detail with parsed brief and contact block", async () => {
    const companyId = await makeCompany("Zephyr Retail", "A regional retailer");
    const vendorId = await makeVendor("Acme Infra", "Infra");
    const leadId = await makeLead({
      companyId,
      vendorId,
      intent: "Warehouse buildout",
      score: 8.5,
      stage: "contacted",
      brief: validBrief,
      contactBlock: validContacts,
    });

    const detail = await getLeadDetail(testDb, leadId);
    expect(detail).not.toBeNull();
    expect(detail!.companyName).toBe("Zephyr Retail");
    expect(detail!.companyDescription).toBe("A regional retailer");
    expect(detail!.vendorName).toBe("Acme Infra");
    expect(detail!.vendorType).toBe("Infra");
    expect(detail!.intent).toBe("Warehouse buildout");
    expect(detail!.score).toBe(8.5);
    expect(detail!.stage).toBe("contacted");
    expect(detail!.brief?.hook).toBe("Congrats on the expansion");
    expect(detail!.brief?.why_now).toHaveLength(1);
    expect(detail!.contactBlock?.decision_makers[0].name).toBe("Jane Doe");
    expect(detail!.createdAt).toBeInstanceOf(Date);
  });

  it("returns null brief and contactBlock when the columns are null", async () => {
    const companyId = await makeCompany("Meridian Logistics");
    const vendorId = await makeVendor("Beacon Marketing");
    const leadId = await makeLead({ companyId, vendorId });

    const detail = await getLeadDetail(testDb, leadId);
    expect(detail).not.toBeNull();
    expect(detail!.brief).toBeNull();
    expect(detail!.contactBlock).toBeNull();
    expect(detail!.companyDescription).toBeNull();
    expect(detail!.vendorType).toBeNull();
    expect(detail!.outreachMode).toBeNull();
  });

  it("degrades a malformed brief payload to null without failing", async () => {
    const companyId = await makeCompany("Vantage Foods");
    const vendorId = await makeVendor("Acme Infra");
    const leadId = await makeLead({
      companyId,
      vendorId,
      brief: { hook: "only a hook, missing everything else" },
      contactBlock: validContacts,
    });

    const detail = await getLeadDetail(testDb, leadId);
    expect(detail).not.toBeNull();
    expect(detail!.brief).toBeNull();
    expect(detail!.contactBlock?.decision_makers[0].name).toBe("Jane Doe");
  });

  it("returns null for an unknown lead id", async () => {
    const detail = await getLeadDetail(testDb, "10000000-0000-4000-8000-000000000099");
    expect(detail).toBeNull();
  });

  it("returns null for a malformed (non-UUID) id", async () => {
    const detail = await getLeadDetail(testDb, "not-a-uuid");
    expect(detail).toBeNull();
  });
});

describe("getLeadDetail — outreach columns", () => {
  it("surfaces a valid outreach draft and status", async () => {
    const companyId = await makeCompany("Zephyr Retail");
    const vendorId = await makeVendor("Acme Infra");
    const leadId = await makeLead({
      companyId,
      vendorId,
      outreachStatus: "drafted",
      outreachDraft: { subject: "Hello", body: "Let's talk." },
    });

    const detail = await getLeadDetail(testDb, leadId);
    expect(detail).not.toBeNull();
    expect(detail!.outreachStatus).toBe("drafted");
    expect(detail!.outreachDraft).toEqual({ subject: "Hello", body: "Let's talk." });
  });

  it("degrades a malformed outreach draft to null with status intact", async () => {
    const companyId = await makeCompany("Vantage Foods");
    const vendorId = await makeVendor("Acme Infra");
    const leadId = await makeLead({
      companyId,
      vendorId,
      outreachStatus: "drafted",
      outreachDraft: { subject: "" }, // empty subject + missing body -> invalid
    });

    const detail = await getLeadDetail(testDb, leadId);
    expect(detail).not.toBeNull();
    expect(detail!.outreachDraft).toBeNull();
    expect(detail!.outreachStatus).toBe("drafted");
  });

  it("defaults a fresh lead to status 'pending' with a null draft", async () => {
    const companyId = await makeCompany("Meridian Logistics");
    const vendorId = await makeVendor("Beacon Marketing");
    const leadId = await makeLead({ companyId, vendorId });

    const detail = await getLeadDetail(testDb, leadId);
    expect(detail!.outreachStatus).toBe("pending");
    expect(detail!.outreachDraft).toBeNull();
    expect(detail!.outreachDraftGeneratedAt).toBeNull();
    expect(detail!.outreachSentAt).toBeNull();
  });
});
