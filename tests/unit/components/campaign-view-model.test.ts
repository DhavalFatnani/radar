import { describe, it, expect } from "vitest";
import { yieldPct, relativeTime, sourceTag, deriveListKpis, CREDIT_BUDGET, toSurfacedLeadRow, type CampaignListRow } from "@/app/(app)/campaigns/view-model";

const NOW = new Date("2026-07-07T12:00:00Z");
function row(over: Partial<CampaignListRow>): CampaignListRow {
  return { campaignId: "c", label: "L", vendorName: "V", source: "crustdata", status: "done", companies: 20, leads: 8, credits: 1, yield: 40, createdAt: NOW.toISOString(), ...over };
}

describe("yieldPct", () => {
  it("is leads/companies as a rounded percent, guarding divide-by-zero", () => {
    expect(yieldPct(20, 8)).toBe(40);
    expect(yieldPct(0, 5)).toBe(0);
    expect(yieldPct(3, 1)).toBe(33);
  });
});

describe("relativeTime", () => {
  it("renders coarse buckets", () => {
    expect(relativeTime(new Date("2026-07-07T11:59:40Z"), NOW)).toBe("just now");
    expect(relativeTime(new Date("2026-07-07T11:45:00Z"), NOW)).toBe("15m");
    expect(relativeTime(new Date("2026-07-07T09:00:00Z"), NOW)).toBe("3h");
    expect(relativeTime(new Date("2026-07-05T12:00:00Z"), NOW)).toBe("2d");
    expect(relativeTime(new Date("2026-06-01T12:00:00Z"), NOW)).toBe("Jun 1");
  });
});

describe("sourceTag", () => {
  it("maps crustdata to Live, everything else to Test", () => {
    expect(sourceTag("crustdata")).toEqual({ label: "Live", kind: "live" });
    expect(sourceTag("company-fixture")).toEqual({ label: "Test", kind: "test" });
  });
});

describe("deriveListKpis", () => {
  it("returns four tiles with real aggregates", () => {
    const rows = [
      row({ companies: 20, leads: 8, createdAt: new Date("2026-07-06T12:00:00Z").toISOString() }),
      row({ companies: 10, leads: 5, createdAt: new Date("2026-07-01T12:00:00Z").toISOString() }),
      row({ companies: 30, leads: 3, createdAt: new Date("2026-05-01T12:00:00Z").toISOString() }), // >30d old
    ];
    const tiles = deriveListKpis(rows, NOW);
    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toMatchObject({ label: "Campaigns 30d", value: "2" });   // two within 30d
    expect(tiles[1]).toMatchObject({ label: "Leads sourced", value: "16" });  // 8+5+3
    expect(tiles[2]).toMatchObject({ label: "Companies scanned", value: "60" });
    expect(tiles[3].label).toBe("Avg yield");
    expect(tiles[3].unit).toBe("%");
  });
  it("exposes a spendable budget constant", () => {
    expect(CREDIT_BUDGET).toBeGreaterThan(0);
  });
});

describe("toSurfacedLeadRow", () => {
  it("pulls domain + snapshot fields defensively, nulls when absent", () => {
    const r = toSurfacedLeadRow({
      leadId: "l1", companyName: "RackPro", score: 72, wasNew: true,
      profile: { domain: "rackpro.io" },
      snapshot: { opsPostings: 4, fundraiseDate: "2026-03-01", headcountTotal: 180 },
    });
    expect(r).toEqual({ leadId: "l1", companyName: "RackPro", domain: "rackpro.io", signals: 4, funding: "2026-03-01", headcount: 180, score: 72, wasNew: true });
  });
  it("degrades to nulls / zero score when data is missing", () => {
    const r = toSurfacedLeadRow({ leadId: "l2", companyName: "Acme", score: null, wasNew: false, profile: null, snapshot: null });
    expect(r).toEqual({ leadId: "l2", companyName: "Acme", domain: null, signals: null, funding: null, headcount: null, score: 0, wasNew: false });
  });
});
