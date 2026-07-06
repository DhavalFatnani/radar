import { pgTable, uuid, text, jsonb, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { campaignStatus } from "./enums";
import { vendorProfiles } from "./vendors";
import { companies } from "./companies";
import { leads } from "./leads";

export const campaigns = pgTable("campaigns", {
  campaignId: uuid("campaign_id").primaryKey().defaultRandom(),
  vendorId: uuid("vendor_id").notNull().references(() => vendorProfiles.vendorId),
  label: text("label").notNull(),
  config: jsonb("config"),              // { geography, target, enrichTop?, mappingIds? }
  source: text("source").notNull(),     // "company-fixture" | "crustdata"
  status: campaignStatus("status").notNull().default("running"),
  stats: jsonb("stats"),                // { companiesFetched, observationsWritten, leadsCreated, leadsUpdated, creditsSpent }
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const campaignLeads = pgTable("campaign_leads", {
  campaignLeadId: uuid("campaign_lead_id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.campaignId),
  leadId: uuid("lead_id").notNull().references(() => leads.leadId),
  wasNew: boolean("was_new").notNull(),
}, (t) => [
  uniqueIndex("campaign_leads_campaign_lead_uq").on(t.campaignId, t.leadId),
]);

// Write-only in v1; v2 fingerprint memory reads + diffs these (spec §16.1).
export const companySnapshots = pgTable("company_snapshots", {
  snapshotId: uuid("snapshot_id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.campaignId),
  companyId: uuid("company_id").notNull().references(() => companies.companyId),
  snapshot: jsonb("snapshot").notNull(),  // { fundraiseDate, headcountTotal, opsPostings, score }
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});
