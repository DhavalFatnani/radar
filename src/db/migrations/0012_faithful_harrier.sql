CREATE TYPE "public"."outreach_status" AS ENUM('pending', 'drafted', 'sent');--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "outreach_status" "outreach_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "outreach_draft" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "outreach_draft_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "outreach_sent_at" timestamp with time zone;