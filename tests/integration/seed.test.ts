import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { testDb, migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import {
  companies, signalDefinitions, signalObservations, mappings, vendorProfiles,
  leads, catalogueNodes, catalogueEdges, contacts, projects,
} from "@/db/schema";

const ALL_TABLES = [
  "projects", "contacts", "catalogue_edges", "catalogue_nodes", "leads",
  "vendor_profiles", "mappings", "signal_observations", "signal_definitions", "companies",
];

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(ALL_TABLES); });
afterAll(async () => { await closeTestDb(); });

// Re-implement the seed against the test client so it targets the test DB.
async function seedInto() {
  const [company] = await testDb.insert(companies).values({ name: "Acme" }).returning();
  const [definition] = await testDb.insert(signalDefinitions)
    .values({ signalId: "SIG-EXP-NEW-FACILITY", name: "New facility", family: "expansion" }).returning();
  await testDb.insert(signalObservations).values({
    signalId: definition.signalId, companyId: company.companyId,
    detectedAt: new Date(), source: "news", evidence: ["https://p/1"],
  });
  const [mapping] = await testDb.insert(mappings).values({ name: "Warehouse expansion" }).returning();
  const [vendor] = await testDb.insert(vendorProfiles).values({ name: "RackPro" }).returning();
  const [lead] = await testDb.insert(leads).values({
    companyId: company.companyId, vendorId: vendor.vendorId, matchedMappingId: mapping.mappingId,
  }).returning();
  const [vn] = await testDb.insert(catalogueNodes).values({ type: "vendor", label: "RackPro" }).returning();
  const [cn] = await testDb.insert(catalogueNodes).values({ type: "capability", label: "racking" }).returning();
  await testDb.insert(catalogueEdges).values({ fromNodeId: vn.nodeId, toNodeId: cn.nodeId, type: "vendor_capability" });
  await testDb.insert(contacts).values({ name: "R. Shah", sourceLeadId: lead.leadId });
  await testDb.insert(projects).values({ leadId: lead.leadId, vendorId: vendor.vendorId });
}

describe("seed", () => {
  it("inserts and reads back one row in every table", async () => {
    await seedInto();
    const counts = await Promise.all([
      testDb.select().from(companies),
      testDb.select().from(signalDefinitions),
      testDb.select().from(signalObservations),
      testDb.select().from(mappings),
      testDb.select().from(vendorProfiles),
      testDb.select().from(leads),
      testDb.select().from(catalogueNodes),
      testDb.select().from(catalogueEdges),
      testDb.select().from(contacts),
      testDb.select().from(projects),
    ]);
    // companies..projects each have >=1 row; catalogue_nodes has 2.
    expect(counts.map((c) => c.length)).toEqual([1, 1, 1, 1, 1, 1, 2, 1, 1, 1]);
  });
});
