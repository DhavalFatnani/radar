import { pgTable, uuid, text, jsonb } from "drizzle-orm/pg-core";
import { leads } from "./leads";

export const contacts = pgTable("contacts", {
  contactId: uuid("contact_id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  role: text("role"),
  company: text("company"),
  categories: jsonb("categories"),          // { role, industry, company, geography, ... }
  contactPaths: jsonb("contact_paths"),      // [{ type, value, confidence, source }]
  warmPathStatus: text("warm_path_status"),
  sourceLeadId: uuid("source_lead_id").references(() => leads.leadId),
  dedupKey: text("dedup_key"),               // uniqueness enforced by Phase 6 dedup logic
});
