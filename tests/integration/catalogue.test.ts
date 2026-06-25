import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { catalogueNodes, catalogueEdges } from "@/db/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["catalogue_edges", "catalogue_nodes"]); });
afterAll(async () => { await closeTestDb(); });

describe("catalogue graph", () => {
  it("creates nodes and an edge between them", async () => {
    const [vendor] = await testDb.insert(catalogueNodes)
      .values({ type: "vendor", label: "RackPro Infra" }).returning();
    const [cap] = await testDb.insert(catalogueNodes)
      .values({ type: "capability", label: "warehouse racking" }).returning();

    const [edge] = await testDb.insert(catalogueEdges)
      .values({ fromNodeId: vendor.nodeId, toNodeId: cap.nodeId, type: "vendor_capability" })
      .returning();

    expect(edge.type).toBe("vendor_capability");
    const fromVendor = await testDb.select().from(catalogueEdges)
      .where(eq(catalogueEdges.fromNodeId, vendor.nodeId));
    expect(fromVendor).toHaveLength(1);
  });
});
