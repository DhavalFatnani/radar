import type { CoverageReport } from "@/ai/sia";

// Transcript turn as displayed: [area:X] tags stripped, system messages dropped.
export type DisplayTurn = { role: "sia" | "vendor"; text: string };

export type TurnResult =
  | {
      ok: true;
      interviewId: string;
      transcript: DisplayTurn[];
      pendingQuestion: string;
      coverage: CoverageReport;
      isComplete: boolean;
    }
  | { ok: false; error: string };

export type SaveResult = { ok: true; version: number } | { ok: false; error: string };
