import { pgTable, uuid, text, real, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { pipelineStage, outreachMode, outreachStatus } from "./enums";
import { vendorProfiles } from "./vendors";
import { companies } from "./companies";
import { mappings } from "./mappings";

export const leads = pgTable("leads", {
  leadId: uuid("lead_id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId),
  vendorId: uuid("vendor_id").notNull().references(() => vendorProfiles.vendorId),
  matchedMappingId: uuid("matched_mapping_id").references(() => mappings.mappingId),
  intent: text("intent"),
  score: real("score"),
  pipelineStage: pipelineStage("pipeline_stage").notNull().default("sourced"),
  outreachMode: outreachMode("outreach_mode"),
  outreachStatus: outreachStatus("outreach_status").notNull().default("pending"),
  outreachDraft: jsonb("outreach_draft"),                        // { subject, body }
  outreachDraftGeneratedAt: timestamp("outreach_draft_generated_at", { withTimezone: true }),
  outreachSentAt: timestamp("outreach_sent_at", { withTimezone: true }),
  brief: jsonb("brief"),                 // { why_them, why_now[], what_they_need, hook, ... }
  contactBlock: jsonb("contact_block"),  // { decision_makers[] { name, role, contact_paths[] } }
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("leads_vendor_company_mapping_uq").on(t.vendorId, t.companyId, t.matchedMappingId),
]);
