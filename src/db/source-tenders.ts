import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import type { DB } from "./client";
import { createTenderFixtureAdapter } from "../lib/sourcing/adapters/tenders";
import { ingestTenderObservations, type IngestResult } from "../lib/sourcing/data";

/**
 * On-demand tender sourcing run against the committed fixture.
 * The caller owns the connection lifecycle — this function does NOT open or close one.
 */
export async function runTenderSourcing(db: DB): Promise<IngestResult> {
  return ingestTenderObservations(db, createTenderFixtureAdapter());
}

// Allow `npm run db:source:tenders` to execute directly.
if (process.argv[1] && process.argv[1].endsWith("source-tenders.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:source:tenders");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  runTenderSourcing(db)
    .then((result) => {
      console.log("Tender sourcing complete:", JSON.stringify(result));
      return client.end();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Tender sourcing failed:", e);
      process.exit(1);
    });
}
