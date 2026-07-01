import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { vendorInterviews } from "@/db/schema";
import type { LlmMessage } from "@/ai/llm";
import type { Interview, InterviewStatus, InterviewSummary } from "./schema";

// Re-export the pure types for the service/UI layer.
export type { Interview, InterviewStatus, InterviewSummary };

const columns = {
  interviewId: vendorInterviews.interviewId,
  vendorId: vendorInterviews.vendorId,
  status: vendorInterviews.status,
  messages: vendorInterviews.messages,
  startedAt: vendorInterviews.startedAt,
  completedAt: vendorInterviews.completedAt,
  resultingVersion: vendorInterviews.resultingVersion,
  provider: vendorInterviews.provider,
};

type Row = {
  interviewId: string;
  vendorId: string;
  status: InterviewStatus;
  messages: LlmMessage[] | null;
  startedAt: Date;
  completedAt: Date | null;
  resultingVersion: number | null;
  provider: string | null;
};

function toInterview(row: Row): Interview {
  return {
    interviewId: row.interviewId,
    vendorId: row.vendorId,
    status: row.status,
    messages: row.messages ?? [],
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    resultingVersion: row.resultingVersion,
    provider: row.provider,
  };
}

export async function createInterview(vendorId: string): Promise<Interview> {
  const [row] = await db.insert(vendorInterviews).values({ vendorId }).returning(columns);
  return toInterview(row);
}

export async function getInterview(interviewId: string): Promise<Interview | null> {
  const [row] = await db
    .select(columns)
    .from(vendorInterviews)
    .where(eq(vendorInterviews.interviewId, interviewId))
    .limit(1);
  return row ? toInterview(row) : null;
}

export async function getActiveInterview(vendorId: string): Promise<Interview | null> {
  const [row] = await db
    .select(columns)
    .from(vendorInterviews)
    .where(and(eq(vendorInterviews.vendorId, vendorId), eq(vendorInterviews.status, "in_progress")))
    .limit(1);
  return row ? toInterview(row) : null;
}

export async function listInterviews(vendorId: string): Promise<InterviewSummary[]> {
  const rows = await db
    .select({
      interviewId: vendorInterviews.interviewId,
      status: vendorInterviews.status,
      startedAt: vendorInterviews.startedAt,
      completedAt: vendorInterviews.completedAt,
      resultingVersion: vendorInterviews.resultingVersion,
      messageCount: sql<number>`jsonb_array_length(${vendorInterviews.messages})`,
    })
    .from(vendorInterviews)
    .where(eq(vendorInterviews.vendorId, vendorId))
    .orderBy(desc(vendorInterviews.startedAt))
    .limit(100);
  return rows.map((r) => ({
    interviewId: r.interviewId,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    resultingVersion: r.resultingVersion,
    messageCount: Number(r.messageCount),
  }));
}

// Atomic DB-side append: messages = messages || $msgs::jsonb. No read-modify-write,
// so concurrent turns cannot lose each other. $msgs is a bound parameter.
export async function appendMessages(interviewId: string, msgs: LlmMessage[]): Promise<void> {
  await db
    .update(vendorInterviews)
    .set({ messages: sql`${vendorInterviews.messages} || ${JSON.stringify(msgs)}::jsonb` })
    .where(eq(vendorInterviews.interviewId, interviewId));
}

export async function completeInterview(
  interviewId: string,
  resultingVersion: number,
  provider: string,
): Promise<void> {
  await db
    .update(vendorInterviews)
    .set({ status: "completed", completedAt: new Date(), resultingVersion, provider })
    .where(eq(vendorInterviews.interviewId, interviewId));
}

export async function abandonInterview(interviewId: string): Promise<void> {
  await db
    .update(vendorInterviews)
    .set({ status: "abandoned", completedAt: new Date() })
    .where(eq(vendorInterviews.interviewId, interviewId));
}
