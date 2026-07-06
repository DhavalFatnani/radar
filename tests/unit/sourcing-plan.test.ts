import { describe, it, expect } from "vitest";
import { buildSourcingPlan, type PlanMapping, type PlanSignalDef } from "@/lib/campaigns/plan";

const defs: PlanSignalDef[] = [
  { signalId: "SIG-MONEY-FUNDING", family: "money", freshnessWindowDays: 365 },
  { signalId: "SIG-HIRING-OPS-SURGE", family: "hiring", freshnessWindowDays: 60 },
  { signalId: "SIG-EXP-HEADCOUNT-GROWTH", family: "expansion", freshnessWindowDays: 365 },
];
const opsMapping: PlanMapping = {
  requiredSignals: ["SIG-MONEY-FUNDING", "SIG-HIRING-OPS-SURGE"],
  supportingSignals: ["SIG-EXP-HEADCOUNT-GROWTH"],
  timingWindowDays: 365,
};

describe("buildSourcingPlan", () => {
  it("collects the families the vendor's approved mappings need", () => {
    const plan = buildSourcingPlan({ vendorType: "Infra" }, [opsMapping], defs);
    expect(plan.signalFamilies.sort()).toEqual(["expansion", "hiring", "money"]);
    expect(plan.fundedSinceDays).toBe(365);
    expect(plan.runnable).toBe(true);
  });

  it("is not runnable when the vendor has no approved mappings", () => {
    const plan = buildSourcingPlan({ vendorType: "Infra" }, [], defs);
    expect(plan.runnable).toBe(false);
    expect(plan.signalFamilies).toEqual([]);
  });

  it("falls back to 365 funded-since days when no money signal is present", () => {
    const hiringOnly: PlanMapping = { requiredSignals: ["SIG-HIRING-OPS-SURGE"], supportingSignals: [], timingWindowDays: 60 };
    const plan = buildSourcingPlan({ vendorType: "Infra" }, [hiringOnly], defs);
    expect(plan.fundedSinceDays).toBe(365);
    expect(plan.signalFamilies).toEqual(["hiring"]);
  });
});
