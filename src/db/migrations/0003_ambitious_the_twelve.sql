CREATE TABLE "vendor_profiles" (
	"vendor_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"capabilities" text[],
	"constraints" jsonb,
	"ideal_customer" jsonb,
	"known_good_signals" text,
	"differentiators" text,
	"credibility" jsonb,
	"signal_recipe" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"interview_history" jsonb
);
