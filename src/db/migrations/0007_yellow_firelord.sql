CREATE TABLE "projects" (
	"project_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"commission_terms" jsonb,
	"commission_due" jsonb,
	"recurring_tracking" jsonb,
	"disclosure_log" jsonb,
	"introduction_log" jsonb,
	"dispute_record" jsonb
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_id_leads_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("lead_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_vendor_id_vendor_profiles_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor_profiles"("vendor_id") ON DELETE no action ON UPDATE no action;