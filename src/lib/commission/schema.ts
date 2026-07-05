// Pure commission domain model. Mirrors the commission_status enum in
// src/db/schema/enums.ts. No imports from @/db, @/ai, or server-only — safe to
// import from client components and tests. Money is INR minor units (paise),
// integer throughout. Time is injected (never new Date()) so functions are
// deterministic and testable.
import { z } from "zod";

// --- Enum-mirror constants + unions ---
export const COMMISSION_STATUSES = ["pending", "active", "closed", "disputed", "void"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const COMMISSION_TYPES = ["one_time", "recurring"] as const;
export type CommissionType = (typeof COMMISSION_TYPES)[number];

export const COMMISSION_BASES = ["percentage", "flat"] as const;
export type CommissionBasis = (typeof COMMISSION_BASES)[number];

export const RECURRING_CADENCES = ["monthly", "quarterly", "annual"] as const;
export type RecurringCadence = (typeof RECURRING_CADENCES)[number];

export const CYCLE_STATUSES = ["scheduled", "due", "paid", "missed", "waived"] as const;
export type CommissionCycleStatus = (typeof CYCLE_STATUSES)[number];

// Stages at which a deal exists and commission may be recorded. Explicit set —
// NOT an ordinal comparison (the enum places `lost` after `won`).
export const COMMISSION_ELIGIBLE_STAGES = ["won", "delivered", "paid"] as const;

// --- Display labels ---
export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  pending: "Pending",
  active: "Active",
  closed: "Closed",
  disputed: "Disputed",
  void: "Void",
};

export const CYCLE_STATUS_LABELS: Record<CommissionCycleStatus, string> = {
  scheduled: "Scheduled",
  due: "Due",
  paid: "Paid",
  missed: "Missed",
  waived: "Waived",
};

// --- Zod schemas ---
const intNonNeg = z.number().int().nonnegative();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const commissionTermsSchema = z
  .object({
    type: z.enum(COMMISSION_TYPES),
    basis: z.enum(COMMISSION_BASES),
    dealValueInr: intNonNeg.optional(),
    rateBps: z.number().int().min(1).max(10000).optional(),
    amountInr: intNonNeg.optional(),
    cadence: z.enum(RECURRING_CADENCES).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.basis === "percentage") {
      if (v.dealValueInr === undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dealValueInr"], message: "Deal value is required for a percentage commission." });
      if (v.rateBps === undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rateBps"], message: "Rate is required for a percentage commission." });
      if (v.amountInr !== undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amountInr"], message: "A flat amount is not allowed for a percentage commission." });
    } else {
      if (v.amountInr === undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amountInr"], message: "An amount is required for a flat commission." });
      if (v.dealValueInr !== undefined || v.rateBps !== undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["basis"], message: "Deal value / rate are not allowed for a flat commission." });
    }
    if (v.type === "recurring" && v.cadence === undefined)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cadence"], message: "A cadence is required for a recurring commission." });
    if (v.type === "one_time" && v.cadence !== undefined)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cadence"], message: "A cadence is not allowed for a one-time commission." });
  });

export type CommissionTerms = z.infer<typeof commissionTermsSchema>;

export const commissionCycleSchema = z.object({
  seq: z.number().int().positive(),
  dueDate: isoDate,
  amountInr: intNonNeg,
  status: z.enum(CYCLE_STATUSES),
  paidAt: z.string().nullable().optional(),
  paidAmountInr: intNonNeg.nullable().optional(),
});
export type CommissionCycle = z.infer<typeof commissionCycleSchema>;

export const commissionCyclesSchema = z.object({ cycles: z.array(commissionCycleSchema) });
export type CommissionCycles = z.infer<typeof commissionCyclesSchema>;

export const disclosureEntrySchema = z.object({
  at: z.string(),
  contactField: z.string().min(1),
  disclosedTo: z.string().min(1),
  note: z.string().optional(),
});
export type DisclosureEntry = z.infer<typeof disclosureEntrySchema>;

export const introductionEntrySchema = z.object({
  at: z.string(),
  channel: z.string().min(1),
  note: z.string().optional(),
});
export type IntroductionEntry = z.infer<typeof introductionEntrySchema>;

export const disputeEntrySchema = z.object({
  openedAt: z.string(),
  reason: z.string().min(1),
  status: z.enum(["open", "resolved"]),
  resolvedAt: z.string().nullable().optional(),
  resolution: z.string().nullable().optional(),
});
export type DisputeEntry = z.infer<typeof disputeEntrySchema>;

export const disclosureLogSchema = z.array(disclosureEntrySchema);
export const introductionLogSchema = z.array(introductionEntrySchema);
export const disputeLogSchema = z.array(disputeEntrySchema);

// The fully-parsed commission view model the panel + page consume.
export type CommissionRecord = {
  leadId: string;
  vendorId: string;
  status: CommissionStatus;
  terms: CommissionTerms | null;
  cycles: CommissionCycle[];
  disclosureLog: DisclosureEntry[];
  introductionLog: IntroductionEntry[];
  disputeLog: DisputeEntry[];
};

// --- Pure functions ---

/** Per-cycle commission amount in paise. percentage: floor(dealValue * rateBps / 10000); flat: amount. */
export function computeCycleAmountInr(terms: CommissionTerms): number {
  if (terms.basis === "percentage") {
    return Math.floor((terms.dealValueInr! * terms.rateBps!) / 10000);
  }
  return terms.amountInr!;
}

/** Add whole calendar months to a YYYY-MM-DD date, clamping the day to the target month's length. */
export function addMonths(isoDateStr: string, months: number): string {
  const [y, m, d] = isoDateStr.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth(); // 0-based
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const CADENCE_MONTHS: Record<RecurringCadence, number> = { monthly: 1, quarterly: 3, annual: 12 };

/** Next cycle's due date = fromDate + one cadence interval. */
export function nextCycleDueDate(cadence: RecurringCadence, fromDate: string): string {
  return addMonths(fromDate, CADENCE_MONTHS[cadence]);
}

/** Expected payment cycles at terms-set time: one scheduled cycle at the start date (recurring cycles are added on demand). */
export function buildInitialCycles(terms: CommissionTerms, startDate: string): CommissionCycle[] {
  return [
    { seq: 1, dueDate: startDate, amountInr: computeCycleAmountInr(terms), status: "scheduled", paidAt: null, paidAmountInr: null },
  ];
}

/** A due cycle whose date has passed (strictly before today) is overdue — the missed-payment flag. */
export function isCycleOverdue(cycle: CommissionCycle, today: string): boolean {
  return cycle.status === "due" && cycle.dueDate < today;
}

/** Flip every scheduled cycle to due (called at delivered). Other statuses unchanged. */
export function activateCycles(cycles: CommissionCycle[]): CommissionCycle[] {
  return cycles.map((c) => (c.status === "scheduled" ? { ...c, status: "due" as const } : c));
}

/**
 * Recompute the project-level status from its cycles. Never overrides a disputed
 * or void status. `closed` when at least one cycle exists and all are settled
 * (paid or waived); `active` when any cycle is due or missed; else keep `current`.
 */
export function deriveCommissionStatus(current: CommissionStatus, cycles: CommissionCycle[]): CommissionStatus {
  if (current === "disputed" || current === "void") return current;
  if (cycles.length > 0 && cycles.every((c) => c.status === "paid" || c.status === "waived")) return "closed";
  if (cycles.some((c) => c.status === "due" || c.status === "missed")) return "active";
  return current;
}

/** True only for the stages at which a deal (and thus a commission) exists. */
export function isCommissionEligible(stage: string): boolean {
  return (COMMISSION_ELIGIBLE_STAGES as readonly string[]).includes(stage);
}

/** Format paise as ₹ with Indian digit grouping, always two decimals. e.g. 1234500 → "₹12,345.00". */
export function formatInr(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
