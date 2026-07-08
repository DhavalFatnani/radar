import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { vendorProfiles } from "@/db/schema";
import { populateCatalogueFromProfile } from "@/lib/catalogue/data";
import {
  vendorStubSchema,
  vendorProfileSchema,
  vendorTypeSchema,
  type VendorStubInput,
  type VendorListItem,
  type VendorConstraints,
  type InterviewHistoryEntry,
  type VendorProfile,
  type VendorProfileInput,
  type VendorReadinessClass,
  type VendorTypeOption,
  type VendorListRow,
} from "./schema";

// Re-export the pure schema + types so existing importers of "@/lib/vendors/data" keep working.
export { vendorStubSchema, vendorProfileSchema, vendorTypeSchema };
export type {
  VendorStubInput,
  VendorListItem,
  VendorConstraints,
  InterviewHistoryEntry,
  VendorProfile,
  VendorProfileInput,
  VendorReadinessClass,
  VendorTypeOption,
  VendorListRow,
};

// Insert a minimal vendor stub. Input is already validated by the caller.
export async function createVendorStub(input: VendorStubInput): Promise<VendorListItem> {
  const [row] = await db
    .insert(vendorProfiles)
    .values({ name: input.name })
    .returning({ vendorId: vendorProfiles.vendorId, name: vendorProfiles.name });
  return row;
}

// List vendors for display / the read API. Explicit columns + LIMIT (no SELECT *).
export async function listVendors(): Promise<VendorListItem[]> {
  return db
    .select({ vendorId: vendorProfiles.vendorId, name: vendorProfiles.name })
    .from(vendorProfiles)
    .orderBy(asc(vendorProfiles.name))
    .limit(100);
}

// jsonb { text } <-> plain string helpers.
function unwrapText(value: unknown): string | null {
  if (value && typeof value === "object" && "text" in value) {
    const t = (value as { text?: unknown }).text;
    return typeof t === "string" && t.length > 0 ? t : null;
  }
  return null;
}

type NormalizedProfile = {
  name: string;
  capabilities: string[];
  constraints: VendorConstraints | null;
  idealCustomer: string | null;
  knownGoodSignals: string | null;
  differentiators: string | null;
  credibility: string | null;
};

function normalizeConstraints(c: VendorProfileInput["constraints"]): VendorConstraints | null {
  const out: VendorConstraints = {};
  if (c.minProjectSize) out.minProjectSize = c.minProjectSize;
  if (c.maxProjectSize) out.maxProjectSize = c.maxProjectSize;
  if (c.geographies && c.geographies.length) out.geographies = c.geographies;
  if (c.capacity) out.capacity = c.capacity;
  if (c.currentLoad) out.currentLoad = c.currentLoad;
  if (c.workingCapitalLimit) out.workingCapitalLimit = c.workingCapitalLimit;
  if (c.leadTimes) out.leadTimes = c.leadTimes;
  return Object.keys(out).length ? out : null;
}

function normalizeProfile(input: VendorProfileInput): NormalizedProfile {
  return {
    name: input.name,
    capabilities: input.capabilities,
    constraints: normalizeConstraints(input.constraints),
    idealCustomer: input.idealCustomer ?? null,
    knownGoodSignals: input.knownGoodSignals ?? null,
    differentiators: input.differentiators ?? null,
    credibility: input.credibility ?? null,
  };
}

function comparable(p: NormalizedProfile | VendorProfile) {
  return {
    name: p.name,
    capabilities: p.capabilities,
    constraints: p.constraints,
    idealCustomer: p.idealCustomer,
    knownGoodSignals: p.knownGoodSignals,
    differentiators: p.differentiators,
    credibility: p.credibility,
  };
}

function changedFields(current: VendorProfile, next: NormalizedProfile): string[] {
  const a = comparable(current);
  const b = comparable(next);
  return (Object.keys(a) as (keyof typeof a)[]).filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
}

export async function getVendor(vendorId: string): Promise<VendorProfile | null> {
  const [row] = await db
    .select({
      vendorId: vendorProfiles.vendorId,
      name: vendorProfiles.name,
      vendorType: vendorProfiles.vendorType,
      capabilities: vendorProfiles.capabilities,
      constraints: vendorProfiles.constraints,
      idealCustomer: vendorProfiles.idealCustomer,
      knownGoodSignals: vendorProfiles.knownGoodSignals,
      differentiators: vendorProfiles.differentiators,
      credibility: vendorProfiles.credibility,
      version: vendorProfiles.version,
      interviewHistory: vendorProfiles.interviewHistory,
    })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.vendorId, vendorId))
    .limit(1);
  if (!row) return null;
  return {
    vendorId: row.vendorId,
    name: row.name,
    vendorType: row.vendorType ?? null,
    capabilities: row.capabilities ?? [],
    constraints: (row.constraints as VendorConstraints | null) ?? null,
    idealCustomer: unwrapText(row.idealCustomer),
    knownGoodSignals: row.knownGoodSignals ?? null,
    differentiators: row.differentiators ?? null,
    credibility: unwrapText(row.credibility),
    version: row.version,
    interviewHistory: (row.interviewHistory as InterviewHistoryEntry[] | null) ?? [],
  };
}

export async function updateVendorProfile(
  vendorId: string,
  input: VendorProfileInput,
  source: { kind: "manual_edit" | "interview"; interviewId?: string } = { kind: "manual_edit" },
): Promise<VendorProfile> {
  const current = await getVendor(vendorId);
  if (!current) throw new Error("Vendor not found");

  const next = normalizeProfile(input);
  const changed = changedFields(current, next);
  if (changed.length === 0) return current; // no-op: no version bump, no write

  const newVersion = current.version + 1;
  const history: InterviewHistoryEntry[] = [
    ...current.interviewHistory,
    {
      at: new Date().toISOString(),
      actor: "operator",
      kind: source.kind,
      changed,
      version: newVersion,
      ...(source.interviewId ? { interviewId: source.interviewId } : {}),
    },
  ];

  await db
    .update(vendorProfiles)
    .set({
      name: next.name,
      capabilities: next.capabilities,
      constraints: next.constraints,
      idealCustomer: next.idealCustomer ? { text: next.idealCustomer } : null,
      knownGoodSignals: next.knownGoodSignals,
      differentiators: next.differentiators,
      credibility: next.credibility ? { text: next.credibility } : null,
      version: newVersion,
      interviewHistory: history,
    })
    .where(eq(vendorProfiles.vendorId, vendorId));

  const updated = await getVendor(vendorId);
  if (!updated) throw new Error("Vendor not found");
  await populateCatalogueFromProfile(vendorId);
  return updated;
}
