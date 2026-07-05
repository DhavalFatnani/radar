import { describe, it, expect } from "vitest";
import {
  COMMISSION_STATUSES,
  COMMISSION_ELIGIBLE_STAGES,
  commissionTermsSchema,
  computeCycleAmountInr,
  addMonths,
  nextCycleDueDate,
  buildInitialCycles,
  isCycleOverdue,
  activateCycles,
  deriveCommissionStatus,
  isCommissionEligible,
  formatInr,
  type CommissionCycle,
} from "@/lib/commission/schema";

const pctTerms = { type: "one_time", basis: "percentage", dealValueInr: 5_000_000, rateBps: 1000 } as const;
const flatTerms = { type: "one_time", basis: "flat", amountInr: 250_000 } as const;
const recurTerms = { type: "recurring", basis: "flat", amountInr: 100_000, cadence: "monthly" } as const;

function cycle(over: Partial<CommissionCycle> = {}): CommissionCycle {
  return { seq: 1, dueDate: "2026-07-01", amountInr: 100_000, status: "due", paidAt: null, paidAmountInr: null, ...over };
}

describe("commission terms schema", () => {
  it("accepts a valid percentage one-time term", () => {
    expect(commissionTermsSchema.safeParse(pctTerms).success).toBe(true);
  });
  it("accepts a valid flat recurring term", () => {
    expect(commissionTermsSchema.safeParse(recurTerms).success).toBe(true);
  });
  it("rejects a percentage term missing dealValue or rate", () => {
    expect(commissionTermsSchema.safeParse({ type: "one_time", basis: "percentage" }).success).toBe(false);
    expect(commissionTermsSchema.safeParse({ type: "one_time", basis: "percentage", dealValueInr: 100 }).success).toBe(false);
  });
  it("rejects a flat term missing amount", () => {
    expect(commissionTermsSchema.safeParse({ type: "one_time", basis: "flat" }).success).toBe(false);
  });
  it("rejects a percentage term that also carries a flat amount", () => {
    expect(commissionTermsSchema.safeParse({ ...pctTerms, amountInr: 10 }).success).toBe(false);
  });
  it("rejects a recurring term without a cadence", () => {
    expect(commissionTermsSchema.safeParse({ type: "recurring", basis: "flat", amountInr: 10 }).success).toBe(false);
  });
  it("rejects a one_time term that carries a cadence", () => {
    expect(commissionTermsSchema.safeParse({ ...flatTerms, cadence: "monthly" }).success).toBe(false);
  });
  it("rejects a rate outside 1..10000 bps", () => {
    expect(commissionTermsSchema.safeParse({ ...pctTerms, rateBps: 0 }).success).toBe(false);
    expect(commissionTermsSchema.safeParse({ ...pctTerms, rateBps: 10001 }).success).toBe(false);
  });
  it("rejects a negative or non-integer amount", () => {
    expect(commissionTermsSchema.safeParse({ type: "one_time", basis: "flat", amountInr: -1 }).success).toBe(false);
    expect(commissionTermsSchema.safeParse({ type: "one_time", basis: "flat", amountInr: 1.5 }).success).toBe(false);
  });
});

describe("computeCycleAmountInr", () => {
  it("floors percentage of deal value in paise", () => {
    expect(computeCycleAmountInr(pctTerms)).toBe(500_000); // 10% of 50,00,000
    expect(computeCycleAmountInr({ type: "one_time", basis: "percentage", dealValueInr: 999, rateBps: 333 })).toBe(33); // floor(999*333/10000)=33.2->33
  });
  it("returns the flat amount unchanged", () => {
    expect(computeCycleAmountInr(flatTerms)).toBe(250_000);
  });
  it("handles crore-scale deal values without overflow", () => {
    expect(computeCycleAmountInr({ type: "one_time", basis: "percentage", dealValueInr: 100_00_00_000, rateBps: 500 })).toBe(5_00_00_000);
  });
});

describe("date arithmetic", () => {
  it("addMonths advances and clamps to month length", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-07-05", 3)).toBe("2026-10-05");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
  it("nextCycleDueDate uses the cadence interval", () => {
    expect(nextCycleDueDate("monthly", "2026-07-05")).toBe("2026-08-05");
    expect(nextCycleDueDate("quarterly", "2026-07-05")).toBe("2026-10-05");
    expect(nextCycleDueDate("annual", "2026-07-05")).toBe("2027-07-05");
  });
});

describe("buildInitialCycles", () => {
  it("creates one scheduled cycle at the start date for a one-time term", () => {
    const cycles = buildInitialCycles(pctTerms, "2026-07-05");
    expect(cycles).toEqual([
      { seq: 1, dueDate: "2026-07-05", amountInr: 500_000, status: "scheduled", paidAt: null, paidAmountInr: null },
    ]);
  });
  it("creates one scheduled cycle for a recurring term (rest added on demand)", () => {
    const cycles = buildInitialCycles(recurTerms, "2026-07-05");
    expect(cycles).toHaveLength(1);
    expect(cycles[0].status).toBe("scheduled");
    expect(cycles[0].amountInr).toBe(100_000);
  });
});

describe("isCycleOverdue", () => {
  it("is true for a due cycle strictly before today", () => {
    expect(isCycleOverdue(cycle({ dueDate: "2026-06-30" }), "2026-07-05")).toBe(true);
  });
  it("is false on the due date itself (boundary)", () => {
    expect(isCycleOverdue(cycle({ dueDate: "2026-07-05" }), "2026-07-05")).toBe(false);
  });
  it("is false for a non-due cycle even if past", () => {
    expect(isCycleOverdue(cycle({ status: "paid", dueDate: "2026-06-01" }), "2026-07-05")).toBe(false);
  });
});

describe("activateCycles", () => {
  it("flips scheduled cycles to due and leaves others untouched", () => {
    const out = activateCycles([cycle({ status: "scheduled" }), cycle({ seq: 2, status: "paid" })]);
    expect(out[0].status).toBe("due");
    expect(out[1].status).toBe("paid");
  });
});

describe("deriveCommissionStatus", () => {
  it("never overrides disputed or void", () => {
    expect(deriveCommissionStatus("disputed", [cycle({ status: "paid" })])).toBe("disputed");
    expect(deriveCommissionStatus("void", [])).toBe("void");
  });
  it("closes when every cycle is settled (paid or waived) and at least one exists", () => {
    expect(deriveCommissionStatus("active", [cycle({ status: "paid" }), cycle({ seq: 2, status: "waived" })])).toBe("closed");
  });
  it("is active when any cycle is due or missed", () => {
    expect(deriveCommissionStatus("pending", [cycle({ status: "due" })])).toBe("active");
    expect(deriveCommissionStatus("active", [cycle({ status: "missed" })])).toBe("active");
  });
  it("keeps current when nothing forces a change (all scheduled)", () => {
    expect(deriveCommissionStatus("pending", [cycle({ status: "scheduled" })])).toBe("pending");
  });
  it("does not close on an empty cycle set", () => {
    expect(deriveCommissionStatus("active", [])).toBe("active");
  });
});

describe("isCommissionEligible", () => {
  it("is true only for won, delivered, paid", () => {
    for (const s of COMMISSION_ELIGIBLE_STAGES) expect(isCommissionEligible(s)).toBe(true);
    for (const s of ["sourced", "contacted", "engaged", "pitched", "lost"]) expect(isCommissionEligible(s)).toBe(false);
  });
});

describe("formatInr", () => {
  it("formats paise as rupees with two decimals and Indian grouping", () => {
    expect(formatInr(1_234_500)).toBe("₹12,345.00");
    expect(formatInr(0)).toBe("₹0.00");
    expect(formatInr(50_000)).toBe("₹500.00");
  });
});

describe("COMMISSION_STATUSES", () => {
  it("mirrors the DB enum order", () => {
    expect([...COMMISSION_STATUSES]).toEqual(["pending", "active", "closed", "disputed", "void"]);
  });
});
