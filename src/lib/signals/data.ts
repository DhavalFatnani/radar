import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { signalDefinitions } from "@/db/schema";
import type { SignalDefinition, CreateSignalInput, LifecycleStatus, SignalFamily } from "@/lib/signals/schema";
import { canTransition } from "@/lib/signals/schema";

// Explicit column map — always use this to return the SignalDefinition shape.
const COLUMNS = {
  signalId: signalDefinitions.signalId,
  name: signalDefinitions.name,
  family: signalDefinitions.family,
  description: signalDefinitions.description,
  sources: signalDefinitions.sources,
  detectionMethod: signalDefinitions.detectionMethod,
  triggerRule: signalDefinitions.triggerRule,
  strength: signalDefinitions.strength,
  falsePositiveRisk: signalDefinitions.falsePositiveRisk,
  freshnessWindowDays: signalDefinitions.freshnessWindowDays,
  polarity: signalDefinitions.polarity,
  entityType: signalDefinitions.entityType,
  example: signalDefinitions.example,
  status: signalDefinitions.status,
  origin: signalDefinitions.origin,
  proposedBy: signalDefinitions.proposedBy,
  dateAdded: signalDefinitions.dateAdded,
  lastReviewed: signalDefinitions.lastReviewed,
} as const;

// Status sort rank: proposed=0, approved=1, retired=2
const STATUS_RANK: Record<LifecycleStatus, number> = {
  proposed: 0,
  approved: 1,
  retired: 2,
};

export async function listSignals(filter?: {
  status?: LifecycleStatus;
  family?: SignalFamily;
}): Promise<SignalDefinition[]> {
  const conditions = [];
  if (filter?.status) conditions.push(eq(signalDefinitions.status, filter.status));
  if (filter?.family) conditions.push(eq(signalDefinitions.family, filter.family));

  const rows = await db
    .select(COLUMNS)
    .from(signalDefinitions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(500);

  // Sort: proposed → approved → retired, then by name within each group.
  rows.sort((a, b) => {
    const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  });

  return rows as SignalDefinition[];
}

export async function getSignal(signalId: string): Promise<SignalDefinition | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(signalDefinitions)
    .where(eq(signalDefinitions.signalId, signalId))
    .limit(1);
  return (row as SignalDefinition) ?? null;
}

export async function createSignal(
  input: CreateSignalInput,
): Promise<{ ok: true; signal: SignalDefinition } | { ok: false; error: string }> {
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .insert(signalDefinitions)
    .values({
      ...input,
      status: "proposed",
      origin: "operator",
      proposedBy: "operator",
      dateAdded: today,
    })
    .onConflictDoNothing()
    .returning(COLUMNS);

  if (rows.length === 0) {
    return { ok: false, error: "A signal with that ID already exists." };
  }

  return { ok: true, signal: rows[0] as SignalDefinition };
}

export async function setSignalStatus(
  signalId: string,
  to: LifecycleStatus,
): Promise<{ ok: true; signal: SignalDefinition } | { ok: false; error: string }> {
  const [current] = await db
    .select({ status: signalDefinitions.status })
    .from(signalDefinitions)
    .where(eq(signalDefinitions.signalId, signalId))
    .limit(1);

  if (!current) {
    return { ok: false, error: "Signal not found." };
  }

  if (!canTransition(current.status, to)) {
    return { ok: false, error: `Cannot move a ${current.status} signal to ${to}.` };
  }

  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .update(signalDefinitions)
    .set({ status: to, lastReviewed: today })
    .where(eq(signalDefinitions.signalId, signalId))
    .returning(COLUMNS);

  return { ok: true, signal: rows[0] as SignalDefinition };
}
