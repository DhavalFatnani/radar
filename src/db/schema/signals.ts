import { pgTable, text, integer, jsonb, date, timestamp, uuid, real, uniqueIndex } from "drizzle-orm/pg-core";
import {
  signalFamily, detectionMethod, signalStrength, falsePositiveRisk,
  signalPolarity, entityType, lifecycleStatus,
} from "./enums";
import { companies } from "./companies";

export const signalDefinitions = pgTable("signal_definitions", {
  signalId: text("signal_id").primaryKey(),                 // e.g. SIG-HIRING-OPS-SURGE
  name: text("name").notNull(),
  family: signalFamily("family").notNull(),
  description: text("description"),
  sources: text("sources").array(),
  detectionMethod: detectionMethod("detection_method"),
  triggerRule: text("trigger_rule"),
  parameters: jsonb("parameters"),
  proofCaptured: text("proof_captured"),
  confirmationRule: text("confirmation_rule"),
  recheckCadence: text("recheck_cadence"),                  // open-ended -> text
  strength: signalStrength("strength"),
  falsePositiveRisk: falsePositiveRisk("false_positive_risk"),
  freshnessWindowDays: integer("freshness_window_days"),
  polarity: signalPolarity("polarity"),
  entityType: entityType("entity_type"),
  pairsWith: text("pairs_with").array(),
  geography: text("geography").array(),
  status: lifecycleStatus("status").notNull().default("proposed"),   // APPROVAL GATE
  origin: text("origin"),
  proposedBy: text("proposed_by"),
  dateAdded: date("date_added"),
  lastReviewed: date("last_reviewed"),
  example: text("example"),
  trackRecord: jsonb("track_record"),                       // computed; empty until outcomes
});

export const signalObservations = pgTable(
  "signal_observations",
  {
    observationId: uuid("observation_id").primaryKey().defaultRandom(),
    signalId: text("signal_id").notNull().references(() => signalDefinitions.signalId),
    companyId: uuid("company_id").notNull().references(() => companies.companyId),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),   // MANDATORY (proof)
    source: text("source").notNull(),                                          // MANDATORY (proof)
    evidence: text("evidence").array().notNull(),                              // MANDATORY (proof)
    freshnessVerdict: text("freshness_verdict"),               // computed: recent | stale
    entityMatchConfidence: real("entity_match_confidence"),    // computed
    sourceRef: text("source_ref"),                             // source event id; dedup key
  },
  (t) => [
    uniqueIndex("signal_observations_dedupe_uq").on(t.signalId, t.companyId, t.sourceRef),
  ],
);
