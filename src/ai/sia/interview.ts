import { generateText, type LlmMessage } from "@/ai/llm";
import { assessCoverage, appendAreaTag, AREA_ORDER } from "./coverage";
import { buildQuestionMessages } from "./prompts";
import type { InterviewState, NextQuestion } from "./types";

export async function nextQuestion(state: InterviewState): Promise<NextQuestion> {
  const coverage = assessCoverage(state);
  // Drill the first still-thin area; if all are covered, do a closing probe on
  // the last area.
  const targetArea = coverage.remaining[0] ?? AREA_ORDER[AREA_ORDER.length - 1];

  const messages = buildQuestionMessages(state, targetArea);
  const { value } = await generateText(messages);
  const question = value.trim();

  const transcriptEntry: LlmMessage = {
    role: "assistant",
    content: appendAreaTag(question, targetArea),
  };

  return { question, transcriptEntry, targetArea, coverage };
}
