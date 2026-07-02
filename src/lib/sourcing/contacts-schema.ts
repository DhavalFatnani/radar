import { z } from "zod";

/** One contact path (email / phone / linkedin / ...). val null = "not found / needs enrichment". */
export const contactPathSchema = z.object({
  type: z.string().min(1),
  val: z.string().nullable(),
  conf: z.string().nullable(),   // resolver confidence label, e.g. "high" / "verified"
  source: z.string().nullable(), // provenance: where the resolver got this path
});
export type ContactPath = z.infer<typeof contactPathSchema>;

/** Warm-intro status for a decision-maker. */
export const warmPathSchema = z.object({
  status: z.enum(["warm", "cold"]),
  detail: z.string().nullable(),
});
export type WarmPath = z.infer<typeof warmPathSchema>;

/** One decision-maker. Field names match mockups/leads.html contactBlock(). */
export const decisionMakerSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  why: z.string(),
  paths: z.array(contactPathSchema),
  warm: warmPathSchema,
});
export type DecisionMaker = z.infer<typeof decisionMakerSchema>;

/** Persisted shape of leads.contact_block. */
export const contactBlockSchema = z.object({
  decision_makers: z.array(decisionMakerSchema),
  status: z.enum(["pending_enrichment", "resolved"]),
  resolvedBy: z.string().min(1),
  resolvedAt: z.string(),
});
export type ContactBlock = z.infer<typeof contactBlockSchema>;

/**
 * Context a resolver needs to find the right people for a lead: the company to
 * search, and the vendor + intent that say which roles are the decision-makers.
 */
export type ContactResolutionInput = {
  company: { name: string; description: string | null };
  vendor: { name: string; vendorType: string | null };
  intent: string | null;
};

/** The extensibility seam every contact resolver implements (mirrors SourceAdapter). */
export interface ContactResolver {
  readonly sourceName: string;
  resolve(input: ContactResolutionInput): Promise<{ decisionMakers: DecisionMaker[] }>;
}

/**
 * PURE assembler of the persisted contact_block. Never synthesizes a person: an
 * empty decisionMakers array becomes status "pending_enrichment"; a non-empty one
 * becomes "resolved". decision_makers is the resolver output verbatim; only status,
 * resolvedBy, and resolvedAt are added here.
 */
export function buildContactBlock(
  decisionMakers: DecisionMaker[],
  resolvedBy: string,
  now: Date,
): ContactBlock {
  return {
    decision_makers: decisionMakers,
    status: decisionMakers.length > 0 ? "resolved" : "pending_enrichment",
    resolvedBy,
    resolvedAt: now.toISOString(),
  };
}
