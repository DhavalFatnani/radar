import type { LlmMessage } from "@/ai/llm";
import type { VendorProfile } from "@/lib/vendors/schema";
import { stripAreaTag } from "./coverage";
import type { InterviewArea, InterviewState } from "./types";

const SYSTEM_BASE = `You are SIA, the Supplier Intelligence Agent for a B2B lead-generation platform. An operator is sitting with a vendor and relays your questions to them. Your job is to build a PRECISE profile of what this vendor does, so the platform can find them high-quality leads.

Vendors describe themselves vaguely by default. Your single most important behaviour is to push vague answers toward precision. If a vendor says "we do warehouse setups", probe for specifics: what exactly, to what scale, in which regions, with what constraints. If they say "we serve all of India", ask whether that is supply everywhere, or installation only in some regions.

Ask ONE focused question at a time. Keep it short and conversational — the operator will read it aloud. Do not summarise, lecture, or ask several things at once.`;

const OPENER = `This is the very start of the interview. Open broadly and warmly: in one sentence, ask the vendor to describe, in their own words, what their company does.`;

const AREA_FOCUS: Record<InterviewArea, string> = {
  capabilities:
    "Focus on CAPABILITIES: the specific services or products they deliver, to what scale, with what equipment, materials, or skills. Push for granularity (e.g. 'racking up to 5 tonnes', not 'storage solutions').",
  constraints:
    "Focus on CONSTRAINTS: what they will NOT do, minimum and maximum project size, the geographies they actually serve (supply vs install), capacity / current load, working-capital limits, and typical lead times.",
  idealCustomer:
    "Focus on their IDEAL CUSTOMER: the kind of company they serve best — industry, size, situation. If they are unsure, help them describe their best past customers.",
  knownGoodSignals:
    "Focus on BUYING SIGNALS: ask what real-world events tell them a company is about to need them ('when a company does X, that's when they need us'). Draw out concrete, observable triggers.",
  differentiators:
    "Focus on DIFFERENTIATORS and PROOF: what sets them apart from competitors, plus case studies, numbers, or named clients that prove it.",
};

const EXTRACTION_SYSTEM = `You are SIA, extracting a structured vendor profile from an interview transcript. Read the whole conversation and fill in the profile fields as precisely as the transcript supports.

Rules:
- Use ONLY information stated in the transcript or already on file. Do not invent capabilities, geographies, or clients.
- capabilities: a granular list of what the vendor can do.
- constraints: only the sub-fields the transcript supports (minProjectSize, maxProjectSize, geographies, capacity, currentLoad, workingCapitalLimit, leadTimes); leave the rest empty.
- idealCustomer, knownGoodSignals, differentiators, credibility: concise prose drawn from the transcript.
- If a field was not discussed but a value is already on file, keep the on-file value. If neither, leave it empty.`;

function hasProfileContent(p: VendorProfile): boolean {
  return (
    p.capabilities.length > 0 ||
    Boolean(p.idealCustomer) ||
    Boolean(p.knownGoodSignals) ||
    Boolean(p.differentiators) ||
    Boolean(p.credibility) ||
    (p.constraints != null && Object.keys(p.constraints).length > 0)
  );
}

function profileContext(p: VendorProfile): string {
  return JSON.stringify(
    {
      capabilities: p.capabilities,
      constraints: p.constraints,
      idealCustomer: p.idealCustomer,
      knownGoodSignals: p.knownGoodSignals,
      differentiators: p.differentiators,
      credibility: p.credibility,
    },
    null,
    2,
  );
}

// Remove engine-written [area:X] tags from assistant turns so the model never
// sees them. User turns pass through unchanged.
function withoutTags(messages: LlmMessage[]): LlmMessage[] {
  return messages.map((m) =>
    m.role === "assistant" ? { ...m, content: stripAreaTag(m.content) } : m,
  );
}

export function buildQuestionMessages(
  state: InterviewState,
  targetArea: InterviewArea,
): LlmMessage[] {
  const parts = [SYSTEM_BASE];
  if (state.existingProfile && hasProfileContent(state.existingProfile)) {
    parts.push(
      `Here is what is already on file for this vendor:\n${profileContext(state.existingProfile)}\nAsk only about what is new, unclear, or has changed.`,
    );
  }
  parts.push(state.messages.length === 0 ? OPENER : AREA_FOCUS[targetArea]);

  const system: LlmMessage = { role: "system", content: parts.join("\n\n") };
  return [system, ...withoutTags(state.messages)];
}

export function buildExtractionMessages(state: InterviewState): LlmMessage[] {
  const parts = [EXTRACTION_SYSTEM];
  if (state.existingProfile) {
    parts.push(`The vendor's name is "${state.existingProfile.name}". Use it exactly as the name field.`);
    if (hasProfileContent(state.existingProfile)) {
      parts.push(
        `Currently on file (preserve any field the transcript does not change):\n${profileContext(state.existingProfile)}`,
      );
    }
  }
  const system: LlmMessage = { role: "system", content: parts.join("\n\n") };
  const instruction: LlmMessage = {
    role: "user",
    content: "Now produce the structured vendor profile from this conversation.",
  };
  return [system, ...withoutTags(state.messages), instruction];
}
