CREATE TABLE "signal_definitions" (
	"signal_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"family" "signal_family" NOT NULL,
	"description" text,
	"sources" text[],
	"detection_method" "detection_method",
	"trigger_rule" text,
	"parameters" jsonb,
	"proof_captured" text,
	"confirmation_rule" text,
	"recheck_cadence" text,
	"strength" "signal_strength",
	"false_positive_risk" "false_positive_risk",
	"freshness_window_days" integer,
	"polarity" "signal_polarity",
	"entity_type" "entity_type",
	"pairs_with" text[],
	"geography" text[],
	"status" "lifecycle_status" DEFAULT 'proposed' NOT NULL,
	"origin" text,
	"proposed_by" text,
	"date_added" date,
	"last_reviewed" date,
	"example" text,
	"track_record" jsonb
);
--> statement-breakpoint
CREATE TABLE "signal_observations" (
	"observation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"evidence" text[] NOT NULL,
	"freshness_verdict" text,
	"entity_match_confidence" real
);
--> statement-breakpoint
ALTER TABLE "signal_observations" ADD CONSTRAINT "signal_observations_signal_id_signal_definitions_signal_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signal_definitions"("signal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_observations" ADD CONSTRAINT "signal_observations_company_id_companies_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("company_id") ON DELETE no action ON UPDATE no action;