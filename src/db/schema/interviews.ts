import { pgTable, uuid, integer, jsonb, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { LlmMessage } from "@/ai/llm";
import { interviewStatus } from "./enums";
import { vendorProfiles } from "./vendors";

// One persisted SIA interview session. `messages` is the full LlmMessage[]
// transcript (assistant turns keep their [area:X] tag). At most one
// in_progress row per vendor (partial unique index below).
export const vendorInterviews = pgTable(
  "vendor_interviews",
  {
    interviewId: uuid("interview_id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendorProfiles.vendorId, { onDelete: "cascade" }),
    status: interviewStatus("status").notNull().default("in_progress"),
    messages: jsonb("messages").$type<LlmMessage[]>().notNull().default(sql`'[]'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    resultingVersion: integer("resulting_version"),
    provider: text("provider"),
  },
  (t) => [
    index("vendor_interviews_vendor_id_idx").on(t.vendorId),
    uniqueIndex("vendor_interviews_one_open_per_vendor")
      .on(t.vendorId)
      .where(sql`${t.status} = 'in_progress'`),
  ],
);
