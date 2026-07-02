ALTER TABLE "companies" ADD COLUMN "normalized_name" text;--> statement-breakpoint
ALTER TABLE "signal_observations" ADD COLUMN "source_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_normalized_name_uq" ON "companies" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_observations_dedupe_uq" ON "signal_observations" USING btree ("signal_id","company_id","source_ref");