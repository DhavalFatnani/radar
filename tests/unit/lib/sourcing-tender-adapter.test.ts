import { describe, it, expect } from "vitest";
import { createTenderFixtureAdapter } from "@/lib/sourcing/adapters/tenders";

describe("createTenderFixtureAdapter", () => {
  it("parses the committed fixture with no malformed records", async () => {
    const { records, skippedMalformed } = await createTenderFixtureAdapter().fetch();
    expect(records.length).toBeGreaterThan(0);
    expect(skippedMalformed).toBe(0);
    for (const r of records) {
      expect(r.ref).toBeTruthy();
      expect(r.issuingBody).toBeTruthy();
      expect(r.sourceName).toBeTruthy();
    }
  });

  it("keeps valid records and counts malformed ones", async () => {
    const raw = [
      { ref: "T-1", title: "CCTV supply", issuingBody: "City", publishedAt: "2026-06-01", sourceName: "GeM" },
      { title: "no ref", issuingBody: "City", publishedAt: "2026-06-01", sourceName: "GeM" },
      { ref: "T-3", title: "bad date", issuingBody: "City", publishedAt: "not-a-date", sourceName: "GeM" },
    ];
    const { records, skippedMalformed } = await createTenderFixtureAdapter(raw).fetch();
    expect(records.map((r) => r.ref)).toEqual(["T-1"]);
    expect(skippedMalformed).toBe(2);
  });

  it("exposes a stable sourceName", () => {
    expect(createTenderFixtureAdapter([]).sourceName).toBe("tender-fixture");
  });
});
