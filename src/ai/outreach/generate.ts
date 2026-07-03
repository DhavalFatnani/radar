import { generateObject, type LlmResult } from "@/ai/llm";
import { outreachDraftSchema, type OutreachInput, type OutreachDraft } from "./schema";
import { buildOutreachMessages } from "./prompts";

export async function generateOutreach(
  input: OutreachInput,
): Promise<LlmResult<OutreachDraft>> {
  const messages = buildOutreachMessages(input);
  return generateObject(outreachDraftSchema, messages);
}
