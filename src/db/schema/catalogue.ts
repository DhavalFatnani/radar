import { pgTable, uuid, text, jsonb, index } from "drizzle-orm/pg-core";
import { catalogueNodeType } from "./enums";

export const catalogueNodes = pgTable("catalogue_nodes", {
  nodeId: uuid("node_id").primaryKey().defaultRandom(),
  type: catalogueNodeType("type").notNull(),
  label: text("label").notNull(),
  metadata: jsonb("metadata"),
}, (t) => [index("catalogue_nodes_type_idx").on(t.type)]);

export const catalogueEdges = pgTable("catalogue_edges", {
  edgeId: uuid("edge_id").primaryKey().defaultRandom(),
  fromNodeId: uuid("from_node_id").notNull().references(() => catalogueNodes.nodeId),
  toNodeId: uuid("to_node_id").notNull().references(() => catalogueNodes.nodeId),
  type: text("type").notNull(),     // e.g. vendor_capability, capability_sub_capability
}, (t) => [
  index("catalogue_edges_from_type_idx").on(t.fromNodeId, t.type),
  index("catalogue_edges_to_type_idx").on(t.toNodeId, t.type),
]);
