CREATE TABLE "contacts" (
	"contact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"company" text,
	"categories" jsonb,
	"contact_paths" jsonb,
	"warm_path_status" text,
	"source_lead_id" uuid,
	"dedup_key" text
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_source_lead_id_leads_lead_id_fk" FOREIGN KEY ("source_lead_id") REFERENCES "public"."leads"("lead_id") ON DELETE no action ON UPDATE no action;