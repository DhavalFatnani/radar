CREATE TABLE "mappings" (
	"mapping_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"intent_description" text,
	"serves_vendor_type" text,
	"required_signals" text[],
	"supporting_signals" text[],
	"threshold_rule" text,
	"timing_window_days" integer,
	"strength_logic" text,
	"disqualifiers" text[],
	"status" "lifecycle_status" DEFAULT 'proposed' NOT NULL,
	"origin" text,
	"track_record" jsonb
);
