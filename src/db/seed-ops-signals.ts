import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { signalDefinitions, mappings } from "./schema";
import type { DB } from "./client";

type NewSignal = typeof signalDefinitions.$inferInsert;

const OPS_SIGNALS: NewSignal[] = [
  {
    signalId: "SIG-EXP-HEADCOUNT-GROWTH", name: "Headcount growth", family: "expansion",
    strength: "medium", falsePositiveRisk: "medium", polarity: "positive",
    freshnessWindowDays: 365,
    triggerRule: ">= 15% twelve-month headcount growth for one company", status: "approved", origin: "seed-ops",
  },
  {
    signalId: "SIG-HIRING-OPS-INHOUSE", name: "Ops engineering hiring (in-house build)", family: "hiring",
    strength: "medium", falsePositiveRisk: "medium", polarity: "negative",
    freshnessWindowDays: 365,
    triggerRule: "Open ops-ENGINEERING roles (building ops in-house → future competitor, not a buyer)", status: "approved", origin: "seed-ops",
  },
];

const OPS_MAPPING = {
  name: "Ops expansion — pursue",
  intentDescription: "A recently funded company scaling operations and hiring ops operators — a live buyer for warehouse / fulfilment infrastructure.",
  servesVendorType: "Infra",
  requiredSignals: ["SIG-MONEY-FUNDING", "SIG-HIRING-OPS-SURGE"],
  supportingSignals: ["SIG-EXP-HEADCOUNT-GROWTH"],
  disqualifiers: ["SIG-HIRING-OPS-INHOUSE"],
  timingWindowDays: 365,
  status: "approved" as const,
  origin: "seed-ops",
};

/**
 * Seeds the ops-campaign CONFIG only — two signal definitions and one mapping.
 * Inserts NO vendor, NO company, NO observation (operator onboards vendor #1 and
 * the first live campaign pulls real companies). Idempotent. Caller owns the connection.
 */
export async function seedOpsSignals(db: DB): Promise<{ signalsInserted: number; mappingInserted: number }> {
  const signalsInserted = await db
    .insert(signalDefinitions).values(OPS_SIGNALS).onConflictDoNothing().returning();

  const existing = await db.select({ id: mappings.mappingId }).from(mappings).where(eq(mappings.name, OPS_MAPPING.name));
  let mappingInserted = 0;
  if (existing.length === 0) {
    await db.insert(mappings).values(OPS_MAPPING);
    mappingInserted = 1;
  }
  return { signalsInserted: signalsInserted.length, mappingInserted };
}

if (process.argv[1] && process.argv[1].endsWith("seed-ops-signals.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:seed:ops-signals");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  seedOpsSignals(db).then((r) => {
    console.log("Seeded ops config:", r);
    return client.end();
  }).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
