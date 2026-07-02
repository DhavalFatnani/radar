import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import type { DB } from "./client";
import { generateLeads, type GenerateLeadsResult } from "../lib/sourcing/leads";

/**
 * On-demand matching + scoring run: score every typed vendor's approved mappings against
 * captured observations and upsert scored leads. The caller owns the connection lifecycle.
 */
export async function runLeadSourcing(db: DB): Promise<GenerateLeadsResult> {
  return generateLeads(db);
}

// Allow `npm run db:source:leads` to execute directly.
if (process.argv[1] && process.argv[1].endsWith("source-leads.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:source:leads");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  runLeadSourcing(db)
    .then((result) => {
      console.log("Lead sourcing complete:", JSON.stringify(result));
      return client.end();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Lead sourcing failed:", e);
      process.exit(1);
    });
}
