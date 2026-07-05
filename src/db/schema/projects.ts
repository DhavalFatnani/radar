import { pgTable, uuid, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { commissionStatus } from "./enums";
import { leads } from "./leads";
import { vendorProfiles } from "./vendors";

// One project per WON lead — the deal on which the operator earns commission.
// NOTE: two jsonb columns keep their legacy DB names to avoid a drizzle-kit
// rename prompt: commissionCycles -> "commission_due", disputeLog ->
// "dispute_record". App code uses only the TS property names.
export const projects = pgTable(
  "projects",
  {
    projectId: uuid("project_id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").notNull().references(() => leads.leadId),
    vendorId: uuid("vendor_id").notNull().references(() => vendorProfiles.vendorId),
    commissionStatus: commissionStatus("commission_status").notNull().default("pending"),
    commissionTerms: jsonb("commission_terms"),
    commissionCycles: jsonb("commission_due").notNull().default({ cycles: [] }),
    disclosureLog: jsonb("disclosure_log").notNull().default([]),
    introductionLog: jsonb("introduction_log").notNull().default([]),
    disputeLog: jsonb("dispute_record").notNull().default([]),
  },
  (t) => [uniqueIndex("projects_lead_uq").on(t.leadId)],
);
