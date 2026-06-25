import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { testDb, migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { seed } from "@/db/seed";
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

describe("seed", () => {
  it("inserts and reads back one row in every table", async () => {
    await seed(testDb);
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
