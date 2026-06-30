import type { LlmMessage } from "@/ai/llm";
import type { InterviewArea, InterviewState, CoverageReport } from "./types";

// Fixed questioning order; also the order `remaining` is returned in.
export const AREA_ORDER: InterviewArea[] = [
  "capabilities",
  "constraints",
  "idealCustomer",
  "knownGoodSignals",
  "differentiators",
];

// A user turn must clear this trimmed length to count as a substantive answer.
export const MIN_ANSWER_LENGTH = 15;

const AREA_TAG_RE = /\[area:([A-Za-z]+)\]\s*$/;

// Engine appends this to each assistant turn so coverage is re-derivable from
// the transcript alone. The model never produces it; it is never displayed.
// Note: trimEnd() is intentional — the round-trip contract is
// `stripAreaTag(appendAreaTag(t, a)) === t.trimEnd()`.
export function appendAreaTag(text: string, area: InterviewArea): string {
  return `${text.trimEnd()}\n[area:${area}]`;
}

export function stripAreaTag(text: string): string {
  return text.replace(/\n?\[area:[A-Za-z]+\]\s*$/, "").trimEnd();
}

export function parseAreaTag(text: string): InterviewArea | null {
  const match = text.match(AREA_TAG_RE);
  if (!match) return null;
  const area = match[1] as InterviewArea;
  return AREA_ORDER.includes(area) ? area : null;
}

function isAreaAddressed(messages: LlmMessage[], area: InterviewArea): boolean {
  for (let i = 0; i < messages.length - 1; i += 1) {
    const turn = messages[i];
    if (turn.role === "assistant" && parseAreaTag(turn.content) === area) {
      const answer = messages[i + 1];
      if (answer.role === "user" && answer.content.trim().length >= MIN_ANSWER_LENGTH) {
        return true;
      }
    }
  }
  return false;
}

export function assessCoverage(state: InterviewState): CoverageReport {
  const covered = AREA_ORDER.filter((area) => isAreaAddressed(state.messages, area));
  const remaining = AREA_ORDER.filter((area) => !covered.includes(area));
  return { covered, remaining, isComplete: remaining.length === 0 };
}
