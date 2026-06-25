CREATE TYPE "public"."catalogue_node_type" AS ENUM('vendor', 'capability', 'sub_capability', 'geography', 'project_size_range');--> statement-breakpoint
CREATE TYPE "public"."commission_type" AS ENUM('one_time', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."detection_method" AS ENUM('structured_query', 'api_field', 'keyword_match', 'ai_classification', 'combination');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('business', 'individual', 'both');--> statement-breakpoint
CREATE TYPE "public"."false_positive_risk" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_status" AS ENUM('proposed', 'approved', 'retired');--> statement-breakpoint
CREATE TYPE "public"."outreach_mode" AS ENUM('operator_handles', 'handed_to_vendor');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('sourced', 'contacted', 'engaged', 'pitched', 'won', 'lost', 'delivered', 'paid');--> statement-breakpoint
CREATE TYPE "public"."signal_family" AS ENUM('hiring', 'procurement', 'money', 'expansion', 'leadership', 'digital');--> statement-breakpoint
CREATE TYPE "public"."signal_polarity" AS ENUM('positive', 'negative', 'contextual');--> statement-breakpoint
CREATE TYPE "public"."signal_strength" AS ENUM('low', 'medium', 'high', 'very_high');--> statement-breakpoint
CREATE TABLE "companies" (
	"company_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"profile" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
