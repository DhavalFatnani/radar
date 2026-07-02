# Job-Board Sourcing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect hiring-growth signals (`SIG-HIRING-*`) from job postings and persist them as `signal_observations`, activating the seeded-but-unfed `hiring` signal family so the existing leads pipeline picks up hiring-driven leads with no downstream change.

**Architecture:** A parallel, purely-additive sibling of the tender path. A pure `jobs-schema.ts` (job-posting record + `JobSourceAdapter` seam + role/threshold constants + `detectHiringSignals`) and a deterministic fixture adapter feed a server `jobs.ts` (`ingestJobObservations`) that reuses the exported `resolveCompany` / `computeFreshnessVerdict` and writes to `signal_observations` with the same `(signal_id, company_id, source_ref)` dedup. A runner exposes `db:source:jobs`. The tender path, scoring, leads, and schema are untouched.

**Tech Stack:** TypeScript (strict), Zod, Drizzle ORM (postgres-js), Vitest, Next.js 15 App Router (`@/` → `src/`).

## Global Constraints

- **Data-module split:** `jobs-schema.ts` is pure — imports ONLY `zod` and the pure `normalizeCompanyName` from `@/lib/sourcing/schema`. NO `@/db`, no `server-only`, client-safe. `jobs.ts` is server orchestration.
- **Injected-DB type-only import:** `jobs.ts` imports the DB type via `import type { DB } from "@/db/client"` — the `type` keyword is load-bearing (erased at runtime; a value import would eagerly open a Postgres connection and break no-DB tests).
- **Injected adapter seam:** `ingestJobObservations(db, adapter, now?)` takes the adapter as a parameter; the fixture adapter is a drop-in, a real job-board API a later replacement. Mirrors `SourceAdapter` / `ingestTenderObservations`.
- **No fabrication / proof integrity:** every observation's `detectedAt` and `sourceRef` come from a REAL posting; `evidence[]` is always non-empty and built only from real posting fields (titles, url, counts). Only signals in the approved set emit. A posting matching nothing produces nothing — never a placeholder observation.
- **Signal scope:** detect exactly `SIG-HIRING-SENIOR-OPS` (per-posting), `SIG-HIRING-OPS-SURGE` and `SIG-HIRING-FIELD-MKTG` (per-company aggregates). `SIG-HIRING-NEW-CITY` is OUT of scope (needs company-presence data we cannot fabricate).
- **Thresholds/keywords are code constants** in `jobs-schema.ts` (mirroring `TENDER_KEYWORDS`): `OPS_SURGE_THRESHOLD = 5`, `FIELD_MKTG_THRESHOLD = 3`. Not data, not config.
- **Window is data-driven:** the rolling window per signal comes from `signal_definitions.freshness_window_days`; when null the window is NOT applied (count all) and `computeFreshnessVerdict` returns null (never assert freshness we cannot compute) — consistent with the tender path.
- **Dedup / idempotency:** insert into `signal_observations` with `onConflictDoNothing({ target: [signalId, companyId, sourceRef] })`. Re-runs write 0.
- **Writes ONLY** `companies` (via `resolveCompany`) and `signal_observations`. Never `signal_definitions`, `leads`, or the tender path.
- **Query bounds:** `listApprovedHiringSignals` uses `.limit(100)` like `listApprovedTenderSignals`.
- **No `console.log` / TODO / silent empty catch** in module code. The runner's summary `console.log` / `console.error` are the sole sanctioned exception (operator interface).
- **Commit hygiene:** each task commits ONLY its explicit file paths — NEVER `git add .` / `-A`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Pure hiring-detection schema + fixture adapter

**Files:**
- Create: `src/lib/sourcing/jobs-schema.ts`
- Create: `src/lib/sourcing/adapters/jobs-fixture.ts`
- Create: `src/lib/sourcing/fixtures/jobs-sample.json`
- Test: `tests/unit/sourcing/jobs-schema.test.ts`

**Interfaces:**
- Consumes: `normalizeCompanyName(name: string): string` from `@/lib/sourcing/schema` (pure, DB-free).
- Produces (later tasks rely on these EXACT names/types):
  - `jobPostingRecordSchema` (Zod) and `type JobPostingRecord = { ref: string; title: string; company: string; city?: string; url?: string; postedAt: string; sourceName: string }`.
  - `interface JobSourceAdapter { readonly sourceName: string; fetch(): Promise<{ records: JobPostingRecord[]; skippedMalformed: number }> }`.
  - `type DetectedHiringObservation = { signalId: string; sourceRef: string; source: string; detectedAt: string; evidence: string[]; companyName: string }`.
  - `detectHiringSignals(postings: JobPostingRecord[], approvedSignalIds: Set<string>, windowBySignal: Map<string, number | null>, now: Date): DetectedHiringObservation[]`.
  - Constants `SIG_HIRING_OPS_SURGE`, `SIG_HIRING_SENIOR_OPS`, `SIG_HIRING_FIELD_MKTG`, `OPS_ROLE_KEYWORDS`, `SENIOR_OPS_SENIORITY_KEYWORDS`, `FIELD_MKTG_KEYWORDS`, `OPS_SURGE_THRESHOLD = 5`, `FIELD_MKTG_THRESHOLD = 3`.
  - `createJobBoardFixtureAdapter(raw?: unknown[]): JobSourceAdapter` (`sourceName: "jobboard-fixture"`).

- [ ] **Step 1: Write `src/lib/sourcing/jobs-schema.ts`**

```typescript
import { z } from "zod";
import { normalizeCompanyName } from "@/lib/sourcing/schema";

export const SIG_HIRING_OPS_SURGE = "SIG-HIRING-OPS-SURGE";
export const SIG_HIRING_SENIOR_OPS = "SIG-HIRING-SENIOR-OPS";
export const SIG_HIRING_FIELD_MKTG = "SIG-HIRING-FIELD-MKTG";

/** Operations role-title keywords (lower-case). Whole-word for single tokens, phrase-substring for multi-word. */
export const OPS_ROLE_KEYWORDS = [
  "warehouse", "operations", "logistics", "fulfilment", "fulfillment", "supply chain", "ops",
] as const;

/** Seniority markers that make an ops posting a senior-ops leadership role. */
export const SENIOR_OPS_SENIORITY_KEYWORDS = [
  "head", "vp", "vice president", "director", "chief",
] as const;

/** Field-marketing role-title keywords (lower-case). */
export const FIELD_MKTG_KEYWORDS = [
  "promoter", "field marketing", "store launch", "merchandiser", "btl",
] as const;

/** Minimum matching in-window roles per company to fire an aggregate surge signal. */
export const OPS_SURGE_THRESHOLD = 5;
export const FIELD_MKTG_THRESHOLD = 3;

/** A parseable date string (ISO-8601 or anything Date.parse accepts). */
const dateString = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid date" });

/** One normalized job posting produced by a job-board adapter. */
export const jobPostingRecordSchema = z.object({
  ref: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  city: z.string().optional(),
  url: z.string().url().optional(),
  postedAt: dateString,
  sourceName: z.string().min(1),
});
export type JobPostingRecord = z.infer<typeof jobPostingRecordSchema>;

/** The extensibility seam every job-board adapter implements. */
export interface JobSourceAdapter {
  readonly sourceName: string;
  fetch(): Promise<{ records: JobPostingRecord[]; skippedMalformed: number }>;
}

/** A hiring signal detected from job postings, ready to persist as an observation. */
export type DetectedHiringObservation = {
  signalId: string;
  sourceRef: string;
  source: string;
  detectedAt: string;
  evidence: string[];
  companyName: string;
};

/** Lower-case + collapse non-alphanumerics to single spaces, so "field-marketing" matches "field marketing". */
function titleTokens(title: string): { norm: string; words: string[] } {
  const norm = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return { norm, words: norm.split(" ").filter(Boolean) };
}

/** True if the title contains any term — phrase substring for multi-word terms, whole-word for single tokens. */
function titleMatches(title: string, terms: readonly string[]): boolean {
  const { norm, words } = titleTokens(title);
  return terms.some((term) => (term.includes(" ") ? norm.includes(term) : words.includes(term)));
}

/** Postings within the rolling window; when windowDays is null the window is not applied. */
function withinWindow(postedAt: string, windowDays: number | null, now: Date): boolean {
  if (windowDays == null) return true;
  const ageMs = now.getTime() - Date.parse(postedAt);
  return ageMs <= windowDays * 24 * 60 * 60 * 1000;
}

/** The most-recent posting (max postedAt) in a non-empty group — anchors an aggregate observation. */
function mostRecent(posts: JobPostingRecord[]): JobPostingRecord {
  return posts.reduce((a, b) => (Date.parse(b.postedAt) > Date.parse(a.postedAt) ? b : a));
}

/** Emit one aggregate surge observation per company at/over the threshold, within the window. */
function detectSurge(
  postings: JobPostingRecord[],
  signalId: string,
  keywords: readonly string[],
  threshold: number,
  windowDays: number | null,
  now: Date,
): DetectedHiringObservation[] {
  const matching = postings.filter(
    (p) => titleMatches(p.title, keywords) && withinWindow(p.postedAt, windowDays, now),
  );
  const byCompany = new Map<string, { company: string; posts: JobPostingRecord[] }>();
  for (const p of matching) {
    const key = normalizeCompanyName(p.company);
    const group = byCompany.get(key) ?? { company: p.company, posts: [] };
    group.posts.push(p);
    byCompany.set(key, group);
  }
  const observations: DetectedHiringObservation[] = [];
  for (const { company, posts } of byCompany.values()) {
    if (posts.length < threshold) continue;
    const anchor = mostRecent(posts);
    observations.push({
      signalId,
      sourceRef: anchor.ref,
      source: anchor.sourceName,
      detectedAt: anchor.postedAt,
      evidence: [
        `${posts.length} matching roles`,
        ...posts.map((p) => p.title),
        ...(anchor.url ? [anchor.url] : []),
      ],
      companyName: company,
    });
  }
  return observations;
}

/**
 * PURE hiring detector. Emits:
 *  - SIG-HIRING-SENIOR-OPS per posting whose title carries a seniority marker AND an ops-role keyword;
 *  - SIG-HIRING-OPS-SURGE / SIG-HIRING-FIELD-MKTG once per company whose in-window matching postings
 *    reach the threshold.
 * Only approved signals emit. Signals are independent lenses — a posting may contribute to more than
 * one. Evidence is always non-empty; detectedAt and sourceRef are always drawn from a real posting
 * (no fabrication).
 */
export function detectHiringSignals(
  postings: JobPostingRecord[],
  approvedSignalIds: Set<string>,
  windowBySignal: Map<string, number | null>,
  now: Date,
): DetectedHiringObservation[] {
  const observations: DetectedHiringObservation[] = [];

  if (approvedSignalIds.has(SIG_HIRING_SENIOR_OPS)) {
    for (const p of postings) {
      if (titleMatches(p.title, SENIOR_OPS_SENIORITY_KEYWORDS) && titleMatches(p.title, OPS_ROLE_KEYWORDS)) {
        observations.push({
          signalId: SIG_HIRING_SENIOR_OPS,
          sourceRef: p.ref,
          source: p.sourceName,
          detectedAt: p.postedAt,
          evidence: [
            p.title,
            `ref: ${p.ref}`,
            ...(p.city ? [`city: ${p.city}`] : []),
            ...(p.url ? [p.url] : []),
          ],
          companyName: p.company,
        });
      }
    }
  }

  if (approvedSignalIds.has(SIG_HIRING_OPS_SURGE)) {
    observations.push(
      ...detectSurge(
        postings, SIG_HIRING_OPS_SURGE, OPS_ROLE_KEYWORDS, OPS_SURGE_THRESHOLD,
        windowBySignal.get(SIG_HIRING_OPS_SURGE) ?? null, now,
      ),
    );
  }

  if (approvedSignalIds.has(SIG_HIRING_FIELD_MKTG)) {
    observations.push(
      ...detectSurge(
        postings, SIG_HIRING_FIELD_MKTG, FIELD_MKTG_KEYWORDS, FIELD_MKTG_THRESHOLD,
        windowBySignal.get(SIG_HIRING_FIELD_MKTG) ?? null, now,
      ),
    );
  }

  return observations;
}
```

- [ ] **Step 2: Write `src/lib/sourcing/fixtures/jobs-sample.json`**

Postings that exercise every path: one senior-ops match (Zephyr Retail), a 5-role ops surge (Meridian Logistics), a 3-role field-marketing surge (Vantage Brands), a non-matching role, and one malformed row (missing `title`).

```json
[
  { "ref": "J-1", "title": "Head of Supply Chain", "company": "Zephyr Retail Pvt Ltd", "city": "Bengaluru", "url": "https://jobs.example.com/j-1", "postedAt": "2026-06-20T00:00:00Z", "sourceName": "jobboard-fixture" },
  { "ref": "J-2", "title": "Warehouse Operations Executive", "company": "Meridian Logistics", "city": "Pune", "url": "https://jobs.example.com/j-2", "postedAt": "2026-06-10T00:00:00Z", "sourceName": "jobboard-fixture" },
  { "ref": "J-3", "title": "Logistics Coordinator", "company": "Meridian Logistics", "city": "Pune", "url": "https://jobs.example.com/j-3", "postedAt": "2026-06-12T00:00:00Z", "sourceName": "jobboard-fixture" },
  { "ref": "J-4", "title": "Fulfilment Associate", "company": "Meridian Logistics", "city": "Pune", "url": "https://jobs.example.com/j-4", "postedAt": "2026-06-15T00:00:00Z", "sourceName": "jobboard-fixture" },
  { "ref": "J-5", "title": "Operations Team Lead", "company": "Meridian Logistics", "city": "Nagpur", "url": "https://jobs.example.com/j-5", "postedAt": "2026-06-18T00:00:00Z", "sourceName": "jobboard-fixture" },
  { "ref": "J-6", "title": "Warehouse Supervisor", "company": "Meridian Logistics", "city": "Pune", "url": "https://jobs.example.com/j-6", "postedAt": "2026-06-22T00:00:00Z", "sourceName": "jobboard-fixture" },
  { "ref": "J-7", "title": "Brand Promoter", "company": "Vantage Brands", "city": "Mumbai", "url": "https://jobs.example.com/j-7", "postedAt": "2026-06-11T00:00:00Z", "sourceName": "jobboard-fixture" },
  { "ref": "J-8", "title": "Field Marketing Executive", "company": "Vantage Brands", "city": "Delhi", "url": "https://jobs.example.com/j-8", "postedAt": "2026-06-13T00:00:00Z", "sourceName": "jobboard-fixture" },
  { "ref": "J-9", "title": "Store Launch Coordinator", "company": "Vantage Brands", "city": "Hyderabad", "url": "https://jobs.example.com/j-9", "postedAt": "2026-06-19T00:00:00Z", "sourceName": "jobboard-fixture" },
  { "ref": "J-10", "title": "Senior Software Engineer", "company": "Nimbus Tech", "city": "Bengaluru", "url": "https://jobs.example.com/j-10", "postedAt": "2026-06-21T00:00:00Z", "sourceName": "jobboard-fixture" },
  { "ref": "J-11", "company": "Broken Co", "city": "Pune", "postedAt": "2026-06-01T00:00:00Z", "sourceName": "jobboard-fixture" }
]
```

- [ ] **Step 3: Write `src/lib/sourcing/adapters/jobs-fixture.ts`**

```typescript
import { jobPostingRecordSchema, type JobSourceAdapter, type JobPostingRecord } from "@/lib/sourcing/jobs-schema";
import rawJobs from "../fixtures/jobs-sample.json";

/**
 * Fixture-first job-board adapter. Reads recorded job postings (no network),
 * validates each against jobPostingRecordSchema, and reports how many were malformed.
 * Pass `raw` to inject a custom posting set (used by tests).
 */
export function createJobBoardFixtureAdapter(raw: unknown[] = rawJobs as unknown[]): JobSourceAdapter {
  return {
    sourceName: "jobboard-fixture",
    async fetch() {
      const records: JobPostingRecord[] = [];
      let skippedMalformed = 0;
      for (const entry of raw) {
        const parsed = jobPostingRecordSchema.safeParse(entry);
        if (parsed.success) records.push(parsed.data);
        else skippedMalformed++;
      }
      return { records, skippedMalformed };
    },
  };
}
```

- [ ] **Step 4: Write the failing test `tests/unit/sourcing/jobs-schema.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import {
  jobPostingRecordSchema,
  detectHiringSignals,
  OPS_SURGE_THRESHOLD,
  FIELD_MKTG_THRESHOLD,
  SIG_HIRING_OPS_SURGE,
  SIG_HIRING_SENIOR_OPS,
  SIG_HIRING_FIELD_MKTG,
  type JobPostingRecord,
} from "@/lib/sourcing/jobs-schema";
import { createJobBoardFixtureAdapter } from "@/lib/sourcing/adapters/jobs-fixture";

const NOW = new Date("2026-06-30T00:00:00Z");

function posting(over: Partial<JobPostingRecord> = {}): JobPostingRecord {
  return {
    ref: "J-x", title: "Warehouse Operations Executive", company: "Meridian Logistics",
    postedAt: "2026-06-20T00:00:00Z", sourceName: "jobboard-fixture", ...over,
  };
}

const ALL = new Set([SIG_HIRING_OPS_SURGE, SIG_HIRING_SENIOR_OPS, SIG_HIRING_FIELD_MKTG]);
const NO_WINDOW = new Map<string, number | null>();

describe("jobPostingRecordSchema", () => {
  it("accepts a valid posting", () => {
    expect(jobPostingRecordSchema.safeParse(posting()).success).toBe(true);
  });
  it("rejects a posting missing its title", () => {
    const { title: _omit, ...bad } = posting();
    expect(jobPostingRecordSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a non-URL url and an unparseable date", () => {
    expect(jobPostingRecordSchema.safeParse(posting({ url: "not-a-url" })).success).toBe(false);
    expect(jobPostingRecordSchema.safeParse(posting({ postedAt: "never" })).success).toBe(false);
  });
});

describe("createJobBoardFixtureAdapter", () => {
  it("reports its source name", () => {
    expect(createJobBoardFixtureAdapter([]).sourceName).toBe("jobboard-fixture");
  });
  it("parses valid postings and counts malformed ones", async () => {
    const adapter = createJobBoardFixtureAdapter([posting({ ref: "J-1" }), { ref: "J-2", company: "X" }]);
    const { records, skippedMalformed } = await adapter.fetch();
    expect(records).toHaveLength(1);
    expect(skippedMalformed).toBe(1);
  });
  it("loads the committed fixture without malformed-count exploding", async () => {
    const { records, skippedMalformed } = await createJobBoardFixtureAdapter().fetch();
    expect(records.length).toBeGreaterThan(0);
    expect(skippedMalformed).toBe(1); // the one intentionally-broken row
  });
});

describe("detectHiringSignals — senior ops (per posting)", () => {
  it("emits SIG-HIRING-SENIOR-OPS for a senior ops title with real proof", () => {
    const p = posting({ ref: "J-1", title: "Head of Supply Chain", company: "Zephyr Retail", city: "Bengaluru" });
    const obs = detectHiringSignals([p], ALL, NO_WINDOW, NOW);
    const senior = obs.filter((o) => o.signalId === SIG_HIRING_SENIOR_OPS);
    expect(senior).toHaveLength(1);
    expect(senior[0].sourceRef).toBe("J-1");
    expect(senior[0].detectedAt).toBe("2026-06-20T00:00:00Z");
    expect(senior[0].companyName).toBe("Zephyr Retail");
    expect(senior[0].evidence.length).toBeGreaterThan(0);
  });
  it("does not emit senior ops for a non-ops or non-senior title", () => {
    const eng = posting({ title: "Senior Software Engineer", company: "Nimbus" });
    const junior = posting({ title: "Warehouse Associate", company: "Meridian" });
    const obs = detectHiringSignals([eng, junior], ALL, NO_WINDOW, NOW);
    expect(obs.filter((o) => o.signalId === SIG_HIRING_SENIOR_OPS)).toHaveLength(0);
  });
});

describe("detectHiringSignals — ops surge (per company aggregate)", () => {
  function opsPostings(n: number, company = "Meridian Logistics"): JobPostingRecord[] {
    return Array.from({ length: n }, (_, i) =>
      posting({ ref: `O-${i}`, title: "Warehouse Operations Associate", company, postedAt: `2026-06-${10 + i}T00:00:00Z` }));
  }
  it("fires at exactly the threshold", () => {
    const obs = detectHiringSignals(opsPostings(OPS_SURGE_THRESHOLD), ALL, NO_WINDOW, NOW);
    const surge = obs.filter((o) => o.signalId === SIG_HIRING_OPS_SURGE);
    expect(surge).toHaveLength(1);
    expect(surge[0].companyName).toBe("Meridian Logistics");
  });
  it("does not fire below the threshold", () => {
    const obs = detectHiringSignals(opsPostings(OPS_SURGE_THRESHOLD - 1), ALL, NO_WINDOW, NOW);
    expect(obs.filter((o) => o.signalId === SIG_HIRING_OPS_SURGE)).toHaveLength(0);
  });
  it("anchors detectedAt and sourceRef to the most-recent qualifying posting", () => {
    const posts = opsPostings(OPS_SURGE_THRESHOLD); // O-0..O-4, postedAt 2026-06-10..14; O-4 is newest
    const [surge] = detectHiringSignals(posts, ALL, NO_WINDOW, NOW).filter((o) => o.signalId === SIG_HIRING_OPS_SURGE);
    expect(surge.sourceRef).toBe(`O-${OPS_SURGE_THRESHOLD - 1}`);
    expect(surge.detectedAt).toBe(`2026-06-${10 + OPS_SURGE_THRESHOLD - 1}T00:00:00Z`);
  });
  it("groups by company — two surging companies produce two observations", () => {
    const posts = [...opsPostings(OPS_SURGE_THRESHOLD, "Meridian Logistics"), ...opsPostings(OPS_SURGE_THRESHOLD, "Cargo Kings")];
    const surge = detectHiringSignals(posts, ALL, NO_WINDOW, NOW).filter((o) => o.signalId === SIG_HIRING_OPS_SURGE);
    expect(surge.map((o) => o.companyName).sort()).toEqual(["Cargo Kings", "Meridian Logistics"]);
  });
  it("applies the rolling window when set — stale postings do not count toward the threshold", () => {
    // 5 ops postings, but 2 are 200 days old → only 3 within a 60-day window → below threshold.
    const fresh = Array.from({ length: 3 }, (_, i) => posting({ ref: `F-${i}`, title: "Ops Executive", postedAt: "2026-06-20T00:00:00Z" }));
    const stale = Array.from({ length: 2 }, (_, i) => posting({ ref: `S-${i}`, title: "Ops Executive", postedAt: "2025-12-01T00:00:00Z" }));
    const window = new Map<string, number | null>([[SIG_HIRING_OPS_SURGE, 60]]);
    const obs = detectHiringSignals([...fresh, ...stale], ALL, window, NOW);
    expect(obs.filter((o) => o.signalId === SIG_HIRING_OPS_SURGE)).toHaveLength(0);
  });
});

describe("detectHiringSignals — field marketing surge", () => {
  it("fires at the field-marketing threshold", () => {
    const posts = [
      posting({ ref: "P-1", title: "Brand Promoter", company: "Vantage Brands" }),
      posting({ ref: "P-2", title: "Field Marketing Executive", company: "Vantage Brands" }),
      posting({ ref: "P-3", title: "Store Launch Coordinator", company: "Vantage Brands" }),
    ];
    expect(posts).toHaveLength(FIELD_MKTG_THRESHOLD);
    const obs = detectHiringSignals(posts, ALL, NO_WINDOW, NOW);
    expect(obs.filter((o) => o.signalId === SIG_HIRING_FIELD_MKTG)).toHaveLength(1);
  });
});

describe("detectHiringSignals — approval gating", () => {
  it("emits nothing when no signals are approved", () => {
    const posts = Array.from({ length: 6 }, (_, i) => posting({ ref: `X-${i}`, title: "Warehouse Operations" }));
    expect(detectHiringSignals(posts, new Set(), NO_WINDOW, NOW)).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the unit tests — verify they pass**

Run: `npx vitest run tests/unit/sourcing/jobs-schema.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Verify client-safety and types**

Run: `grep -nE "@/db|server-only" src/lib/sourcing/jobs-schema.ts src/lib/sourcing/adapters/jobs-fixture.ts` → expected: NO matches.
Run: `npx tsc --noEmit` → expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sourcing/jobs-schema.ts src/lib/sourcing/adapters/jobs-fixture.ts src/lib/sourcing/fixtures/jobs-sample.json tests/unit/sourcing/jobs-schema.test.ts
git commit -m "feat(sourcing): pure hiring-signal detection + job-board fixture adapter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Job-observation ingestion (server data layer)

**Files:**
- Create: `src/lib/sourcing/jobs.ts`
- Test: `tests/integration/sourcing-jobs.test.ts`

**Interfaces:**
- Consumes: `resolveCompany(db, name)` from `@/lib/sourcing/data`; `computeFreshnessVerdict(detectedAt, windowDays, now)` from `@/lib/sourcing/schema`; `detectHiringSignals`, `JobSourceAdapter` from `@/lib/sourcing/jobs-schema`; `companies, signalDefinitions, signalObservations` from `@/db/schema`; `DB` type from `@/db/client`.
- Produces (Task 3 relies on these): `type IngestResult = { scanned: number; detected: number; written: number; skippedDuplicates: number; skippedMalformed: number }`; `ingestJobObservations(db: DB, adapter: JobSourceAdapter, now?: Date): Promise<IngestResult>`; `listApprovedHiringSignals(db: DB): Promise<{ signalId: string; freshnessWindowDays: number | null }[]>`.

- [ ] **Step 1: Write `src/lib/sourcing/jobs.ts`**

```typescript
import { and, eq, like } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — erased at runtime, never loads the env-eager client
import { signalDefinitions, signalObservations } from "@/db/schema";
import { computeFreshnessVerdict } from "@/lib/sourcing/schema";
import { resolveCompany } from "@/lib/sourcing/data";
import { detectHiringSignals, type JobSourceAdapter } from "@/lib/sourcing/jobs-schema";

export type IngestResult = {
  scanned: number;
  detected: number;
  written: number;
  skippedDuplicates: number;
  skippedMalformed: number;
};

/** Approved signal definitions in the hiring family, with their freshness window. */
export async function listApprovedHiringSignals(
  db: DB,
): Promise<{ signalId: string; freshnessWindowDays: number | null }[]> {
  return db
    .select({
      signalId: signalDefinitions.signalId,
      freshnessWindowDays: signalDefinitions.freshnessWindowDays,
    })
    .from(signalDefinitions)
    .where(and(eq(signalDefinitions.status, "approved"), like(signalDefinitions.signalId, "SIG-HIRING-%")))
    .limit(100);
}

/**
 * Orchestrate one on-demand job-board sourcing run: fetch → detect hiring signals → resolve entity →
 * upsert observation. Idempotent via the (signal_id, company_id, source_ref) unique index +
 * onConflictDoNothing. Writes ONLY companies (find-or-create) and signal_observations.
 */
export async function ingestJobObservations(
  db: DB,
  adapter: JobSourceAdapter,
  now: Date = new Date(),
): Promise<IngestResult> {
  const { records, skippedMalformed } = await adapter.fetch();
  const defs = await listApprovedHiringSignals(db);
  const approvedIds = new Set(defs.map((d) => d.signalId));
  const windowBySignal = new Map(defs.map((d) => [d.signalId, d.freshnessWindowDays]));

  const observations = detectHiringSignals(records, approvedIds, windowBySignal, now);

  let written = 0;
  let skippedDuplicates = 0;

  for (const obs of observations) {
    const { companyId, entityMatchConfidence } = await resolveCompany(db, obs.companyName);
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

  return { scanned: records.length + skippedMalformed, detected: observations.length, written, skippedDuplicates, skippedMalformed };
}
```

- [ ] **Step 2: Write the failing test `tests/integration/sourcing-jobs.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { companies, signalDefinitions, signalObservations } from "@/db/schema";
import { ingestJobObservations } from "@/lib/sourcing/jobs";
import type { JobSourceAdapter, JobPostingRecord } from "@/lib/sourcing/jobs-schema";
import {
  SIG_HIRING_OPS_SURGE,
  SIG_HIRING_SENIOR_OPS,
  OPS_SURGE_THRESHOLD,
} from "@/lib/sourcing/jobs-schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["signal_observations", "signal_definitions", "companies"]); });
afterAll(async () => { await closeTestDb(); });

async function approvedHiringSignal(signalId: string, freshnessWindowDays: number | null = null) {
  await testDb.insert(signalDefinitions).values({
    signalId, name: `S ${signalId}`, family: "hiring",
    strength: "medium", falsePositiveRisk: "low",
    freshnessWindowDays, status: "approved", origin: "seed",
  }).onConflictDoNothing();
}

function adapterFrom(records: JobPostingRecord[], skippedMalformed = 0): JobSourceAdapter {
  return { sourceName: "test", async fetch() { return { records, skippedMalformed }; } };
}

function posting(over: Partial<JobPostingRecord> = {}): JobPostingRecord {
  return {
    ref: "J-x", title: "Warehouse Operations Executive", company: "Meridian Logistics",
    postedAt: "2026-06-20T00:00:00Z", sourceName: "jobboard-fixture", ...over,
  };
}

function opsPostings(n: number, company = "Meridian Logistics"): JobPostingRecord[] {
  return Array.from({ length: n }, (_, i) =>
    posting({ ref: `O-${i}`, title: "Warehouse Operations Associate", company, postedAt: `2026-06-${10 + i}T00:00:00Z` }));
}

describe("ingestJobObservations", () => {
  it("writes a senior-ops observation with all mandatory proof fields", async () => {
    await approvedHiringSignal(SIG_HIRING_SENIOR_OPS);
    const now = new Date();
    const res = await ingestJobObservations(
      testDb,
      adapterFrom([posting({ ref: "J-1", title: "Head of Supply Chain", company: "Zephyr Retail", postedAt: now.toISOString() })]),
      now,
    );
    expect(res.detected).toBe(1);
    expect(res.written).toBe(1);
    const [obs] = await testDb.select().from(signalObservations);
    expect(obs.signalId).toBe(SIG_HIRING_SENIOR_OPS);
    expect(obs.detectedAt).not.toBeNull();
    expect(obs.source).toBe("jobboard-fixture");
    expect(obs.evidence.length).toBeGreaterThan(0);
    expect(obs.companyId).toBeTruthy();
    expect(obs.entityMatchConfidence).toBe(1);
    expect(obs.sourceRef).toBe("J-1");
  });

  it("writes one aggregate ops-surge observation for a company over the threshold", async () => {
    await approvedHiringSignal(SIG_HIRING_OPS_SURGE);
    const res = await ingestJobObservations(testDb, adapterFrom(opsPostings(OPS_SURGE_THRESHOLD)), new Date("2026-06-30T00:00:00Z"));
    expect(res.written).toBe(1);
    const rows = await testDb.select().from(signalObservations);
    expect(rows).toHaveLength(1);
    expect(rows[0].signalId).toBe(SIG_HIRING_OPS_SURGE);
    expect(rows[0].sourceRef).toBe(`O-${OPS_SURGE_THRESHOLD - 1}`); // anchored to most-recent posting
  });

  it("computes a recent freshness verdict when the definition sets a window", async () => {
    await approvedHiringSignal(SIG_HIRING_SENIOR_OPS, 90);
    const now = new Date();
    await ingestJobObservations(
      testDb,
      adapterFrom([posting({ ref: "J-1", title: "VP Operations", company: "Zephyr Retail", postedAt: now.toISOString() })]),
      now,
    );
    const [obs] = await testDb.select().from(signalObservations);
    expect(obs.freshnessVerdict).toBe("recent");
  });

  it("does not write a hiring signal that is not approved", async () => {
    // OPS-SURGE approved, SENIOR-OPS intentionally NOT approved.
    await approvedHiringSignal(SIG_HIRING_OPS_SURGE);
    const posts = [posting({ ref: "J-1", title: "Head of Supply Chain", company: "Zephyr Retail" }), ...opsPostings(OPS_SURGE_THRESHOLD)];
    await ingestJobObservations(testDb, adapterFrom(posts), new Date("2026-06-30T00:00:00Z"));
    const rows = await testDb.select().from(signalObservations);
    expect(rows.map((r) => r.signalId)).toEqual([SIG_HIRING_OPS_SURGE]);
  });

  it("is idempotent — a second run writes 0 rows", async () => {
    await approvedHiringSignal(SIG_HIRING_OPS_SURGE);
    const adapter = adapterFrom(opsPostings(OPS_SURGE_THRESHOLD));
    const now = new Date("2026-06-30T00:00:00Z");
    const first = await ingestJobObservations(testDb, adapter, now);
    const second = await ingestJobObservations(testDb, adapter, now);
    expect(first.written).toBe(1);
    expect(second.written).toBe(0);
    expect(second.skippedDuplicates).toBe(1);
    const rows = await testDb.select().from(signalObservations);
    expect(rows).toHaveLength(1);
  });

  it("resolves the same company across postings to one row", async () => {
    await approvedHiringSignal(SIG_HIRING_OPS_SURGE);
    await ingestJobObservations(testDb, adapterFrom(opsPostings(OPS_SURGE_THRESHOLD)), new Date("2026-06-30T00:00:00Z"));
    const cos = await testDb.select().from(companies).where(eq(companies.normalizedName, "meridian logistics"));
    expect(cos).toHaveLength(1);
  });

  it("counts adapter-reported malformed postings in scanned", async () => {
    await approvedHiringSignal(SIG_HIRING_OPS_SURGE);
    const res = await ingestJobObservations(testDb, adapterFrom(opsPostings(OPS_SURGE_THRESHOLD), 2), new Date("2026-06-30T00:00:00Z"));
    expect(res.skippedMalformed).toBe(2);
    expect(res.scanned).toBe(OPS_SURGE_THRESHOLD + 2);
  });
});
```

- [ ] **Step 3: Run the integration tests — verify they pass**

Run: `npx vitest run tests/integration/sourcing-jobs.test.ts`
Expected: all tests PASS. (If a transient Neon TRUNCATE/latency error appears, re-run 2-3× — it is not structural.)

- [ ] **Step 4: Verify boundaries and types**

Run: `grep -nE "server-only|@/ai|adapters/" src/lib/sourcing/jobs.ts` → expected: NO matches.
Run: `grep -n "import type { DB }" src/lib/sourcing/jobs.ts` → expected: present (type-only DB import).
Run: `npx tsc --noEmit` → expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourcing/jobs.ts tests/integration/sourcing-jobs.test.ts
git commit -m "feat(sourcing): ingestJobObservations persists hiring signals from postings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Runner + npm script

**Files:**
- Create: `src/db/source-jobs.ts`
- Modify: `package.json` (add one script line)

**Interfaces:**
- Consumes: `ingestJobObservations`, `IngestResult` from `@/lib/sourcing/jobs`; `createJobBoardFixtureAdapter` from `@/lib/sourcing/adapters/jobs-fixture`; `DB` type from `./client`.
- Produces: `runJobSourcing(db: DB): Promise<IngestResult>` and the `db:source:jobs` npm script.

- [ ] **Step 1: Write `src/db/source-jobs.ts`** (exact mirror of `src/db/source-tenders.ts`)

```typescript
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
```

- [ ] **Step 2: Add the npm script to `package.json`**

Find the line `"db:source:tenders": "tsx src/db/source-tenders.ts",` and add immediately after it:

```json
    "db:source:jobs": "tsx src/db/source-jobs.ts",
```

- [ ] **Step 3: Verify the script parses and types are clean**

Run: `npx tsc --noEmit` → expected: clean.
Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json valid')"` → expected: `package.json valid`.

- [ ] **Step 4: End-to-end smoke against the dev DB**

Run: `npm run db:seed:signals` (idempotent — ensures the four SIG-HIRING-* definitions exist), then `npm run db:source:jobs`.
Expected: exit 0 and a summary like `Job sourcing complete: {"scanned":11,"detected":3,"written":3,"skippedDuplicates":0,"skippedMalformed":1}` on the first run (3 = one senior-ops + one ops-surge + one field-mktg from the fixture); a second `db:source:jobs` run writes 0 (`skippedDuplicates` rises).

- [ ] **Step 5: Commit**

```bash
git add src/db/source-jobs.ts package.json
git commit -m "feat(sourcing): db:source:jobs runner wiring the job-board fixture adapter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §2 signal scope (senior-ops per-posting, ops-surge + field-mktg aggregates, new-city excluded) → Task 1 `detectHiringSignals` + constants. ✅
- §3 no-fabrication (real detectedAt/sourceRef/evidence, approved-only) → Task 1 detection + Task 2 persistence; asserted in both test suites. ✅
- §4.1 pure schema → Task 1 `jobs-schema.ts`. §4.2 fixture adapter + JSON → Task 1. §4.3 data layer → Task 2. §4.4 runner + script → Task 3. ✅
- §6 idempotency / bounds → Task 2 onConflictDoNothing + `.limit(100)`; idempotency test. ✅
- §7 unit + integration tests → Task 1 & Task 2 test files. ✅
- §8 dependency boundaries → Global Constraints + Task 1 Step 6 / Task 2 Step 4 grep checks. ✅

**Placeholder scan:** No TBD/TODO; every code + test step shows complete content. ✅

**Type consistency:** `JobPostingRecord`, `JobSourceAdapter`, `DetectedHiringObservation`, `IngestResult`, `detectHiringSignals`, `ingestJobObservations`, `listApprovedHiringSignals`, `createJobBoardFixtureAdapter`, and the `SIG_HIRING_*` / threshold constants are used with identical names/signatures across Tasks 1→2→3 and both test files. `resolveCompany` / `computeFreshnessVerdict` / `normalizeCompanyName` match their existing exported signatures. ✅

**Window semantics note:** the seeded hiring definitions currently have `freshness_window_days = NULL`, so in production the surge window is not applied and freshness verdict is null (honest — no window to assert against). Integration/unit tests seed an explicit window to exercise both the windowed-drop and the `recent` verdict paths. This is intentional and consistent with the tender path.
