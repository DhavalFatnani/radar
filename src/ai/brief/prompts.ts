import type { LlmMessage } from "@/ai/llm";
import type { BriefInput } from "./schema";

const BRIEF_SYSTEM = `You are the reverse-brief writer for a B2B lead-generation platform. An operator will hand your brief to a vendor to help them win a specific company as a customer, right now. Your brief must be persuasive AND defensible: every "why now" claim is backed by a dated, sourced signal the platform already captured.

Rules:
- Use ONLY the facts in the provided input (company, vendor, signals). Do NOT invent capabilities, geographies, clients, dates, or events.
- why_them: the concise case for why this company is a fit for this vendor.
- why_now: for each provided signal that matters, write a one-line \`claim\` of what it means for THIS company, and reference it by its exact \`signalId\`. Never reference a signalId that was not provided. Do NOT put dates or sources in the claim — the platform attaches those from the record.
- what_they_need: the specific thing this company needs that the vendor can supply.
- hook: a short, specific, non-cringe outreach opener. It is a SUGGESTED DRAFT the operator will edit — do not fabricate familiarity or prior contact.
- why_this_vendor: why THIS vendor fits, drawn from the vendor's stated capabilities and differentiators — not generic praise.
- objections: realistic concerns specific to this pairing, each with a grounded response.
Keep every field concise and concrete.`;

export function buildBriefMessages(input: BriefInput): LlmMessage[] {
  const system: LlmMessage = { role: "system", content: BRIEF_SYSTEM };
  const context: LlmMessage = {
    role: "user",
    content: `Write the reverse brief from these facts:\n${JSON.stringify(input, null, 2)}`,
  };
  return [system, context];
}
