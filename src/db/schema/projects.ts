import { pgTable, uuid, jsonb } from "drizzle-orm/pg-core";
import { leads } from "./leads";
import { vendorProfiles } from "./vendors";

export const projects = pgTable("projects", {
  projectId: uuid("project_id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.leadId),
  vendorId: uuid("vendor_id").notNull().references(() => vendorProfiles.vendorId),
  commissionTerms: jsonb("commission_terms"),   // { type: one_time|recurring, rate_or_amount, cadence }
  commissionDue: jsonb("commission_due"),        // computed; per-cycle for recurring
  recurringTracking: jsonb("recurring_tracking"),
  disclosureLog: jsonb("disclosure_log"),        // leak-defense (§4.7); may normalize in Phase 5
  introductionLog: jsonb("introduction_log"),
  disputeRecord: jsonb("dispute_record"),
});
