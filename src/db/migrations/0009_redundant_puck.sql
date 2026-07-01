CREATE TYPE "public"."interview_status" AS ENUM('in_progress', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "vendor_interviews" (
	"interview_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"status" "interview_status" DEFAULT 'in_progress' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"resulting_version" integer,
	"provider" text
);
--> statement-breakpoint
ALTER TABLE "vendor_interviews" ADD CONSTRAINT "vendor_interviews_vendor_id_vendor_profiles_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor_profiles"("vendor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_interviews_vendor_id_idx" ON "vendor_interviews" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_interviews_one_open_per_vendor" ON "vendor_interviews" USING btree ("vendor_id") WHERE "vendor_interviews"."status" = 'in_progress';