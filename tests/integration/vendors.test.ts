import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { testDb, migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { vendorProfiles } from "@/db/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["vendor_profiles"]); });
afterAll(async () => { await closeTestDb(); });

describe("vendor_profiles", () => {
  it("creates and reads back a vendor with jsonb constraints and version default", async () => {
    const [v] = await testDb.insert(vendorProfiles).values({
      name: "RackPro Infra",
      capabilities: ["racking", "cctv", "networking"],
      constraints: { max_project_size: "100000sqft", geographies_served: ["maharashtra"] },
    }).returning();
    expect(v.version).toBe(1);
    expect(v.capabilities).toContain("cctv");
    expect((v.constraints as { geographies_served: string[] }).geographies_served).toEqual(["maharashtra"]);
  });
});
