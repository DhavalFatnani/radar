import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import {
  companies, signalDefinitions, signalObservations, mappings,
  vendorProfiles, leads, catalogueNodes, catalogueEdges, contacts, projects,
} from "./schema";
import type { DB } from "./client";

/**
 * Inserts one representative row per table, respecting FK order.
 * The caller owns the connection lifecycle — this function does NOT
 * create or close any connection.
 */
export async function seed(db: DB) {
  const [company] = await db.insert(companies)
    .values({ name: "Acme Logistics", description: "3PL operator expanding capacity" }).returning();

  const [definition] = await db.insert(signalDefinitions).values({
    signalId: "SIG-EXP-NEW-FACILITY", name: "New facility announced", family: "expansion",
    strength: "very_high", falsePositiveRisk: "low", status: "approved",
    sources: ["news", "company-press"],
  }).returning();

  const [observation] = await db.insert(signalObservations).values({
    signalId: definition.signalId, companyId: company.companyId,
    detectedAt: new Date(), source: "news", evidence: ["https://news/acme-new-dc"],
  }).returning();

  const [mapping] = await db.insert(mappings).values({
    name: "Warehouse expansion", servesVendorType: "infra", status: "approved",
    requiredSignals: ["SIG-EXP-NEW-FACILITY"], supportingSignals: ["SIG-HIRING-OPS-SURGE"],
  }).returning();

  const [vendor] = await db.insert(vendorProfiles).values({
    name: "RackPro Infra", vendorType: "Infra", capabilities: ["racking", "cctv"],
    constraints: { geographies_served: ["maharashtra"] },
  }).returning();

  const [lead] = await db.insert(leads).values({
    companyId: company.companyId, vendorId: vendor.vendorId, matchedMappingId: mapping.mappingId,
    intent: "Expanding warehouse capacity", score: 0.82,
    brief: { why_them: "new DC announced" },
    contactBlock: { decision_makers: [{ name: "R. Shah", role: "Head of Ops" }] },
  }).returning();

  const [vendorNode] = await db.insert(catalogueNodes)
    .values({ type: "vendor", label: "RackPro Infra" }).returning();
  const [capNode] = await db.insert(catalogueNodes)
    .values({ type: "capability", label: "warehouse racking" }).returning();
  const [edge] = await db.insert(catalogueEdges)
    .values({ fromNodeId: vendorNode.nodeId, toNodeId: capNode.nodeId, type: "vendor_capability" })
    .returning();

  const [contact] = await db.insert(contacts).values({
    name: "R. Shah", role: "Head of Ops", company: "Acme Logistics",
    contactPaths: [{ type: "linkedin", value: "in/rshah", confidence: 0.9, source: "search" }],
    sourceLeadId: lead.leadId, dedupKey: "rshah@acme",
  }).returning();

  const [project] = await db.insert(projects).values({
    leadId: lead.leadId, vendorId: vendor.vendorId,
    commissionTerms: { type: "one_time", rate_or_amount: "3%" },
  }).returning();

  return {
    company, definition, observation, mapping, vendor, lead,
    vendorNode, capNode, edge, contact, project,
  };
}

// Allow `npm run db:seed` to execute directly.
if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:seed");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  seed(db).then((r) => {
    console.log("Seeded:", Object.keys(r).join(", "));
    return client.end();
  }).then(() => {
    process.exit(0);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
