import { pgEnum } from "drizzle-orm/pg-core";

// Approval gate (§4.1, §4.3, §8)
export const lifecycleStatus = pgEnum("lifecycle_status", ["proposed", "approved", "retired"]);

// Signal definition (§4.1)
export const signalFamily = pgEnum("signal_family", [
  "hiring", "procurement", "money", "expansion", "leadership", "digital",
]);
export const detectionMethod = pgEnum("detection_method", [
  "structured_query", "api_field", "keyword_match", "ai_classification", "combination",
]);
export const signalStrength = pgEnum("signal_strength", ["low", "medium", "high", "very_high"]);
export const falsePositiveRisk = pgEnum("false_positive_risk", ["low", "medium", "high"]);
export const signalPolarity = pgEnum("signal_polarity", ["positive", "negative", "contextual"]);
export const entityType = pgEnum("entity_type", ["business", "individual", "both"]);

// Lead / pipeline (§4.5, §4.7)
export const pipelineStage = pgEnum("pipeline_stage", [
  "sourced", "contacted", "engaged", "pitched", "won", "lost", "delivered", "paid",
]);
export const outreachMode = pgEnum("outreach_mode", ["operator_handles", "handed_to_vendor"]);
export const outreachStatus = pgEnum("outreach_status", ["pending", "drafted", "sent"]);

// Catalogue (§4.6)
export const catalogueNodeType = pgEnum("catalogue_node_type", [
  "vendor", "capability", "sub_capability", "geography", "project_size_range",
]);

// SIA interview session (§7.1)
export const interviewStatus = pgEnum("interview_status", ["in_progress", "completed", "abandoned"]);

// Commission / projects (§4.7, §7.6)
export const commissionStatus = pgEnum("commission_status", [
  "pending", "active", "closed", "disputed", "void",
]);

// Campaign run lifecycle (§5.1). `queued` reserved for V2 async/scheduled runs.
export const campaignStatus = pgEnum("campaign_status", ["queued", "running", "done", "failed"]);
