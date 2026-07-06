import { describe, it, expect } from "vitest";
import {
  classifyOpsTitle, detectCompanySignals,
  FUNDING_SIGNAL, HEADCOUNT_SIGNAL, OPS_HIRING_SIGNAL, OPS_INHOUSE_SIGNAL,
  type CompanyRecord,
} from "@/lib/sourcing/company-schema";

const NOW = new Date("2026-07-06T00:00:00Z");
const approved = new Set([FUNDING_SIGNAL, HEADCOUNT_SIGNAL, OPS_HIRING_SIGNAL, OPS_INHOUSE_SIGNAL]);

function rec(over: Partial<CompanyRecord> = {}): CompanyRecord {
  return { name: "Anveshan", sourceName: "fixture", sourceRef: "anveshan.com", ...over };
}

describe("classifyOpsTitle", () => {
  it("classifies operator vs engineer vs unrelated", () => {
    expect(classifyOpsTitle("Warehouse Operations Lead")).toBe("operator");
    expect(classifyOpsTitle("Supply Chain Manager")).toBe("operator");
    expect(classifyOpsTitle("DevOps Engineer")).toBe("engineer");
    expect(classifyOpsTitle("Operations Software Engineer")).toBe("engineer");
    expect(classifyOpsTitle("Frontend Designer")).toBeNull();
  });
});

describe("detectCompanySignals", () => {
  it("emits a funding signal with proof when funding is present", () => {
    const obs = detectCompanySignals(rec({ funding: { lastRoundType: "series_b", amountUsd: 12700000, date: "2026-05-29" } }), approved, NOW);
    const f = obs.find((o) => o.signalId === FUNDING_SIGNAL);
    expect(f).toBeTruthy();
    expect(f!.detectedAt).toBe("2026-05-29");
    expect(f!.evidence.length).toBeGreaterThan(0);
    expect(f!.companyName).toBe("Anveshan");
  });

  it("does NOT emit funding when funding is missing (missing != zero)", () => {
    const obs = detectCompanySignals(rec({ funding: null }), approved, NOW);
    expect(obs.find((o) => o.signalId === FUNDING_SIGNAL)).toBeUndefined();
  });

  it("emits headcount growth at/above 15% only", () => {
    expect(detectCompanySignals(rec({ headcount: { total: 160, growth12mPct: 30 } }), approved, NOW).some((o) => o.signalId === HEADCOUNT_SIGNAL)).toBe(true);
    expect(detectCompanySignals(rec({ headcount: { total: 160, growth12mPct: 4 } }), approved, NOW).some((o) => o.signalId === HEADCOUNT_SIGNAL)).toBe(false);
    expect(detectCompanySignals(rec({ headcount: { total: 160, growth12mPct: null } }), approved, NOW).some((o) => o.signalId === HEADCOUNT_SIGNAL)).toBe(false);
  });

  it("emits ops-hiring at >=5 operator roles, and the negative in-house counter when engineer roles exist", () => {
    const postings = [
      { title: "Warehouse Lead" }, { title: "Supply Chain Manager" }, { title: "Logistics Executive" },
      { title: "Fulfilment Associate" }, { title: "Dispatch Supervisor" }, { title: "DevOps Engineer" },
    ];
    const obs = detectCompanySignals(rec({ jobPostings: postings }), approved, NOW);
    expect(obs.some((o) => o.signalId === OPS_HIRING_SIGNAL)).toBe(true);
    expect(obs.some((o) => o.signalId === OPS_INHOUSE_SIGNAL)).toBe(true);
  });

  it("does not emit ops-hiring below the threshold", () => {
    const obs = detectCompanySignals(rec({ jobPostings: [{ title: "Warehouse Lead" }] }), approved, NOW);
    expect(obs.some((o) => o.signalId === OPS_HIRING_SIGNAL)).toBe(false);
  });

  it("emits nothing for a signal that is not approved", () => {
    const obs = detectCompanySignals(rec({ funding: { date: "2026-05-29" } }), new Set(), NOW);
    expect(obs).toHaveLength(0);
  });
});
