import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { vendorProfiles } from "./schema";
import type { DB } from "./client";
import { createCampaign, type CampaignStats } from "@/lib/campaigns/data";
import { runCampaign } from "@/lib/campaigns/run";
import { adapterForSource } from "@/lib/campaigns/adapter";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Create + run one campaign for a vendor. Caller owns the connection. */
export async function runCampaignForVendor(
  db: DB,
  input: { vendorId: string; source: string; geography: string; target: number },
): Promise<{ campaignId: string; stats: CampaignStats }> {
  const [vendor] = await db
    .select({ vendorId: vendorProfiles.vendorId, name: vendorProfiles.name })
    .from(vendorProfiles).where(eq(vendorProfiles.vendorId, input.vendorId)).limit(1);
  if (!vendor) throw new Error(`vendor ${input.vendorId} not found`);

  const { campaignId } = await createCampaign(db, {
    vendorId: vendor.vendorId,
    source: input.source,
    label: `${vendor.name} · ${input.geography} · ${input.target}`,
    config: { geography: input.geography, target: input.target },
  });
  const stats = await runCampaign(db, { campaignId, adapter: adapterForSource(input.source) });
  return { campaignId, stats };
}

/** Resolve a --vendor arg that is either a UUID or a (case-insensitive) vendor name. */
async function resolveVendorId(db: DB, vendorArg: string): Promise<string> {
  if (UUID_RE.test(vendorArg)) return vendorArg;
  const rows = await db.select({ id: vendorProfiles.vendorId, name: vendorProfiles.name }).from(vendorProfiles);
  const match = rows.find((r) => r.name.toLowerCase() === vendorArg.toLowerCase());
  if (!match) throw new Error(`no vendor named "${vendorArg}" (create one in radar first, or pass its UUID)`);
  return match.id;
}

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

// db:campaign:run -- --vendor "RackPro Infra" [--source crustdata] [--geo IND] [--target 20]
if (process.argv[1] && process.argv[1].endsWith("campaign-run.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:campaign:run");
  const vendorArg = arg("--vendor");
  if (!vendorArg) throw new Error('usage: db:campaign:run -- --vendor "<name-or-uuid>" [--source crustdata] [--geo IND] [--target 20]');
  const source = arg("--source", "crustdata")!;
  const geography = arg("--geo", "IND")!;
  const target = Number(arg("--target", "20"));

  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  (async () => {
    const vendorId = await resolveVendorId(db, vendorArg);
    const { campaignId, stats } = await runCampaignForVendor(db, { vendorId, source, geography, target });
    console.log(`Campaign ${campaignId} [${source}] done:`, stats);
  })()
    .then(() => client.end())
    .then(() => process.exit(0))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); return client.end().finally(() => process.exit(1)); });
}
