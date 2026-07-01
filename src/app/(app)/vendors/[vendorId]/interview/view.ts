import type { LlmMessage } from "@/ai/llm";
import { assessCoverage, stripAreaTag } from "@/ai/sia";
import type { VendorProfile } from "@/lib/vendors/schema";
import type { DisplayTurn, TurnResult } from "./types";

// Map the stored transcript to display turns: drop the system message,
// strip [area:X] tags from assistant turns.
export function toDisplayTurns(messages: LlmMessage[]): DisplayTurn[] {
  return messages
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => ({
      role: m.role === "assistant" ? "sia" : "vendor",
      text: m.role === "assistant" ? stripAreaTag(m.content) : m.content,
    }));
}

// The pending question is the last assistant turn awaiting an answer; "" when
// the transcript is empty or ends with a vendor answer.
export function pendingQuestionFrom(messages: LlmMessage[]): string {
  const last = messages[messages.length - 1];
  return last && last.role === "assistant" ? stripAreaTag(last.content) : "";
}

export function turnView(interviewId: string, messages: LlmMessage[], vendor: VendorProfile): TurnResult {
  const coverage = assessCoverage({ messages, existingProfile: vendor });
  return {
    ok: true,
    interviewId,
    transcript: toDisplayTurns(messages),
    pendingQuestion: pendingQuestionFrom(messages),
    coverage,
    isComplete: coverage.isComplete,
  };
}
