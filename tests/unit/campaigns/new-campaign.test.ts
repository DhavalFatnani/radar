import { describe, it, expect } from "vitest";
import { newCampaignSchema, fundedMonthsToDays, buildCampaignConfig } from "@/lib/campaigns/new-campaign";

const base = { vendorId: "10000000-0000-4000-8000-000000000001", geography: "IND", target: 20, source: "crustdata" };

describe("fundedMonthsToDays", () => {
  it("converts month chips to a days window", () => {
    expect(fundedMonthsToDays(1)).toBe(30);
    expect(fundedMonthsToDays(12)).toBe(360);
  });
});

describe("newCampaignSchema", () => {
  it("accepts a minimal valid form and applies defaults", () => {
    const p = newCampaignSchema.parse(base);
    expect(p.target).toBe(20);
    expect(p.fundedMonths).toBe(12);          // default window
    expect(p.excludeSeen).toBe(true);          // default on
    expect(p.industries).toEqual([]);
  });
  it("rejects an out-of-range target", () => {
    expect(() => newCampaignSchema.parse({ ...base, target: 99 })).toThrow();
  });
  it("rejects a non-uuid vendor", () => {
    expect(() => newCampaignSchema.parse({ ...base, vendorId: "nope" })).toThrow();
  });
});

describe("buildCampaignConfig", () => {
  it("persists the full form and derives fundedSinceDays from the month chip", () => {
    const cfg = buildCampaignConfig(newCampaignSchema.parse({ ...base, fundedMonths: 6, roundType: "seriesA" }));
    expect(cfg).toMatchObject({ geography: "IND", target: 20, source: "crustdata", fundedMonths: 6, fundedSinceDays: 180, roundType: "seriesA" });
  });
});
