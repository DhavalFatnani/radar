// Pure outreach-status domain model. Mirrors the outreach_status enum in
// src/db/schema/enums.ts. No imports from @/db, @/ai, or server-only — safe to
// import from client components and tests. Mirrors the pipeline schema precedent.
import { z } from "zod";

// Enum union — mirror src/db/schema/enums.ts outreachStatus EXACTLY, same order.
export const OUTREACH_STATUSES = ["pending", "drafted", "sent"] as const;

export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

// Human-readable labels for display.
export const OUTREACH_STATUS_LABELS: Record<OutreachStatus, string> = {
  pending: "Not started",
  drafted: "Draft ready",
  sent: "Sent",
};

// The current draft persisted to leads.outreach_draft and produced by the LLM.
export type OutreachDraft = {
  subject: string;
  body: string;
};

// Read-validator for the persisted draft: both fields must be non-empty. Kept
// structurally identical to src/ai/outreach/schema.ts's outreachDraftSchema (the
// one-directional src/lib -> src/ai type-only dependency is never inverted).
export const outreachDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

// Legal forward moves. A draft can be marked sent; a sent lead is terminal.
// "pending -> sent" is allowed (operator sent manually without generating here).
const ALLOWED: Record<OutreachStatus, OutreachStatus[]> = {
  pending: ["drafted", "sent"],
  drafted: ["sent"],
  sent: [],
};

export function nextStatuses(status: OutreachStatus): OutreachStatus[] {
  return ALLOWED[status] ?? [];
}

export function canMarkSent(status: OutreachStatus): boolean {
  return nextStatuses(status).includes("sent");
}
