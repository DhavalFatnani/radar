import { describe, it, expect } from "vitest";
import {
  jobPostingRecordSchema,
  detectHiringSignals,
  OPS_SURGE_THRESHOLD,
  FIELD_MKTG_THRESHOLD,
  SIG_HIRING_OPS_SURGE,
  SIG_HIRING_SENIOR_OPS,
  SIG_HIRING_FIELD_MKTG,
  type JobPostingRecord,
} from "@/lib/sourcing/jobs-schema";
import { createJobBoardFixtureAdapter } from "@/lib/sourcing/adapters/jobs-fixture";

const NOW = new Date("2026-06-30T00:00:00Z");

function posting(over: Partial<JobPostingRecord> = {}): JobPostingRecord {
  return {
    ref: "J-x", title: "Warehouse Operations Executive", company: "Meridian Logistics",
    postedAt: "2026-06-20T00:00:00Z", sourceName: "jobboard-fixture", ...over,
  };
}

const ALL = new Set([SIG_HIRING_OPS_SURGE, SIG_HIRING_SENIOR_OPS, SIG_HIRING_FIELD_MKTG]);
const NO_WINDOW = new Map<string, number | null>();

describe("jobPostingRecordSchema", () => {
  it("accepts a valid posting", () => {
    expect(jobPostingRecordSchema.safeParse(posting()).success).toBe(true);
  });
  it("rejects a posting missing its title", () => {
    const { title: _omit, ...bad } = posting();
    expect(jobPostingRecordSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a non-URL url and an unparseable date", () => {
    expect(jobPostingRecordSchema.safeParse(posting({ url: "not-a-url" })).success).toBe(false);
    expect(jobPostingRecordSchema.safeParse(posting({ postedAt: "never" })).success).toBe(false);
  });
});

describe("createJobBoardFixtureAdapter", () => {
  it("reports its source name", () => {
    expect(createJobBoardFixtureAdapter([]).sourceName).toBe("jobboard-fixture");
  });
  it("parses valid postings and counts malformed ones", async () => {
    const adapter = createJobBoardFixtureAdapter([posting({ ref: "J-1" }), { ref: "J-2", company: "X" }]);
    const { records, skippedMalformed } = await adapter.fetch();
    expect(records).toHaveLength(1);
    expect(skippedMalformed).toBe(1);
  });
  it("loads the committed fixture without malformed-count exploding", async () => {
    const { records, skippedMalformed } = await createJobBoardFixtureAdapter().fetch();
    expect(records.length).toBeGreaterThan(0);
    expect(skippedMalformed).toBe(1); // the one intentionally-broken row
  });
});

describe("detectHiringSignals — senior ops (per posting)", () => {
  it("emits SIG-HIRING-SENIOR-OPS for a senior ops title with real proof", () => {
    const p = posting({ ref: "J-1", title: "Head of Supply Chain", company: "Zephyr Retail", city: "Bengaluru" });
    const obs = detectHiringSignals([p], ALL, NO_WINDOW, NOW);
    const senior = obs.filter((o) => o.signalId === SIG_HIRING_SENIOR_OPS);
    expect(senior).toHaveLength(1);
    expect(senior[0].sourceRef).toBe("J-1");
    expect(senior[0].detectedAt).toBe("2026-06-20T00:00:00Z");
    expect(senior[0].companyName).toBe("Zephyr Retail");
    expect(senior[0].evidence.length).toBeGreaterThan(0);
  });
  it("does not emit senior ops for a non-ops or non-senior title", () => {
    const eng = posting({ title: "Senior Software Engineer", company: "Nimbus" });
    const junior = posting({ title: "Warehouse Associate", company: "Meridian" });
    const obs = detectHiringSignals([eng, junior], ALL, NO_WINDOW, NOW);
    expect(obs.filter((o) => o.signalId === SIG_HIRING_SENIOR_OPS)).toHaveLength(0);
  });
});

describe("detectHiringSignals — ops surge (per company aggregate)", () => {
  function opsPostings(n: number, company = "Meridian Logistics"): JobPostingRecord[] {
    return Array.from({ length: n }, (_, i) =>
      posting({ ref: `O-${i}`, title: "Warehouse Operations Associate", company, postedAt: `2026-06-${10 + i}T00:00:00Z` }));
  }
  it("fires at exactly the threshold", () => {
    const obs = detectHiringSignals(opsPostings(OPS_SURGE_THRESHOLD), ALL, NO_WINDOW, NOW);
    const surge = obs.filter((o) => o.signalId === SIG_HIRING_OPS_SURGE);
    expect(surge).toHaveLength(1);
    expect(surge[0].companyName).toBe("Meridian Logistics");
  });
  it("does not fire below the threshold", () => {
    const obs = detectHiringSignals(opsPostings(OPS_SURGE_THRESHOLD - 1), ALL, NO_WINDOW, NOW);
    expect(obs.filter((o) => o.signalId === SIG_HIRING_OPS_SURGE)).toHaveLength(0);
  });
  it("anchors detectedAt and sourceRef to the most-recent qualifying posting", () => {
    const posts = opsPostings(OPS_SURGE_THRESHOLD); // O-0..O-4, postedAt 2026-06-10..14; O-4 is newest
    const [surge] = detectHiringSignals(posts, ALL, NO_WINDOW, NOW).filter((o) => o.signalId === SIG_HIRING_OPS_SURGE);
    expect(surge.sourceRef).toBe(`O-${OPS_SURGE_THRESHOLD - 1}`);
    expect(surge.detectedAt).toBe(`2026-06-${10 + OPS_SURGE_THRESHOLD - 1}T00:00:00Z`);
  });
  it("groups by company — two surging companies produce two observations", () => {
    const posts = [...opsPostings(OPS_SURGE_THRESHOLD, "Meridian Logistics"), ...opsPostings(OPS_SURGE_THRESHOLD, "Cargo Kings")];
    const surge = detectHiringSignals(posts, ALL, NO_WINDOW, NOW).filter((o) => o.signalId === SIG_HIRING_OPS_SURGE);
    expect(surge.map((o) => o.companyName).sort()).toEqual(["Cargo Kings", "Meridian Logistics"]);
  });
  it("applies the rolling window when set — stale postings do not count toward the threshold", () => {
    // 5 ops postings, but 2 are 200 days old → only 3 within a 60-day window → below threshold.
    const fresh = Array.from({ length: 3 }, (_, i) => posting({ ref: `F-${i}`, title: "Ops Executive", postedAt: "2026-06-20T00:00:00Z" }));
    const stale = Array.from({ length: 2 }, (_, i) => posting({ ref: `S-${i}`, title: "Ops Executive", postedAt: "2025-12-01T00:00:00Z" }));
    const window = new Map<string, number | null>([[SIG_HIRING_OPS_SURGE, 60]]);
    const obs = detectHiringSignals([...fresh, ...stale], ALL, window, NOW);
    expect(obs.filter((o) => o.signalId === SIG_HIRING_OPS_SURGE)).toHaveLength(0);
  });
});

describe("detectHiringSignals — field marketing surge", () => {
  it("fires at the field-marketing threshold", () => {
    const posts = [
      posting({ ref: "P-1", title: "Brand Promoter", company: "Vantage Brands" }),
      posting({ ref: "P-2", title: "Field Marketing Executive", company: "Vantage Brands" }),
      posting({ ref: "P-3", title: "Store Launch Coordinator", company: "Vantage Brands" }),
    ];
    expect(posts).toHaveLength(FIELD_MKTG_THRESHOLD);
    const obs = detectHiringSignals(posts, ALL, NO_WINDOW, NOW);
    expect(obs.filter((o) => o.signalId === SIG_HIRING_FIELD_MKTG)).toHaveLength(1);
  });
});

describe("detectHiringSignals — approval gating", () => {
  it("emits nothing when no signals are approved", () => {
    const posts = Array.from({ length: 6 }, (_, i) => posting({ ref: `X-${i}`, title: "Warehouse Operations" }));
    expect(detectHiringSignals(posts, new Set(), NO_WINDOW, NOW)).toEqual([]);
  });
});
