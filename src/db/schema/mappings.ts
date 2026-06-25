import { pgTable, uuid, text, integer, jsonb } from "drizzle-orm/pg-core";
import { lifecycleStatus } from "./enums";

export const mappings = pgTable("mappings", {
  mappingId: uuid("mapping_id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  intentDescription: text("intent_description"),
  servesVendorType: text("serves_vendor_type"),
  requiredSignals: text("required_signals").array(),     // signal_id[] (>= one to fire)
  supportingSignals: text("supporting_signals").array(), // signal_id[]
  thresholdRule: text("threshold_rule"),
  timingWindowDays: integer("timing_window_days"),
  strengthLogic: text("strength_logic"),
  disqualifiers: text("disqualifiers").array(),
  status: lifecycleStatus("status").notNull().default("proposed"),   // APPROVAL GATE
  origin: text("origin"),
  trackRecord: jsonb("track_record"),                    // computed
});
