import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { mappings, signalDefinitions } from "@/db/schema";
import type { MappingDefinition, SignalRef, CreateMappingInput, LifecycleStatus } from "@/lib/mappings/schema";
import { canTransition } from "@/lib/mappings/schema";

// Explicit column map — always use this to return the MappingDefinition shape (track_record omitted).
const COLUMNS = {
  mappingId: mappings.mappingId,
  name: mappings.name,
  intentDescription: mappings.intentDescription,
  servesVendorType: mappings.servesVendorType,
  requiredSignals: mappings.requiredSignals,
  supportingSignals: mappings.supportingSignals,
  thresholdRule: mappings.thresholdRule,
  timingWindowDays: mappings.timingWindowDays,
  strengthLogic: mappings.strengthLogic,
  disqualifiers: mappings.disqualifiers,
  status: mappings.status,
  origin: mappings.origin,
} as const;

// Status sort rank: proposed=0, approved=1, retired=2
const STATUS_RANK: Record<LifecycleStatus, number> = { proposed: 0, approved: 1, retired: 2 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listMappings(filter?: { status?: LifecycleStatus }): Promise<MappingDefinition[]> {
  const conditions = [];
  if (filter?.status) conditions.push(eq(mappings.status, filter.status));

  const rows = await db
    .select(COLUMNS)
    .from(mappings)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(500);

  rows.sort((a, b) => {
    const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  });

  return rows as MappingDefinition[];
}

export async function getMapping(mappingId: string): Promise<MappingDefinition | null> {
  if (!UUID_RE.test(mappingId)) return null; // avoid a 500 on a malformed detail URL
  const [row] = await db.select(COLUMNS).from(mappings).where(eq(mappings.mappingId, mappingId)).limit(1);
  return (row as MappingDefinition) ?? null;
}

export async function resolveSignalRefs(ids: string[]): Promise<SignalRef[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db
    .select({ signalId: signalDefinitions.signalId, name: signalDefinitions.name, status: signalDefinitions.status })
    .from(signalDefinitions)
    .where(inArray(signalDefinitions.signalId, unique));
  const byId = new Map(rows.map((r) => [r.signalId, r]));
  return unique.map((id) => {
    const row = byId.get(id);
    return row
      ? { signalId: id, name: row.name, status: row.status }
      : { signalId: id, name: null, status: null };
  });
}

export async function createMapping(
  input: CreateMappingInput,
): Promise<{ ok: true; mapping: MappingDefinition } | { ok: false; error: string }> {
  const refs = [...new Set([...(input.requiredSignals ?? []), ...(input.supportingSignals ?? [])])];
  const resolved = await resolveSignalRefs(refs);
  const missing = resolved.filter((r) => r.status === null).map((r) => r.signalId);
  if (missing.length > 0) {
    return { ok: false, error: `Unknown signal IDs: ${missing.join(", ")}` };
  }

  const rows = await db
    .insert(mappings)
    .values({
      name: input.name,
      intentDescription: input.intentDescription,
      servesVendorType: input.servesVendorType,
      requiredSignals: input.requiredSignals,
      supportingSignals: input.supportingSignals ?? [],
      thresholdRule: input.thresholdRule,
      timingWindowDays: input.timingWindowDays,
      strengthLogic: input.strengthLogic,
      disqualifiers: input.disqualifiers ?? [],
      status: "proposed",
      origin: "operator",
    })
    .returning(COLUMNS);

  return { ok: true, mapping: rows[0] as MappingDefinition };
}

export async function setMappingStatus(
  mappingId: string,
  to: LifecycleStatus,
): Promise<{ ok: true; mapping: MappingDefinition } | { ok: false; error: string }> {
  if (!UUID_RE.test(mappingId)) return { ok: false, error: "Mapping not found." };

  const [current] = await db
    .select({ status: mappings.status, requiredSignals: mappings.requiredSignals })
    .from(mappings)
    .where(eq(mappings.mappingId, mappingId))
    .limit(1);

  if (!current) return { ok: false, error: "Mapping not found." };

  if (!canTransition(current.status, to)) {
    return { ok: false, error: `Cannot move a ${current.status} mapping to ${to}.` };
  }

  // Validation gate: a mapping cannot go live unless its required signals are all live.
  if (to === "approved") {
    const required = current.requiredSignals ?? [];
    const refs = await resolveSignalRefs(required);
    const notApproved = refs.filter((r) => r.status !== "approved").map((r) => r.signalId);
    if (notApproved.length > 0) {
      return { ok: false, error: `Cannot approve: these required signals are not approved: ${notApproved.join(", ")}` };
    }
  }

  const rows = await db.update(mappings).set({ status: to }).where(eq(mappings.mappingId, mappingId)).returning(COLUMNS);
  return { ok: true, mapping: rows[0] as MappingDefinition };
}
