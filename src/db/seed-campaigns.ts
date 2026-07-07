import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { campaigns, companies, leads, campaignLeads, companySnapshots, vendorProfiles } from "./schema";
import type { DB } from "./client";

/**
 * Dev-only sample campaigns spread across the last ~30 days, so the Campaigns
 * KPI sparklines and detail pages have real history to plot. Every row is tagged
 * (`config.sample = true` on campaigns, `profile.sample = true` on companies) so
 * `db:wipe:campaigns` removes exactly this data and nothing real.
 *
 *   npm run db:seed:campaigns          # ~26 campaigns over 30 days
 *   npm run db:wipe:campaigns          # remove them again
 */

const N = 26;                       // campaigns to create
const GEOS = ["IND", "USA", "GBR"] as const;
const TARGETS = [10, 15, 20, 25] as const;
const COMPANY_NAMES = [
  "Vizhinjam Seaport", "YoLearn.AI", "Dovetail Capital", "Limelight Diamonds", "Spense",
  "Data Science Wizards", "Supply6", "Heatronics", "BCT Ventures", "Northwind Logistics",
  "Aster Retail", "Cobalt Robotics", "Fernweh Travel", "Meridian Foods", "Quanta Health",
  "Riverbend Mfg", "Solaris Energy", "Tessellate", "Umbra Security", "Vantage Freight",
  "Wayfare Mobility", "Xylem Water", "Yonder Farms", "Zephyr Cloud",
];

// deterministic PRNG (mulberry32) so the seed is reproducible run-to-run.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(1337);
const pick = <T,>(arr: readonly T[], f: number) => arr[Math.floor(f * arr.length) % arr.length];
const DAY = 86400_000;

async function seed(db: DB) {
  const vendors = await db.select({ vendorId: vendorProfiles.vendorId, name: vendorProfiles.name, vendorType: vendorProfiles.vendorType }).from(vendorProfiles);
  if (vendors.length === 0) throw new Error("no vendors found — create a vendor in radar first, then re-run.");

  // sample company pool (tagged, with a domain in profile). normalizedName is a
  // "sample-*" slug so re-runs don't duplicate; we always select back by the tag
  // (never by name) so we never touch a real company that shares a name.
  await db.insert(companies).values(
    COMPANY_NAMES.map((name, i) => ({
      name: `${name}`,
      normalizedName: `sample-${i}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      profile: { sample: true, domain: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com` },
    })),
  ).onConflictDoNothing({ target: companies.normalizedName });
  const samplePool = await db.select({ companyId: companies.companyId, name: companies.name })
    .from(companies).where(sql`${companies.profile}->>'sample' = 'true'`);
  if (samplePool.length === 0) throw new Error("sample company pool is empty after insert");

  const now = Date.now();
  const leadByKey = new Map<string, string>(); // `${vendorId}:${companyId}` -> leadId
  let created = 0;

  // oldest → newest so a lead's sourceCampaignId is the earliest run that surfaced it.
  for (let i = 0; i < N; i++) {
    const vendor = vendors[i % vendors.length];
    const daysAgo = Math.max(0, Math.round(29 - (i * 29) / (N - 1)));
    const createdAt = new Date(now - daysAgo * DAY - Math.floor(r() * DAY));
    const source = i % 3 === 0 ? "company-fixture" : "crustdata";
    const status = i === N - 1 ? "running" : i % 11 === 5 ? "failed" : i % 13 === 7 ? "queued" : "done";
    const geography = pick(GEOS, r());
    const target = pick(TARGETS, r());

    const companiesFetched = status === "queued" ? 0 : 8 + Math.floor(r() * 33);
    const leadsCreated = status === "done" ? Math.floor(r() * Math.min(companiesFetched, 14)) : status === "running" ? Math.floor(r() * 5) : 0;
    const creditsSpent = source === "crustdata" && status !== "queued" ? Number((0.15 + r() * 1.25).toFixed(2)) : 0;
    const stats = {
      companiesFetched,
      observationsWritten: companiesFetched + Math.floor(r() * 25),
      leadsCreated,
      leadsUpdated: Math.floor(r() * 3),
      creditsSpent,
    };

    const [camp] = await db.insert(campaigns).values({
      vendorId: vendor.vendorId,
      label: `${vendor.name} · ${geography} · ${target}`,
      source,
      config: { geography, target, sample: true },
      status,
      stats: status === "queued" ? null : stats,
      error: status === "failed" ? "sample: adapter returned 502" : null,
      startedAt: status === "queued" ? null : createdAt,
      finishedAt: status === "done" || status === "failed" ? new Date(createdAt.getTime() + 40_000 + Math.floor(r() * 90_000)) : null,
      createdAt,
    }).returning({ campaignId: campaigns.campaignId });
    created++;

    // surfaced leads for finished runs, with varied scores → real score meters + detail graph.
    for (let j = 0; j < leadsCreated; j++) {
      const company = samplePool[(i * 7 + j * 3) % samplePool.length];
      const key = `${vendor.vendorId}:${company.companyId}`;
      let leadId = leadByKey.get(key);
      const wasNew = !leadId;
      const score = 18 + Math.floor(r() * 78); // 18–95
      if (!leadId) {
        const [lead] = await db.insert(leads).values({
          companyId: company.companyId, vendorId: vendor.vendorId, score,
          intent: "sample sourcing signal", sourceCampaignId: camp.campaignId,
        }).returning({ leadId: leads.leadId });
        leadId = lead.leadId;
        leadByKey.set(key, leadId);
      }
      await db.insert(campaignLeads).values({ campaignId: camp.campaignId, leadId, wasNew }).onConflictDoNothing({ target: [campaignLeads.campaignId, campaignLeads.leadId] });
      await db.insert(companySnapshots).values({
        campaignId: camp.campaignId, companyId: company.companyId,
        snapshot: {
          fundraiseDate: new Date(createdAt.getTime() - Math.floor(r() * 300) * DAY).toISOString().slice(0, 10),
          headcountTotal: 12 + Math.floor(r() * 400),
          opsPostings: Math.floor(r() * 9),
          score,
        },
      });
    }
  }
  console.log(`Seeded ${created} sample campaigns across ${vendors.length} vendor(s) and ${samplePool.length} companies.`);
  console.log("Wipe anytime with:  npm run db:wipe:campaigns");
}

if (process.argv[1] && process.argv[1].endsWith("seed-campaigns.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:seed:campaigns");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  seed(db)
    .then(() => client.end())
    .then(() => process.exit(0))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); return client.end().finally(() => process.exit(1)); });
}
