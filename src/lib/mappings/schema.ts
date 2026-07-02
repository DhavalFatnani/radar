import { z } from "zod";
import { LIFECYCLE_STATUSES, canTransition } from "@/lib/signals/schema";
import type { LifecycleStatus } from "@/lib/signals/schema";

// Re-export the shared governance primitives so mappings consumers import from one module.
export { LIFECYCLE_STATUSES, canTransition };
export type { LifecycleStatus };

const SIGNAL_ID = /^SIG-[A-Z0-9-]{3,}$/;

// Read shape returned by the data layer for display (track_record omitted — computed).
export type MappingDefinition = {
  mappingId: string;
  name: string;
  intentDescription: string | null;
  servesVendorType: string | null;
  requiredSignals: string[] | null;
  supportingSignals: string[] | null;
  thresholdRule: string | null;
  timingWindowDays: number | null;
  strengthLogic: string | null;
  disqualifiers: string[] | null;
  status: LifecycleStatus;
  origin: string | null;
};

// A resolved signal reference for the readiness panel (status: null ⇒ the ID no longer resolves).
export type SignalRef = { signalId: string; name: string | null; status: LifecycleStatus | null };

// newline/comma-separated string (or array) -> clean string[]
const stringList = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(/[\n,]/)))
  .transform((a) => a.map((s) => s.trim()).filter(Boolean));

export const createMappingSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  requiredSignals: z
    .array(z.string().trim().regex(SIGNAL_ID, "Bad signal ID."))
    .min(1, "Select at least one required signal."),
  supportingSignals: z.array(z.string().trim().regex(SIGNAL_ID, "Bad signal ID.")).optional(),
  intentDescription: z.string().trim().max(4000).optional().transform((v) => (v && v.length ? v : undefined)),
  servesVendorType: z.string().trim().max(200).optional().transform((v) => (v && v.length ? v : undefined)),
  thresholdRule: z.string().trim().max(2000).optional().transform((v) => (v && v.length ? v : undefined)),
  timingWindowDays: z.coerce.number().int().min(0).max(3650).optional(),
  strengthLogic: z.string().trim().max(2000).optional().transform((v) => (v && v.length ? v : undefined)),
  disqualifiers: stringList.optional(),
});
export type CreateMappingInput = z.infer<typeof createMappingSchema>;
