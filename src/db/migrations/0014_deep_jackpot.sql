CREATE TYPE "public"."campaign_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "campaign_leads" (
	"campaign_lead_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"was_new" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"campaign_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"label" text NOT NULL,
	"config" jsonb,
	"source" text NOT NULL,
	"status" "campaign_status" DEFAULT 'running' NOT NULL,
	"stats" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_snapshots" (
	"snapshot_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source_campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_campaigns_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_leads_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("lead_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_vendor_id_vendor_profiles_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor_profiles"("vendor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_snapshots" ADD CONSTRAINT "company_snapshots_campaign_id_campaigns_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_snapshots" ADD CONSTRAINT "company_snapshots_company_id_companies_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_leads_campaign_lead_uq" ON "campaign_leads" USING btree ("campaign_id","lead_id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_campaign_id_campaigns_campaign_id_fk" FOREIGN KEY ("source_campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE no action ON UPDATE no action;