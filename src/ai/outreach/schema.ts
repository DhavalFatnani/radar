import { z } from "zod";

// ── Input the generator receives (assembled by the action layer; DB-free here) ──

export type OutreachInput = {
  company: { name: string; description: string | null };
  vendor: { name: string; vendorType: string | null };
  intent: string | null;
  mode: "operator_handles" | "handed_to_vendor";
  brief: {
    why_them: string;
    what_they_need: string;
    hook: string;
    why_this_vendor: string;
  };
};

// ── What the LLM produces (validated by generateObject) ──
// The AI module keeps its OWN draft schema (mirrors src/ai/brief owning
// leadBriefDraftSchema) so the one-directional src/lib -> src/ai (type-only)
// dependency is never inverted. Structurally identical to the pure module's
// outreachDraftSchema; the inferred type is mutually assignable to OutreachDraft.
export const outreachDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

export type OutreachDraft = z.infer<typeof outreachDraftSchema>;
