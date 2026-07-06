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
  nextCycleDueDate,
  computeCycleAmountInr,
  type CommissionRecord,
  type CommissionStatus,
  type CommissionTerms,
  type CommissionCycle,
  type DisclosureEntry,
  type IntroductionEntry,
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
