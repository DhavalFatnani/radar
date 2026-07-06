# Campaigns Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend engine of a per-vendor Campaign — schema, seed config, company signal detectors, a fixture adapter, a sourcing plan, and an orchestrator — so `runCampaign(db, …)` fetches companies, detects grounded signals, and produces scored leads end-to-end, fully tested, with no UI yet.

**Architecture:** A campaign reads a vendor's approved mappings to build a *sourcing plan*, hands it to a `CompanySourceAdapter` (fixture in this plan; live Crustdata in a later plan), runs pure detectors over the returned company records to write grounded `signal_observations`, calls the existing `generateLeads` to score matches, and records which leads the run surfaced plus a per-company snapshot for the imminent V2 memory. This plan mirrors radar's existing tender/jobs sourcing pipeline (`SourceAdapter.fetch()` → pure detector → `resolveCompany` → upsert observation → `generateLeads`) exactly.

**Tech Stack:** TypeScript (strict), Next.js 15, PostgreSQL (Neon) + Drizzle ORM, drizzle-kit migrations, Zod, Vitest (integration tests hit a real Neon test branch).

## Global Constraints

- **Node ≥ 22.** ESM + `tsx` for scripts.
- **Design spec is authoritative:** `docs/superpowers/specs/2026-07-06-campaigns-design.md`. This plan implements its Phase A (core).
- **Test location (deliberate deviation from the global colocate rule):** radar keeps all tests under `tests/unit/` (DB-free) and `tests/integration/` (DB-backed) — 40 existing files. Follow this convention for consistency, NOT the `foo.test.ts`-beside-`foo.ts` global default. Flagged for the operator.
- **DB-free modules use a type-only DB import:** `import type { DB } from "@/db/client";` — never a value import (the runtime client is env-eager and would break unit tests / client bundles). Pattern copied from `src/lib/sourcing/leads.ts:2`.
- **Every observation carries proof:** `evidence` is always non-empty (the grounding rule). Detectors emit only for *approved* signals.
- **Missing = null, not zero:** company numeric fields are nullable; a missing figure never becomes `0`. This is load-bearing for the imminent V2 fingerprint memory.
- **Idempotent writes:** observations upsert via `onConflictDoNothing` on `(signal_id, company_id, source_ref)`; leads upsert via the existing `(vendor_id, company_id, matched_mapping_id)` unique index.
- **Neon requires `prepare: false`** on the pooled endpoint (already handled by `src/db/client.ts` and the test helper).
- **Seed/script runner pattern:** a `seedX(db)` function that does NOT own the connection, plus a `if (process.argv[1]?.endsWith("<file>.ts")) { … }` direct-run block — copied verbatim from `src/db/seed-signals.ts:46-62`.
- **Branch:** all work on `feature/campaigns` (already checked out). One commit per task.
- **Signal reconciliation (vs the spec's illustrative IDs):** reuse the existing seeds `SIG-MONEY-FUNDING` (family `money`) and `SIG-HIRING-OPS-SURGE` (family `hiring`); add two new definitions — `SIG-EXP-HEADCOUNT-GROWTH` (family `expansion`, positive) and `SIG-HIRING-OPS-INHOUSE` (family `hiring`, **polarity `negative`** so `scoreMapping` treats it as a disqualifier — the enum is `positive|negative|contextual`, there is no "counter").
- **Thresholds (named constants):** headcount-growth fires at `>= 15%` 12-month growth; ops-hiring fires at `>= 5` operator-classified roles (matches the existing `SIG-HIRING-OPS-SURGE` trigger rule).

---

### Task 1: Campaign schema + migration

**Files:**
- Modify: `src/db/schema/enums.ts` (append the campaign status enum)
- Create: `src/db/schema/campaigns.ts` (`campaigns`, `campaignLeads`, `companySnapshots`)
- Modify: `src/db/schema/leads.ts` (add nullable `sourceCampaignId`)
- Modify: `src/db/schema/index.ts` (export campaigns)
- Generate: `src/db/migrations/<generated>.sql` (via drizzle-kit)
- Test: `tests/integration/campaigns-schema.test.ts`

**Interfaces:**
- Produces: tables `campaigns`, `campaign_leads`, `company_snapshots`; enum `campaign_status` = `queued|running|done|failed`; `leads.source_campaign_id` (nullable FK). Drizzle exports `campaigns`, `campaignLeads`, `companySnapshots`, `campaignStatus`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/campaigns-schema.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { campaigns, campaignLeads, companySnapshots, leads, companies, vendorProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["campaign_leads", "company_snapshots", "leads", "campaigns", "companies", "vendor_profiles"]);
});
afterAll(async () => { await closeTestDb(); });

describe("campaigns schema", () => {
  it("inserts a campaign, a company_snapshot, and links a lead via campaign_leads", async () => {
    const [v] = await testDb.insert(vendorProfiles).values({ name: "V", vendorType: "Infra" }).returning();
    const [co] = await testDb.insert(companies).values({ name: "Co", normalizedName: "co" }).returning();
    const [c] = await testDb.insert(campaigns).values({
      vendorId: v.vendorId, label: "V · India · 20", source: "company-fixture",
      status: "running", config: { geography: "IND", target: 20 },
    }).returning();
    expect(c.campaignId).toBeTruthy();
    expect(c.status).toBe("running");

    const [lead] = await testDb.insert(leads).values({
      vendorId: v.vendorId, companyId: co.companyId, intent: "x", score: 42,
      sourceCampaignId: c.campaignId,
    }).returning();
    expect(lead.sourceCampaignId).toBe(c.campaignId);

    await testDb.insert(campaignLeads).values({ campaignId: c.campaignId, leadId: lead.leadId, wasNew: true });
    await testDb.insert(companySnapshots).values({
      campaignId: c.campaignId, companyId: co.companyId,
      snapshot: { fundraiseDate: "2026-05-01", headcountTotal: 120, opsPostings: 6, score: 42 },
    });

    const links = await testDb.select().from(campaignLeads).where(eq(campaignLeads.campaignId, c.campaignId));
    expect(links).toHaveLength(1);
    expect(links[0].wasNew).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/campaigns-schema.test.ts`
Expected: FAIL — `campaigns` / `campaignLeads` / `companySnapshots` are not exported from `@/db/schema` (compile error).

- [ ] **Step 3: Add the enum**

Append to `src/db/schema/enums.ts`:
```ts
// Campaign run lifecycle (§5.1). `queued` reserved for V2 async/scheduled runs.
export const campaignStatus = pgEnum("campaign_status", ["queued", "running", "done", "failed"]);
```

- [ ] **Step 4: Create the campaigns schema file**

Create `src/db/schema/campaigns.ts`:
```ts
import { pgTable, uuid, text, jsonb, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { campaignStatus } from "./enums";
import { vendorProfiles } from "./vendors";
import { companies } from "./companies";
import { leads } from "./leads";

export const campaigns = pgTable("campaigns", {
  campaignId: uuid("campaign_id").primaryKey().defaultRandom(),
  vendorId: uuid("vendor_id").notNull().references(() => vendorProfiles.vendorId),
  label: text("label").notNull(),
  config: jsonb("config"),              // { geography, target, enrichTop?, mappingIds? }
  source: text("source").notNull(),     // "company-fixture" | "crustdata"
  status: campaignStatus("status").notNull().default("running"),
  stats: jsonb("stats"),                // { companiesFetched, observationsWritten, leadsCreated, leadsUpdated, creditsSpent }
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const campaignLeads = pgTable("campaign_leads", {
  campaignLeadId: uuid("campaign_lead_id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.campaignId),
  leadId: uuid("lead_id").notNull().references(() => leads.leadId),
  wasNew: boolean("was_new").notNull(),
}, (t) => [
  uniqueIndex("campaign_leads_campaign_lead_uq").on(t.campaignId, t.leadId),
]);

// Write-only in v1; v2 fingerprint memory reads + diffs these (spec §16.1).
export const companySnapshots = pgTable("company_snapshots", {
  snapshotId: uuid("snapshot_id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.campaignId),
  companyId: uuid("company_id").notNull().references(() => companies.companyId),
  snapshot: jsonb("snapshot").notNull(),  // { fundraiseDate, headcountTotal, opsPostings, score }
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 5: Add the nullable FK on leads**

In `src/db/schema/leads.ts`, add the import and the column. Change the import line at the top to include a forward reference — Drizzle allows referencing `campaigns` by lazy callback, so import it:
```ts
import { campaigns } from "./campaigns";
```
Add this column inside the `leads` table definition, right after the `score` line (`score: real("score"),`):
```ts
  sourceCampaignId: uuid("source_campaign_id").references(() => campaigns.campaignId),  // nullable — first campaign that created this lead (spec §5.4)
```
Note: `campaigns.ts` imports `leads` and `leads.ts` imports `campaigns` — this is a safe circular *type* import because both use lazy `() => …` reference callbacks (Drizzle resolves them at query build time, not module load). This is the standard Drizzle pattern; do not try to break the cycle.

- [ ] **Step 6: Export the new schema**

In `src/db/schema/index.ts`, add after `export * from "./leads";`:
```ts
export * from "./campaigns";
```

- [ ] **Step 7: Generate the migration**

Run: `npm run db:generate`
Expected: drizzle-kit prints a new migration file under `src/db/migrations/` creating `campaign_status`, `campaigns`, `campaign_leads`, `company_snapshots`, and altering `leads` to add `source_campaign_id`. This is purely additive (new tables + one nullable column), so drizzle-kit does NOT prompt — it should complete non-interactively. If it prompts about a rename, answer by choosing "create" (never a rename); a hang means a column-swap ambiguity that should not occur here.

- [ ] **Step 8: Run the schema test to verify it passes**

Run: `npx vitest run tests/integration/campaigns-schema.test.ts`
Expected: PASS (the test helper's `migrateTestDb()` applies the new migration to the test branch).

- [ ] **Step 9: Commit**

```bash
git add src/db/schema/enums.ts src/db/schema/campaigns.ts src/db/schema/leads.ts src/db/schema/index.ts src/db/migrations tests/integration/campaigns-schema.test.ts
git commit -m "feat(campaigns): schema — campaigns, campaign_leads, company_snapshots + leads.source_campaign_id"
```

---

### Task 2: Seed the ops signal + mapping config (no vendor, no company)

**Files:**
- Create: `src/db/seed-ops-signals.ts`
- Modify: `package.json` (add `db:seed:ops-signals` script)
- Test: `tests/integration/seed-ops-signals.test.ts`

**Interfaces:**
- Produces: `seedOpsSignals(db: DB): Promise<{ signalsInserted: number; mappingInserted: number }>`. Inserts signal defs `SIG-EXP-HEADCOUNT-GROWTH`, `SIG-HIRING-OPS-INHOUSE`, and the mapping "Ops expansion — pursue" (`serves_vendor_type: "Infra"`, approved). Idempotent.
- Consumes: existing seeds `SIG-MONEY-FUNDING`, `SIG-HIRING-OPS-SURGE` (assumed present from `db:seed:signals`).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/seed-ops-signals.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { seedOpsSignals } from "@/db/seed-ops-signals";
import { signalDefinitions, mappings } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["mappings", "signal_definitions"]); });
afterAll(async () => { await closeTestDb(); });

describe("seedOpsSignals", () => {
  it("inserts the headcount-growth signal, the negative in-house counter, and the approved ops mapping", async () => {
    const res = await seedOpsSignals(testDb);
    expect(res.signalsInserted).toBe(2);
    expect(res.mappingInserted).toBe(1);

    const [hc] = await testDb.select().from(signalDefinitions).where(eq(signalDefinitions.signalId, "SIG-EXP-HEADCOUNT-GROWTH"));
    expect(hc.family).toBe("expansion");
    expect(hc.status).toBe("approved");

    const [counter] = await testDb.select().from(signalDefinitions).where(eq(signalDefinitions.signalId, "SIG-HIRING-OPS-INHOUSE"));
    expect(counter.polarity).toBe("negative");

    const [m] = await testDb.select().from(mappings).where(eq(mappings.name, "Ops expansion — pursue"));
    expect(m.servesVendorType).toBe("Infra");
    expect(m.status).toBe("approved");
    expect(m.requiredSignals).toContain("SIG-MONEY-FUNDING");
    expect(m.requiredSignals).toContain("SIG-HIRING-OPS-SURGE");
    expect(m.disqualifiers).toContain("SIG-HIRING-OPS-INHOUSE");
  });

  it("is idempotent — a second run inserts nothing", async () => {
    await seedOpsSignals(testDb);
    const res = await seedOpsSignals(testDb);
    expect(res.signalsInserted).toBe(0);
    expect(res.mappingInserted).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/seed-ops-signals.test.ts`
Expected: FAIL — cannot find module `@/db/seed-ops-signals`.

- [ ] **Step 3: Write the seed script**

Create `src/db/seed-ops-signals.ts` (mirrors `src/db/seed-signals.ts`):
```ts
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
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add to `scripts` after `"db:seed:mappings"`:
```json
    "db:seed:ops-signals": "tsx src/db/seed-ops-signals.ts",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/seed-ops-signals.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/seed-ops-signals.ts package.json tests/integration/seed-ops-signals.test.ts
git commit -m "feat(campaigns): seed ops signal + mapping config (no vendor/company)"
```

---

### Task 3: Company signal detectors (pure)

**Files:**
- Create: `src/lib/sourcing/company-schema.ts`
- Test: `tests/unit/company-detectors.test.ts`

**Interfaces:**
- Produces:
  - Types `CompanyRecord`, `CompanyQuery`, `CompanySourceAdapter`, `DetectedCompanyObservation`, `SignalFamily`.
  - `companyRecordSchema` (Zod).
  - Consts `FUNDING_SIGNAL="SIG-MONEY-FUNDING"`, `HEADCOUNT_SIGNAL="SIG-EXP-HEADCOUNT-GROWTH"`, `OPS_HIRING_SIGNAL="SIG-HIRING-OPS-SURGE"`, `OPS_INHOUSE_SIGNAL="SIG-HIRING-OPS-INHOUSE"`, `HEADCOUNT_GROWTH_PCT=15`, `OPS_POSTINGS_MIN=5`.
  - `classifyOpsTitle(title: string): "operator" | "engineer" | null`
  - `detectCompanySignals(record: CompanyRecord, approvedSignalIds: Set<string>, now: Date): DetectedCompanyObservation[]`
- `DetectedCompanyObservation` = `{ signalId; sourceRef; source; detectedAt: string; evidence: string[]; companyName: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/company-detectors.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  classifyOpsTitle, detectCompanySignals,
  FUNDING_SIGNAL, HEADCOUNT_SIGNAL, OPS_HIRING_SIGNAL, OPS_INHOUSE_SIGNAL,
  type CompanyRecord,
} from "@/lib/sourcing/company-schema";

const NOW = new Date("2026-07-06T00:00:00Z");
const approved = new Set([FUNDING_SIGNAL, HEADCOUNT_SIGNAL, OPS_HIRING_SIGNAL, OPS_INHOUSE_SIGNAL]);

function rec(over: Partial<CompanyRecord> = {}): CompanyRecord {
  return { name: "Anveshan", sourceName: "fixture", sourceRef: "anveshan.com", ...over };
}

describe("classifyOpsTitle", () => {
  it("classifies operator vs engineer vs unrelated", () => {
    expect(classifyOpsTitle("Warehouse Operations Lead")).toBe("operator");
    expect(classifyOpsTitle("Supply Chain Manager")).toBe("operator");
    expect(classifyOpsTitle("DevOps Engineer")).toBe("engineer");
    expect(classifyOpsTitle("Operations Software Engineer")).toBe("engineer");
    expect(classifyOpsTitle("Frontend Designer")).toBeNull();
  });
});

describe("detectCompanySignals", () => {
  it("emits a funding signal with proof when funding is present", () => {
    const obs = detectCompanySignals(rec({ funding: { lastRoundType: "series_b", amountUsd: 12700000, date: "2026-05-29" } }), approved, NOW);
    const f = obs.find((o) => o.signalId === FUNDING_SIGNAL);
    expect(f).toBeTruthy();
    expect(f!.detectedAt).toBe("2026-05-29");
    expect(f!.evidence.length).toBeGreaterThan(0);
    expect(f!.companyName).toBe("Anveshan");
  });

  it("does NOT emit funding when funding is missing (missing != zero)", () => {
    const obs = detectCompanySignals(rec({ funding: null }), approved, NOW);
    expect(obs.find((o) => o.signalId === FUNDING_SIGNAL)).toBeUndefined();
  });

  it("emits headcount growth at/above 15% only", () => {
    expect(detectCompanySignals(rec({ headcount: { total: 160, growth12mPct: 30 } }), approved, NOW).some((o) => o.signalId === HEADCOUNT_SIGNAL)).toBe(true);
    expect(detectCompanySignals(rec({ headcount: { total: 160, growth12mPct: 4 } }), approved, NOW).some((o) => o.signalId === HEADCOUNT_SIGNAL)).toBe(false);
    expect(detectCompanySignals(rec({ headcount: { total: 160, growth12mPct: null } }), approved, NOW).some((o) => o.signalId === HEADCOUNT_SIGNAL)).toBe(false);
  });

  it("emits ops-hiring at >=5 operator roles, and the negative in-house counter when engineer roles exist", () => {
    const postings = [
      { title: "Warehouse Lead" }, { title: "Supply Chain Manager" }, { title: "Logistics Executive" },
      { title: "Fulfilment Associate" }, { title: "Dispatch Supervisor" }, { title: "DevOps Engineer" },
    ];
    const obs = detectCompanySignals(rec({ jobPostings: postings }), approved, NOW);
    expect(obs.some((o) => o.signalId === OPS_HIRING_SIGNAL)).toBe(true);
    expect(obs.some((o) => o.signalId === OPS_INHOUSE_SIGNAL)).toBe(true);
  });

  it("does not emit ops-hiring below the threshold", () => {
    const obs = detectCompanySignals(rec({ jobPostings: [{ title: "Warehouse Lead" }] }), approved, NOW);
    expect(obs.some((o) => o.signalId === OPS_HIRING_SIGNAL)).toBe(false);
  });

  it("emits nothing for a signal that is not approved", () => {
    const obs = detectCompanySignals(rec({ funding: { date: "2026-05-29" } }), new Set(), NOW);
    expect(obs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/company-detectors.test.ts`
Expected: FAIL — cannot find module `@/lib/sourcing/company-schema`.

- [ ] **Step 3: Write the company schema + detectors**

Create `src/lib/sourcing/company-schema.ts`:
```ts
import { z } from "zod";

export type SignalFamily = "hiring" | "procurement" | "money" | "expansion" | "leadership" | "digital";

export const FUNDING_SIGNAL = "SIG-MONEY-FUNDING";
export const HEADCOUNT_SIGNAL = "SIG-EXP-HEADCOUNT-GROWTH";
export const OPS_HIRING_SIGNAL = "SIG-HIRING-OPS-SURGE";
export const OPS_INHOUSE_SIGNAL = "SIG-HIRING-OPS-INHOUSE";

export const HEADCOUNT_GROWTH_PCT = 15;
export const OPS_POSTINGS_MIN = 5;

// "operations" (not bare "ops") so "DevOps" never false-matches as an operator role.
const OPS_OPERATOR_TERMS = ["operations", "warehouse", "inventory", "supply chain", "logistics", "fulfil", "dispatch", "distribution"];
const OPS_ENGINEER_TERMS = ["engineer", "developer", "software", "sde", "devops", "platform", "architect"];

const dateString = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid date" });

export const companyRecordSchema = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  country: z.string().optional(),
  funding: z.object({
    lastRoundType: z.string().optional(),
    amountUsd: z.number().nullable().optional(),
    date: dateString.optional(),
  }).nullable().optional(),
  headcount: z.object({
    total: z.number().nullable().optional(),
    growth12mPct: z.number().nullable().optional(),
  }).nullable().optional(),
  jobPostings: z.array(z.object({ title: z.string().min(1), updatedAt: dateString.optional() })).optional(),
  sourceName: z.string().min(1),
  sourceRef: z.string().min(1),
});
export type CompanyRecord = z.infer<typeof companyRecordSchema>;

/** What a campaign asks a provider for — built from the vendor's sourcing plan. */
export type CompanyQuery = {
  geography: string;
  target: number;
  fundedSinceDays?: number;
  signalFamilies: SignalFamily[];
};

export interface CompanySourceAdapter {
  readonly sourceName: string;
  fetch(query: CompanyQuery): Promise<{ records: CompanyRecord[]; skippedMalformed: number }>;
}

export type DetectedCompanyObservation = {
  signalId: string;
  sourceRef: string;
  source: string;
  detectedAt: string;    // ISO
  evidence: string[];    // always non-empty
  companyName: string;
};

export function classifyOpsTitle(title: string): "operator" | "engineer" | null {
  const t = title.toLowerCase();
  const isOps = OPS_OPERATOR_TERMS.some((k) => t.includes(k));
  if (!isOps) return null;
  const isEng = OPS_ENGINEER_TERMS.some((k) => t.includes(k));
  return isEng ? "engineer" : "operator";
}

/** Run every company detector over one record. Pure. Emits only for approved signals; evidence always non-empty. */
export function detectCompanySignals(
  record: CompanyRecord,
  approvedSignalIds: Set<string>,
  now: Date,
): DetectedCompanyObservation[] {
  const out: DetectedCompanyObservation[] = [];
  const base = { sourceRef: record.sourceRef, source: record.sourceName, companyName: record.name };

  // Funding — emit when a fundraise with a date is present.
  if (approvedSignalIds.has(FUNDING_SIGNAL) && record.funding?.date) {
    const f = record.funding;
    const amount = f.amountUsd != null ? `$${(f.amountUsd / 1_000_000).toFixed(1)}M` : "amount undisclosed";
    out.push({
      ...base, signalId: FUNDING_SIGNAL, detectedAt: f.date,
      evidence: [`Raised ${f.lastRoundType ?? "a round"} (${amount}) on ${f.date}`, `source: ${record.sourceName}`],
    });
  }

  // Headcount growth — emit at/above threshold; missing growth never fires.
  const g = record.headcount?.growth12mPct;
  if (approvedSignalIds.has(HEADCOUNT_SIGNAL) && g != null && g >= HEADCOUNT_GROWTH_PCT) {
    out.push({
      ...base, signalId: HEADCOUNT_SIGNAL, detectedAt: now.toISOString(),
      evidence: [`Headcount grew ${g}% over 12 months` + (record.headcount?.total != null ? ` (now ~${record.headcount.total})` : "")],
    });
  }

  // Ops hiring — split operator (buy signal) vs engineer (negative counter).
  const postings = record.jobPostings ?? [];
  const operatorTitles = postings.map((p) => p.title).filter((t) => classifyOpsTitle(t) === "operator");
  const engineerTitles = postings.map((p) => p.title).filter((t) => classifyOpsTitle(t) === "engineer");

  if (approvedSignalIds.has(OPS_HIRING_SIGNAL) && operatorTitles.length >= OPS_POSTINGS_MIN) {
    out.push({
      ...base, signalId: OPS_HIRING_SIGNAL, detectedAt: now.toISOString(),
      evidence: [`${operatorTitles.length} open ops-operator roles`, `e.g. ${operatorTitles.slice(0, 3).join(", ")}`],
    });
  }
  if (approvedSignalIds.has(OPS_INHOUSE_SIGNAL) && engineerTitles.length > 0) {
    out.push({
      ...base, signalId: OPS_INHOUSE_SIGNAL, detectedAt: now.toISOString(),
      evidence: [`${engineerTitles.length} ops-engineering roles (may be building ops in-house)`, `e.g. ${engineerTitles.slice(0, 3).join(", ")}`],
    });
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/company-detectors.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourcing/company-schema.ts tests/unit/company-detectors.test.ts
git commit -m "feat(campaigns): pure company signal detectors (funding, headcount, ops-hiring + in-house counter)"
```

---

### Task 4: Company fixture adapter (test scaffolding)

**Files:**
- Create: `src/lib/sourcing/fixtures/companies-sample.json`
- Create: `src/lib/sourcing/adapters/company-fixture.ts`
- Test: `tests/unit/company-fixture.test.ts`

**Interfaces:**
- Consumes: `CompanySourceAdapter`, `companyRecordSchema`, `CompanyRecord`, `CompanyQuery` (Task 3).
- Produces: `createCompanyFixtureAdapter(raw?: unknown[]): CompanySourceAdapter`. `fetch(query)` validates each record, returns up to `query.target` valid records + `skippedMalformed` count. No network.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/company-fixture.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createCompanyFixtureAdapter } from "@/lib/sourcing/adapters/company-fixture";
import type { CompanyQuery } from "@/lib/sourcing/company-schema";

const query: CompanyQuery = { geography: "IND", target: 2, signalFamilies: ["money", "hiring"] };

describe("createCompanyFixtureAdapter", () => {
  it("returns valid records and counts malformed ones", async () => {
    const adapter = createCompanyFixtureAdapter([
      { name: "Good Co", sourceName: "fixture", sourceRef: "good.com", funding: { date: "2026-05-01" } },
      { name: "", sourceName: "fixture", sourceRef: "bad.com" }, // malformed: empty name
    ]);
    const { records, skippedMalformed } = await adapter.fetch(query);
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe("Good Co");
    expect(skippedMalformed).toBe(1);
  });

  it("caps results at query.target", async () => {
    const raw = Array.from({ length: 5 }, (_, i) => ({ name: `Co ${i}`, sourceName: "fixture", sourceRef: `co${i}.com` }));
    const { records } = await createCompanyFixtureAdapter(raw).fetch(query);
    expect(records).toHaveLength(2);
  });

  it("ships a non-empty default fixture set", async () => {
    const { records } = await createCompanyFixtureAdapter().fetch({ ...query, target: 100 });
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.name && r.sourceRef)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/company-fixture.test.ts`
Expected: FAIL — cannot find module `@/lib/sourcing/adapters/company-fixture`.

- [ ] **Step 3: Create the fixture data**

Create `src/lib/sourcing/fixtures/companies-sample.json` (TEST-ONLY scaffolding — never in the operator's live path; realistic ops-scaling shapes):
```json
[
  { "name": "Anveshan", "domain": "anveshan.com", "country": "IND", "sourceName": "company-fixture", "sourceRef": "anveshan.com",
    "funding": { "lastRoundType": "series_b", "amountUsd": 12700000, "date": "2026-05-29" },
    "headcount": { "total": 162, "growth12mPct": 30 },
    "jobPostings": [ { "title": "Warehouse Lead" }, { "title": "Supply Chain Manager" }, { "title": "Logistics Executive" }, { "title": "Fulfilment Associate" }, { "title": "Dispatch Supervisor" } ] },
  { "name": "Nimbus Retail", "domain": "nimbusretail.in", "country": "IND", "sourceName": "company-fixture", "sourceRef": "nimbusretail.in",
    "funding": { "lastRoundType": "series_a", "amountUsd": 6000000, "date": "2026-04-10" },
    "headcount": { "total": 90, "growth12mPct": 8 },
    "jobPostings": [ { "title": "Operations Software Engineer" }, { "title": "DevOps Engineer" } ] },
  { "name": "Harbor Foods", "domain": "harborfoods.in", "country": "IND", "sourceName": "company-fixture", "sourceRef": "harborfoods.in",
    "funding": null,
    "headcount": { "total": 240, "growth12mPct": 18 },
    "jobPostings": [ { "title": "Warehouse Operations Manager" }, { "title": "Inventory Planner" }, { "title": "Distribution Lead" }, { "title": "Logistics Coordinator" }, { "title": "Dispatch Executive" }, { "title": "Supply Chain Analyst" } ] }
]
```

- [ ] **Step 4: Write the adapter**

Create `src/lib/sourcing/adapters/company-fixture.ts`:
```ts
import { companyRecordSchema, type CompanySourceAdapter, type CompanyRecord, type CompanyQuery } from "@/lib/sourcing/company-schema";
import rawCompanies from "../fixtures/companies-sample.json";

/**
 * Fixture-first company adapter — TEST/DEV scaffolding, no network. Validates each
 * record against companyRecordSchema, reports malformed count, and caps at query.target.
 * The operator's real runs use the live Crustdata adapter (a later plan), not this.
 */
export function createCompanyFixtureAdapter(raw: unknown[] = rawCompanies as unknown[]): CompanySourceAdapter {
  return {
    sourceName: "company-fixture",
    async fetch(query: CompanyQuery) {
      const records: CompanyRecord[] = [];
      let skippedMalformed = 0;
      for (const entry of raw) {
        const parsed = companyRecordSchema.safeParse(entry);
        if (parsed.success) records.push(parsed.data);
        else skippedMalformed++;
      }
      return { records: records.slice(0, query.target), skippedMalformed };
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/company-fixture.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sourcing/fixtures/companies-sample.json src/lib/sourcing/adapters/company-fixture.ts tests/unit/company-fixture.test.ts
git commit -m "feat(campaigns): company fixture adapter (test scaffolding)"
```

---

### Task 5: buildSourcingPlan (pure)

**Files:**
- Create: `src/lib/campaigns/plan.ts`
- Test: `tests/unit/sourcing-plan.test.ts`

**Interfaces:**
- Consumes: `SignalFamily`, `CompanyQuery` (Task 3).
- Produces:
  - Types `PlanVendor = { vendorType: string | null }`, `PlanMapping = { requiredSignals: string[] | null; supportingSignals: string[] | null; timingWindowDays: number | null }`, `PlanSignalDef = { signalId: string; family: SignalFamily; freshnessWindowDays: number | null }`, `SourcingPlan = { signalFamilies: SignalFamily[]; fundedSinceDays: number; runnable: boolean }`.
  - `buildSourcingPlan(vendor: PlanVendor, approvedMappings: PlanMapping[], signalDefs: PlanSignalDef[]): SourcingPlan` — collects the families of every required/supporting signal across the vendor's approved mappings; `fundedSinceDays` = max freshness window among money-family signals (fallback 365); `runnable` = at least one signal family resolved.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/sourcing-plan.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildSourcingPlan, type PlanMapping, type PlanSignalDef } from "@/lib/campaigns/plan";

const defs: PlanSignalDef[] = [
  { signalId: "SIG-MONEY-FUNDING", family: "money", freshnessWindowDays: 365 },
  { signalId: "SIG-HIRING-OPS-SURGE", family: "hiring", freshnessWindowDays: 60 },
  { signalId: "SIG-EXP-HEADCOUNT-GROWTH", family: "expansion", freshnessWindowDays: 365 },
];
const opsMapping: PlanMapping = {
  requiredSignals: ["SIG-MONEY-FUNDING", "SIG-HIRING-OPS-SURGE"],
  supportingSignals: ["SIG-EXP-HEADCOUNT-GROWTH"],
  timingWindowDays: 365,
};

describe("buildSourcingPlan", () => {
  it("collects the families the vendor's approved mappings need", () => {
    const plan = buildSourcingPlan({ vendorType: "Infra" }, [opsMapping], defs);
    expect(plan.signalFamilies.sort()).toEqual(["expansion", "hiring", "money"]);
    expect(plan.fundedSinceDays).toBe(365);
    expect(plan.runnable).toBe(true);
  });

  it("is not runnable when the vendor has no approved mappings", () => {
    const plan = buildSourcingPlan({ vendorType: "Infra" }, [], defs);
    expect(plan.runnable).toBe(false);
    expect(plan.signalFamilies).toEqual([]);
  });

  it("falls back to 365 funded-since days when no money signal is present", () => {
    const hiringOnly: PlanMapping = { requiredSignals: ["SIG-HIRING-OPS-SURGE"], supportingSignals: [], timingWindowDays: 60 };
    const plan = buildSourcingPlan({ vendorType: "Infra" }, [hiringOnly], defs);
    expect(plan.fundedSinceDays).toBe(365);
    expect(plan.signalFamilies).toEqual(["hiring"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sourcing-plan.test.ts`
Expected: FAIL — cannot find module `@/lib/campaigns/plan`.

- [ ] **Step 3: Write the plan builder**

Create `src/lib/campaigns/plan.ts`:
```ts
import type { SignalFamily } from "@/lib/sourcing/company-schema";

export type PlanVendor = { vendorType: string | null };
export type PlanMapping = {
  requiredSignals: string[] | null;
  supportingSignals: string[] | null;
  timingWindowDays: number | null;
};
export type PlanSignalDef = { signalId: string; family: SignalFamily; freshnessWindowDays: number | null };

export type SourcingPlan = {
  signalFamilies: SignalFamily[];
  fundedSinceDays: number;
  runnable: boolean;
};

const DEFAULT_FUNDED_SINCE_DAYS = 365;

/**
 * Derive what to source from the vendor's APPROVED mappings: every signal they
 * require or support resolves to a family; the union of families is what the
 * campaign fetches. Pure — the DB read happens in the caller.
 */
export function buildSourcingPlan(
  vendor: PlanVendor,
  approvedMappings: PlanMapping[],
  signalDefs: PlanSignalDef[],
): SourcingPlan {
  const familyBySignal = new Map(signalDefs.map((d) => [d.signalId, d.family]));
  const windowBySignal = new Map(signalDefs.map((d) => [d.signalId, d.freshnessWindowDays]));

  const families = new Set<SignalFamily>();
  let fundedSinceDays = DEFAULT_FUNDED_SINCE_DAYS;

  for (const m of approvedMappings) {
    for (const sig of [...(m.requiredSignals ?? []), ...(m.supportingSignals ?? [])]) {
      const fam = familyBySignal.get(sig);
      if (fam) families.add(fam);
      if (fam === "money") {
        fundedSinceDays = Math.max(fundedSinceDays, windowBySignal.get(sig) ?? DEFAULT_FUNDED_SINCE_DAYS);
      }
    }
  }

  const signalFamilies = [...families].sort();
  return { signalFamilies, fundedSinceDays, runnable: signalFamilies.length > 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sourcing-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaigns/plan.ts tests/unit/sourcing-plan.test.ts
git commit -m "feat(campaigns): buildSourcingPlan — derive what to source from a vendor's approved mappings"
```

---

### Task 6: Ingest company observations (DB)

**Files:**
- Create: `src/lib/campaigns/ingest.ts`
- Test: `tests/integration/campaigns-ingest.test.ts`

**Interfaces:**
- Consumes: `resolveCompany` (`@/lib/sourcing/data.ts`), `computeFreshnessVerdict` (`@/lib/sourcing/schema.ts`), `detectCompanySignals`, `CompanySourceAdapter`, `CompanyQuery`, `CompanyRecord` (Task 3).
- Produces:
  - Type `RawSnapshot = { fundraiseDate: string | null; headcountTotal: number | null; opsPostings: number | null }`.
  - Type `TouchedCompany = { companyId: string; name: string; snapshot: RawSnapshot }`.
  - Type `CompanyIngestResult = { scanned; detected; written; skippedDuplicates; skippedMalformed; touched: TouchedCompany[] }`.
  - `ingestCompanyObservations(db: DB, adapter: CompanySourceAdapter, query: CompanyQuery): Promise<CompanyIngestResult>`.
  - `listApprovedCompanySignals(db: DB): Promise<{ signalId: string; freshnessWindowDays: number | null }[]>` (the money/expansion/hiring signals).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/campaigns-ingest.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { signalDefinitions, signalObservations, companies } from "@/db/schema";
import { ingestCompanyObservations } from "@/lib/campaigns/ingest";
import { createCompanyFixtureAdapter } from "@/lib/sourcing/adapters/company-fixture";
import { FUNDING_SIGNAL, HEADCOUNT_SIGNAL, OPS_HIRING_SIGNAL, type CompanyQuery } from "@/lib/sourcing/company-schema";
import { eq } from "drizzle-orm";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["signal_observations", "signal_definitions", "companies"]); });
afterAll(async () => { await closeTestDb(); });

const QUERY: CompanyQuery = { geography: "IND", target: 10, fundedSinceDays: 365, signalFamilies: ["money", "hiring", "expansion"] };

async function approve(signalId: string, family: string, freshnessWindowDays: number | null, polarity = "positive") {
  await testDb.insert(signalDefinitions).values({
    signalId, name: `S ${signalId}`, family: family as never, strength: "medium",
    falsePositiveRisk: "medium", polarity: polarity as never, freshnessWindowDays, status: "approved", origin: "seed",
  }).onConflictDoNothing();
}

describe("ingestCompanyObservations", () => {
  it("writes grounded observations, resolves companies, and returns touched companies with a snapshot", async () => {
    await approve(FUNDING_SIGNAL, "money", 365);
    await approve(HEADCOUNT_SIGNAL, "expansion", 365);
    await approve(OPS_HIRING_SIGNAL, "hiring", 60);

    const res = await ingestCompanyObservations(testDb, createCompanyFixtureAdapter(), QUERY);

    expect(res.written).toBeGreaterThan(0);
    expect(res.touched.length).toBeGreaterThan(0);

    // Anveshan: funding + headcount(30%) + ops-hiring(5 operators) all fire, and it has a snapshot.
    const anveshan = res.touched.find((t) => t.name === "Anveshan");
    expect(anveshan).toBeTruthy();
    expect(anveshan!.snapshot.fundraiseDate).toBe("2026-05-29");
    expect(anveshan!.snapshot.headcountTotal).toBe(162);
    expect(anveshan!.snapshot.opsPostings).toBe(5);

    const obs = await testDb.select().from(signalObservations).where(eq(signalObservations.companyId, anveshan!.companyId));
    expect(obs.map((o) => o.signalId).sort()).toContain(FUNDING_SIGNAL);
    expect(obs.every((o) => o.evidence.length > 0)).toBe(true);
    expect((await testDb.select().from(companies)).length).toBe(res.touched.length);
  });

  it("is idempotent — a second run writes 0 new observations", async () => {
    await approve(FUNDING_SIGNAL, "money", 365);
    const first = await ingestCompanyObservations(testDb, createCompanyFixtureAdapter(), QUERY);
    const second = await ingestCompanyObservations(testDb, createCompanyFixtureAdapter(), QUERY);
    expect(first.written).toBeGreaterThan(0);
    expect(second.written).toBe(0);
    expect(second.skippedDuplicates).toBe(first.written);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/campaigns-ingest.test.ts`
Expected: FAIL — cannot find module `@/lib/campaigns/ingest`.

- [ ] **Step 3: Write the ingest orchestration**

Create `src/lib/campaigns/ingest.ts`:
```ts
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — never load the env-eager client
import { signalDefinitions, signalObservations } from "@/db/schema";
import { resolveCompany } from "@/lib/sourcing/data";
import { computeFreshnessVerdict } from "@/lib/sourcing/schema";
import {
  detectCompanySignals, classifyOpsTitle,
  FUNDING_SIGNAL, HEADCOUNT_SIGNAL, OPS_HIRING_SIGNAL, OPS_INHOUSE_SIGNAL,
  type CompanySourceAdapter, type CompanyQuery, type CompanyRecord,
} from "@/lib/sourcing/company-schema";

const COMPANY_SIGNAL_IDS = [FUNDING_SIGNAL, HEADCOUNT_SIGNAL, OPS_HIRING_SIGNAL, OPS_INHOUSE_SIGNAL];

export type RawSnapshot = { fundraiseDate: string | null; headcountTotal: number | null; opsPostings: number | null };
export type TouchedCompany = { companyId: string; name: string; snapshot: RawSnapshot };
export type CompanyIngestResult = {
  scanned: number; detected: number; written: number;
  skippedDuplicates: number; skippedMalformed: number; touched: TouchedCompany[];
};

export async function listApprovedCompanySignals(db: DB): Promise<{ signalId: string; freshnessWindowDays: number | null }[]> {
  return db
    .select({ signalId: signalDefinitions.signalId, freshnessWindowDays: signalDefinitions.freshnessWindowDays })
    .from(signalDefinitions)
    .where(and(eq(signalDefinitions.status, "approved"), inArray(signalDefinitions.signalId, COMPANY_SIGNAL_IDS)));
}

function rawSnapshot(record: CompanyRecord): RawSnapshot {
  const opsPostings = (record.jobPostings ?? []).filter((p) => classifyOpsTitle(p.title) === "operator").length;
  return {
    fundraiseDate: record.funding?.date ?? null,
    headcountTotal: record.headcount?.total ?? null,
    opsPostings: record.jobPostings ? opsPostings : null,   // null (not 0) when we never saw postings
  };
}

/**
 * One company sourcing run: fetch → detect → resolve entity → upsert observation.
 * Idempotent via the (signal_id, company_id, source_ref) unique index. Caller owns the connection.
 */
export async function ingestCompanyObservations(
  db: DB, adapter: CompanySourceAdapter, query: CompanyQuery,
): Promise<CompanyIngestResult> {
  const { records, skippedMalformed } = await adapter.fetch(query);
  const defs = await listApprovedCompanySignals(db);
  const approvedIds = new Set(defs.map((d) => d.signalId));
  const windowBySignal = new Map(defs.map((d) => [d.signalId, d.freshnessWindowDays]));
  const now = new Date();

  let detected = 0, written = 0, skippedDuplicates = 0;
  const touched = new Map<string, TouchedCompany>();

  for (const record of records) {
    const observations = detectCompanySignals(record, approvedIds, now);
    if (observations.length === 0) continue;

    const { companyId } = await resolveCompany(db, record.name);
    if (!touched.has(companyId)) touched.set(companyId, { companyId, name: record.name, snapshot: rawSnapshot(record) });

    for (const obs of observations) {
      detected++;
      const detectedAt = new Date(obs.detectedAt);
      const freshnessVerdict = computeFreshnessVerdict(detectedAt, windowBySignal.get(obs.signalId) ?? null, now);
      const ins = await db
        .insert(signalObservations)
        .values({
          signalId: obs.signalId, companyId, detectedAt, source: obs.source,
          evidence: obs.evidence, freshnessVerdict, entityMatchConfidence: 1, sourceRef: obs.sourceRef,
        })
        .onConflictDoNothing({
          target: [signalObservations.signalId, signalObservations.companyId, signalObservations.sourceRef],
        })
        .returning({ id: signalObservations.observationId });
      if (ins.length > 0) written++; else skippedDuplicates++;
    }
  }

  return {
    scanned: records.length + skippedMalformed,
    detected, written, skippedDuplicates, skippedMalformed,
    touched: [...touched.values()],
  };
}
```
Note on the idempotency test: all company signals for one record share the record's `sourceRef` (the company's domain), so the `(signal_id, company_id, source_ref)` index dedups per-signal across runs — different signals coexist (different `signal_id`), a re-run of the same signal is skipped. That matches the assertion `second.written === 0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/campaigns-ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaigns/ingest.ts tests/integration/campaigns-ingest.test.ts
git commit -m "feat(campaigns): ingest company observations (fetch → detect → resolve → upsert)"
```

---

### Task 7: Campaign data access

**Files:**
- Create: `src/lib/campaigns/data.ts`
- Test: `tests/integration/campaigns-data.test.ts`

**Interfaces:**
- Produces:
  - `type CampaignStats = { companiesFetched: number; observationsWritten: number; leadsCreated: number; leadsUpdated: number; creditsSpent: number }`.
  - `type NewCampaignInput = { vendorId: string; label: string; source: string; config: unknown }`.
  - `createCampaign(db, input: NewCampaignInput): Promise<{ campaignId: string }>` (inserts with status `running`, `startedAt` now).
  - `finishCampaign(db, campaignId: string, stats: CampaignStats): Promise<void>` (status `done`, `finishedAt` now, stats set).
  - `failCampaign(db, campaignId: string, error: string): Promise<void>` (status `failed`, `finishedAt` now, error set).
  - `recordCampaignLead(db, campaignId: string, leadId: string, wasNew: boolean): Promise<void>` (idempotent on the unique index).
  - `writeCompanySnapshot(db, campaignId: string, companyId: string, snapshot: unknown): Promise<void>`.
  - `getCampaign(db, campaignId: string)` / `listCampaigns(db, vendorId?)` (read helpers).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/campaigns-data.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { campaigns, campaignLeads, companySnapshots, vendorProfiles, companies, leads } from "@/db/schema";
import { createCampaign, finishCampaign, failCampaign, recordCampaignLead, writeCompanySnapshot, getCampaign, listCampaigns } from "@/lib/campaigns/data";
import { eq } from "drizzle-orm";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["campaign_leads", "company_snapshots", "leads", "campaigns", "companies", "vendor_profiles"]);
});
afterAll(async () => { await closeTestDb(); });

async function vendor() {
  const [v] = await testDb.insert(vendorProfiles).values({ name: "V", vendorType: "Infra" }).returning();
  return v.vendorId;
}

describe("campaign data access", () => {
  it("creates a running campaign, then finishes it with stats", async () => {
    const vendorId = await vendor();
    const { campaignId } = await createCampaign(testDb, { vendorId, label: "V · India · 20", source: "company-fixture", config: { geography: "IND", target: 20 } });
    let c = await getCampaign(testDb, campaignId);
    expect(c!.status).toBe("running");
    expect(c!.startedAt).not.toBeNull();

    await finishCampaign(testDb, campaignId, { companiesFetched: 3, observationsWritten: 5, leadsCreated: 2, leadsUpdated: 1, creditsSpent: 0 });
    c = await getCampaign(testDb, campaignId);
    expect(c!.status).toBe("done");
    expect(c!.finishedAt).not.toBeNull();
    expect((c!.stats as { leadsCreated: number }).leadsCreated).toBe(2);
  });

  it("marks a campaign failed with an error message", async () => {
    const vendorId = await vendor();
    const { campaignId } = await createCampaign(testDb, { vendorId, label: "x", source: "company-fixture", config: {} });
    await failCampaign(testDb, campaignId, "adapter timeout");
    const c = await getCampaign(testDb, campaignId);
    expect(c!.status).toBe("failed");
    expect(c!.error).toBe("adapter timeout");
  });

  it("records campaign_leads idempotently and writes a snapshot", async () => {
    const vendorId = await vendor();
    const [co] = await testDb.insert(companies).values({ name: "Co", normalizedName: "co" }).returning();
    const { campaignId } = await createCampaign(testDb, { vendorId, label: "x", source: "company-fixture", config: {} });
    const [lead] = await testDb.insert(leads).values({ vendorId, companyId: co.companyId, intent: "x", score: 40 }).returning();

    await recordCampaignLead(testDb, campaignId, lead.leadId, true);
    await recordCampaignLead(testDb, campaignId, lead.leadId, true); // idempotent
    await writeCompanySnapshot(testDb, campaignId, co.companyId, { fundraiseDate: "2026-05-01", headcountTotal: 100, opsPostings: 5, score: 40 });

    const links = await testDb.select().from(campaignLeads).where(eq(campaignLeads.campaignId, campaignId));
    expect(links).toHaveLength(1);
    const snaps = await testDb.select().from(companySnapshots).where(eq(companySnapshots.campaignId, campaignId));
    expect(snaps).toHaveLength(1);

    const list = await listCampaigns(testDb, vendorId);
    expect(list).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/campaigns-data.test.ts`
Expected: FAIL — cannot find module `@/lib/campaigns/data`.

- [ ] **Step 3: Write the data access**

Create `src/lib/campaigns/data.ts`:
```ts
import { desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only
import { campaigns, campaignLeads, companySnapshots } from "@/db/schema";

export type CampaignStats = {
  companiesFetched: number; observationsWritten: number;
  leadsCreated: number; leadsUpdated: number; creditsSpent: number;
};
export type NewCampaignInput = { vendorId: string; label: string; source: string; config: unknown };

export async function createCampaign(db: DB, input: NewCampaignInput): Promise<{ campaignId: string }> {
  const [row] = await db
    .insert(campaigns)
    .values({
      vendorId: input.vendorId, label: input.label, source: input.source,
      config: input.config as never, status: "running", startedAt: new Date(),
    })
    .returning({ campaignId: campaigns.campaignId });
  return { campaignId: row.campaignId };
}

export async function finishCampaign(db: DB, campaignId: string, stats: CampaignStats): Promise<void> {
  await db.update(campaigns)
    .set({ status: "done", stats: stats as never, finishedAt: new Date() })
    .where(eq(campaigns.campaignId, campaignId));
}

export async function failCampaign(db: DB, campaignId: string, error: string): Promise<void> {
  await db.update(campaigns)
    .set({ status: "failed", error, finishedAt: new Date() })
    .where(eq(campaigns.campaignId, campaignId));
}

export async function recordCampaignLead(db: DB, campaignId: string, leadId: string, wasNew: boolean): Promise<void> {
  await db.insert(campaignLeads)
    .values({ campaignId, leadId, wasNew })
    .onConflictDoNothing({ target: [campaignLeads.campaignId, campaignLeads.leadId] });
}

export async function writeCompanySnapshot(db: DB, campaignId: string, companyId: string, snapshot: unknown): Promise<void> {
  await db.insert(companySnapshots).values({ campaignId, companyId, snapshot: snapshot as never });
}

export async function getCampaign(db: DB, campaignId: string) {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.campaignId, campaignId)).limit(1);
  return row ?? null;
}

export async function listCampaigns(db: DB, vendorId?: string) {
  const base = db.select().from(campaigns).orderBy(desc(campaigns.createdAt));
  return vendorId ? base.where(eq(campaigns.vendorId, vendorId)) : base;
}
```
Note: `.orderBy(...).where(...)` chaining above — Drizzle's query builder allows `.where()` after `.orderBy()` on the same builder; if the installed drizzle version rejects the order, build with `.where()` first then `.orderBy()`. Verify by the passing test.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/campaigns-data.test.ts`
Expected: PASS. (If the `listCampaigns` chaining errors, swap to apply `.where()` before `.orderBy()` and re-run.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaigns/data.ts tests/integration/campaigns-data.test.ts
git commit -m "feat(campaigns): campaign data access (create/finish/fail, campaign_leads, snapshots)"
```

---

### Task 8: runCampaign orchestrator

**Files:**
- Create: `src/lib/campaigns/run.ts`
- Test: `tests/integration/campaigns-run.test.ts`

**Interfaces:**
- Consumes: `getCampaign`, `finishCampaign`, `failCampaign`, `recordCampaignLead`, `writeCompanySnapshot`, `CampaignStats` (Task 7); `ingestCompanyObservations`, `listApprovedCompanySignals` (Task 6); `buildSourcingPlan` (Task 5); `generateLeads` (`@/lib/sourcing/leads.ts`); schema tables.
- Produces: `runCampaign(db: DB, opts: { campaignId: string; adapter: CompanySourceAdapter; now?: Date }): Promise<CampaignStats>`. Loads the campaign's vendor + approved mappings, builds the plan, ingests, generates leads, records `campaign_leads` + `leads.source_campaign_id` + `company_snapshots`, finishes with stats. On any throw: `failCampaign` and rethrow.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/campaigns-run.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { seedSignals } from "@/db/seed-signals";
import { seedOpsSignals } from "@/db/seed-ops-signals";
import { vendorProfiles, leads, campaignLeads, companySnapshots } from "@/db/schema";
import { createCampaign, getCampaign } from "@/lib/campaigns/data";
import { runCampaign } from "@/lib/campaigns/run";
import { createCompanyFixtureAdapter } from "@/lib/sourcing/adapters/company-fixture";
import { eq } from "drizzle-orm";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["campaign_leads", "company_snapshots", "leads", "campaigns", "signal_observations", "mappings", "signal_definitions", "companies", "vendor_profiles"]);
});
afterAll(async () => { await closeTestDb(); });

async function setup() {
  await seedSignals(testDb);       // SIG-MONEY-FUNDING, SIG-HIRING-OPS-SURGE, ...
  await seedOpsSignals(testDb);    // headcount + in-house counter + "Ops expansion — pursue" (Infra)
  const [v] = await testDb.insert(vendorProfiles).values({ name: "RackPro Infra", vendorType: "Infra" }).returning();
  return v.vendorId;
}

describe("runCampaign", () => {
  it("sources real-shaped companies and produces scored leads for the vendor", async () => {
    const vendorId = await setup();
    const { campaignId } = await createCampaign(testDb, { vendorId, label: "RackPro · India · 10", source: "company-fixture", config: { geography: "IND", target: 10 } });

    const stats = await runCampaign(testDb, { campaignId, adapter: createCompanyFixtureAdapter() });

    expect(stats.companiesFetched).toBeGreaterThan(0);
    expect(stats.leadsCreated).toBeGreaterThan(0);

    const c = await getCampaign(testDb, campaignId);
    expect(c!.status).toBe("done");

    const vendorLeads = await testDb.select().from(leads).where(eq(leads.vendorId, vendorId));
    expect(vendorLeads.length).toBe(stats.leadsCreated);
    // Anveshan fires funding + ops-hiring (both required) → a lead exists, tagged to this campaign.
    expect(vendorLeads.every((l) => l.sourceCampaignId === campaignId)).toBe(true);

    const links = await testDb.select().from(campaignLeads).where(eq(campaignLeads.campaignId, campaignId));
    expect(links.length).toBe(vendorLeads.length);
    expect(links.every((l) => l.wasNew)).toBe(true);

    const snaps = await testDb.select().from(companySnapshots).where(eq(companySnapshots.campaignId, campaignId));
    expect(snaps.length).toBeGreaterThan(0);
  });

  it("marks the campaign failed and rethrows when the adapter throws", async () => {
    const vendorId = await setup();
    const { campaignId } = await createCampaign(testDb, { vendorId, label: "x", source: "company-fixture", config: {} });
    const boom = { sourceName: "boom", async fetch() { throw new Error("provider down"); } };

    await expect(runCampaign(testDb, { campaignId, adapter: boom })).rejects.toThrow("provider down");
    const c = await getCampaign(testDb, campaignId);
    expect(c!.status).toBe("failed");
    expect(c!.error).toContain("provider down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/campaigns-run.test.ts`
Expected: FAIL — cannot find module `@/lib/campaigns/run`.

- [ ] **Step 3: Write the orchestrator**

Create `src/lib/campaigns/run.ts`:
```ts
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only
import { leads, mappings, signalDefinitions, vendorProfiles } from "@/db/schema";
import { generateLeads } from "@/lib/sourcing/leads";
import { buildSourcingPlan, type PlanMapping, type PlanSignalDef } from "@/lib/campaigns/plan";
import { ingestCompanyObservations } from "@/lib/campaigns/ingest";
import { getCampaign, finishCampaign, failCampaign, recordCampaignLead, writeCompanySnapshot, type CampaignStats } from "@/lib/campaigns/data";
import type { CompanySourceAdapter, CompanyQuery, SignalFamily } from "@/lib/sourcing/company-schema";

type LeadKey = string;
const leadKey = (companyId: string, mappingId: string | null): LeadKey => `${companyId}|${mappingId ?? ""}`;

export async function runCampaign(
  db: DB,
  opts: { campaignId: string; adapter: CompanySourceAdapter; now?: Date },
): Promise<CampaignStats> {
  const { campaignId, adapter } = opts;
  const now = opts.now ?? new Date();
  try {
    const campaign = await getCampaign(db, campaignId);
    if (!campaign) throw new Error(`campaign ${campaignId} not found`);

    // 1. Vendor + approved mappings for this vendor's type.
    const [vendor] = await db
      .select({ vendorId: vendorProfiles.vendorId, vendorType: vendorProfiles.vendorType })
      .from(vendorProfiles).where(eq(vendorProfiles.vendorId, campaign.vendorId)).limit(1);
    if (!vendor) throw new Error("vendor not found");
    const vType = (vendor.vendorType ?? "").toLowerCase();

    const approvedMappings = await db
      .select({
        requiredSignals: mappings.requiredSignals,
        supportingSignals: mappings.supportingSignals,
        timingWindowDays: mappings.timingWindowDays,
        servesVendorType: mappings.servesVendorType,
      })
      .from(mappings).where(eq(mappings.status, "approved"));
    const vendorMappings: PlanMapping[] = approvedMappings
      .filter((m) => (m.servesVendorType ?? "").toLowerCase() === vType)
      .map((m) => ({ requiredSignals: m.requiredSignals, supportingSignals: m.supportingSignals, timingWindowDays: m.timingWindowDays }));

    const defRows = await db
      .select({ signalId: signalDefinitions.signalId, family: signalDefinitions.family, freshnessWindowDays: signalDefinitions.freshnessWindowDays })
      .from(signalDefinitions).where(eq(signalDefinitions.status, "approved"));
    const signalDefs: PlanSignalDef[] = defRows.map((d) => ({ signalId: d.signalId, family: d.family as SignalFamily, freshnessWindowDays: d.freshnessWindowDays }));

    const plan = buildSourcingPlan({ vendorType: vendor.vendorType }, vendorMappings, signalDefs);
    if (!plan.runnable) throw new Error("vendor has no approved mappings — nothing to source");

    // 2. Build the provider query from the plan + campaign config.
    const cfg = (campaign.config ?? {}) as { geography?: string; target?: number };
    const query: CompanyQuery = {
      geography: cfg.geography ?? "IND",
      target: cfg.target ?? 20,
      fundedSinceDays: plan.fundedSinceDays,
      signalFamilies: plan.signalFamilies,
    };

    // 3. Capture pre-existing lead keys for this vendor (to compute wasNew after generateLeads).
    const beforeLeads = await db
      .select({ companyId: leads.companyId, matchedMappingId: leads.matchedMappingId })
      .from(leads).where(eq(leads.vendorId, vendor.vendorId));
    const beforeKeys = new Set(beforeLeads.map((l) => leadKey(l.companyId, l.matchedMappingId)));

    // 4. Ingest company observations.
    const ingest = await ingestCompanyObservations(db, adapter, query);
    const touchedIds = ingest.touched.map((t) => t.companyId);

    // 5. Score matches (existing global matcher; idempotent upsert).
    await generateLeads(db, now);

    // 6. Record this campaign's leads (scoped to the vendor + touched companies) + wasNew + source tag.
    let leadsCreated = 0, leadsUpdated = 0;
    const bestScoreByCompany = new Map<string, number>();
    if (touchedIds.length > 0) {
      const vendorLeads = await db
        .select({ leadId: leads.leadId, companyId: leads.companyId, matchedMappingId: leads.matchedMappingId, score: leads.score })
        .from(leads)
        .where(and(eq(leads.vendorId, vendor.vendorId), inArray(leads.companyId, touchedIds)));

      for (const l of vendorLeads) {
        const wasNew = !beforeKeys.has(leadKey(l.companyId, l.matchedMappingId));
        await recordCampaignLead(db, campaignId, l.leadId, wasNew);
        if (wasNew) {
          leadsCreated++;
          await db.update(leads).set({ sourceCampaignId: campaignId }).where(eq(leads.leadId, l.leadId));
        } else {
          leadsUpdated++;
        }
        const prev = bestScoreByCompany.get(l.companyId);
        if (l.score != null && (prev == null || l.score > prev)) bestScoreByCompany.set(l.companyId, l.score);
      }
    }

    // 7. Write per-company snapshots (write-only; v2 memory reads these).
    for (const t of ingest.touched) {
      await writeCompanySnapshot(db, campaignId, t.companyId, {
        ...t.snapshot, score: bestScoreByCompany.get(t.companyId) ?? null,
      });
    }

    // 8. Finish.
    const stats: CampaignStats = {
      companiesFetched: ingest.touched.length,
      observationsWritten: ingest.written,
      leadsCreated, leadsUpdated, creditsSpent: 0,
    };
    await finishCampaign(db, campaignId, stats);
    return stats;
  } catch (e) {
    await failCampaign(db, campaignId, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
```
**Implementer note:** everything for the orchestrator lives in `run.ts` — do not create extra helper modules.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/campaigns-run.test.ts`
Expected: PASS — both the happy path (leads created, campaign done, snapshots written, leads tagged) and the failure path (adapter throws → campaign failed → rethrow).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm run typecheck && npx vitest run tests/unit/company-detectors.test.ts tests/unit/company-fixture.test.ts tests/unit/sourcing-plan.test.ts tests/integration/campaigns-schema.test.ts tests/integration/seed-ops-signals.test.ts tests/integration/campaigns-ingest.test.ts tests/integration/campaigns-data.test.ts tests/integration/campaigns-run.test.ts`
Expected: typecheck clean; all campaign tests PASS. (Integration tests share one Neon branch and run serially — a transient TRUNCATE/latency failure is known flakiness; re-run 2–3× before investigating.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/campaigns/run.ts tests/integration/campaigns-run.test.ts
git commit -m "feat(campaigns): runCampaign orchestrator — plan → ingest → score → record + snapshots"
```

---

## Self-Review

**1. Spec coverage (Phase A):**
- §5.1 enum `campaign_status` → Task 1 ✓
- §5.2 `campaigns` table → Task 1 ✓
- §5.3 `campaign_leads` (+`wasNew`) → Task 1 ✓
- §5.4 `leads.sourceCampaignId` → Task 1 ✓
- §5.5 money/expansion detectors + reuse hiring + negative counter → Task 3 ✓ (reconciled to `negative` polarity)
- §5.6 `company_snapshots` (write-only) → Task 1 (schema) + Task 8 (written) ✓
- §6.1 `CompanySourceAdapter` + fixture impl → Tasks 3, 4 ✓
- §6.3 `buildSourcingPlan` → Task 5 ✓
- §6.4 orchestrator steps 1–9 → Task 8 ✓ (client/live adapter = separate plan; enrichLeads no-op folded as "not called in v1" — see note below)
- §8 seed config only → Task 2 ✓
- §9 grounding (evidence non-empty) + missing=null → Tasks 3, 6 ✓
- §16.1 snapshot capture → Tasks 1, 8 ✓
- **Deferred to later plans (correctly out of this plan's scope):** §6.2 CrustdataClient + §6.5 server actions/routes/UI + §4.5 execution model + the live adapter. These are Plans 2 (UI) and 3 (live Crustdata).
- **Gap noted & intentional:** §6.4 step 8 `enrichLeads(topN)` no-op — omitted from v1 orchestrator entirely (a no-op call adds nothing testable); V2 adds the call + body. Recorded here so it isn't lost.

**2. Placeholder scan:** No "TBD"/"handle errors"/"similar to". No dangling imports (the earlier `run-helpers` placeholder was removed).

**3. Type consistency:** `DetectedCompanyObservation` (Task 3) fields match their use in Task 6; `CompanyIngestResult.touched` (Task 6) shape matches Task 8's `ingest.touched` reads; `CampaignStats` (Task 7) matches Task 8's returned object; `PlanMapping`/`PlanSignalDef` (Task 5) match Task 8's construction. `resolveCompany`, `computeFreshnessVerdict`, `generateLeads` signatures verified against source.

Fix applied inline: removed reliance on any `enrichLeads` symbol (not defined) — it is intentionally absent from v1.
