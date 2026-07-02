import { describe, it, expect } from "vitest";
import { scoreMapping, type ScoringMapping, type ScoredObservation } from "@/lib/sourcing/scoring";

const now = new Date("2026-06-30T00:00:00Z");

const mapping: ScoringMapping = {
  requiredSignals: ["SIG-REQ"],
  supportingSignals: ["SIG-SUP-A", "SIG-SUP-B", "SIG-SUP-C", "SIG-SUP-D"],
  timingWindowDays: 180,
};

function obs(overrides: Partial<ScoredObservation> & { signalId: string }): ScoredObservation {
  return {
    detectedAt: new Date("2026-06-20T00:00:00Z"),
    freshnessVerdict: "recent",
    strength: "very_high",
    polarity: "positive",
    ...overrides,
  };
}

describe("scoreMapping", () => {
  it("one required very_high recent → moderate 60", () => {
    const r = scoreMapping(mapping, [obs({ signalId: "SIG-REQ" })], now);
    expect(r.fired).toBe(true);
    expect(r.disqualified).toBe(false);
    expect(r.score).toBe(60);
    expect(r.contributingSignals).toEqual(["SIG-REQ"]);
  });

  it("required + 2 supporting high recent → top-tier 88", () => {
    const r = scoreMapping(mapping, [
      obs({ signalId: "SIG-REQ" }),
      obs({ signalId: "SIG-SUP-A", strength: "high" }),
      obs({ signalId: "SIG-SUP-B", strength: "high" }),
    ], now);
    expect(r.score).toBe(88);
  });

  it("required + 4 supporting high recent → saturates at 100", () => {
    const r = scoreMapping(mapping, [
      obs({ signalId: "SIG-REQ" }),
      obs({ signalId: "SIG-SUP-A", strength: "high" }),
      obs({ signalId: "SIG-SUP-B", strength: "high" }),
      obs({ signalId: "SIG-SUP-C", strength: "high" }),
      obs({ signalId: "SIG-SUP-D", strength: "high" }),
    ], now);
    expect(r.score).toBe(100);
  });

  it("one required medium recent → 24", () => {
    const r = scoreMapping(mapping, [obs({ signalId: "SIG-REQ", strength: "medium" })], now);
    expect(r.score).toBe(24);
  });

  it("one required very_high stale → 30", () => {
    const r = scoreMapping(mapping, [obs({ signalId: "SIG-REQ", freshnessVerdict: "stale" })], now);
    expect(r.score).toBe(30);
  });

  it("no eligible required (only supporting) → does not fire, no score", () => {
    const r = scoreMapping(mapping, [obs({ signalId: "SIG-SUP-A", strength: "high" })], now);
    expect(r.fired).toBe(false);
    expect(r.score).toBe(0);
  });

  it("negative-polarity observation in window → disqualified even though it fired", () => {
    const r = scoreMapping(mapping, [
      obs({ signalId: "SIG-REQ" }),
      obs({ signalId: "SIG-DISTRESS", polarity: "negative" }),
    ], now);
    expect(r.disqualified).toBe(true);
    expect(r.fired).toBe(true);
    expect(r.score).toBe(0);
  });

  it("required detected outside the timing window → not eligible → no fire", () => {
    const oldReq = obs({ signalId: "SIG-REQ", detectedAt: new Date("2025-12-01T00:00:00Z") }); // ~211d before now
    const r = scoreMapping(mapping, [oldReq], now);
    expect(r.fired).toBe(false);
    expect(r.score).toBe(0);
  });

  it("timingWindowDays null → no timing filter (an old required still fires)", () => {
    const r = scoreMapping(
      { ...mapping, timingWindowDays: null },
      [obs({ signalId: "SIG-REQ", detectedAt: new Date("2020-01-01T00:00:00Z") })],
      now,
    );
    expect(r.fired).toBe(true);
    expect(r.score).toBe(60);
  });

  it("unknown strength → medium (0.4); unknown freshness → 0.75 → score 18", () => {
    const r = scoreMapping(mapping, [obs({ signalId: "SIG-REQ", strength: null, freshnessVerdict: null })], now);
    expect(r.score).toBe(18);
  });

  it("empty observations → no fire, not disqualified, score 0", () => {
    const r = scoreMapping(mapping, [], now);
    expect(r).toEqual({ fired: false, disqualified: false, score: 0, contributingSignals: [] });
  });
});
