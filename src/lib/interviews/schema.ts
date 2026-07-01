import type { LlmMessage } from "@/ai/llm";

export type InterviewStatus = "in_progress" | "completed" | "abandoned";

export type Interview = {
  interviewId: string;
  vendorId: string;
  status: InterviewStatus;
  messages: LlmMessage[];
  startedAt: string;
  completedAt: string | null;
  resultingVersion: number | null;
  provider: string | null;
};

export type InterviewSummary = {
  interviewId: string;
  status: InterviewStatus;
  startedAt: string;
  completedAt: string | null;
  resultingVersion: number | null;
  messageCount: number;
};
