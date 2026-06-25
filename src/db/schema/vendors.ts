import { pgTable, uuid, text, integer, jsonb } from "drizzle-orm/pg-core";

export const vendorProfiles = pgTable("vendor_profiles", {
  vendorId: uuid("vendor_id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  capabilities: text("capabilities").array(),
  constraints: jsonb("constraints"),          // { max/min_project_size, geographies_served, ... }
  idealCustomer: jsonb("ideal_customer"),
  knownGoodSignals: text("known_good_signals"),
  differentiators: text("differentiators"),
  credibility: jsonb("credibility"),
  signalRecipe: jsonb("signal_recipe"),        // computed
  version: integer("version").notNull().default(1),
  interviewHistory: jsonb("interview_history"),
});
