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
