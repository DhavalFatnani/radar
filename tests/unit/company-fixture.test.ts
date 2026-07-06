import { describe, it, expect } from "vitest";
import { createCompanyFixtureAdapter } from "@/lib/sourcing/adapters/company-fixture";
import type { CompanyQuery } from "@/lib/sourcing/company-schema";

const query: CompanyQuery = { geography: "IND", target: 2, signalFamilies: ["money", "hiring"] };

describe("createCompanyFixtureAdapter", () => {
  it("returns valid records and counts malformed ones", async () => {
    const adapter = createCompanyFixtureAdapter([
      { name: "Good Co", sourceName: "fixture", sourceRef: "good.com", funding: { date: "2026-05-01" } },
      { name: "", sourceName: "fixture", sourceRef: "bad.com" }, // malformed: empty name
    ]);
    const { records, skippedMalformed } = await adapter.fetch(query);
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe("Good Co");
    expect(skippedMalformed).toBe(1);
  });

  it("caps results at query.target", async () => {
    const raw = Array.from({ length: 5 }, (_, i) => ({ name: `Co ${i}`, sourceName: "fixture", sourceRef: `co${i}.com` }));
    const { records } = await createCompanyFixtureAdapter(raw).fetch(query);
    expect(records).toHaveLength(2);
  });

  it("ships a non-empty default fixture set", async () => {
    const { records } = await createCompanyFixtureAdapter().fetch({ ...query, target: 100 });
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.name && r.sourceRef)).toBe(true);
  });
});
