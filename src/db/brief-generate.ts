import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import type { DB } from "./client";
import { generateBrief } from "../ai/brief";
import { generateBriefsForLeads, type GenerateBriefsResult } from "../lib/sourcing/brief";

/**
 * On-demand reverse-brief run: generate a brief for every scored lead that does
 * not have one yet, and persist it to leads.brief. The caller owns the connection
 * lifecycle. This is the only place a live LLM is invoked.
 */
export async function runBriefGeneration(db: DB): Promise<GenerateBriefsResult> {
  return generateBriefsForLeads(db, generateBrief);
}

// Allow `npm run db:brief:generate` to execute directly.
if (process.argv[1] && process.argv[1].endsWith("brief-generate.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:brief:generate");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  runBriefGeneration(db)
    .then((result) => {
      console.log("Brief generation complete:", JSON.stringify(result));
      return client.end();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Brief generation failed:", e);
      process.exit(1);
    });
}
