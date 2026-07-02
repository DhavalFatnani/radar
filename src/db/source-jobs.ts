import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import type { DB } from "./client";
import { createJobBoardFixtureAdapter } from "../lib/sourcing/adapters/jobs-fixture";
import { ingestJobObservations, type IngestResult } from "../lib/sourcing/jobs";

/**
 * On-demand job-board sourcing run against the committed fixture.
 * The caller owns the connection lifecycle — this function does NOT open or close one.
 */
export async function runJobSourcing(db: DB): Promise<IngestResult> {
  return ingestJobObservations(db, createJobBoardFixtureAdapter());
}

// Allow `npm run db:source:jobs` to execute directly.
if (process.argv[1] && process.argv[1].endsWith("source-jobs.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:source:jobs");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  runJobSourcing(db)
    .then((result) => {
      console.log("Job sourcing complete:", JSON.stringify(result));
      return client.end();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Job sourcing failed:", e);
      process.exit(1);
    });
}
