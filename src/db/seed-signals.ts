import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { signalDefinitions } from "./schema";
import type { DB } from "./client";

type NewSignal = typeof signalDefinitions.$inferInsert;

const SEED_SIGNALS: NewSignal[] = [
  { signalId: "SIG-HIRING-OPS-SURGE",  name: "Operations hiring surge",          family: "hiring",      strength: "high",      falsePositiveRisk: "medium", triggerRule: ">= 5 open warehouse/operations/logistics/fulfilment roles, one company, rolling 60 days", status: "approved" },
  { signalId: "SIG-HIRING-NEW-CITY",   name: "New-city hiring",                  family: "hiring",      strength: "high",      falsePositiveRisk: "medium", triggerRule: "A company posts roles in a city where it has no current presence", status: "approved" },
  { signalId: "SIG-HIRING-SENIOR-OPS", name: "Senior ops leader sought",         family: "hiring",      strength: "medium",    falsePositiveRisk: "low",    triggerRule: "A posting for Head/VP/Director of Supply Chain, Operations, or Logistics", status: "approved" },
  { signalId: "SIG-HIRING-FIELD-MKTG", name: "Field-marketing hiring surge",     family: "hiring",      strength: "medium",    falsePositiveRisk: "medium", triggerRule: "A surge in promoter / field-marketing / store-launch roles across locations", status: "approved" },
  { signalId: "SIG-TENDER-LIVE",       name: "Live relevant tender",             family: "procurement", strength: "very_high", falsePositiveRisk: "low",    triggerRule: "An open government or PSU tender matching vendor keywords (racking, CCTV, IT hardware, signage, printing)", status: "approved" },
  { signalId: "SIG-TENDER-RECURRING",  name: "Recurring tender cycle",           family: "procurement", strength: "medium",    falsePositiveRisk: "low",    triggerRule: "A body that issued a similar tender in a prior year, window approaching", status: "approved" },
  { signalId: "SIG-TENDER-AMENDED",    name: "Tender extended or amended",       family: "procurement", strength: "high",      falsePositiveRisk: "low",    triggerRule: "An existing relevant tender gets a corrigendum or deadline extension", status: "approved" },
  { signalId: "SIG-MONEY-FUNDING",     name: "Funding round raised",             family: "money",       strength: "medium",    falsePositiveRisk: "medium", triggerRule: "A company announces a seed, Series A, or later round", status: "approved" },
  { signalId: "SIG-MONEY-ALLOCATION",  name: "Sector or region allocation",      family: "money",       strength: "low",       falsePositiveRisk: "medium", triggerRule: "A PLI scheme, state budget, or subsidy directed at a relevant sector", status: "approved" },
  { signalId: "SIG-EXP-NEW-FACILITY",  name: "New facility announced",           family: "expansion",   strength: "very_high", falsePositiveRisk: "low",    triggerRule: "News of a new warehouse, dark store, distribution centre, or plant", status: "approved" },
  { signalId: "SIG-EXP-NEW-GST",       name: "New place of business registered", family: "expansion",   strength: "high",      falsePositiveRisk: "medium", triggerRule: "A new GST registration or address for an existing company", status: "approved" },
  { signalId: "SIG-EXP-LARGE-LEASE",   name: "Large commercial lease",           family: "expansion",   strength: "high",      falsePositiveRisk: "medium", triggerRule: "A sizeable warehouse or retail lease reported", status: "approved" },
  { signalId: "SIG-EXP-NEW-STORE",     name: "New store or outlet opening",      family: "expansion",   strength: "high",      falsePositiveRisk: "low",    triggerRule: "An announcement of a new branch or store opening", status: "approved" },
  { signalId: "SIG-LEAD-NEW-OPS",      name: "New ops decision-maker",           family: "leadership",  strength: "medium",    falsePositiveRisk: "low",    triggerRule: "An actual appointment (not a posting) of a CXO/VP in operations or supply chain", status: "approved" },
  { signalId: "SIG-LEAD-NEW-MKTG",     name: "New marketing head",               family: "leadership",  strength: "medium",    falsePositiveRisk: "medium", triggerRule: "An appointment of a CMO or marketing director", status: "approved" },
  { signalId: "SIG-DIG-NEW-LAUNCH",    name: "New product or market launch",     family: "digital",     strength: "medium",    falsePositiveRisk: "medium", triggerRule: "A company announces a new category, product line, or market", status: "approved" },
  { signalId: "SIG-DIG-CAMPAIGN-PUSH", name: "New offline campaign push",        family: "digital",     strength: "medium",    falsePositiveRisk: "high",   triggerRule: "Evidence of a new go-to-market or outdoor push", status: "approved" },
];

/**
 * Inserts the 17 canonical seed signals as status:'approved'.
 * Uses onConflictDoNothing so it is safe to run multiple times (idempotent).
 * The caller owns the connection lifecycle — this function does NOT
 * create or close any connection.
 */
export async function seedSignals(db: DB): Promise<{ inserted: number; total: number }> {
  const inserted = await db
    .insert(signalDefinitions)
    .values(SEED_SIGNALS)
    .onConflictDoNothing()
    .returning();

  return { inserted: inserted.length, total: SEED_SIGNALS.length };
}

// Allow `npm run db:seed:signals` to execute directly.
if (process.argv[1] && process.argv[1].endsWith("seed-signals.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:seed:signals");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  seedSignals(db).then(({ inserted, total }) => {
    console.log("Seeded signals:", inserted, "/", total);
    return client.end();
  }).then(() => {
    process.exit(0);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
