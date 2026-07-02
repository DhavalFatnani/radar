import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { companies, vendorProfiles, leads } from "@/db/schema";
import { resolveContactsForLeads } from "@/lib/sourcing/contacts";
import type { ContactResolver, DecisionMaker } from "@/lib/sourcing/contacts-schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["leads", "vendor_profiles", "companies"]); });
afterAll(async () => { await closeTestDb(); });

const NOW = new Date("2026-07-03T12:00:00.000Z");

async function makeCompany(name: string): Promise<string> {
  const [c] = await testDb.insert(companies).values({ name, normalizedName: name.toLowerCase() }).returning();
  return c.companyId;
}
async function makeVendor(name: string, vendorType: string | null): Promise<string> {
  const [v] = await testDb.insert(vendorProfiles).values({ name, vendorType }).returning();
  return v.vendorId;
}
async function makeLead(companyId: string, vendorId: string, intent: string): Promise<string> {
  const [l] = await testDb.insert(leads).values({ companyId, vendorId, intent }).returning();
  return l.leadId;
}

const emptyResolver: ContactResolver = {
  sourceName: "stub",
  async resolve() { return { decisionMakers: [] }; },
};

const dm: DecisionMaker = {
  name: "Jane Doe",
  role: "VP Operations",
  why: "Owns the expansion budget",
  paths: [{ type: "email", val: "jane@acme.test", conf: "high", source: "test" }],
  warm: { status: "warm", detail: "intro via mutual client" },
};
const dmResolver: ContactResolver = {
  sourceName: "test-apollo",
  async resolve() { return { decisionMakers: [dm] }; },
};

describe("resolveContactsForLeads", () => {
  it("persists an empty result as pending_enrichment with resolver metadata", async () => {
    const companyId = await makeCompany("Acme");
    const vendorId = await makeVendor("RackPro", "Infra");
    await makeLead(companyId, vendorId, "Expanding capacity");

    const res = await resolveContactsForLeads(testDb, emptyResolver, NOW);
    expect(res).toEqual({ leadsScanned: 1, contactsResolved: 0, pendingEnrichment: 1, failures: 0 });

    const [lead] = await testDb.select().from(leads);
    const block = lead.contactBlock as {
      status: string; decision_makers: unknown[]; resolvedBy: string; resolvedAt: string;
    };
    expect(block.status).toBe("pending_enrichment");
    expect(block.decision_makers).toEqual([]);
    expect(block.resolvedBy).toBe("stub");
    expect(block.resolvedAt).toBe("2026-07-03T12:00:00.000Z");
  });

  it("persists resolved decision-makers verbatim", async () => {
    const companyId = await makeCompany("Acme");
    const vendorId = await makeVendor("RackPro", "Infra");
    await makeLead(companyId, vendorId, "Expanding capacity");

    const res = await resolveContactsForLeads(testDb, dmResolver, NOW);
    expect(res).toEqual({ leadsScanned: 1, contactsResolved: 1, pendingEnrichment: 0, failures: 0 });

    const [lead] = await testDb.select().from(leads);
    const block = lead.contactBlock as { status: string; resolvedBy: string; decision_makers: DecisionMaker[] };
    expect(block.status).toBe("resolved");
    expect(block.resolvedBy).toBe("test-apollo");
    expect(block.decision_makers).toEqual([dm]);
  });

  it("is idempotent — a second run scans no already-resolved leads", async () => {
    const companyId = await makeCompany("Acme");
    const vendorId = await makeVendor("RackPro", "Infra");
    await makeLead(companyId, vendorId, "Expanding capacity");

    const first = await resolveContactsForLeads(testDb, emptyResolver, NOW);
    expect(first.leadsScanned).toBe(1);
    const second = await resolveContactsForLeads(testDb, emptyResolver, NOW);
    expect(second.leadsScanned).toBe(0);
  });

  it("isolates a resolver failure and still resolves other leads", async () => {
    const boomCo = await makeCompany("Boom");
    const goodCo = await makeCompany("Good");
    const vendorId = await makeVendor("RackPro", "Infra");
    await makeLead(boomCo, vendorId, "x");
    await makeLead(goodCo, vendorId, "y");

    const selective: ContactResolver = {
      sourceName: "selective",
      async resolve(input) {
        if (input.company.name === "Boom") throw new Error("resolver down");
        return { decisionMakers: [dm] };
      },
    };

    const res = await resolveContactsForLeads(testDb, selective, NOW);
    expect(res.failures).toBe(1);
    expect(res.contactsResolved).toBe(1);

    const rows = await testDb.select().from(leads);
    const boom = rows.find((r) => r.companyId === boomCo)!;
    const good = rows.find((r) => r.companyId === goodCo)!;
    expect(boom.contactBlock).toBeNull();
    expect((good.contactBlock as { status: string }).status).toBe("resolved");
  });

  it("does not re-scan a lead that already has a contact_block", async () => {
    const companyId = await makeCompany("Acme");
    const vendorId = await makeVendor("RackPro", "Infra");
    const leadId = await makeLead(companyId, vendorId, "Expanding capacity");
    const existing = {
      decision_makers: [], status: "resolved", resolvedBy: "manual", resolvedAt: "2020-01-01T00:00:00.000Z",
    };
    await testDb.update(leads).set({ contactBlock: existing }).where(eq(leads.leadId, leadId));

    const res = await resolveContactsForLeads(testDb, dmResolver, NOW);
    expect(res.leadsScanned).toBe(0);

    const [lead] = await testDb.select().from(leads);
    expect((lead.contactBlock as { resolvedBy: string }).resolvedBy).toBe("manual"); // untouched
  });
});
