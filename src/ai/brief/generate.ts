import { generateObject, type LlmResult } from "@/ai/llm";
import { leadBriefDraftSchema, type BriefInput, type LeadBriefDraft } from "./schema";
import { buildBriefMessages } from "./prompts";

export async function generateBrief(
  input: BriefInput,
): Promise<LlmResult<LeadBriefDraft>> {
  const messages = buildBriefMessages(input);
  return generateObject(leadBriefDraftSchema, messages);
}
