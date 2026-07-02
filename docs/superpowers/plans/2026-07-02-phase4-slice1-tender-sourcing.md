# Phase 4 Slice 1 — Tender Source Adapter + Signal Observation Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator command reads a committed fixture of tender records, detects `SIG-TENDER-LIVE`/`SIG-TENDER-AMENDED` against approved signal definitions using vendor keywords, resolves each tender's issuing body to a deduplicated `companies` row, and writes idempotent `signal_observations` carrying mandatory proof (`detected_at`, `source`, non-empty `evidence`), a computed `freshness_verdict`, and an `entity_match_confidence`.

**Architecture:** A new `src/lib/sourcing/` domain with the established pure/`data` split. `schema.ts` holds pure types + Zod + pure detection/normalization/freshness functions (client-safe, DB-free). `data.ts` holds server-only orchestration functions that take an **injected `db: DB`** (mirroring `seedMappings(db)`) so they run under both Next.js/vitest and plain `tsx`, and are testable against the integration `testDb`. A fixture-first tender adapter implements a `SourceAdapter` interface (the extensibility seam). Two additive nullable columns (`companies.normalized_name`, `signal_observations.source_ref`) plus unique indexes give DB-enforced dedup, applied via a generated Drizzle migration.

**Tech Stack:** TypeScript (strict), Zod, Drizzle ORM 0.45 (postgres-js, `prepare:false`), Neon Postgres, Vitest, tsx.

## Global Constraints

- **Data-module split (hard rule):** `src/lib/sourcing/schema.ts` is PURE — no `@/db/*` import, client-safe. `src/lib/sourcing/data.ts` is server-only — imports `@/db/schema` (pure table defs) and a **type-only** `import type { DB } from "@/db/client"` (erased at runtime; never triggers the env-eager client module). No client component in this slice.
- **Injected DB:** every `data.ts` function takes `db: DB` as its first parameter. `data.ts` never imports the runtime `db` singleton.
- Parameterized Drizzle queries only; never string-interpolated SQL. `.limit()` every unbounded read.
- No secrets in code; **no external network calls in this slice**; no credentials handled.
- No `console.log` in committed library code. The runner **script** (`src/db/source-tenders.ts`) MAY `console.log`/`console.error` its summary — that is its operator interface, matching `seed-mappings.ts`. No TODO comments; no silent empty `catch` (skips are explicit + counted).
- Always write tests for new functions; unit tests under `tests/unit/lib/`, integration under `tests/integration/`. ≥80% on new code.
- **Schema changes via a generated Drizzle migration** (`npm run db:generate` → `src/db/migrations/0010_*.sql` → `npm run db:migrate`). Keep additive + nullable so shipped tables/rows are unaffected. **Never `db:push`** — the test branch's schema comes from applied migration files via `migrateTestDb()`.
- Commit only explicit file paths — never `git add .`/`-A`. Leave `AGENTS.md`, `.DS_Store`, `.next`, `.superpowers/` unstaged.
- Detected signals are ONLY `SIG-TENDER-LIVE` / `SIG-TENDER-AMENDED`, ONLY for approved definitions, ONLY on a keyword match. Evidence array is always non-empty (proof principle).
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Pure sourcing schema module

**Files:**
- Create: `src/lib/sourcing/schema.ts`
- Test: `tests/unit/lib/sourcing-schema.test.ts`

**Interfaces:**
- Consumes: `zod` (already a dependency).
- Produces (later tasks rely on these exact names/types):
  - `TENDER_KEYWORDS: readonly string[]`
  - `TENDER_LIVE_SIGNAL = "SIG-TENDER-LIVE"`, `TENDER_AMENDED_SIGNAL = "SIG-TENDER-AMENDED"`
  - `tenderRecordSchema` (Zod), `type TenderRecord`
  - `interface SourceAdapter { readonly sourceName: string; fetch(): Promise<{ records: TenderRecord[]; skippedMalformed: number }> }`
  - `type DetectedObservation = { signalId: string; sourceRef: string; source: string; detectedAt: string; evidence: string[]; issuingBody: string }`
  - `type FreshnessVerdict = "recent" | "stale" | null`
  - `normalizeCompanyName(name: string): string`
  - `computeFreshnessVerdict(detectedAt: Date, windowDays: number | null, now: Date): FreshnessVerdict`
  - `detectTenderSignals(record: TenderRecord, approvedSignalIds: Set<string>, keywords: readonly string[]): DetectedObservation[]`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/lib/sourcing-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  tenderRecordSchema,
  normalizeCompanyName,
  computeFreshnessVerdict,
  detectTenderSignals,
  TENDER_KEYWORDS,
  TENDER_LIVE_SIGNAL,
  TENDER_AMENDED_SIGNAL,
  type TenderRecord,
} from "@/lib/sourcing/schema";

const base: TenderRecord = {
  ref: "T-1",
  title: "Supply of CCTV surveillance",
  issuingBody: "Pune Municipal Corporation",
  publishedAt: "2026-06-20T00:00:00Z",
  sourceName: "GeM",
};

describe("normalizeCompanyName", () => {
  it("lower-cases, collapses whitespace, strips trailing punctuation", () => {
    expect(normalizeCompanyName("Acme Corp.")).toBe("acme corp");
    expect(normalizeCompanyName("  Foo   Bar  ")).toBe("foo bar");
    expect(normalizeCompanyName("PMC,")).toBe("pmc");
  });
});

describe("computeFreshnessVerdict", () => {
  const now = new Date("2026-06-30T00:00:00Z");
  it("returns null when the window is undefined", () => {
    expect(computeFreshnessVerdict(new Date("2026-01-01T00:00:00Z"), null, now)).toBeNull();
  });
  it("returns 'recent' inside the window (inclusive boundary)", () => {
    expect(computeFreshnessVerdict(new Date("2026-06-20T00:00:00Z"), 90, now)).toBe("recent");
    expect(computeFreshnessVerdict(new Date("2026-04-01T00:00:00Z"), 90, now)).toBe("recent");
  });
  it("returns 'stale' outside the window", () => {
    expect(computeFreshnessVerdict(new Date("2025-06-30T00:00:00Z"), 90, now)).toBe("stale");
  });
});

describe("tenderRecordSchema", () => {
  it("accepts a valid record", () => {
    expect(tenderRecordSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a missing ref", () => {
    const { ref, ...noRef } = base;
    expect(tenderRecordSchema.safeParse(noRef).success).toBe(false);
  });
  it("rejects an unparseable publishedAt", () => {
    expect(tenderRecordSchema.safeParse({ ...base, publishedAt: "not-a-date" }).success).toBe(false);
  });
  it("rejects a non-URL url when present", () => {
    expect(tenderRecordSchema.safeParse({ ...base, url: "notaurl" }).success).toBe(false);
  });
});

describe("detectTenderSignals", () => {
  const approvedBoth = new Set([TENDER_LIVE_SIGNAL, TENDER_AMENDED_SIGNAL]);

  it("emits SIG-TENDER-LIVE with non-empty evidence on a keyword match", () => {
    const out = detectTenderSignals(base, new Set([TENDER_LIVE_SIGNAL]), TENDER_KEYWORDS);
    expect(out).toHaveLength(1);
    expect(out[0].signalId).toBe(TENDER_LIVE_SIGNAL);
    expect(out[0].sourceRef).toBe("T-1");
    expect(out[0].source).toBe("GeM");
    expect(out[0].detectedAt).toBe("2026-06-20T00:00:00Z");
    expect(out[0].evidence.length).toBeGreaterThan(0);
  });

  it("emits both LIVE and AMENDED for an amendment that matches, when both approved", () => {
    const out = detectTenderSignals({ ...base, isAmendment: true }, approvedBoth, TENDER_KEYWORDS);
    expect(out.map((o) => o.signalId).sort()).toEqual([TENDER_AMENDED_SIGNAL, TENDER_LIVE_SIGNAL].sort());
  });

  it("emits nothing when no keyword matches", () => {
    const out = detectTenderSignals(
      { ...base, title: "Construction of rural road", description: undefined, keywordsText: undefined },
      approvedBoth,
      TENDER_KEYWORDS,
    );
    expect(out).toHaveLength(0);
  });

  it("does not emit a signal that is not approved", () => {
    const out = detectTenderSignals({ ...base, isAmendment: true }, new Set([TENDER_AMENDED_SIGNAL]), TENDER_KEYWORDS);
    expect(out.map((o) => o.signalId)).toEqual([TENDER_AMENDED_SIGNAL]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/sourcing-schema.test.ts`
Expected: FAIL — cannot resolve `@/lib/sourcing/schema`.

- [ ] **Step 3: Write `src/lib/sourcing/schema.ts`**

```ts
import { z } from "zod";

/**
 * Vendor keywords for slice 1 — copied from the SIG-TENDER-LIVE seed trigger rule.
 * STOPGAP: later slices derive these from the vendor catalogue. Lower-cased for
 * case-insensitive matching in detectTenderSignals.
 */
export const TENDER_KEYWORDS = ["racking", "cctv", "it hardware", "signage", "printing"] as const;

export const TENDER_LIVE_SIGNAL = "SIG-TENDER-LIVE";
export const TENDER_AMENDED_SIGNAL = "SIG-TENDER-AMENDED";

/** A parseable date string (ISO-8601 or anything Date.parse accepts). */
const dateString = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid date" });

/** One normalized tender record produced by a source adapter. */
export const tenderRecordSchema = z.object({
  ref: z.string().min(1),
  title: z.string().min(1),
  issuingBody: z.string().min(1),
  description: z.string().optional(),
  keywordsText: z.string().optional(),
  publishedAt: dateString,
  deadline: z.string().optional(),
  url: z.string().url().optional(),
  isAmendment: z.boolean().optional(),
  sourceName: z.string().min(1),
});
export type TenderRecord = z.infer<typeof tenderRecordSchema>;

/** The extensibility seam every source adapter implements. */
export interface SourceAdapter {
  readonly sourceName: string;
  fetch(): Promise<{ records: TenderRecord[]; skippedMalformed: number }>;
}

/** A signal detected from one tender record, ready to persist as an observation. */
export type DetectedObservation = {
  signalId: string;
  sourceRef: string;
  source: string;
  detectedAt: string;
  evidence: string[];
  issuingBody: string;
};

export type FreshnessVerdict = "recent" | "stale" | null;

/** Deterministic company-name normalization for entity dedup. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

/**
 * "recent" if the observation is within the signal's freshness window, else "stale".
 * null when the window is undefined so we never assert freshness we cannot compute.
 */
export function computeFreshnessVerdict(
  detectedAt: Date,
  windowDays: number | null,
  now: Date,
): FreshnessVerdict {
  if (windowDays == null) return null;
  const ageMs = now.getTime() - detectedAt.getTime();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  return ageMs <= windowMs ? "recent" : "stale";
}

/**
 * PURE tender detector. Matches record text against vendor keywords (case-insensitive).
 * On a match emits SIG-TENDER-LIVE (if approved); if the record is an amendment it also
 * emits SIG-TENDER-AMENDED (if approved). Emits nothing on no match or an unapproved signal.
 * Evidence is always non-empty (the proof principle).
 */
export function detectTenderSignals(
  record: TenderRecord,
  approvedSignalIds: Set<string>,
  keywords: readonly string[],
): DetectedObservation[] {
  const haystack = [record.title, record.description ?? "", record.keywordsText ?? ""]
    .join(" ")
    .toLowerCase();
  const matched = keywords.filter((k) => haystack.includes(k.toLowerCase()));
  if (matched.length === 0) return [];

  const evidence = [
    record.title,
    `ref: ${record.ref}`,
    `matched: ${matched.join(", ")}`,
    ...(record.url ? [record.url] : []),
  ];

  const observations: DetectedObservation[] = [];
  if (approvedSignalIds.has(TENDER_LIVE_SIGNAL)) {
    observations.push({
      signalId: TENDER_LIVE_SIGNAL,
      sourceRef: record.ref,
      source: record.sourceName,
      detectedAt: record.publishedAt,
      evidence,
      issuingBody: record.issuingBody,
    });
  }
  if (record.isAmendment && approvedSignalIds.has(TENDER_AMENDED_SIGNAL)) {
    observations.push({
      signalId: TENDER_AMENDED_SIGNAL,
      sourceRef: record.ref,
      source: record.sourceName,
      detectedAt: record.publishedAt,
      evidence: [...evidence, "amendment/corrigendum"],
      issuingBody: record.issuingBody,
    });
  }
  return observations;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/sourcing-schema.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Verify the client-safety boundary and typecheck**

Run: `grep -n "@/db" src/lib/sourcing/schema.ts` → Expected: no output (no DB import).
Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sourcing/schema.ts tests/unit/lib/sourcing-schema.test.ts
git commit -m "feat(sourcing): pure tender schema — types, Zod, detect/normalize/freshness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: DB schema additions + generated migration

**Files:**
- Modify: `src/db/schema/companies.ts` (add `normalizedName` column + unique index)
- Modify: `src/db/schema/signals.ts` (add `sourceRef` to `signalObservations` + composite unique index; add `uniqueIndex` to imports)
- Create (generated by `db:generate`): `src/db/migrations/0010_*.sql` + `src/db/migrations/meta/0010_snapshot.json` + updated `src/db/migrations/meta/_journal.json`
- Test: `tests/integration/sourcing-schema.test.ts`

**Interfaces:**
- Consumes: existing `companies` and `signalObservations` tables.
- Produces: `companies.normalizedName` (`normalized_name text`, nullable, unique index `companies_normalized_name_uq`); `signalObservations.sourceRef` (`source_ref text`, nullable) with unique index `signal_observations_dedupe_uq` on `(signal_id, company_id, source_ref)`. These back the dedup logic in Task 4.

**Impact assessment (additive-only, LOW):** both changes are new **nullable** columns plus new indexes — no column removed, renamed, or retyped. Existing readers (`select` of specific columns or whole row) are unaffected; the `signal_observations` table is currently unpopulated. Confirm no consumer reads these as required before editing (Step 1).

- [ ] **Step 1: Confirm the additive-only blast radius**

Run: `grep -rn "normalized_name\|normalizedName\|source_ref\|sourceRef" src/ | grep -v "src/db/migrations"`
Expected: no output (no existing code references the new columns → purely additive). If any consumer appears, stop and report.

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/sourcing-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { companies, signalDefinitions, signalObservations } from "@/db/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["signal_observations", "signal_definitions", "companies"]); });
afterAll(async () => { await closeTestDb(); });

describe("companies.normalized_name unique index", () => {
  it("dedupes a repeated normalized_name via onConflictDoNothing", async () => {
    const a = await testDb.insert(companies).values({ name: "Acme", normalizedName: "acme" }).returning();
    const b = await testDb
      .insert(companies)
      .values({ name: "ACME", normalizedName: "acme" })
      .onConflictDoNothing({ target: companies.normalizedName })
      .returning();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0); // conflict → skipped
  });
});

describe("signal_observations composite dedup index", () => {
  it("dedupes a repeated (signal_id, company_id, source_ref)", async () => {
    await testDb.insert(signalDefinitions).values({
      signalId: "SIG-TENDER-LIVE", name: "Live tender", family: "procurement",
      strength: "very_high", falsePositiveRisk: "low", status: "approved",
    });
    const [co] = await testDb.insert(companies).values({ name: "PMC", normalizedName: "pmc" }).returning();
    const values = {
      signalId: "SIG-TENDER-LIVE",
      companyId: co.companyId,
      detectedAt: new Date("2026-06-20T00:00:00Z"),
      source: "GeM",
      evidence: ["tender X"],
      sourceRef: "T-1",
    };
    const first = await testDb.insert(signalObservations).values(values).returning();
    const second = await testDb
      .insert(signalObservations)
      .values(values)
      .onConflictDoNothing({
        target: [signalObservations.signalId, signalObservations.companyId, signalObservations.sourceRef],
      })
      .returning();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // conflict → skipped
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/sourcing-schema.test.ts`
Expected: FAIL — `normalized_name`/`source_ref` columns do not exist yet (or the `onConflictDoNothing` target has no matching unique index).

- [ ] **Step 4: Edit `src/db/schema/companies.ts` — replace the whole file**

```ts
import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const companies = pgTable(
  "companies",
  {
    companyId: uuid("company_id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name"), // entity-dedup key; set by the sourcing layer
    description: text("description"),
    profile: jsonb("profile"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("companies_normalized_name_uq").on(t.normalizedName)],
);
```

- [ ] **Step 5: Edit `src/db/schema/signals.ts`**

Change the import on line 1 to add `uniqueIndex`:

```ts
import { pgTable, text, integer, jsonb, date, timestamp, uuid, real, uniqueIndex } from "drizzle-orm/pg-core";
```

Replace the existing `signalObservations` block (currently ending `});`) with:

```ts
export const signalObservations = pgTable(
  "signal_observations",
  {
    observationId: uuid("observation_id").primaryKey().defaultRandom(),
    signalId: text("signal_id").notNull().references(() => signalDefinitions.signalId),
    companyId: uuid("company_id").notNull().references(() => companies.companyId),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),   // MANDATORY (proof)
    source: text("source").notNull(),                                          // MANDATORY (proof)
    evidence: text("evidence").array().notNull(),                              // MANDATORY (proof)
    freshnessVerdict: text("freshness_verdict"),               // computed: recent | stale
    entityMatchConfidence: real("entity_match_confidence"),    // computed
    sourceRef: text("source_ref"),                             // source event id; dedup key
  },
  (t) => [
    uniqueIndex("signal_observations_dedupe_uq").on(t.signalId, t.companyId, t.sourceRef),
  ],
);
```

- [ ] **Step 6: Generate the migration**

Run: `npm run db:generate`
Expected: creates `src/db/migrations/0010_*.sql`, `src/db/migrations/meta/0010_snapshot.json`, and appends to `_journal.json`.

- [ ] **Step 7: Verify the generated SQL is exactly additive**

Run: `cat src/db/migrations/0010_*.sql`
Expected: only `ALTER TABLE "companies" ADD COLUMN "normalized_name" text;`, `ALTER TABLE "signal_observations" ADD COLUMN "source_ref" text;`, and two `CREATE UNIQUE INDEX` statements (`companies_normalized_name_uq`, `signal_observations_dedupe_uq`). **No `DROP`, no `ALTER COLUMN ... SET NOT NULL`, no other table touched.** If anything else appears, stop and report.

- [ ] **Step 8: Apply the migration to the dev DB**

Run: `npm run db:migrate`
Expected: applies `0010` cleanly (uses `DIRECT_URL`).

- [ ] **Step 9: Run the integration test to verify it passes**

Run: `npx vitest run tests/integration/sourcing-schema.test.ts`
Expected: PASS — `migrateTestDb()` applies `0010` to the test branch; both dedup cases hold.
(If a transient Neon TRUNCATE/latency error appears, re-run 2–3× — only a deterministic repeat is real.)

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add src/db/schema/companies.ts src/db/schema/signals.ts src/db/migrations/0010_*.sql src/db/migrations/meta/0010_snapshot.json src/db/migrations/meta/_journal.json tests/integration/sourcing-schema.test.ts
git commit -m "feat(db): add normalized_name + source_ref dedup columns and indexes (0010)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Tender fixture + fixture-first adapter

**Files:**
- Create: `src/lib/sourcing/fixtures/tenders-sample.json`
- Create: `src/lib/sourcing/adapters/tenders.ts`
- Test: `tests/unit/lib/sourcing-tender-adapter.test.ts`

**Interfaces:**
- Consumes: `tenderRecordSchema`, `SourceAdapter`, `TenderRecord` from `@/lib/sourcing/schema` (Task 1).
- Produces: `createTenderFixtureAdapter(raw?: unknown[]): SourceAdapter` (default reads the committed fixture; pass `raw` to inject records in tests). `sourceName` is `"tender-fixture"`.

- [ ] **Step 1: Create the fixture `src/lib/sourcing/fixtures/tenders-sample.json`**

```json
[
  {
    "ref": "CPPP/2026/RACK/00187",
    "title": "Supply and installation of heavy-duty pallet racking for regional warehouse",
    "issuingBody": "Maharashtra State Warehousing Corporation",
    "description": "Open tender for design, supply and installation of selective pallet racking systems.",
    "keywordsText": "racking, warehouse, storage",
    "publishedAt": "2026-06-20T00:00:00Z",
    "deadline": "2026-07-15T00:00:00Z",
    "url": "https://eprocure.gov.in/cppp/tender/CPPP-2026-RACK-00187",
    "sourceName": "CPPP"
  },
  {
    "ref": "GEM/2026/CCTV/44521",
    "title": "Procurement of CCTV surveillance system for municipal offices",
    "issuingBody": "Pune Municipal Corporation",
    "description": "Supply, installation, testing and commissioning of IP CCTV cameras and NVR.",
    "keywordsText": "cctv, surveillance, security",
    "publishedAt": "2026-06-25T00:00:00Z",
    "url": "https://gem.gov.in/tender/GEM-2026-CCTV-44521",
    "sourceName": "GeM"
  },
  {
    "ref": "GEM/2026/SIGN/44900",
    "title": "Fabrication and installation of directional signage across campus",
    "issuingBody": "Pune Municipal Corporation",
    "description": "Interior and exterior signage boards and wayfinding.",
    "keywordsText": "signage, boards",
    "publishedAt": "2026-06-28T00:00:00Z",
    "sourceName": "GeM"
  },
  {
    "ref": "CPPP/2026/RACK/00187",
    "title": "CORRIGENDUM: heavy-duty pallet racking supply — submission deadline extended",
    "issuingBody": "Maharashtra State Warehousing Corporation",
    "description": "Corrigendum extending the submission deadline for the racking tender.",
    "keywordsText": "racking, corrigendum",
    "publishedAt": "2026-06-30T00:00:00Z",
    "deadline": "2026-07-30T00:00:00Z",
    "url": "https://eprocure.gov.in/cppp/tender/CPPP-2026-RACK-00187",
    "isAmendment": true,
    "sourceName": "CPPP"
  },
  {
    "ref": "CPPP/2026/ROAD/01230",
    "title": "Construction of rural approach road package IV",
    "issuingBody": "Public Works Department, Nashik",
    "description": "Earthwork, bituminous surfacing and culverts for rural road.",
    "keywordsText": "road, civil, construction",
    "publishedAt": "2026-06-22T00:00:00Z",
    "sourceName": "CPPP"
  },
  {
    "ref": "GEM/2026/PRINT/45010",
    "title": "Annual rate contract for commercial printing of brochures and forms",
    "issuingBody": "Directorate of Information and Public Relations",
    "description": "Offset and digital printing services.",
    "keywordsText": "printing, offset, brochures",
    "publishedAt": "2026-06-18T00:00:00Z",
    "url": "https://gem.gov.in/tender/GEM-2026-PRINT-45010",
    "sourceName": "GeM"
  }
]
```

Note the deliberate shape: 5 keyword matches (racking, cctv, signage, racking-corrigendum, printing), 1 non-match (road), 1 amendment (record 4), and a duplicate `ref` shared by records 1 and 4 (same issuing body) to exercise entity + observation dedup downstream.

- [ ] **Step 2: Write the failing unit test**

Create `tests/unit/lib/sourcing-tender-adapter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTenderFixtureAdapter } from "@/lib/sourcing/adapters/tenders";

describe("createTenderFixtureAdapter", () => {
  it("parses the committed fixture with no malformed records", async () => {
    const { records, skippedMalformed } = await createTenderFixtureAdapter().fetch();
    expect(records.length).toBeGreaterThan(0);
    expect(skippedMalformed).toBe(0);
    for (const r of records) {
      expect(r.ref).toBeTruthy();
      expect(r.issuingBody).toBeTruthy();
      expect(r.sourceName).toBeTruthy();
    }
  });

  it("keeps valid records and counts malformed ones", async () => {
    const raw = [
      { ref: "T-1", title: "CCTV supply", issuingBody: "City", publishedAt: "2026-06-01", sourceName: "GeM" },
      { title: "no ref", issuingBody: "City", publishedAt: "2026-06-01", sourceName: "GeM" },
      { ref: "T-3", title: "bad date", issuingBody: "City", publishedAt: "not-a-date", sourceName: "GeM" },
    ];
    const { records, skippedMalformed } = await createTenderFixtureAdapter(raw).fetch();
    expect(records.map((r) => r.ref)).toEqual(["T-1"]);
    expect(skippedMalformed).toBe(2);
  });

  it("exposes a stable sourceName", () => {
    expect(createTenderFixtureAdapter([]).sourceName).toBe("tender-fixture");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/sourcing-tender-adapter.test.ts`
Expected: FAIL — cannot resolve `@/lib/sourcing/adapters/tenders`.

- [ ] **Step 4: Write `src/lib/sourcing/adapters/tenders.ts`**

```ts
import { tenderRecordSchema, type SourceAdapter, type TenderRecord } from "@/lib/sourcing/schema";
import rawTenders from "../fixtures/tenders-sample.json";

/**
 * Fixture-first tender adapter. Reads recorded tender records (no network),
 * validates each against tenderRecordSchema, and reports how many were malformed.
 * Pass `raw` to inject a custom record set (used by tests).
 */
export function createTenderFixtureAdapter(raw: unknown[] = rawTenders as unknown[]): SourceAdapter {
  return {
    sourceName: "tender-fixture",
    async fetch() {
      const records: TenderRecord[] = [];
      let skippedMalformed = 0;
      for (const entry of raw) {
        const parsed = tenderRecordSchema.safeParse(entry);
        if (parsed.success) records.push(parsed.data);
        else skippedMalformed++;
      }
      return { records, skippedMalformed };
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/sourcing-tender-adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + client-safety**

Run: `grep -n "@/db" src/lib/sourcing/adapters/tenders.ts` → Expected: no output.
Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sourcing/fixtures/tenders-sample.json src/lib/sourcing/adapters/tenders.ts tests/unit/lib/sourcing-tender-adapter.test.ts
git commit -m "feat(sourcing): fixture-first tender adapter + recorded sample

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Sourcing data layer (resolve, list, ingest)

**Files:**
- Create: `src/lib/sourcing/data.ts`
- Test: `tests/integration/sourcing-data.test.ts`

**Interfaces:**
- Consumes: `@/db/schema` (`companies`, `signalDefinitions`, `signalObservations`); `type DB` from `@/db/client` (type-only); pure fns + `TENDER_KEYWORDS` + `type SourceAdapter` from `@/lib/sourcing/schema` (Task 1); the columns added in Task 2; `drizzle-orm` (`and`, `eq`, `like`).
- Produces:
  - `resolveCompany(db: DB, name: string): Promise<{ companyId: string; entityMatchConfidence: number }>`
  - `listApprovedTenderSignals(db: DB): Promise<{ signalId: string; freshnessWindowDays: number | null }[]>`
  - `ingestTenderObservations(db: DB, adapter: SourceAdapter): Promise<IngestResult>`
  - `type IngestResult = { scanned: number; detected: number; written: number; skippedDuplicates: number; skippedMalformed: number }`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/sourcing-data.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { companies, signalDefinitions, signalObservations } from "@/db/schema";
import { resolveCompany, ingestTenderObservations } from "@/lib/sourcing/data";
import type { SourceAdapter, TenderRecord } from "@/lib/sourcing/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["signal_observations", "signal_definitions", "companies"]); });
afterAll(async () => { await closeTestDb(); });

async function approvedTenderSignal(signalId: string, freshnessWindowDays: number | null = null) {
  await testDb.insert(signalDefinitions).values({
    signalId, name: `S ${signalId}`, family: "procurement",
    strength: "high", falsePositiveRisk: "low",
    freshnessWindowDays, status: "approved", origin: "seed",
  }).onConflictDoNothing();
}

function adapterFrom(records: TenderRecord[], skippedMalformed = 0): SourceAdapter {
  return { sourceName: "test", async fetch() { return { records, skippedMalformed }; } };
}

const liveRecord: TenderRecord = {
  ref: "T-1", title: "CCTV surveillance supply", issuingBody: "Pune Municipal Corporation",
  publishedAt: "2026-06-25T00:00:00Z", sourceName: "GeM",
};

describe("resolveCompany", () => {
  it("creates once and reuses the same company for normalized-equal names", async () => {
    const a = await resolveCompany(testDb, "Acme Corp.");
    const b = await resolveCompany(testDb, "acme corp");
    expect(b.companyId).toBe(a.companyId);
    expect(a.entityMatchConfidence).toBe(1);
    const rows = await testDb.select().from(companies);
    expect(rows).toHaveLength(1);
  });
});

describe("ingestTenderObservations", () => {
  it("writes an observation with all mandatory proof fields", async () => {
    await approvedTenderSignal("SIG-TENDER-LIVE", 90);
    const now = new Date();
    const res = await ingestTenderObservations(
      testDb,
      adapterFrom([{ ...liveRecord, publishedAt: now.toISOString() }]),
    );
    expect(res.written).toBe(1);
    expect(res.detected).toBe(1);
    const [obs] = await testDb.select().from(signalObservations);
    expect(obs.signalId).toBe("SIG-TENDER-LIVE");
    expect(obs.detectedAt).not.toBeNull();
    expect(obs.source).toBe("GeM");
    expect(obs.evidence.length).toBeGreaterThan(0);
    expect(obs.companyId).toBeTruthy();
    expect(obs.entityMatchConfidence).toBe(1);
    expect(obs.freshnessVerdict).toBe("recent");
    expect(obs.sourceRef).toBe("T-1");
  });

  it("marks an old tender 'stale' against the freshness window", async () => {
    await approvedTenderSignal("SIG-TENDER-LIVE", 90);
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    await ingestTenderObservations(testDb, adapterFrom([{ ...liveRecord, publishedAt: old }]));
    const [obs] = await testDb.select().from(signalObservations);
    expect(obs.freshnessVerdict).toBe("stale");
  });

  it("emits LIVE + AMENDED for a matching amendment when both are approved", async () => {
    await approvedTenderSignal("SIG-TENDER-LIVE", 90);
    await approvedTenderSignal("SIG-TENDER-AMENDED", 90);
    const res = await ingestTenderObservations(
      testDb,
      adapterFrom([{ ...liveRecord, isAmendment: true }]),
    );
    expect(res.written).toBe(2);
    const rows = await testDb.select().from(signalObservations);
    expect(rows.map((r) => r.signalId).sort()).toEqual(["SIG-TENDER-AMENDED", "SIG-TENDER-LIVE"]);
  });

  it("does not write a signal that is not approved", async () => {
    await approvedTenderSignal("SIG-TENDER-AMENDED", 90); // LIVE intentionally NOT approved
    const res = await ingestTenderObservations(
      testDb,
      adapterFrom([{ ...liveRecord, isAmendment: true }]),
    );
    const rows = await testDb.select().from(signalObservations);
    expect(rows.map((r) => r.signalId)).toEqual(["SIG-TENDER-AMENDED"]);
    expect(res.written).toBe(1);
  });

  it("is idempotent — a second run writes 0 rows", async () => {
    await approvedTenderSignal("SIG-TENDER-LIVE", 90);
    const adapter = adapterFrom([liveRecord]);
    const first = await ingestTenderObservations(testDb, adapter);
    const second = await ingestTenderObservations(testDb, adapter);
    expect(first.written).toBe(1);
    expect(second.written).toBe(0);
    expect(second.skippedDuplicates).toBe(1);
    const rows = await testDb.select().from(signalObservations);
    expect(rows).toHaveLength(1);
  });

  it("resolves the same issuing body across records to one company", async () => {
    await approvedTenderSignal("SIG-TENDER-LIVE", 90);
    await ingestTenderObservations(testDb, adapterFrom([
      { ...liveRecord, ref: "T-1" },
      { ...liveRecord, ref: "T-2", title: "signage boards supply" },
    ]));
    const cos = await testDb.select().from(companies).where(eq(companies.normalizedName, "pune municipal corporation"));
    expect(cos).toHaveLength(1);
  });

  it("skips malformed records reported by the adapter and still succeeds", async () => {
    await approvedTenderSignal("SIG-TENDER-LIVE", 90);
    const res = await ingestTenderObservations(testDb, adapterFrom([liveRecord], 2));
    expect(res.skippedMalformed).toBe(2);
    expect(res.scanned).toBe(3); // 1 valid + 2 malformed
    expect(res.written).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/sourcing-data.test.ts`
Expected: FAIL — cannot resolve `@/lib/sourcing/data`.

- [ ] **Step 3: Write `src/lib/sourcing/data.ts`**

```ts
import { and, eq, like } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — erased at runtime, never loads the env-eager client
import { companies, signalDefinitions, signalObservations } from "@/db/schema";
import {
  normalizeCompanyName,
  computeFreshnessVerdict,
  detectTenderSignals,
  TENDER_KEYWORDS,
  type SourceAdapter,
} from "@/lib/sourcing/schema";

export type IngestResult = {
  scanned: number;
  detected: number;
  written: number;
  skippedDuplicates: number;
  skippedMalformed: number;
};

/** Find-or-create a company by normalized name. Deterministic; confidence 1 for an exact normalized match. */
export async function resolveCompany(
  db: DB,
  name: string,
): Promise<{ companyId: string; entityMatchConfidence: number }> {
  const normalized = normalizeCompanyName(name);

  const existing = await db
    .select({ id: companies.companyId })
    .from(companies)
    .where(eq(companies.normalizedName, normalized))
    .limit(1);
  if (existing.length > 0) return { companyId: existing[0].id, entityMatchConfidence: 1 };

  const inserted = await db
    .insert(companies)
    .values({ name: name.trim(), normalizedName: normalized })
    .onConflictDoNothing({ target: companies.normalizedName })
    .returning({ id: companies.companyId });
  if (inserted.length > 0) return { companyId: inserted[0].id, entityMatchConfidence: 1 };

  // Lost an insert race — re-select the winning row.
  const race = await db
    .select({ id: companies.companyId })
    .from(companies)
    .where(eq(companies.normalizedName, normalized))
    .limit(1);
  return { companyId: race[0].id, entityMatchConfidence: 1 };
}

/** Approved signal definitions in the tender family, with their freshness window. */
export async function listApprovedTenderSignals(
  db: DB,
): Promise<{ signalId: string; freshnessWindowDays: number | null }[]> {
  return db
    .select({
      signalId: signalDefinitions.signalId,
      freshnessWindowDays: signalDefinitions.freshnessWindowDays,
    })
    .from(signalDefinitions)
    .where(and(eq(signalDefinitions.status, "approved"), like(signalDefinitions.signalId, "SIG-TENDER-%")))
    .limit(100);
}

/**
 * Orchestrate one on-demand sourcing run: fetch → detect → resolve entity → upsert observation.
 * Idempotent via the (signal_id, company_id, source_ref) unique index + onConflictDoNothing.
 */
export async function ingestTenderObservations(db: DB, adapter: SourceAdapter): Promise<IngestResult> {
  const { records, skippedMalformed } = await adapter.fetch();
  const defs = await listApprovedTenderSignals(db);
  const approvedIds = new Set(defs.map((d) => d.signalId));
  const windowBySignal = new Map(defs.map((d) => [d.signalId, d.freshnessWindowDays]));
  const now = new Date();

  let detected = 0;
  let written = 0;
  let skippedDuplicates = 0;

  for (const record of records) {
    const observations = detectTenderSignals(record, approvedIds, TENDER_KEYWORDS);
    for (const obs of observations) {
      detected++;
      const { companyId, entityMatchConfidence } = await resolveCompany(db, obs.issuingBody);
      const detectedAt = new Date(obs.detectedAt);
      const freshnessVerdict = computeFreshnessVerdict(
        detectedAt,
        windowBySignal.get(obs.signalId) ?? null,
        now,
      );
      const ins = await db
        .insert(signalObservations)
        .values({
          signalId: obs.signalId,
          companyId,
          detectedAt,
          source: obs.source,
          evidence: obs.evidence,
          freshnessVerdict,
          entityMatchConfidence,
          sourceRef: obs.sourceRef,
        })
        .onConflictDoNothing({
          target: [signalObservations.signalId, signalObservations.companyId, signalObservations.sourceRef],
        })
        .returning({ id: signalObservations.observationId });
      if (ins.length > 0) written++;
      else skippedDuplicates++;
    }
  }

  return { scanned: records.length + skippedMalformed, detected, written, skippedDuplicates, skippedMalformed };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/sourcing-data.test.ts`
Expected: PASS (all cases). (Transient Neon errors → re-run 2–3×.)

- [ ] **Step 5: Verify the client boundary is type-only + typecheck**

Run: `grep -n "@/db/client" src/lib/sourcing/data.ts` → Expected: exactly one line, and it MUST be `import type { DB } from "@/db/client";` (the `type` keyword makes it erased — a runtime import would load the env-eager client and break `tsx`).
Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sourcing/data.ts tests/integration/sourcing-data.test.ts
git commit -m "feat(sourcing): tender ingest data layer — resolve, list, idempotent observation capture

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: On-demand runner script + npm script

**Files:**
- Create: `src/db/source-tenders.ts`
- Modify: `package.json` (add `db:source:tenders` script after `db:seed:mappings`)

**Interfaces:**
- Consumes: `createTenderFixtureAdapter` (Task 3), `ingestTenderObservations` + `IngestResult` (Task 4), `type DB` from `./client`.
- Produces: `runTenderSourcing(db: DB): Promise<IngestResult>` + a direct-run guard that opens its own connection (mirrors `seed-mappings.ts`).

- [ ] **Step 1: Write `src/db/source-tenders.ts`**

```ts
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
```

- [ ] **Step 2: Add the npm script to `package.json`**

After the `"db:seed:mappings": ...` line, add:

```json
    "db:source:tenders": "tsx src/db/source-tenders.ts",
```

(Ensure the preceding line keeps its trailing comma and JSON stays valid.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the script end-to-end against the dev DB**

First ensure the tender signals are approved in the dev DB (they seed as approved): `npm run db:seed:signals`
Then: `npm run db:source:tenders`
Expected: prints `Tender sourcing complete: {"scanned":6,"detected":...,"written":...,"skippedDuplicates":...,"skippedMalformed":0}` and exits 0. On a second run, `written` is 0 and `skippedDuplicates` equals the first run's `written` (idempotency).

- [ ] **Step 5: Commit**

```bash
git add src/db/source-tenders.ts package.json
git commit -m "feat(sourcing): db:source:tenders on-demand runner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (controller, against the spec)

- **Spec coverage:** adapter interface + tender adapter (Task 3) ✓; detection with evidence (Task 1 `detectTenderSignals`, exercised Task 4) ✓; entity resolution/dedup (Task 2 index + Task 4 `resolveCompany`) ✓; mandatory proof fields + freshness + confidence (Task 4 test asserts each) ✓; idempotency (Task 2 index + Task 4 idempotency test) ✓; malformed skip (Task 3 adapter + Task 4 count) ✓; on-demand trigger (Task 5) ✓; data-module split + client boundary (Tasks 1/4 grep steps) ✓; schema via generated migration not push (Task 2) ✓. All 7 acceptance criteria map to a task.
- **Type consistency:** `SourceAdapter.fetch()` returns `{ records, skippedMalformed }` everywhere (schema, adapter, test doubles, data layer). `DetectedObservation`/`IngestResult`/`FreshnessVerdict` names are stable across tasks. `resolveCompany`/`listApprovedTenderSignals`/`ingestTenderObservations` all take `db: DB` first.
- **No placeholders:** every code + command step is complete.
- **Deferred-gate note:** no task leaves the tree red — each task's own tests pass on completion; Task 2's migration is applied before Task 4 uses the columns.
