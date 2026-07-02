import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { mappings } from "./schema";
import type { DB } from "./client";

type NewMapping = typeof mappings.$inferInsert;

const DISTRESS = ["Announced layoffs or facility shutdown (distress)", "Existing client", "Recently pitched"];

const SEED_MAPPINGS: NewMapping[] = [
  {
    mappingId: "10000000-0000-4000-8000-000000000001",
    name: "Warehouse expansion",
    intentDescription: "Company is expanding physical warehouse or fulfilment capacity.",
    servesVendorType: "Infra",
    requiredSignals: ["SIG-EXP-NEW-FACILITY", "SIG-EXP-NEW-GST", "SIG-EXP-LARGE-LEASE", "SIG-TENDER-LIVE"],
    supportingSignals: ["SIG-HIRING-OPS-SURGE", "SIG-HIRING-NEW-CITY", "SIG-MONEY-FUNDING", "SIG-LEAD-NEW-OPS"],
    thresholdRule: "At least one required signal. Supporting signals are optional and act as the score multiplier.",
    timingWindowDays: 180,
    strengthLogic: "One required signal = moderate lead. Each fresh supporting signal lifts it. Required + two or more fresh supporting signals inside 90 days = top-tier lead.",
    disqualifiers: DISTRESS,
    status: "approved",
    origin: "seed",
  },
  {
    mappingId: "10000000-0000-4000-8000-000000000002",
    name: "Offline marketing push",
    intentDescription: "Company is about to run a physical, on-the-ground marketing push (posters, outdoor, store-launch promotion).",
    servesVendorType: "Mktg",
    requiredSignals: ["SIG-EXP-NEW-STORE", "SIG-HIRING-NEW-CITY", "SIG-TENDER-LIVE", "SIG-DIG-NEW-LAUNCH"],
    supportingSignals: ["SIG-HIRING-FIELD-MKTG", "SIG-LEAD-NEW-MKTG", "SIG-DIG-CAMPAIGN-PUSH", "SIG-MONEY-FUNDING"],
    thresholdRule: "At least one required signal.",
    timingWindowDays: 180,
    strengthLogic: "One required signal = moderate lead. Each fresh supporting signal lifts it. Required + two or more fresh supporting signals inside 90 days = top-tier lead.",
    disqualifiers: DISTRESS,
    status: "approved",
    origin: "seed",
  },
];

/**
 * Inserts the 2 canonical seed mappings as status:'approved'.
 * Uses onConflictDoNothing on the fixed mapping_id PK so it is idempotent.
 * Run AFTER db:seed:signals so the referenced signals exist and are approved.
 * The caller owns the connection lifecycle — this function does NOT open or close one.
 */
export async function seedMappings(db: DB): Promise<{ inserted: number; total: number }> {
  const inserted = await db.insert(mappings).values(SEED_MAPPINGS).onConflictDoNothing().returning();
  return { inserted: inserted.length, total: SEED_MAPPINGS.length };
}

// Allow `npm run db:seed:mappings` to execute directly.
if (process.argv[1] && process.argv[1].endsWith("seed-mappings.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:seed:mappings");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  seedMappings(db)
    .then(({ inserted, total }) => {
      console.log("Seeded mappings:", inserted, "/", total);
      return client.end();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
