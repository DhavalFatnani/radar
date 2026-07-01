import { z } from "zod";

// Enum unions — mirror src/db/schema/enums.ts exactly.
export const LIFECYCLE_STATUSES = ["proposed", "approved", "retired"] as const;
export const SIGNAL_FAMILIES = ["hiring", "procurement", "money", "expansion", "leadership", "digital"] as const;
export const DETECTION_METHODS = ["structured_query", "api_field", "keyword_match", "ai_classification", "combination"] as const;
export const SIGNAL_STRENGTHS = ["low", "medium", "high", "very_high"] as const;
export const FALSE_POSITIVE_RISKS = ["low", "medium", "high"] as const;
export const SIGNAL_POLARITIES = ["positive", "negative", "contextual"] as const;
export const ENTITY_TYPES = ["business", "individual", "both"] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];
export type SignalFamily = (typeof SIGNAL_FAMILIES)[number];
export type DetectionMethod = (typeof DETECTION_METHODS)[number];
export type SignalStrength = (typeof SIGNAL_STRENGTHS)[number];
export type FalsePositiveRisk = (typeof FALSE_POSITIVE_RISKS)[number];
export type SignalPolarity = (typeof SIGNAL_POLARITIES)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];

// Read shape returned by the data layer for display.
export type SignalDefinition = {
  signalId: string;
  name: string;
  family: SignalFamily;
  description: string | null;
  sources: string[] | null;
  detectionMethod: DetectionMethod | null;
  triggerRule: string | null;
  strength: SignalStrength | null;
  falsePositiveRisk: FalsePositiveRisk | null;
  freshnessWindowDays: number | null;
  polarity: SignalPolarity | null;
  entityType: EntityType | null;
  example: string | null;
  status: LifecycleStatus;
  origin: string | null;
  proposedBy: string | null;
  dateAdded: string | null;
  lastReviewed: string | null;
};

// newline/comma-separated string (or array) -> clean string[]
const stringList = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(/[\n,]/)))
  .transform((a) => a.map((s) => s.trim()).filter(Boolean));

export const createSignalSchema = z.object({
  signalId: z.string().trim().regex(/^SIG-[A-Z0-9-]{3,}$/, "ID must look like SIG-HIRING-OPS-SURGE."),
  name: z.string().trim().min(1, "Name is required.").max(200),
  family: z.enum(SIGNAL_FAMILIES),
  strength: z.enum(SIGNAL_STRENGTHS),
  falsePositiveRisk: z.enum(FALSE_POSITIVE_RISKS),
  description: z.string().trim().max(2000).optional().transform((v) => (v && v.length ? v : undefined)),
  sources: stringList.optional(),
  detectionMethod: z.enum(DETECTION_METHODS).optional(),
  triggerRule: z.string().trim().max(2000).optional().transform((v) => (v && v.length ? v : undefined)),
  polarity: z.enum(SIGNAL_POLARITIES).optional(),
  entityType: z.enum(ENTITY_TYPES).optional(),
  freshnessWindowDays: z.coerce.number().int().min(0).max(3650).optional(),
  example: z.string().trim().max(2000).optional().transform((v) => (v && v.length ? v : undefined)),
});
export type CreateSignalInput = z.infer<typeof createSignalSchema>;

// The governance gate — the only allowed status moves (design §D5).
const ALLOWED: Record<LifecycleStatus, LifecycleStatus[]> = {
  proposed: ["approved", "retired"],
  approved: ["retired"],
  retired: ["approved"],
};
export function canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}
