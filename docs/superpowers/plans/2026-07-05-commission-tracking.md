# Commission Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track broker commission on won deals — set terms at `won`, make them due at `delivered`, record payment manually — plus recurring cycles, missed-payment flags, and disclosure/introduction/dispute leak-defense logs, all on the lead-detail page.

**Architecture:** Mirror the existing `pipeline` + `outreach` data-module split: a pure `src/lib/commission/schema.ts` (Zod + types + pure functions, clock-free), a server `src/lib/commission/data.ts` (injected-`db` functions), server actions extending `src/app/(app)/leads/actions.ts`, and a client `commission-panel.tsx` on the lead-detail page. The empty `projects` table is redefined with a typed `commission_status` enum column + jsonb terms/cycles/leak-logs.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle ORM (postgres-js) on Neon Postgres, Zod, NextAuth v5, Vitest + Testing Library, React 19.

**Spec:** `docs/superpowers/specs/2026-07-05-commission-tracking-design.md`.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec.

- **INR minor units (paise)** everywhere; integer math for money; `formatInr` for display only. Money lives in **jsonb** (no bigint columns); values ≤ `Number.MAX_SAFE_INTEGER`.
- **Locked decisions:** basis = percentage-of-deal-value **or** flat, per record; lifecycle = terms at `won` → due at `delivered` → paid manually; **INR only**; full feature (one-time + recurring + reminders-on-read + missed flags + 3 leak logs).
- **Commission-eligible stages are the explicit set `{won, delivered, paid}`** — never an ordinal `>= won` (the `pipeline_stage` enum places `lost` after `won`).
- **Data-module split:** `schema.ts` is pure — no `@/db`, no `server-only`, no `@/ai` value imports (type-only imports OK). `data.ts` is the only file importing `@/db`. The client panel imports only from `schema.ts` (+ the actions module), never `data.ts`.
- **Injected `db`** as the first arg of every `data.ts` function; **type-only** `import type { DB } from "@/db/client"`. Parameterized Drizzle (`eq(...)`) only — never string-interpolated SQL. UUID-guard every id with the shared `UUID_RE`.
- **Clock is injected** into pure + data layers: timestamps (`today` = `YYYY-MM-DD`, `now` = ISO datetime) are produced in the **action** and passed down. `schema.ts` and `data.ts` never call `new Date()`.
- **Auth-first** guard ladder in every action (`signedIn()` local wrapper, identical to the existing one). Errors returned to the client are **safe constant strings** — never DB internals or stack traces.
- **Dated proof** on every leak-defense entry; leak logs are **append-only** (never mutate/delete existing entries; dispute resolve updates the latest dispute entry in place, which is allowed).
- **a11y / mobile-first (375px):** semantic HTML, real `<button>`s, keyboard-navigable, focus states, `role="alert"` errors, `role="group"` + `aria-label`, inline two-step confirms (no native `confirm()`).
- **TDD**; test files mirror source dir; ≥80% coverage on new code; every test carries positive **and** negative assertions (non-vacuous).
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Additive edits only; commit **explicit paths** (never `git add .`).
- **Migration refinement of spec §5.1/§10:** to keep `drizzle-kit generate` non-interactive (it prompts on column drop+add rename detection), the two repurposed jsonb columns keep their **legacy DB column names** — TS property `commissionCycles` → DB column `commission_due`, TS property `disputeLog` → DB column `dispute_record`. Only `recurring_tracking` is dropped; only `commission_status` (enum) is added. App code uses the clean TS names exclusively.

---

### Task 1: Pure commission domain module

**Files:**
- Create: `src/lib/commission/schema.ts`
- Test: `tests/unit/commission/schema.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces (later tasks rely on these exact names/types):
  - Constants: `COMMISSION_STATUSES`, `COMMISSION_TYPES`, `COMMISSION_BASES`, `RECURRING_CADENCES`, `CYCLE_STATUSES`, `COMMISSION_ELIGIBLE_STAGES`, `COMMISSION_STATUS_LABELS`, `CYCLE_STATUS_LABELS`.
  - Types: `CommissionStatus`, `CommissionType`, `CommissionBasis`, `RecurringCadence`, `CommissionCycleStatus`, `CommissionTerms`, `CommissionCycle`, `CommissionCycles`, `DisclosureEntry`, `IntroductionEntry`, `DisputeEntry`, `CommissionRecord`.
  - Zod: `commissionTermsSchema`, `commissionCycleSchema`, `commissionCyclesSchema`, `disclosureEntrySchema`, `introductionEntrySchema`, `disputeEntrySchema`, `disclosureLogSchema`, `introductionLogSchema`, `disputeLogSchema`.
  - Functions: `computeCycleAmountInr(terms)`, `addMonths(isoDate, months)`, `nextCycleDueDate(cadence, fromDate)`, `buildInitialCycles(terms, startDate)`, `isCycleOverdue(cycle, today)`, `activateCycles(cycles)`, `deriveCommissionStatus(current, cycles)`, `isCommissionEligible(stage)`, `formatInr(paise)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/commission/schema.test.ts`:

```ts
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
    expect(computeCycleAmountInr({ type: "one_time", basis: "percentage", dealValueInr: 100_00_00_000, rateBps: 500 })).toBe(50_00_00_000);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/commission/schema.test.ts`
Expected: FAIL — `Cannot find module '@/lib/commission/schema'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/commission/schema.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/commission/schema.test.ts`
Expected: PASS (all cases). Then `npx tsc --noEmit` — expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/commission/schema.ts tests/unit/commission/schema.test.ts
git commit -m "feat(commission): pure domain schema — terms, cycles, leak logs, pure helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: DB schema, enum, migration

**Files:**
- Modify: `src/db/schema/enums.ts` (add `commissionStatus` pgEnum)
- Modify: `src/db/schema/projects.ts` (redefine the empty skeleton)
- Create: `src/db/migrations/0013_*.sql` (generated by drizzle-kit) + its `meta/` snapshot updates
- Test: `tests/integration/commission-schema.test.ts`

**Interfaces:**
- Consumes: Task 1 has no runtime dependency here.
- Produces: the `projects` table with TS properties `commissionStatus`, `commissionTerms`, `commissionCycles` (DB col `commission_due`), `disclosureLog`, `introductionLog`, `disputeLog` (DB col `dispute_record`); the `commissionStatus` pgEnum.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/commission-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { projects, leads, companies, vendorProfiles } from "@/db/schema";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["projects", "leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
});

async function seedLead(): Promise<{ leadId: string; vendorId: string }> {
  const [company] = await testDb.insert(companies).values({ name: "Zephyr Retail", normalizedName: "zephyr retail" }).returning();
  const [vendor] = await testDb.insert(vendorProfiles).values({ name: "Acme Infra" }).returning();
  const [lead] = await testDb
    .insert(leads)
    .values({ companyId: company.companyId, vendorId: vendor.vendorId, pipelineStage: "won" })
    .returning();
  return { leadId: lead.leadId, vendorId: vendor.vendorId };
}

describe("projects commission schema", () => {
  it("inserts a project row with commission defaults", async () => {
    const { leadId, vendorId } = await seedLead();
    const [row] = await testDb.insert(projects).values({ leadId, vendorId }).returning();
    expect(row.commissionStatus).toBe("pending");
    expect(row.commissionCycles).toEqual({ cycles: [] });
    expect(row.disclosureLog).toEqual([]);
    expect(row.introductionLog).toEqual([]);
    expect(row.disputeLog).toEqual([]);
    expect(row.commissionTerms).toBeNull();
  });

  it("round-trips a populated terms + cycles payload", async () => {
    const { leadId, vendorId } = await seedLead();
    await testDb.insert(projects).values({
      leadId,
      vendorId,
      commissionStatus: "active",
      commissionTerms: { type: "one_time", basis: "flat", amountInr: 250000 },
      commissionCycles: { cycles: [{ seq: 1, dueDate: "2026-07-05", amountInr: 250000, status: "due", paidAt: null, paidAmountInr: null }] },
    });
    const [row] = await testDb.select().from(projects).where(eq(projects.leadId, leadId));
    expect(row.commissionStatus).toBe("active");
    expect((row.commissionTerms as { amountInr: number }).amountInr).toBe(250000);
    expect((row.commissionCycles as { cycles: unknown[] }).cycles).toHaveLength(1);
  });

  it("enforces one project per lead (unique lead_id)", async () => {
    const { leadId, vendorId } = await seedLead();
    await testDb.insert(projects).values({ leadId, vendorId });
    await expect(testDb.insert(projects).values({ leadId, vendorId })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/commission-schema.test.ts`
Expected: FAIL — `row.commissionStatus` is undefined / column does not exist (schema not yet migrated).

- [ ] **Step 3: Add the enum**

In `src/db/schema/enums.ts`, add after the `interviewStatus` line:

```ts
// Commission / projects (§4.7, §7.6)
export const commissionStatus = pgEnum("commission_status", [
  "pending", "active", "closed", "disputed", "void",
]);
```

- [ ] **Step 4: Redefine the projects table**

Replace the entire contents of `src/db/schema/projects.ts` with:

```ts
import { pgTable, uuid, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { commissionStatus } from "./enums";
import { leads } from "./leads";
import { vendorProfiles } from "./vendors";

// One project per WON lead — the deal on which the operator earns commission.
// NOTE: two jsonb columns keep their legacy DB names to avoid a drizzle-kit
// rename prompt: commissionCycles -> "commission_due", disputeLog ->
// "dispute_record". App code uses only the TS property names.
export const projects = pgTable(
  "projects",
  {
    projectId: uuid("project_id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").notNull().references(() => leads.leadId),
    vendorId: uuid("vendor_id").notNull().references(() => vendorProfiles.vendorId),
    commissionStatus: commissionStatus("commission_status").notNull().default("pending"),
    commissionTerms: jsonb("commission_terms"),
    commissionCycles: jsonb("commission_due").notNull().default({ cycles: [] }),
    disclosureLog: jsonb("disclosure_log").notNull().default([]),
    introductionLog: jsonb("introduction_log").notNull().default([]),
    disputeLog: jsonb("dispute_record").notNull().default([]),
  },
  (t) => [uniqueIndex("projects_lead_uq").on(t.leadId)],
);
```

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: creates `src/db/migrations/0013_<slug>.sql` and updates `src/db/migrations/meta/`. Open the generated `.sql` and confirm it is **non-interactive and additive-only** — it must contain:
- `CREATE TYPE "public"."commission_status" AS ENUM('pending', 'active', 'closed', 'disputed', 'void');`
- `ALTER TABLE "projects" ADD COLUMN "commission_status" "commission_status" DEFAULT 'pending' NOT NULL;`
- `ALTER TABLE "projects" DROP COLUMN "recurring_tracking";`
- `ALTER TABLE ... SET DEFAULT / SET NOT NULL` on `commission_due`, `disclosure_log`, `introduction_log`, `dispute_record`
- `CREATE UNIQUE INDEX "projects_lead_uq" ON "projects" ("lead_id");`

If drizzle-kit pauses to ask whether any column was **renamed**, answer **create/drop** (not rename) — but with this schema (only `recurring_tracking` dropped, only the enum column added) it should not prompt.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/integration/commission-schema.test.ts`
Expected: PASS (defaults present, round-trip works, unique constraint rejects the duplicate). Then `npx tsc --noEmit` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/enums.ts src/db/schema/projects.ts src/db/migrations tests/integration/commission-schema.test.ts
git commit -m "feat(commission): projects schema — commission_status enum, cycles + leak-log jsonb, migration 0013

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Data layer — read, terms, activate

**Files:**
- Create: `src/lib/commission/data.ts`
- Test: `tests/integration/commission-data.test.ts`

**Interfaces:**
- Consumes: Task 1 schema (`buildInitialCycles`, `activateCycles`, `deriveCommissionStatus`, the Zod log/terms/cycles schemas, types), Task 2 `projects`/`leads` tables, `DB` type.
- Produces (Task 4 appends more functions to this same file; Task 5 actions consume these):
  - `getCommissionForLead(db, leadId): Promise<CommissionRecord | null>`
  - `createCommissionTerms(db, leadId, terms, today): Promise<Result>`
  - `updateCommissionTerms(db, leadId, terms, today): Promise<Result>`
  - `activateCommission(db, leadId): Promise<Result>`
  - Shared internal: `UUID_RE`, `Result` type, `toRecord(row)`, `loadState(db, leadId)`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/commission-data.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { projects, leads, companies, vendorProfiles } from "@/db/schema";
import {
  getCommissionForLead,
  createCommissionTerms,
  updateCommissionTerms,
  activateCommission,
} from "@/lib/commission/data";
import type { CommissionTerms } from "@/lib/commission/schema";

const flat: CommissionTerms = { type: "one_time", basis: "flat", amountInr: 250_000 };
const recurring: CommissionTerms = { type: "recurring", basis: "flat", amountInr: 100_000, cadence: "monthly" };

async function seedLead(stage: string = "won"): Promise<string> {
  const [company] = await testDb.insert(companies).values({ name: "Zephyr", normalizedName: "zephyr" }).returning();
  const [vendor] = await testDb.insert(vendorProfiles).values({ name: "Acme" }).returning();
  const [lead] = await testDb
    .insert(leads)
    .values({ companyId: company.companyId, vendorId: vendor.vendorId, pipelineStage: stage as never })
    .returning();
  return lead.leadId;
}

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["projects", "leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
});

describe("getCommissionForLead", () => {
  it("returns null for a malformed id", async () => {
    expect(await getCommissionForLead(testDb, "nope")).toBeNull();
  });
  it("returns null when no project exists", async () => {
    const leadId = await seedLead();
    expect(await getCommissionForLead(testDb, leadId)).toBeNull();
  });
});

describe("createCommissionTerms", () => {
  it("creates a pending project with one scheduled cycle", async () => {
    const leadId = await seedLead();
    const r = await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.status).toBe("pending");
    expect(rec?.terms?.amountInr).toBe(250_000);
    expect(rec?.cycles).toEqual([
      { seq: 1, dueDate: "2026-07-05", amountInr: 250_000, status: "scheduled", paidAt: null, paidAmountInr: null },
    ]);
    const [row] = await testDb.select().from(projects).where(eq(projects.leadId, leadId));
    expect(row.vendorId).toBeTruthy();
  });
  it("rejects a second create for the same lead", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    const r = await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    expect(r).toEqual({ ok: false, error: "Commission terms already exist for this deal." });
  });
  it("rejects an unknown lead", async () => {
    const r = await createCommissionTerms(testDb, "10000000-0000-4000-8000-000000000009", flat, "2026-07-05");
    expect(r).toEqual({ ok: false, error: "Lead not found." });
  });
});

describe("updateCommissionTerms", () => {
  it("rebuilds cycles while status is pending", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    const r = await updateCommissionTerms(testDb, leadId, recurring, "2026-07-06");
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.terms?.type).toBe("recurring");
    expect(rec?.cycles[0].dueDate).toBe("2026-07-06");
  });
  it("refuses to edit once active", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await updateCommissionTerms(testDb, leadId, recurring, "2026-07-06");
    expect(r).toEqual({ ok: false, error: "Terms can only be edited before the deal is delivered." });
  });
});

describe("activateCommission", () => {
  it("flips scheduled cycles to due and sets status active", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    const r = await activateCommission(testDb, leadId);
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.status).toBe("active");
    expect(rec?.cycles[0].status).toBe("due");
  });
  it("rejects activating a non-pending commission", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await activateCommission(testDb, leadId);
    expect(r).toEqual({ ok: false, error: "Commission is already active." });
  });
  it("rejects when there is no commission", async () => {
    const leadId = await seedLead();
    const r = await activateCommission(testDb, leadId);
    expect(r).toEqual({ ok: false, error: "No commission for this deal." });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/commission-data.test.ts`
Expected: FAIL — `Cannot find module '@/lib/commission/data'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/commission/data.ts`:

```ts
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — a value import would eagerly open Postgres
import { projects, leads } from "@/db/schema";
import {
  commissionTermsSchema,
  commissionCyclesSchema,
  disclosureLogSchema,
  introductionLogSchema,
  disputeLogSchema,
  buildInitialCycles,
  activateCycles,
  deriveCommissionStatus,
  type CommissionRecord,
  type CommissionStatus,
  type CommissionTerms,
  type CommissionCycle,
} from "@/lib/commission/schema";

export type Result = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Parse a raw projects row into the tolerant view model — a malformed jsonb
// payload degrades to a safe default rather than throwing.
function toRecord(row: typeof projects.$inferSelect): CommissionRecord {
  const terms = row.commissionTerms == null ? null : commissionTermsSchema.safeParse(row.commissionTerms);
  const cycles = commissionCyclesSchema.safeParse(row.commissionCycles);
  const disclosure = disclosureLogSchema.safeParse(row.disclosureLog);
  const introduction = introductionLogSchema.safeParse(row.introductionLog);
  const dispute = disputeLogSchema.safeParse(row.disputeLog);
  return {
    leadId: row.leadId,
    vendorId: row.vendorId,
    status: row.commissionStatus as CommissionStatus,
    terms: terms && terms.success ? terms.data : null,
    cycles: cycles.success ? cycles.data.cycles : [],
    disclosureLog: disclosure.success ? disclosure.data : [],
    introductionLog: introduction.success ? introduction.data : [],
    disputeLog: dispute.success ? dispute.data : [],
  };
}

// Load the mutable commission state for a lead (status + parsed cycles + terms).
// Used by every mutation. Returns null when no project exists.
export async function loadState(
  db: DB,
  leadId: string,
): Promise<{ status: CommissionStatus; cycles: CommissionCycle[]; terms: CommissionTerms | null } | null> {
  const [row] = await db
    .select({ status: projects.commissionStatus, cycles: projects.commissionCycles, terms: projects.commissionTerms })
    .from(projects)
    .where(eq(projects.leadId, leadId))
    .limit(1);
  if (!row) return null;
  const cycles = commissionCyclesSchema.safeParse(row.cycles);
  const terms = row.terms == null ? null : commissionTermsSchema.safeParse(row.terms);
  return {
    status: row.status as CommissionStatus,
    cycles: cycles.success ? cycles.data.cycles : [],
    terms: terms && terms.success ? terms.data : null,
  };
}

/** The commission view model for a lead, or null for a malformed id / no project. Caller owns the connection. */
export async function getCommissionForLead(db: DB, leadId: string): Promise<CommissionRecord | null> {
  if (!UUID_RE.test(leadId)) return null;
  const [row] = await db.select().from(projects).where(eq(projects.leadId, leadId)).limit(1);
  if (!row) return null;
  return toRecord(row);
}

/** Create the project (terms set at `won`). The vendor is taken from the lead. Rejects a duplicate. */
export async function createCommissionTerms(
  db: DB,
  leadId: string,
  terms: CommissionTerms,
  today: string,
): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const [lead] = await db.select({ vendorId: leads.vendorId }).from(leads).where(eq(leads.leadId, leadId)).limit(1);
  if (!lead) return { ok: false, error: "Lead not found." };
  const [existing] = await db.select({ id: projects.projectId }).from(projects).where(eq(projects.leadId, leadId)).limit(1);
  if (existing) return { ok: false, error: "Commission terms already exist for this deal." };

  await db.insert(projects).values({
    leadId,
    vendorId: lead.vendorId,
    commissionStatus: "pending",
    commissionTerms: terms,
    commissionCycles: { cycles: buildInitialCycles(terms, today) },
    disclosureLog: [],
    introductionLog: [],
    disputeLog: [],
  });
  return { ok: true };
}

/** Replace terms + regenerate cycles. Allowed only while status is `pending`. */
export async function updateCommissionTerms(
  db: DB,
  leadId: string,
  terms: CommissionTerms,
  today: string,
): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const state = await loadState(db, leadId);
  if (!state) return { ok: false, error: "No commission for this deal." };
  if (state.status !== "pending") return { ok: false, error: "Terms can only be edited before the deal is delivered." };

  await db
    .update(projects)
    .set({ commissionTerms: terms, commissionCycles: { cycles: buildInitialCycles(terms, today) } })
    .where(eq(projects.leadId, leadId));
  return { ok: true };
}

/** Deal delivered: flip scheduled cycles to due, set status active. Allowed only from `pending`. */
export async function activateCommission(db: DB, leadId: string): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const state = await loadState(db, leadId);
  if (!state) return { ok: false, error: "No commission for this deal." };
  if (state.status !== "pending") return { ok: false, error: "Commission is already active." };

  const cycles = activateCycles(state.cycles);
  const status = deriveCommissionStatus("active", cycles);
  await db.update(projects).set({ commissionCycles: { cycles }, commissionStatus: status }).where(eq(projects.leadId, leadId));
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/commission-data.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/commission/data.ts tests/integration/commission-data.test.ts
git commit -m "feat(commission): data layer — read, create/update terms, activate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Data layer — cycle mutations, logs, disputes

**Files:**
- Modify: `src/lib/commission/data.ts` (append functions)
- Test: `tests/integration/commission-data.test.ts` (append describe blocks)

**Interfaces:**
- Consumes: Task 3 internals (`UUID_RE`, `Result`, `loadState`), Task 1 schema (`nextCycleDueDate`, `computeCycleAmountInr`, `deriveCommissionStatus`, log schemas, entry types).
- Produces (Task 5 actions consume these):
  - `markCyclePaid(db, leadId, seq, now): Promise<Result>` — paid amount = the cycle's expected amount.
  - `markCycleMissed(db, leadId, seq): Promise<Result>`
  - `waiveCycle(db, leadId, seq): Promise<Result>`
  - `addNextCycle(db, leadId): Promise<Result>` — recurring only.
  - `appendDisclosure(db, leadId, entry): Promise<Result>`
  - `appendIntroduction(db, leadId, entry): Promise<Result>`
  - `openDispute(db, leadId, reason, at): Promise<Result>`
  - `resolveDispute(db, leadId, resolution, at): Promise<Result>`

- [ ] **Step 1: Write the failing test (append)**

Append to `tests/integration/commission-data.test.ts` (add the new imports to the existing import from `@/lib/commission/data`):

```ts
// Extend the existing import line from "@/lib/commission/data" to also include:
//   markCyclePaid, markCycleMissed, waiveCycle, addNextCycle,
//   appendDisclosure, appendIntroduction, openDispute, resolveDispute

describe("markCyclePaid", () => {
  it("marks a due cycle paid at its expected amount and closes a one-time commission", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await markCyclePaid(testDb, leadId, 1, "2026-07-10T09:00:00.000Z");
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.status).toBe("closed");
    expect(rec?.cycles[0].status).toBe("paid");
    expect(rec?.cycles[0].paidAmountInr).toBe(250_000);
    expect(rec?.cycles[0].paidAt).toBe("2026-07-10T09:00:00.000Z");
  });
  it("refuses a cycle that is not due or missed", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05"); // still scheduled
    const r = await markCyclePaid(testDb, leadId, 1, "2026-07-10T09:00:00.000Z");
    expect(r).toEqual({ ok: false, error: "Only a due or missed cycle can be marked paid." });
  });
  it("rejects an unknown cycle seq", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await markCyclePaid(testDb, leadId, 99, "2026-07-10T09:00:00.000Z");
    expect(r).toEqual({ ok: false, error: "Cycle not found." });
  });
});

describe("markCycleMissed + waiveCycle", () => {
  it("marks a due cycle missed and keeps status active", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await markCycleMissed(testDb, leadId, 1);
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.cycles[0].status).toBe("missed");
    expect(rec?.status).toBe("active");
  });
  it("waives a cycle, which counts as settled and closes the commission", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await waiveCycle(testDb, leadId, 1);
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.cycles[0].status).toBe("waived");
    expect(rec?.status).toBe("closed");
  });
});

describe("addNextCycle", () => {
  it("appends the next recurring cycle one cadence interval later", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, recurring, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await addNextCycle(testDb, leadId);
    expect(r.ok).toBe(true);
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.cycles).toHaveLength(2);
    expect(rec?.cycles[1]).toMatchObject({ seq: 2, dueDate: "2026-08-05", amountInr: 100_000, status: "due" });
  });
  it("refuses on a one-time commission", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const r = await addNextCycle(testDb, leadId);
    expect(r).toEqual({ ok: false, error: "Only recurring commissions have additional cycles." });
  });
});

describe("leak-defense logs", () => {
  it("appends disclosure and introduction entries", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await appendDisclosure(testDb, leadId, { at: "2026-07-06T10:00:00.000Z", contactField: "email", disclosedTo: "vendor" });
    await appendIntroduction(testDb, leadId, { at: "2026-07-06T11:00:00.000Z", channel: "email" });
    const rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.disclosureLog).toHaveLength(1);
    expect(rec?.disclosureLog[0].contactField).toBe("email");
    expect(rec?.introductionLog).toHaveLength(1);
  });
});

describe("disputes", () => {
  it("opens a dispute (status disputed) then resolves it back to the cycle-derived status", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    await activateCommission(testDb, leadId);
    const opened = await openDispute(testDb, leadId, "Vendor went direct", "2026-07-07T09:00:00.000Z");
    expect(opened.ok).toBe(true);
    let rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.status).toBe("disputed");
    expect(rec?.disputeLog[0].status).toBe("open");

    const resolved = await resolveDispute(testDb, leadId, "Paid in full", "2026-07-09T09:00:00.000Z");
    expect(resolved.ok).toBe(true);
    rec = await getCommissionForLead(testDb, leadId);
    expect(rec?.status).toBe("active"); // one due cycle remains
    expect(rec?.disputeLog[0].status).toBe("resolved");
    expect(rec?.disputeLog[0].resolution).toBe("Paid in full");
  });
  it("refuses to resolve when there is no open dispute", async () => {
    const leadId = await seedLead();
    await createCommissionTerms(testDb, leadId, flat, "2026-07-05");
    const r = await resolveDispute(testDb, leadId, "n/a", "2026-07-09T09:00:00.000Z");
    expect(r).toEqual({ ok: false, error: "No open dispute to resolve." });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/commission-data.test.ts`
Expected: FAIL — the new functions are not exported.

- [ ] **Step 3: Write the implementation (append to `src/lib/commission/data.ts`)**

Add these imports to the existing `@/lib/commission/schema` import block: `nextCycleDueDate`, `computeCycleAmountInr`, and the entry types `DisclosureEntry`, `IntroductionEntry`. Then append:

```ts
/** Mark a due/missed cycle paid at its expected amount; recompute project status. */
export async function markCyclePaid(db: DB, leadId: string, seq: number, now: string): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const state = await loadState(db, leadId);
  if (!state) return { ok: false, error: "No commission for this deal." };
  const idx = state.cycles.findIndex((c) => c.seq === seq);
  if (idx === -1) return { ok: false, error: "Cycle not found." };
  const cycle = state.cycles[idx];
  if (cycle.status !== "due" && cycle.status !== "missed") {
    return { ok: false, error: "Only a due or missed cycle can be marked paid." };
  }
  const cycles = state.cycles.map((c, i) =>
    i === idx ? { ...c, status: "paid" as const, paidAt: now, paidAmountInr: c.amountInr } : c,
  );
  await db
    .update(projects)
    .set({ commissionCycles: { cycles }, commissionStatus: deriveCommissionStatus(state.status, cycles) })
    .where(eq(projects.leadId, leadId));
  return { ok: true };
}

/** Flag a due cycle as missed (record-keeping); status stays active. */
export async function markCycleMissed(db: DB, leadId: string, seq: number): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const state = await loadState(db, leadId);
  if (!state) return { ok: false, error: "No commission for this deal." };
  const idx = state.cycles.findIndex((c) => c.seq === seq);
  if (idx === -1) return { ok: false, error: "Cycle not found." };
  if (state.cycles[idx].status !== "due") return { ok: false, error: "Only a due cycle can be marked missed." };
  const cycles = state.cycles.map((c, i) => (i === idx ? { ...c, status: "missed" as const } : c));
  await db
    .update(projects)
    .set({ commissionCycles: { cycles }, commissionStatus: deriveCommissionStatus(state.status, cycles) })
    .where(eq(projects.leadId, leadId));
  return { ok: true };
}

/** Waive a due/missed cycle — counts as settled for the close derivation. */
export async function waiveCycle(db: DB, leadId: string, seq: number): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const state = await loadState(db, leadId);
  if (!state) return { ok: false, error: "No commission for this deal." };
  const idx = state.cycles.findIndex((c) => c.seq === seq);
  if (idx === -1) return { ok: false, error: "Cycle not found." };
  const st = state.cycles[idx].status;
  if (st !== "due" && st !== "missed") return { ok: false, error: "Only a due or missed cycle can be waived." };
  const cycles = state.cycles.map((c, i) => (i === idx ? { ...c, status: "waived" as const } : c));
  await db
    .update(projects)
    .set({ commissionCycles: { cycles }, commissionStatus: deriveCommissionStatus(state.status, cycles) })
    .where(eq(projects.leadId, leadId));
  return { ok: true };
}

/** Append the next recurring cycle (due, one cadence interval after the latest). Recurring + active only. */
export async function addNextCycle(db: DB, leadId: string): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const state = await loadState(db, leadId);
  if (!state) return { ok: false, error: "No commission for this deal." };
  if (!state.terms || state.terms.type !== "recurring") {
    return { ok: false, error: "Only recurring commissions have additional cycles." };
  }
  if (state.status !== "active") return { ok: false, error: "Activate the commission first." };
  const last = state.cycles.reduce((a, b) => (b.seq > a.seq ? b : a));
  const next = {
    seq: last.seq + 1,
    dueDate: nextCycleDueDate(state.terms.cadence!, last.dueDate),
    amountInr: computeCycleAmountInr(state.terms),
    status: "due" as const,
    paidAt: null,
    paidAmountInr: null,
  };
  const cycles = [...state.cycles, next];
  await db
    .update(projects)
    .set({ commissionCycles: { cycles }, commissionStatus: deriveCommissionStatus(state.status, cycles) })
    .where(eq(projects.leadId, leadId));
  return { ok: true };
}

/** Append a disclosure entry (append-only audit trail). */
export async function appendDisclosure(db: DB, leadId: string, entry: DisclosureEntry): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const [row] = await db.select({ log: projects.disclosureLog }).from(projects).where(eq(projects.leadId, leadId)).limit(1);
  if (!row) return { ok: false, error: "No commission for this deal." };
  const parsed = disclosureLogSchema.safeParse(row.log);
  const log = parsed.success ? parsed.data : [];
  await db.update(projects).set({ disclosureLog: [...log, entry] }).where(eq(projects.leadId, leadId));
  return { ok: true };
}

/** Append an introduction entry (append-only audit trail). */
export async function appendIntroduction(db: DB, leadId: string, entry: IntroductionEntry): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const [row] = await db.select({ log: projects.introductionLog }).from(projects).where(eq(projects.leadId, leadId)).limit(1);
  if (!row) return { ok: false, error: "No commission for this deal." };
  const parsed = introductionLogSchema.safeParse(row.log);
  const log = parsed.success ? parsed.data : [];
  await db.update(projects).set({ introductionLog: [...log, entry] }).where(eq(projects.leadId, leadId));
  return { ok: true };
}

/** Open a dispute — append an open entry and set status disputed. */
export async function openDispute(db: DB, leadId: string, reason: string, at: string): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const [row] = await db.select({ log: projects.disputeLog }).from(projects).where(eq(projects.leadId, leadId)).limit(1);
  if (!row) return { ok: false, error: "No commission for this deal." };
  const parsed = disputeLogSchema.safeParse(row.log);
  const log = parsed.success ? parsed.data : [];
  const next = [...log, { openedAt: at, reason, status: "open" as const, resolvedAt: null, resolution: null }];
  await db.update(projects).set({ disputeLog: next, commissionStatus: "disputed" }).where(eq(projects.leadId, leadId));
  return { ok: true };
}

/** Resolve the latest open dispute and recompute status from the cycles. */
export async function resolveDispute(db: DB, leadId: string, resolution: string, at: string): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const state = await loadState(db, leadId);
  if (!state) return { ok: false, error: "No commission for this deal." };
  const [row] = await db.select({ log: projects.disputeLog }).from(projects).where(eq(projects.leadId, leadId)).limit(1);
  const parsed = disputeLogSchema.safeParse(row!.log);
  const log = parsed.success ? parsed.data : [];
  const idx = [...log].map((d) => d.status).lastIndexOf("open");
  if (idx === -1) return { ok: false, error: "No open dispute to resolve." };
  const nextLog = log.map((d, i) => (i === idx ? { ...d, status: "resolved" as const, resolvedAt: at, resolution } : d));
  const base: CommissionStatus = state.cycles.every((c) => c.status === "scheduled") ? "pending" : "active";
  await db
    .update(projects)
    .set({ disputeLog: nextLog, commissionStatus: deriveCommissionStatus(base, state.cycles) })
    .where(eq(projects.leadId, leadId));
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/commission-data.test.ts`
Expected: PASS (all describe blocks). Then `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/commission/data.ts tests/integration/commission-data.test.ts
git commit -m "feat(commission): data layer — cycle mutations, leak logs, disputes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Server actions

**Files:**
- Modify: `src/app/(app)/leads/actions.ts` (append commission actions + a date helper)
- Test: `tests/integration/commission-actions.test.ts`

**Interfaces:**
- Consumes: Task 3/4 data functions, Task 1 `commissionTermsSchema` + entry schemas + `isCommissionEligible`, existing `getLeadDetail`, `db`, `auth`.
- Produces (Task 6 panel consumes these): `setCommissionTermsAction`, `activateCommissionAction`, `markCyclePaidAction`, `markCycleMissedAction`, `waiveCycleAction`, `addNextCycleAction`, `appendDisclosureAction`, `appendIntroductionAction`, `openDisputeAction`, `resolveDisputeAction` — each `Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/commission-actions.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll, vi, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { leads, companies, vendorProfiles } from "@/db/schema";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { getCommissionForLead } from "@/lib/commission/data";
import {
  setCommissionTermsAction,
  activateCommissionAction,
  markCyclePaidAction,
  openDisputeAction,
} from "@/app/(app)/leads/actions";

const flatInput = { type: "one_time", basis: "flat", amountInr: 250_000 };

async function makeLead(stage: string = "won"): Promise<string> {
  const [company] = await testDb.insert(companies).values({ name: "Zephyr", normalizedName: "zephyr" }).returning();
  const [vendor] = await testDb.insert(vendorProfiles).values({ name: "Acme" }).returning();
  const [lead] = await testDb
    .insert(leads)
    .values({ companyId: company.companyId, vendorId: vendor.vendorId, pipelineStage: stage as never })
    .returning();
  return lead.leadId;
}

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  vi.clearAllMocks();
  await truncateAll(["projects", "leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("setCommissionTermsAction", () => {
  it("creates terms on a won lead and revalidates", async () => {
    const leadId = await makeLead("won");
    const r = await setCommissionTermsAction(leadId, flatInput);
    expect(r).toEqual({ ok: true });
    expect(await getCommissionForLead(testDb, leadId)).not.toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(`/leads/${leadId}`);
  });
  it("rejects an unauthenticated caller without writing", async () => {
    (auth as Mock).mockResolvedValueOnce(null);
    const leadId = await makeLead("won");
    const r = await setCommissionTermsAction(leadId, flatInput);
    expect(r.ok).toBe(false);
    expect(await getCommissionForLead(testDb, leadId)).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("rejects invalid terms", async () => {
    const leadId = await makeLead("won");
    const r = await setCommissionTermsAction(leadId, { type: "one_time", basis: "flat" });
    expect(r).toEqual({ ok: false, error: "Invalid commission terms." });
  });
  it("refuses when the lead is not in a commission-eligible stage", async () => {
    const leadId = await makeLead("contacted");
    const r = await setCommissionTermsAction(leadId, flatInput);
    expect(r).toEqual({ ok: false, error: "Set commission terms once the deal is won." });
  });
});

describe("activateCommissionAction", () => {
  it("refuses until the deal is delivered", async () => {
    const leadId = await makeLead("won");
    await setCommissionTermsAction(leadId, flatInput);
    const r = await activateCommissionAction(leadId);
    expect(r).toEqual({ ok: false, error: "Mark the deal delivered first." });
  });
  it("activates once delivered", async () => {
    const leadId = await makeLead("delivered");
    await setCommissionTermsAction(leadId, flatInput);
    const r = await activateCommissionAction(leadId);
    expect(r).toEqual({ ok: true });
    expect((await getCommissionForLead(testDb, leadId))?.status).toBe("active");
  });
});

describe("markCyclePaidAction + openDisputeAction", () => {
  it("marks the cycle paid", async () => {
    const leadId = await makeLead("delivered");
    await setCommissionTermsAction(leadId, flatInput);
    await activateCommissionAction(leadId);
    const r = await markCyclePaidAction(leadId, 1);
    expect(r).toEqual({ ok: true });
    expect((await getCommissionForLead(testDb, leadId))?.cycles[0].status).toBe("paid");
  });
  it("opens a dispute", async () => {
    const leadId = await makeLead("delivered");
    await setCommissionTermsAction(leadId, flatInput);
    await activateCommissionAction(leadId);
    const r = await openDisputeAction(leadId, "went direct");
    expect(r).toEqual({ ok: true });
    expect((await getCommissionForLead(testDb, leadId))?.status).toBe("disputed");
  });
  it("rejects an unauthenticated mark-paid", async () => {
    (auth as Mock).mockResolvedValueOnce(null);
    const r = await markCyclePaidAction("10000000-0000-4000-8000-000000000009", 1);
    expect(r.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/commission-actions.test.ts`
Expected: FAIL — commission actions not exported from `@/app/(app)/leads/actions`.

- [ ] **Step 3: Write the implementation (append to `src/app/(app)/leads/actions.ts`)**

Add these imports to the top of the file (below the existing imports):

```ts
import {
  createCommissionTerms,
  updateCommissionTerms,
  activateCommission,
  markCyclePaid,
  markCycleMissed,
  waiveCycle,
  addNextCycle,
  appendDisclosure,
  appendIntroduction,
  openDispute,
  resolveDispute,
  getCommissionForLead,
} from "@/lib/commission/data";
import {
  commissionTermsSchema,
  disclosureEntrySchema,
  introductionEntrySchema,
  isCommissionEligible,
} from "@/lib/commission/schema";
```

Then append the actions (the existing local `signedIn()` is reused — it is already defined in this file):

```ts
// Server clock — kept in the action so the pure + data layers stay clock-free.
function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function serverNow(): string {
  return new Date().toISOString();
}

export async function setCommissionTermsAction(
  leadId: string,
  termsInput: unknown,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const parsed = commissionTermsSchema.safeParse(termsInput);
  if (!parsed.success) return { ok: false, error: "Invalid commission terms." };

  const lead = await getLeadDetail(db, leadId);
  if (!lead) return { ok: false, error: "Lead not found." };
  if (!isCommissionEligible(lead.stage)) return { ok: false, error: "Set commission terms once the deal is won." };

  const existing = await getCommissionForLead(db, leadId);
  const r = existing
    ? await updateCommissionTerms(db, leadId, parsed.data, serverToday())
    : await createCommissionTerms(db, leadId, parsed.data, serverToday());
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function activateCommissionAction(leadId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const lead = await getLeadDetail(db, leadId);
  if (!lead) return { ok: false, error: "Lead not found." };
  if (lead.stage !== "delivered" && lead.stage !== "paid") return { ok: false, error: "Mark the deal delivered first." };

  const r = await activateCommission(db, leadId);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function markCyclePaidAction(leadId: string, seq: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(seq)) return { ok: false, error: "Invalid cycle." };
  const r = await markCyclePaid(db, leadId, seq, serverNow());
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function markCycleMissedAction(leadId: string, seq: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(seq)) return { ok: false, error: "Invalid cycle." };
  const r = await markCycleMissed(db, leadId, seq);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function waiveCycleAction(leadId: string, seq: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(seq)) return { ok: false, error: "Invalid cycle." };
  const r = await waiveCycle(db, leadId, seq);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function addNextCycleAction(leadId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const r = await addNextCycle(db, leadId);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function appendDisclosureAction(
  leadId: string,
  contactField: string,
  disclosedTo: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const parsed = disclosureEntrySchema.safeParse({ at: serverNow(), contactField, disclosedTo, note });
  if (!parsed.success) return { ok: false, error: "Invalid disclosure entry." };
  const r = await appendDisclosure(db, leadId, parsed.data);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function appendIntroductionAction(
  leadId: string,
  channel: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const parsed = introductionEntrySchema.safeParse({ at: serverNow(), channel, note });
  if (!parsed.success) return { ok: false, error: "Invalid introduction entry." };
  const r = await appendIntroduction(db, leadId, parsed.data);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function openDisputeAction(leadId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  if (!reason || reason.trim().length === 0) return { ok: false, error: "A dispute reason is required." };
  const r = await openDispute(db, leadId, reason.trim(), serverNow());
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function resolveDisputeAction(leadId: string, resolution: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  if (!resolution || resolution.trim().length === 0) return { ok: false, error: "A resolution note is required." };
  const r = await resolveDispute(db, leadId, resolution.trim(), serverNow());
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/commission-actions.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/leads/actions.ts" tests/integration/commission-actions.test.ts
git commit -m "feat(commission): server actions — terms, activate, cycles, logs, disputes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: UI — commission panel + page wiring + styles

**Files:**
- Create: `src/app/(app)/leads/[id]/commission-panel.tsx`
- Modify: `src/app/(app)/leads/[id]/page.tsx` (fetch commission, compute `today`, render panel)
- Modify: `src/app/styles/components.css` (append commission-panel rules)
- Test: `tests/unit/components/commission-panel.test.tsx`

**Interfaces:**
- Consumes: Task 5 actions, Task 1 schema (types, labels, `formatInr`, `isCycleOverdue`, `isCommissionEligible`), `getCommissionForLead` (page), `PipelineStage`.
- Produces: `<CommissionPanel leadId stage commission today />`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/commission-panel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/leads/actions", () => ({
  setCommissionTermsAction: vi.fn(() => Promise.resolve({ ok: true })),
  activateCommissionAction: vi.fn(() => Promise.resolve({ ok: true })),
  markCyclePaidAction: vi.fn(() => Promise.resolve({ ok: true })),
  markCycleMissedAction: vi.fn(() => Promise.resolve({ ok: true })),
  waiveCycleAction: vi.fn(() => Promise.resolve({ ok: true })),
  addNextCycleAction: vi.fn(() => Promise.resolve({ ok: true })),
  appendDisclosureAction: vi.fn(() => Promise.resolve({ ok: true })),
  appendIntroductionAction: vi.fn(() => Promise.resolve({ ok: true })),
  openDisputeAction: vi.fn(() => Promise.resolve({ ok: true })),
  resolveDisputeAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CommissionPanel } from "@/app/(app)/leads/[id]/commission-panel";
import {
  setCommissionTermsAction,
  activateCommissionAction,
  markCyclePaidAction,
} from "@/app/(app)/leads/actions";
import type { CommissionRecord } from "@/lib/commission/schema";

const ID = "10000000-0000-4000-8000-000000000001";

function record(over: Partial<CommissionRecord> = {}): CommissionRecord {
  return {
    leadId: ID,
    vendorId: "v1",
    status: "active",
    terms: { type: "one_time", basis: "flat", amountInr: 250_000 },
    cycles: [{ seq: 1, dueDate: "2026-07-01", amountInr: 250_000, status: "due", paidAt: null, paidAmountInr: null }],
    disclosureLog: [],
    introductionLog: [],
    disputeLog: [],
    ...over,
  };
}

describe("CommissionPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the set-terms form when eligible and no commission exists", () => {
    render(<CommissionPanel leadId={ID} stage="won" commission={null} today="2026-07-05" />);
    expect(screen.getByRole("button", { name: /save commission terms/i })).toBeInTheDocument();
  });

  it("shows a note (no form) when the stage is not commission-eligible", () => {
    render(<CommissionPanel leadId={ID} stage="contacted" commission={null} today="2026-07-05" />);
    expect(screen.queryByRole("button", { name: /save commission terms/i })).toBeNull();
    expect(screen.getByText(/once the deal is won/i)).toBeInTheDocument();
  });

  it("toggles conditional fields between percentage and flat basis", async () => {
    render(<CommissionPanel leadId={ID} stage="won" commission={null} today="2026-07-05" />);
    // flat is the default → amount visible, deal value hidden
    expect(screen.getByLabelText(/flat amount/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/deal value/i)).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText(/basis/i), "percentage");
    expect(screen.getByLabelText(/deal value/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/rate/i)).toBeInTheDocument();
  });

  it("submits flat terms converted to paise", async () => {
    render(<CommissionPanel leadId={ID} stage="won" commission={null} today="2026-07-05" />);
    await userEvent.type(screen.getByLabelText(/flat amount/i), "2500");
    await userEvent.click(screen.getByRole("button", { name: /save commission terms/i }));
    expect(setCommissionTermsAction).toHaveBeenCalledWith(ID, { type: "one_time", basis: "flat", amountInr: 250_000 });
  });

  it("shows the status badge and formatted terms for an existing commission", () => {
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record()} today="2026-07-05" />);
    expect(screen.getByText(/active/i)).toBeInTheDocument();
    expect(screen.getByText(/₹2,500\.00/)).toBeInTheDocument();
  });

  it("shows an Activate control for a pending commission on a delivered lead", () => {
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record({ status: "pending", cycles: [{ seq: 1, dueDate: "2026-07-01", amountInr: 250_000, status: "scheduled", paidAt: null, paidAmountInr: null }] })} today="2026-07-05" />);
    expect(screen.getByRole("button", { name: /activate commission/i })).toBeInTheDocument();
  });

  it("hides Activate when the lead is only won (not delivered)", () => {
    render(<CommissionPanel leadId={ID} stage="won" commission={record({ status: "pending" })} today="2026-07-05" />);
    expect(screen.queryByRole("button", { name: /activate commission/i })).toBeNull();
  });

  it("flags an overdue due cycle", () => {
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record({ cycles: [{ seq: 1, dueDate: "2026-06-01", amountInr: 250_000, status: "due", paidAt: null, paidAmountInr: null }] })} today="2026-07-05" />);
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });

  it("confirms before marking a cycle paid and refreshes on success", async () => {
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record()} today="2026-07-05" />);
    fireEvent.click(screen.getByRole("button", { name: /mark paid/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(markCyclePaidAction).toHaveBeenCalledWith(ID, 1));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("cancel aborts the mark-paid confirm without calling the action", () => {
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record()} today="2026-07-05" />);
    fireEvent.click(screen.getByRole("button", { name: /mark paid/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(markCyclePaidAction).not.toHaveBeenCalled();
  });

  it("shows Add next cycle only for a recurring active commission", () => {
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record({ terms: { type: "recurring", basis: "flat", amountInr: 100_000, cadence: "monthly" } })} today="2026-07-05" />);
    expect(screen.getByRole("button", { name: /add next cycle/i })).toBeInTheDocument();
    cleanup();
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record()} today="2026-07-05" />);
    expect(screen.queryByRole("button", { name: /add next cycle/i })).toBeNull();
  });

  it("surfaces an action error inline and does not refresh", async () => {
    (setCommissionTermsAction as Mock).mockResolvedValueOnce({ ok: false, error: "Invalid commission terms." });
    render(<CommissionPanel leadId={ID} stage="won" commission={null} today="2026-07-05" />);
    await userEvent.type(screen.getByLabelText(/flat amount/i), "2500");
    await userEvent.click(screen.getByRole("button", { name: /save commission terms/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid commission terms/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/commission-panel.test.tsx`
Expected: FAIL — `Cannot find module '.../commission-panel'`.

- [ ] **Step 3: Write the panel**

Create `src/app/(app)/leads/[id]/commission-panel.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PipelineStage } from "@/lib/pipeline/schema";
import {
  COMMISSION_STATUS_LABELS,
  CYCLE_STATUS_LABELS,
  formatInr,
  isCycleOverdue,
  isCommissionEligible,
  type CommissionRecord,
  type CommissionBasis,
  type CommissionType,
  type RecurringCadence,
} from "@/lib/commission/schema";
import {
  setCommissionTermsAction,
  activateCommissionAction,
  markCyclePaidAction,
  markCycleMissedAction,
  waiveCycleAction,
  addNextCycleAction,
  appendDisclosureAction,
  appendIntroductionAction,
  openDisputeAction,
  resolveDisputeAction,
} from "../actions";

type Action = () => Promise<{ ok: boolean; error?: string }>;

export function CommissionPanel({
  leadId,
  stage,
  commission,
  today,
}: {
  leadId: string;
  stage: PipelineStage;
  commission: CommissionRecord | null;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [confirmSeq, setConfirmSeq] = useState<number | null>(null);

  function run(action: Action) {
    setError(undefined);
    startTransition(async () => {
      const r = await action();
      if (r.ok) router.refresh();
      else setError(r.error ?? "Action failed.");
    });
  }

  return (
    <section className="commission-panel" aria-label="Commission">
      <header className="commission-head">
        <h2>Commission</h2>
        {commission && (
          <span className={`commission-status commission-status-${commission.status}`}>
            {COMMISSION_STATUS_LABELS[commission.status]}
          </span>
        )}
      </header>

      {!commission ? (
        isCommissionEligible(stage) ? (
          <TermsForm leadId={leadId} pending={pending} run={run} />
        ) : (
          <p className="commission-note">Set commission terms once the deal is won.</p>
        )
      ) : (
        <>
          <TermsSummary commission={commission} />

          {commission.status === "pending" && (stage === "delivered" || stage === "paid") && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pending}
              onClick={() => run(() => activateCommissionAction(leadId))}
            >
              Activate commission (deal delivered)
            </button>
          )}

          <table className="commission-cycles">
            <caption>Payment cycles</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Due</th>
                <th scope="col">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {commission.cycles.map((c) => {
                const overdue = isCycleOverdue(c, today);
                return (
                  <tr key={c.seq}>
                    <td>{c.seq}</td>
                    <td>{c.dueDate}</td>
                    <td>{formatInr(c.amountInr)}</td>
                    <td>
                      {CYCLE_STATUS_LABELS[c.status]}
                      {overdue && <span className="commission-overdue"> · Overdue</span>}
                    </td>
                    <td>
                      {(c.status === "due" || c.status === "missed") &&
                        (confirmSeq === c.seq ? (
                          <span className="commission-confirm" role="group" aria-label={`Confirm payment for cycle ${c.seq}`}>
                            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => { setConfirmSeq(null); run(() => markCyclePaidAction(leadId, c.seq)); }}>
                              Confirm
                            </button>
                            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setConfirmSeq(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="commission-cycle-actions">
                            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setConfirmSeq(c.seq)}>
                              Mark paid
                            </button>
                            {c.status === "due" && (
                              <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => markCycleMissedAction(leadId, c.seq))}>
                                Mark missed
                              </button>
                            )}
                            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => waiveCycleAction(leadId, c.seq))}>
                              Waive
                            </button>
                          </span>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {commission.terms?.type === "recurring" && commission.status === "active" && (
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => addNextCycleAction(leadId))}>
              Add next cycle
            </button>
          )}

          <LeakLogs commission={commission} leadId={leadId} pending={pending} run={run} />
        </>
      )}

      {error && (
        <p role="alert" className="commission-error">
          {error}
        </p>
      )}
    </section>
  );
}

function TermsForm({ leadId, pending, run }: { leadId: string; pending: boolean; run: (a: Action) => void }) {
  const [type, setType] = useState<CommissionType>("one_time");
  const [basis, setBasis] = useState<CommissionBasis>("flat");
  const [dealValue, setDealValue] = useState("");
  const [ratePct, setRatePct] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<RecurringCadence>("monthly");

  function submit() {
    const terms =
      basis === "percentage"
        ? {
            type,
            basis,
            dealValueInr: Math.round(Number(dealValue) * 100),
            rateBps: Math.round(Number(ratePct) * 100),
            ...(type === "recurring" ? { cadence } : {}),
          }
        : {
            type,
            basis,
            amountInr: Math.round(Number(amount) * 100),
            ...(type === "recurring" ? { cadence } : {}),
          };
    run(() => setCommissionTermsAction(leadId, terms));
  }

  return (
    <form
      className="commission-form"
      aria-label="Commission terms"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="commission-field">
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as CommissionType)}>
          <option value="one_time">One-time</option>
          <option value="recurring">Recurring</option>
        </select>
      </label>
      <label className="commission-field">
        <span>Basis</span>
        <select value={basis} onChange={(e) => setBasis(e.target.value as CommissionBasis)}>
          <option value="flat">Flat amount</option>
          <option value="percentage">Percentage of deal</option>
        </select>
      </label>
      {basis === "percentage" ? (
        <>
          <label className="commission-field">
            <span>Deal value (₹)</span>
            <input type="number" min="0" step="0.01" value={dealValue} onChange={(e) => setDealValue(e.target.value)} />
          </label>
          <label className="commission-field">
            <span>Rate (%)</span>
            <input type="number" min="0" max="100" step="0.01" value={ratePct} onChange={(e) => setRatePct(e.target.value)} />
          </label>
        </>
      ) : (
        <label className="commission-field">
          <span>Flat amount (₹)</span>
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      )}
      {type === "recurring" && (
        <label className="commission-field">
          <span>Cadence</span>
          <select value={cadence} onChange={(e) => setCadence(e.target.value as RecurringCadence)}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
        </label>
      )}
      <button type="submit" className="btn btn-sm btn-primary" disabled={pending}>
        Save commission terms
      </button>
    </form>
  );
}

function TermsSummary({ commission }: { commission: CommissionRecord }) {
  const t = commission.terms;
  if (!t) return null;
  return (
    <dl className="commission-terms">
      <div className="fact">
        <dt>Type</dt>
        <dd>{t.type === "recurring" ? `Recurring (${t.cadence})` : "One-time"}</dd>
      </div>
      <div className="fact">
        <dt>Basis</dt>
        <dd>
          {t.basis === "percentage"
            ? `${(t.rateBps! / 100).toFixed(2)}% of ${formatInr(t.dealValueInr!)}`
            : formatInr(t.amountInr!)}
        </dd>
      </div>
    </dl>
  );
}

function LeakLogs({
  commission,
  leadId,
  pending,
  run,
}: {
  commission: CommissionRecord;
  leadId: string;
  pending: boolean;
  run: (a: Action) => void;
}) {
  const [field, setField] = useState("");
  const [to, setTo] = useState("");
  const [channel, setChannel] = useState("");
  const [reason, setReason] = useState("");
  const [resolution, setResolution] = useState("");
  const hasOpenDispute = commission.disputeLog.some((d) => d.status === "open");

  return (
    <div className="commission-logs">
      <section aria-label="Disclosure log">
        <h3>Disclosures</h3>
        <ul>
          {commission.disclosureLog.map((d, i) => (
            <li key={i}>
              {d.at} — {d.contactField} → {d.disclosedTo}
            </li>
          ))}
        </ul>
        <div className="commission-log-add" role="group" aria-label="Add disclosure">
          <input aria-label="Contact field disclosed" value={field} onChange={(e) => setField(e.target.value)} placeholder="e.g. email" />
          <input aria-label="Disclosed to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. vendor" />
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending || !field || !to}
            onClick={() => { run(() => appendDisclosureAction(leadId, field, to)); setField(""); setTo(""); }}
          >
            Log disclosure
          </button>
        </div>
      </section>

      <section aria-label="Introduction log">
        <h3>Introductions</h3>
        <ul>
          {commission.introductionLog.map((d, i) => (
            <li key={i}>
              {d.at} — {d.channel}
            </li>
          ))}
        </ul>
        <div className="commission-log-add" role="group" aria-label="Add introduction">
          <input aria-label="Introduction channel" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="e.g. email" />
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending || !channel}
            onClick={() => { run(() => appendIntroductionAction(leadId, channel)); setChannel(""); }}
          >
            Log introduction
          </button>
        </div>
      </section>

      <section aria-label="Dispute log">
        <h3>Disputes</h3>
        <ul>
          {commission.disputeLog.map((d, i) => (
            <li key={i}>
              {d.openedAt} — {d.reason} ({d.status})
            </li>
          ))}
        </ul>
        {hasOpenDispute ? (
          <div className="commission-log-add" role="group" aria-label="Resolve dispute">
            <input aria-label="Resolution note" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="How it was resolved" />
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending || !resolution}
              onClick={() => { run(() => resolveDisputeAction(leadId, resolution)); setResolution(""); }}
            >
              Resolve dispute
            </button>
          </div>
        ) : (
          <div className="commission-log-add" role="group" aria-label="Open dispute">
            <input aria-label="Dispute reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why" />
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending || !reason}
              onClick={() => { run(() => openDisputeAction(leadId, reason)); setReason(""); }}
            >
              Open dispute
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Wire the page**

In `src/app/(app)/leads/[id]/page.tsx`, add imports (with the other imports):

```tsx
import { getCommissionForLead } from "@/lib/commission/data";
import { CommissionPanel } from "./commission-panel";
```

After `const lead = await getLeadDetail(db, id);` (and the `if (!lead) notFound();`), add:

```tsx
  const commission = await getCommissionForLead(db, lead.leadId);
  const today = new Date().toISOString().slice(0, 10);
```

Then, in the JSX, render the panel immediately after the `{lead.contactBlock ? ... }` block (still inside `<div className="lead-detail">`):

```tsx
        <CommissionPanel leadId={lead.leadId} stage={lead.stage} commission={commission} today={today} />
```

- [ ] **Step 5: Append styles**

Append to the bottom of `src/app/styles/components.css`:

```css
/* Commission panel */
.commission-panel {
  margin-top: 1.5rem;
  padding: 1rem;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 0.5rem;
}
.commission-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.commission-status {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  background: var(--muted-bg, #f1f5f9);
}
.commission-form,
.commission-terms {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.75rem;
}
.commission-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.875rem;
}
.commission-cycles {
  width: 100%;
  margin-top: 1rem;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.commission-cycles th,
.commission-cycles td {
  text-align: left;
  padding: 0.375rem 0.5rem;
  border-bottom: 1px solid var(--border, #e2e8f0);
}
.commission-cycle-actions,
.commission-confirm {
  display: inline-flex;
  gap: 0.375rem;
}
.commission-overdue {
  color: var(--danger, #dc2626);
  font-weight: 600;
}
.commission-logs {
  margin-top: 1rem;
  display: grid;
  gap: 1rem;
}
.commission-log-add {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.commission-note {
  margin-top: 0.75rem;
  font-size: 0.875rem;
  color: var(--muted, #64748b);
}
.commission-error {
  margin-top: 0.75rem;
  color: var(--danger, #dc2626);
  font-size: 0.875rem;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/commission-panel.test.tsx`
Expected: PASS (all cases). Then `npx tsc --noEmit` — clean, and `rm -rf .next && npm run build` — 13/13 pages (route unchanged; the panel is additive).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/leads/[id]/commission-panel.tsx" "src/app/(app)/leads/[id]/page.tsx" src/app/styles/components.css tests/unit/components/commission-panel.test.tsx
git commit -m "feat(commission): lead-detail panel — terms, cycles, leak logs, page wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** §2 locked decisions → Task 1 schema (both bases, INR paise, eligible stages) + all tasks. §5 data model → Task 2. §5.3/§5.4 Zod + pure functions → Task 1. §6 lifecycle → Tasks 3–5. §7 data layer → Tasks 3–4. §8 actions → Task 5. §9 UI → Task 6. §11 testing → every task's test file. All covered.

**Placeholder scan:** No TBD/TODO; every code step contains complete code. The generated migration filename `0013_<slug>.sql` is drizzle-kit-assigned at generation (Task 2 Step 5 lists the exact expected statements to verify).

**Type consistency:** `Result`, `loadState`, `UUID_RE`, `toRecord` defined in Task 3 and reused in Task 4 (same file). Action names in Task 5 match the panel imports in Task 6. `CommissionRecord` shape consistent across data → page → panel. `commissionCycles`/`disputeLog` TS names consistent everywhere (legacy DB names confined to `projects.ts`). `markCyclePaid(db, leadId, seq, now)` (no `paidAmountInr` param — records the cycle's expected amount) consistent between Task 4 def, Task 5 action, and Task 6 test.

**Migration note:** Task 2 avoids drizzle-kit rename prompts by keeping legacy column names — documented in Global Constraints and the Task 2 file comment.
