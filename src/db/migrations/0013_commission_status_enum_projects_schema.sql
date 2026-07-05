CREATE TYPE "public"."commission_status" AS ENUM('pending', 'active', 'closed', 'disputed', 'void');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "commission_status" "commission_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "recurring_tracking";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "commission_due" SET DEFAULT '{"cycles":[]}'::jsonb;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "commission_due" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "disclosure_log" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "disclosure_log" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "introduction_log" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "introduction_log" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "dispute_record" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "dispute_record" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_lead_uq" ON "projects" ("lead_id");
