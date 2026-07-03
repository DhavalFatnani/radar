import { eq } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — a value import would eagerly open Postgres
import { leads } from "@/db/schema";
import type { OutreachMode } from "@/lib/leads/schema";
import type { OutreachDraft, OutreachStatus } from "@/lib/outreach/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = { ok: true } | { ok: false; error: string };

/** Set the operator's outreach posture. Caller owns the connection. */
export async function setOutreachMode(
  db: DB,
  leadId: string,
  mode: OutreachMode,
): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const result = await db
    .update(leads)
    .set({ outreachMode: mode })
    .where(eq(leads.leadId, leadId))
    .returning({ id: leads.leadId });
  if (result.length === 0) return { ok: false, error: "Lead not found." };
  return { ok: true };
}

/**
 * Persist a generated draft: sets the draft payload, moves status to "drafted",
 * and stamps the generation time. Caller owns the connection.
 */
export async function saveOutreachDraft(
  db: DB,
  leadId: string,
  draft: OutreachDraft,
): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const result = await db
    .update(leads)
    .set({
      outreachDraft: draft,
      outreachStatus: "drafted",
      outreachDraftGeneratedAt: new Date(),
    })
    .where(eq(leads.leadId, leadId))
    .returning({ id: leads.leadId });
  if (result.length === 0) return { ok: false, error: "Lead not found." };
  return { ok: true };
}

/**
 * Set the outreach status. Moving to "sent" also stamps outreachSentAt.
 * Caller owns the connection.
 */
export async function setOutreachStatus(
  db: DB,
  leadId: string,
  status: OutreachStatus,
): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  const result = await db
    .update(leads)
    .set({
      outreachStatus: status,
      ...(status === "sent" ? { outreachSentAt: new Date() } : {}),
    })
    .where(eq(leads.leadId, leadId))
    .returning({ id: leads.leadId });
  if (result.length === 0) return { ok: false, error: "Lead not found." };
  return { ok: true };
}
