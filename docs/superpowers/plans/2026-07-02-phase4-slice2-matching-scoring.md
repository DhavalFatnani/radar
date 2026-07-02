# Phase 4 Slice 2 — Matching & Scoring Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn captured `signal_observations` into scored `leads` by evaluating a vendor's approved mappings (required-gate, timing window, disqualifiers) and computing a 0–100 score.

**Architecture:** A pure DB-free scoring module (`scoring.ts`) holds the formula and gates; a DB-orchestration layer (`leads.ts`, using the type-only `DB` import) loads vendors + approved mappings + observations, calls the scorer, and upserts idempotent leads; an on-demand runner (`source-leads.ts`) mirrors the Slice 1 tender runner. One additive schema change adds `vendor_type` to `vendor_profiles` and a unique index to `leads`.

**Tech Stack:** TypeScript (strict), Drizzle ORM + postgres-js (Neon), Vitest, tsx runner. Spec: `docs/superpowers/specs/2026-07-02-phase4-slice2-matching-scoring-design.md`.

## Global Constraints

- Data-module split: `src/lib/sourcing/scoring.ts` is **pure** — no `@/db` import, no `import "server-only"`, client-safe. `src/lib/sourcing/leads.ts` uses `import type { DB } from "@/db/client"` — the `type` keyword is load-bearing (erased at runtime, never eager-loads the env-bound client).
- **Generated** Drizzle migrations only: `npm run db:generate` then `npm run db:migrate`. NEVER `db:push`.
- Parameterized Drizzle queries only; every listing query `.limit()`-bounded.
- No `console.log` / TODO / silent empty catch in committed code. The runner's summary `console.log` is its operator interface — allowed only in `src/db/source-leads.ts`'s direct-run guard.
- Commits stage only the explicit file paths named in each task — NEVER `git add .` / `-A`. Leave `.DS_Store` and any hook-modified `AGENTS.md` unstaged.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Scoring weights (verbatim): `very_high=1.0, high=0.7, medium=0.4, low=0.2`, unknown strength → `0.4`. Recency: `recent=1.0, stale=0.5, null=0.75`. Score: `round(100 × min(1, 0.6·req + 0.4·min(1, sup/2)))`.
- `pipeline_stage` default `'sourced'`; never reset on re-run. `brief`/`contact_block` stay `null` this slice.

---

### Task 1: Schema — `vendor_type` column + `leads` unique index + migration

**Files:**
- Modify: `src/db/schema/vendors.ts` (add `vendorType`)
- Modify: `src/db/schema/leads.ts` (add unique index; import `uniqueIndex`)
- Create: `src/db/migrations/0011_*.sql` (+ snapshot + journal) via `db:generate`

**Interfaces:**
- Produces: `vendorProfiles.vendorType` (text, nullable); unique index `leads_vendor_company_mapping_uq` on `(vendor_id, company_id, matched_mapping_id)` — the conflict target Task 3 upserts against.

- [ ] **Step 1: Add `vendorType` to `vendor_profiles`**

In `src/db/schema/vendors.ts`, add this field to the `vendorProfiles` object (place it right after `name`):

```ts
  vendorType: text("vendor_type"),          // matches mappings.serves_vendor_type (case-insensitive), e.g. "Infra" | "Mktg"
```

(`text` is already imported.)

- [ ] **Step 2: Add the unique index to `leads`**

In `src/db/schema/leads.ts`, change the import to include `uniqueIndex`:

```ts
import { pgTable, uuid, text, real, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
```

Then add the table-extras array as the third `pgTable` argument (after the columns object):

```ts
export const leads = pgTable("leads", {
  leadId: uuid("lead_id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId),
  vendorId: uuid("vendor_id").notNull().references(() => vendorProfiles.vendorId),
  matchedMappingId: uuid("matched_mapping_id").references(() => mappings.mappingId),
  intent: text("intent"),
  score: real("score"),
  pipelineStage: pipelineStage("pipeline_stage").notNull().default("sourced"),
  outreachMode: outreachMode("outreach_mode"),
  brief: jsonb("brief"),                 // { why_them, why_now[], what_they_need, hook, ... }
  contactBlock: jsonb("contact_block"),  // { decision_makers[] { name, role, contact_paths[] } }
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("leads_vendor_company_mapping_uq").on(t.vendorId, t.companyId, t.matchedMappingId),
]);
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: creates `src/db/migrations/0011_*.sql` containing `ALTER TABLE "vendor_profiles" ADD COLUMN "vendor_type" text;` and `CREATE UNIQUE INDEX "leads_vendor_company_mapping_uq" ON "leads" ...`, plus a new snapshot and a `_journal.json` entry.

- [ ] **Step 4: Inspect the generated SQL**

Read the new `src/db/migrations/0011_*.sql`. Confirm it contains ONLY the `vendor_type` column add and the `leads_vendor_company_mapping_uq` unique index — no unexpected drops or table rewrites. If it contains anything else, stop and report.

- [ ] **Step 5: Apply the migration**

Run: `npm run db:migrate`
Expected: applies cleanly (a `__drizzle_migrations already exists` NOTICE is benign). Exit 0.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/vendors.ts src/db/schema/leads.ts src/db/migrations/0011_*.sql src/db/migrations/meta/0011_snapshot.json src/db/migrations/meta/_journal.json
git commit -m "feat(db): vendor_type column + leads uniqueness for matching/scoring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure scoring module + unit tests

**Files:**
- Create: `src/lib/sourcing/scoring.ts`
- Test: `tests/unit/lib/sourcing-scoring.test.ts`

**Interfaces:**
- Consumes: nothing (pure; only local types).
- Produces: `SignalStrength`, `SignalPolarity`, `FreshnessVerdict`, `ScoredObservation`, `ScoringMapping`, `ScoreResult` types; `scoreMapping(mapping: ScoringMapping, observations: ScoredObservation[], now: Date): ScoreResult`.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/lib/sourcing-scoring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scoreMapping, type ScoringMapping, type ScoredObservation } from "@/lib/sourcing/scoring";

const now = new Date("2026-06-30T00:00:00Z");

const mapping: ScoringMapping = {
  requiredSignals: ["SIG-REQ"],
  supportingSignals: ["SIG-SUP-A", "SIG-SUP-B", "SIG-SUP-C", "SIG-SUP-D"],
  timingWindowDays: 180,
};

function obs(overrides: Partial<ScoredObservation> & { signalId: string }): ScoredObservation {
  return {
    detectedAt: new Date("2026-06-20T00:00:00Z"),
    freshnessVerdict: "recent",
    strength: "very_high",
    polarity: "positive",
    ...overrides,
  };
}

describe("scoreMapping", () => {
  it("one required very_high recent → moderate 60", () => {
    const r = scoreMapping(mapping, [obs({ signalId: "SIG-REQ" })], now);
    expect(r.fired).toBe(true);
    expect(r.disqualified).toBe(false);
    expect(r.score).toBe(60);
    expect(r.contributingSignals).toEqual(["SIG-REQ"]);
  });

  it("required + 2 supporting high recent → top-tier 88", () => {
    const r = scoreMapping(mapping, [
      obs({ signalId: "SIG-REQ" }),
      obs({ signalId: "SIG-SUP-A", strength: "high" }),
      obs({ signalId: "SIG-SUP-B", strength: "high" }),
    ], now);
    expect(r.score).toBe(88);
  });

  it("required + 4 supporting high recent → saturates at 100", () => {
    const r = scoreMapping(mapping, [
      obs({ signalId: "SIG-REQ" }),
      obs({ signalId: "SIG-SUP-A", strength: "high" }),
      obs({ signalId: "SIG-SUP-B", strength: "high" }),
      obs({ signalId: "SIG-SUP-C", strength: "high" }),
      obs({ signalId: "SIG-SUP-D", strength: "high" }),
    ], now);
    expect(r.score).toBe(100);
  });

  it("one required medium recent → 24", () => {
    const r = scoreMapping(mapping, [obs({ signalId: "SIG-REQ", strength: "medium" })], now);
    expect(r.score).toBe(24);
  });

  it("one required very_high stale → 30", () => {
    const r = scoreMapping(mapping, [obs({ signalId: "SIG-REQ", freshnessVerdict: "stale" })], now);
    expect(r.score).toBe(30);
  });

  it("no eligible required (only supporting) → does not fire, no score", () => {
    const r = scoreMapping(mapping, [obs({ signalId: "SIG-SUP-A", strength: "high" })], now);
    expect(r.fired).toBe(false);
    expect(r.score).toBe(0);
  });

  it("negative-polarity observation in window → disqualified even though it fired", () => {
    const r = scoreMapping(mapping, [
      obs({ signalId: "SIG-REQ" }),
      obs({ signalId: "SIG-DISTRESS", polarity: "negative" }),
    ], now);
    expect(r.disqualified).toBe(true);
    expect(r.fired).toBe(true);
    expect(r.score).toBe(0);
  });

  it("required detected outside the timing window → not eligible → no fire", () => {
    const oldReq = obs({ signalId: "SIG-REQ", detectedAt: new Date("2025-12-01T00:00:00Z") }); // ~211d before now
    const r = scoreMapping(mapping, [oldReq], now);
    expect(r.fired).toBe(false);
    expect(r.score).toBe(0);
  });

  it("timingWindowDays null → no timing filter (an old required still fires)", () => {
    const r = scoreMapping(
      { ...mapping, timingWindowDays: null },
      [obs({ signalId: "SIG-REQ", detectedAt: new Date("2020-01-01T00:00:00Z") })],
      now,
    );
    expect(r.fired).toBe(true);
    expect(r.score).toBe(60);
  });

  it("unknown strength → medium (0.4); unknown freshness → 0.75 → score 18", () => {
    const r = scoreMapping(mapping, [obs({ signalId: "SIG-REQ", strength: null, freshnessVerdict: null })], now);
    expect(r.score).toBe(18);
  });

  it("empty observations → no fire, not disqualified, score 0", () => {
    const r = scoreMapping(mapping, [], now);
    expect(r).toEqual({ fired: false, disqualified: false, score: 0, contributingSignals: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/sourcing-scoring.test.ts`
Expected: FAIL — cannot resolve `@/lib/sourcing/scoring`.

- [ ] **Step 3: Write `src/lib/sourcing/scoring.ts`**

```ts
/**
 * Pure, DB-free lead scoring — the formalization of Phase0 §12's deferred formula.
 * See docs/superpowers/specs/2026-07-02-phase4-slice2-matching-scoring-design.md §5.
 * No @/db import: this module is client-safe and unit-tested with hand-built inputs.
 */

export type SignalStrength = "low" | "medium" | "high" | "very_high";
export type SignalPolarity = "positive" | "negative" | "contextual";
export type FreshnessVerdict = "recent" | "stale" | null;

/** One observation as the scorer needs it (DB-agnostic). */
export type ScoredObservation = {
  signalId: string;
  detectedAt: Date;
  freshnessVerdict: FreshnessVerdict;
  strength: SignalStrength | null;
  polarity: SignalPolarity | null;
};

/** The mapping fields the scorer needs. */
export type ScoringMapping = {
  requiredSignals: string[];
  supportingSignals: string[];
  timingWindowDays: number | null;
};

export type ScoreResult = {
  fired: boolean;                 // ≥1 eligible required observation
  disqualified: boolean;          // a negative-polarity observation sits within the window
  score: number;                  // 0..100; 0 when !fired or disqualified
  contributingSignals: string[];  // distinct signalIds that contributed to the score
};

const STRENGTH_WEIGHT: Record<SignalStrength, number> = {
  very_high: 1.0,
  high: 0.7,
  medium: 0.4,
  low: 0.2,
};
const DEFAULT_STRENGTH_WEIGHT = 0.4; // unknown strength → treat as medium

function strengthWeight(s: SignalStrength | null): number {
  return s == null ? DEFAULT_STRENGTH_WEIGHT : STRENGTH_WEIGHT[s];
}

function recencyMultiplier(v: FreshnessVerdict): number {
  if (v === "recent") return 1.0;
  if (v === "stale") return 0.5;
  return 0.75; // null / unknown
}

function contribution(o: ScoredObservation): number {
  return strengthWeight(o.strength) * recencyMultiplier(o.freshnessVerdict);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function withinWindow(o: ScoredObservation, timingWindowDays: number | null, now: Date): boolean {
  if (timingWindowDays == null) return true;
  const ageDays = (now.getTime() - o.detectedAt.getTime()) / MS_PER_DAY;
  return ageDays <= timingWindowDays;
}

/**
 * Score a single mapping against one company's observations. Pure and deterministic.
 * Fire gate: ≥1 eligible required observation. Disqualifier gate: any negative-polarity
 * observation within the window (independent of the contributing-signal sets).
 */
export function scoreMapping(
  mapping: ScoringMapping,
  observations: ScoredObservation[],
  now: Date,
): ScoreResult {
  const required = new Set(mapping.requiredSignals ?? []);
  const supporting = new Set(mapping.supportingSignals ?? []);

  const disqualified = observations.some(
    (o) => o.polarity === "negative" && withinWindow(o, mapping.timingWindowDays, now),
  );

  const eligible = observations.filter(
    (o) =>
      (required.has(o.signalId) || supporting.has(o.signalId)) &&
      withinWindow(o, mapping.timingWindowDays, now),
  );
  const eligibleRequired = eligible.filter((o) => required.has(o.signalId));
  const eligibleSupporting = eligible.filter((o) => supporting.has(o.signalId));
  const fired = eligibleRequired.length > 0;

  if (disqualified || !fired) {
    return { fired, disqualified, score: 0, contributingSignals: [] };
  }

  const req = Math.max(...eligibleRequired.map(contribution));
  const sup = eligibleSupporting.reduce((sum, o) => sum + contribution(o), 0);
  const raw = 0.6 * req + 0.4 * Math.min(1, sup / 2);
  const score = Math.round(100 * Math.min(1, raw));

  const contributingSignals = [
    ...new Set([...eligibleRequired, ...eligibleSupporting].map((o) => o.signalId)),
  ];

  return { fired: true, disqualified: false, score, contributingSignals };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/sourcing-scoring.test.ts`
Expected: PASS (all 11 cases).

- [ ] **Step 5: Verify the client-safety boundary and typecheck**

Run: `grep -n "@/db\|server-only" src/lib/sourcing/scoring.ts` → Expected: no output.
Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sourcing/scoring.ts tests/unit/lib/sourcing-scoring.test.ts
git commit -m "feat(sourcing): pure lead scoring — gates + strength/recency formula

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: DB orchestration `generateLeads` + integration tests

**Files:**
- Create: `src/lib/sourcing/leads.ts`
- Test: `tests/integration/sourcing-leads.test.ts`

**Interfaces:**
- Consumes: `scoreMapping`, `ScoredObservation`, `ScoringMapping` (Task 2); `type DB` from `@/db/client`; schema tables `leads`, `mappings`, `signalDefinitions`, `signalObservations`, `vendorProfiles`; the `leads_vendor_company_mapping_uq` index (Task 1).
- Produces: `GenerateLeadsResult` type; `generateLeads(db: DB, now?: Date): Promise<GenerateLeadsResult>`.

Field definitions for `GenerateLeadsResult`: `vendorsProcessed` = vendors with a non-null `vendor_type`; `mappingsEvaluated` = (vendor, approved-matching-mapping) pairs; `companiesConsidered` = distinct companies that yielded ≥1 lead; `leadsWritten` = net-new lead rows; `leadsUpdated` = existing leads re-scored; `skippedNoFire` / `skippedDisqualified` = (company, mapping) evaluations that did not produce a lead.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/sourcing-leads.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { companies, signalDefinitions, signalObservations, mappings, vendorProfiles, leads } from "@/db/schema";
import { generateLeads } from "@/lib/sourcing/leads";
import type { SignalStrength, SignalPolarity } from "@/lib/sourcing/scoring";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["leads", "signal_observations", "signal_definitions", "mappings", "vendor_profiles", "companies"]);
});
afterAll(async () => { await closeTestDb(); });

async function approvedSignal(
  signalId: string,
  strength: SignalStrength = "very_high",
  polarity: SignalPolarity = "positive",
) {
  await testDb.insert(signalDefinitions).values({
    signalId, name: `S ${signalId}`, family: "procurement",
    strength, polarity, falsePositiveRisk: "low", status: "approved", origin: "seed",
  }).onConflictDoNothing();
}

async function makeCompany(name: string): Promise<string> {
  const [c] = await testDb.insert(companies).values({ name, normalizedName: name.toLowerCase() }).returning();
  return c.companyId;
}

async function observe(
  companyId: string,
  signalId: string,
  opts: { detectedAt?: Date; freshnessVerdict?: string } = {},
) {
  await testDb.insert(signalObservations).values({
    signalId, companyId,
    detectedAt: opts.detectedAt ?? new Date(),
    source: "test", evidence: ["e"],
    freshnessVerdict: opts.freshnessVerdict ?? "recent",
    entityMatchConfidence: 1,
    sourceRef: `${signalId}-${companyId}`,
  });
}

async function makeVendor(name: string, vendorType: string | null): Promise<string> {
  const [v] = await testDb.insert(vendorProfiles).values({ name, vendorType }).returning();
  return v.vendorId;
}

async function approvedMapping(opts: {
  name: string; servesVendorType: string; required: string[]; supporting?: string[];
  timingWindowDays?: number | null; intentDescription?: string;
}): Promise<string> {
  const [m] = await testDb.insert(mappings).values({
    name: opts.name, servesVendorType: opts.servesVendorType, status: "approved",
    requiredSignals: opts.required, supportingSignals: opts.supporting ?? [],
    timingWindowDays: opts.timingWindowDays ?? 180,
    intentDescription: opts.intentDescription,
  }).returning();
  return m.mappingId;
}

describe("generateLeads", () => {
  it("writes a scored lead for a fired mapping matching the vendor_type", async () => {
    await approvedSignal("SIG-REQ", "very_high");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-REQ");
    const vendorId = await makeVendor("RackPro", "Infra");
    const mappingId = await approvedMapping({
      name: "Warehouse expansion", servesVendorType: "Infra",
      required: ["SIG-REQ"], intentDescription: "Expanding capacity",
    });

    const res = await generateLeads(testDb);
    expect(res.leadsWritten).toBe(1);

    const [lead] = await testDb.select().from(leads);
    expect(lead.vendorId).toBe(vendorId);
    expect(lead.companyId).toBe(companyId);
    expect(lead.matchedMappingId).toBe(mappingId);
    expect(lead.score).toBe(60);
    expect(lead.intent).toBe("Expanding capacity");
    expect(lead.pipelineStage).toBe("sourced");
    expect(lead.brief).toBeNull();
    expect(lead.contactBlock).toBeNull();
  });

  it("matches vendor_type case-insensitively", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-REQ");
    await makeVendor("RackPro", "infra");                                  // lowercase
    await approvedMapping({ name: "W", servesVendorType: "Infra", required: ["SIG-REQ"] }); // capitalized
    const res = await generateLeads(testDb);
    expect(res.leadsWritten).toBe(1);
  });

  it("writes no lead when the mapping is not approved", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-REQ");
    await makeVendor("RackPro", "Infra");
    await testDb.insert(mappings).values({
      name: "W", servesVendorType: "Infra", status: "proposed", requiredSignals: ["SIG-REQ"],
    });
    const res = await generateLeads(testDb);
    expect(res.leadsWritten).toBe(0);
    expect(await testDb.select().from(leads)).toHaveLength(0);
  });

  it("writes no lead when a negative-polarity observation disqualifies the company", async () => {
    await approvedSignal("SIG-REQ", "very_high", "positive");
    await approvedSignal("SIG-DISTRESS", "high", "negative");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-REQ");
    await observe(companyId, "SIG-DISTRESS");
    await makeVendor("RackPro", "Infra");
    await approvedMapping({ name: "W", servesVendorType: "Infra", required: ["SIG-REQ"] });
    const res = await generateLeads(testDb);
    expect(res.skippedDisqualified).toBeGreaterThan(0);
    expect(res.leadsWritten).toBe(0);
    expect(await testDb.select().from(leads)).toHaveLength(0);
  });

  it("writes no lead when the required gate is not met (supporting only)", async () => {
    await approvedSignal("SIG-REQ");
    await approvedSignal("SIG-SUP");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-SUP");
    await makeVendor("RackPro", "Infra");
    await approvedMapping({ name: "W", servesVendorType: "Infra", required: ["SIG-REQ"], supporting: ["SIG-SUP"] });
    const res = await generateLeads(testDb);
    expect(res.skippedNoFire).toBeGreaterThan(0);
    expect(res.leadsWritten).toBe(0);
  });

  it("does not produce leads for a vendor with a null vendor_type", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-REQ");
    await makeVendor("Untyped", null);
    await approvedMapping({ name: "W", servesVendorType: "Infra", required: ["SIG-REQ"] });
    const res = await generateLeads(testDb);
    expect(res.vendorsProcessed).toBe(0);
    expect(res.leadsWritten).toBe(0);
  });

  it("is idempotent and preserves an advanced pipeline_stage", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("Acme");
    await observe(companyId, "SIG-REQ");
    await makeVendor("RackPro", "Infra");
    await approvedMapping({ name: "W", servesVendorType: "Infra", required: ["SIG-REQ"] });

    const first = await generateLeads(testDb);
    expect(first.leadsWritten).toBe(1);

    await testDb.update(leads).set({ pipelineStage: "contacted" });

    const second = await generateLeads(testDb);
    expect(second.leadsWritten).toBe(0);
    expect(second.leadsUpdated).toBe(1);

    const rows = await testDb.select().from(leads);
    expect(rows).toHaveLength(1);
    expect(rows[0].pipelineStage).toBe("contacted"); // preserved
    expect(rows[0].score).toBe(60);                   // refreshed (same value)
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/sourcing-leads.test.ts`
Expected: FAIL — cannot resolve `@/lib/sourcing/leads`.

- [ ] **Step 3: Write `src/lib/sourcing/leads.ts`**

```ts
import { eq, isNotNull } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — erased at runtime, never loads the env-eager client
import { leads, mappings, signalDefinitions, signalObservations, vendorProfiles } from "@/db/schema";
import { scoreMapping, type ScoredObservation, type ScoringMapping } from "@/lib/sourcing/scoring";

const VENDOR_LIMIT = 500;
const MAPPING_LIMIT = 500;
const OBSERVATION_SCAN_LIMIT = 5000;
const EXISTING_LEAD_LIMIT = 10000;

export type GenerateLeadsResult = {
  vendorsProcessed: number;
  mappingsEvaluated: number;
  companiesConsidered: number;
  leadsWritten: number;
  leadsUpdated: number;
  skippedNoFire: number;
  skippedDisqualified: number;
};

function leadKey(vendorId: string, companyId: string, mappingId: string): string {
  return `${vendorId}|${companyId}|${mappingId}`;
}

/**
 * Matching + scoring pass: evaluate each vendor's approved mappings (matched to the vendor's
 * vendor_type, case-insensitively) against every company's observations, then upsert a scored
 * lead for each fired, non-disqualified (vendor, company, mapping). Idempotent via the
 * leads (vendor_id, company_id, matched_mapping_id) unique index. Caller owns the connection.
 */
export async function generateLeads(db: DB, now: Date = new Date()): Promise<GenerateLeadsResult> {
  const vendors = await db
    .select({ vendorId: vendorProfiles.vendorId, vendorType: vendorProfiles.vendorType })
    .from(vendorProfiles)
    .where(isNotNull(vendorProfiles.vendorType))
    .limit(VENDOR_LIMIT);

  const approvedMappings = await db
    .select({
      mappingId: mappings.mappingId,
      intentDescription: mappings.intentDescription,
      name: mappings.name,
      servesVendorType: mappings.servesVendorType,
      requiredSignals: mappings.requiredSignals,
      supportingSignals: mappings.supportingSignals,
      timingWindowDays: mappings.timingWindowDays,
    })
    .from(mappings)
    .where(eq(mappings.status, "approved"))
    .limit(MAPPING_LIMIT);

  const obsRows = await db
    .select({
      companyId: signalObservations.companyId,
      signalId: signalObservations.signalId,
      detectedAt: signalObservations.detectedAt,
      freshnessVerdict: signalObservations.freshnessVerdict,
      strength: signalDefinitions.strength,
      polarity: signalDefinitions.polarity,
    })
    .from(signalObservations)
    .innerJoin(signalDefinitions, eq(signalObservations.signalId, signalDefinitions.signalId))
    .limit(OBSERVATION_SCAN_LIMIT);

  const obsByCompany = new Map<string, ScoredObservation[]>();
  for (const r of obsRows) {
    const list = obsByCompany.get(r.companyId) ?? [];
    list.push({
      signalId: r.signalId,
      detectedAt: r.detectedAt,
      freshnessVerdict: r.freshnessVerdict as ScoredObservation["freshnessVerdict"],
      strength: r.strength as ScoredObservation["strength"],
      polarity: r.polarity as ScoredObservation["polarity"],
    });
    obsByCompany.set(r.companyId, list);
  }

  const existing = await db
    .select({
      vendorId: leads.vendorId,
      companyId: leads.companyId,
      matchedMappingId: leads.matchedMappingId,
    })
    .from(leads)
    .limit(EXISTING_LEAD_LIMIT);
  const existingKeys = new Set(
    existing
      .filter((e) => e.matchedMappingId != null)
      .map((e) => leadKey(e.vendorId, e.companyId, e.matchedMappingId as string)),
  );

  const result: GenerateLeadsResult = {
    vendorsProcessed: 0,
    mappingsEvaluated: 0,
    companiesConsidered: 0,
    leadsWritten: 0,
    leadsUpdated: 0,
    skippedNoFire: 0,
    skippedDisqualified: 0,
  };
  const consideredCompanies = new Set<string>();

  for (const vendor of vendors) {
    if (vendor.vendorType == null) continue;
    result.vendorsProcessed++;
    const vType = vendor.vendorType.toLowerCase();
    const vendorMappings = approvedMappings.filter(
      (m) => (m.servesVendorType ?? "").toLowerCase() === vType,
    );

    for (const m of vendorMappings) {
      result.mappingsEvaluated++;
      const scoringMapping: ScoringMapping = {
        requiredSignals: m.requiredSignals ?? [],
        supportingSignals: m.supportingSignals ?? [],
        timingWindowDays: m.timingWindowDays,
      };
      const intent = m.intentDescription ?? m.name;

      for (const [companyId, observations] of obsByCompany) {
        const outcome = scoreMapping(scoringMapping, observations, now);
        if (outcome.disqualified) {
          result.skippedDisqualified++;
          continue;
        }
        if (!outcome.fired) {
          result.skippedNoFire++;
          continue;
        }
        consideredCompanies.add(companyId);

        const key = leadKey(vendor.vendorId, companyId, m.mappingId);
        const isUpdate = existingKeys.has(key);

        await db
          .insert(leads)
          .values({
            vendorId: vendor.vendorId,
            companyId,
            matchedMappingId: m.mappingId,
            intent,
            score: outcome.score,
          })
          .onConflictDoUpdate({
            target: [leads.vendorId, leads.companyId, leads.matchedMappingId],
            set: { score: outcome.score, intent },
          });

        if (isUpdate) {
          result.leadsUpdated++;
        } else {
          result.leadsWritten++;
          existingKeys.add(key); // guard against double-counting within one run
        }
      }
    }
  }

  result.companiesConsidered = consideredCompanies.size;
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/sourcing-leads.test.ts`
Expected: PASS (all 7 cases). If Neon flakiness appears (transient TRUNCATE/latency), re-run up to 3× before investigating.

- [ ] **Step 5: Verify the client boundary and typecheck**

Run: `grep -n "from \"@/db/client\"" src/lib/sourcing/leads.ts` → Expected: the line shows `import type` (type-only).
Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sourcing/leads.ts tests/integration/sourcing-leads.test.ts
git commit -m "feat(sourcing): generateLeads — match approved mappings, upsert scored leads

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: On-demand runner + npm script + seed vendor_type

**Files:**
- Create: `src/db/source-leads.ts`
- Modify: `package.json` (add `db:source:leads` after `db:source:tenders`)
- Modify: `src/db/seed.ts` (set `vendorType` on the demo vendor)

**Interfaces:**
- Consumes: `generateLeads` + `GenerateLeadsResult` (Task 3), `type DB` from `./client`.
- Produces: `runLeadSourcing(db: DB): Promise<GenerateLeadsResult>` + a direct-run guard mirroring `source-tenders.ts`.

- [ ] **Step 1: Write `src/db/source-leads.ts`**

```ts
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
```

- [ ] **Step 2: Add the npm script to `package.json`**

After the `"db:source:tenders": "tsx src/db/source-tenders.ts"` line, add:

```json
    "db:source:leads": "tsx src/db/source-leads.ts",
```

(Keep the preceding line's trailing comma; JSON stays valid.)

- [ ] **Step 3: Give the demo vendor a `vendor_type` in `src/db/seed.ts`**

In `src/db/seed.ts`, change the demo vendor insert to include `vendorType`:

```ts
  const [vendor] = await db.insert(vendorProfiles).values({
    name: "RackPro Infra", vendorType: "Infra", capabilities: ["racking", "cctv"],
    constraints: { geographies_served: ["maharashtra"] },
  }).returning();
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the end-to-end chain against the dev DB**

```bash
npm run db:seed:signals   # approves SIG-TENDER-* signals
npm run db:seed:mappings  # 2 approved mappings (Infra/Mktg) requiring SIG-TENDER-LIVE
npm run db:seed           # demo vendor (now vendorType Infra) + demo company/observation
npm run db:source:tenders # creates SIG-TENDER-LIVE observations for tender issuers
npm run db:source:leads   # <-- the new runner
```

Expected: the final command prints `Lead sourcing complete: {"vendorsProcessed":...,"mappingsEvaluated":...,"companiesConsidered":...,"leadsWritten":...,"leadsUpdated":...,"skippedNoFire":...,"skippedDisqualified":...}` and exits 0. `leadsWritten + leadsUpdated` ≥ 1 (the Infra vendor matches the "Warehouse expansion" mapping against the tender issuers' SIG-TENDER-LIVE observations). Running `db:source:leads` a second time yields `leadsWritten: 0` with the same rows updated (idempotency).

- [ ] **Step 6: Commit**

```bash
git add src/db/source-leads.ts package.json src/db/seed.ts
git commit -m "feat(sourcing): db:source:leads runner + seed a typed demo vendor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (controller, against the spec)

- **Spec coverage:** vendor_type column + case-insensitive match (Task 1 + Task 3 loop) ✓; leads unique index + idempotent upsert (Task 1 + Task 3) ✓; pure scoring module with the §5 formula + all §5.6 rows (Task 2) ✓; fire gate / disqualifier gate / timing window (Task 2) ✓; `generateLeads` orchestration + result shape §8 (Task 3) ✓; pipeline_stage preserved, brief/contact_block null (Task 3 test) ✓; on-demand runner + npm script §7 (Task 4) ✓; generated migration not push (Task 1) ✓; data-module split + type-only DB import (Tasks 2/3 grep steps) ✓. All 7 acceptance criteria (§10) map to a task.
- **Type consistency:** `ScoredObservation`/`ScoringMapping`/`ScoreResult`/`scoreMapping` names identical across Task 2 (def), its test, and Task 3 (consumer). `GenerateLeadsResult` fields identical across Task 3 def, its test, and Task 4 runner. `SignalStrength`/`SignalPolarity` reused by the Task 3 test helper.
- **No placeholders:** every code + command step is complete.
- **Weights match the spec:** strength `1.0/0.7/0.4/0.2` (unknown 0.4), recency `1.0/0.5/0.75`, `round(100 × min(1, 0.6·req + 0.4·min(1, sup/2)))` — identical in spec §5, Global Constraints, and `scoring.ts`.
- **Deferred-gate note:** each task's own tests pass on completion; Task 1's migration is applied before Task 3 upserts against the index.
