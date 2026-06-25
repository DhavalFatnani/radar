CREATE TABLE "leads" (
	"lead_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"matched_mapping_id" uuid,
	"intent" text,
	"score" real,
	"pipeline_stage" "pipeline_stage" DEFAULT 'sourced' NOT NULL,
	"outreach_mode" "outreach_mode",
	"brief" jsonb,
	"contact_block" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_vendor_id_vendor_profiles_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor_profiles"("vendor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_matched_mapping_id_mappings_mapping_id_fk" FOREIGN KEY ("matched_mapping_id") REFERENCES "public"."mappings"("mapping_id") ON DELETE no action ON UPDATE no action;