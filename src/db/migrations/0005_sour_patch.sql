CREATE TABLE "catalogue_edges" (
	"edge_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalogue_nodes" (
	"node_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "catalogue_node_type" NOT NULL,
	"label" text NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "catalogue_edges" ADD CONSTRAINT "catalogue_edges_from_node_id_catalogue_nodes_node_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."catalogue_nodes"("node_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_edges" ADD CONSTRAINT "catalogue_edges_to_node_id_catalogue_nodes_node_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."catalogue_nodes"("node_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_edges_from_type_idx" ON "catalogue_edges" USING btree ("from_node_id","type");--> statement-breakpoint
CREATE INDEX "catalogue_edges_to_type_idx" ON "catalogue_edges" USING btree ("to_node_id","type");--> statement-breakpoint
CREATE INDEX "catalogue_nodes_type_idx" ON "catalogue_nodes" USING btree ("type");