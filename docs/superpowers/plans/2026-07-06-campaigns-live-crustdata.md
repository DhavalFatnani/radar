# Campaigns Live Crustdata Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a campaign pull **real, live companies** — a metered, credit-safe Crustdata client + a `CompanySourceAdapter` backed by `/company/search` + `/data_lab/job_listings`, wired behind the campaign's `source` flag, plus a CLI runner so the operator can run a live campaign for a vendor and see real leads before the UI (Plan 2) exists.

**Architecture:** A faithful TypeScript port of crust-data's credit-safe `crustdata.py` (`src/lib/vendors/crustdata/client.ts`) — Bearer→Token 401 fallback, hard 25-row cap, per-row (0.03) metering, job-listings retry, failures-are-free. A `createCrustdataCompanyAdapter(client)` maps live responses into the existing `CompanyRecord` shape (cheap `/company/search` discovery, then `/data_lab/job_listings` enrichment on the shortlist only). An `adapterForSource(source)` factory picks fixture vs live by the campaign's `source`, and a `db:campaign:run` CLI creates + runs a campaign end-to-end. Everything downstream (detectors → ingest → `generateLeads` → orchestrator) is Plan 1, unchanged.

**Tech Stack:** TypeScript (strict), Node 22 global `fetch` (no `node-fetch`), Drizzle/Neon, Zod, Vitest. Live API: Crustdata (`https://api.crustdata.com`, `x-api-version: 2025-11-01`).

## Global Constraints

- **Node ≥ 22** — use the built-in global `fetch`/`AbortController`; do NOT add an HTTP dependency.
- **Spec is authoritative:** `docs/superpowers/specs/2026-07-06-campaigns-design.md` §6.1–6.2. Plan 1 (core) is already merged on `main`; this plan is purely additive except two small backward-compatible edits to Plan-1 files (Task 4), which must not regress the existing campaign suite.
- **Reference:** `docs/crustdata-endpoints-reference.md` (ported in Task 2) is the verified contract. Honor it exactly:
  - **Two filter dialects:** `field` for `/company/search` (& person); `column` for `/data_lab/job_listings`.
  - **Operators:** `=>` / `=<` (NOT `>=`/`<=`); `(.)` is *contains* (plain substring, one term per OR condition, never a regex/pipe).
  - **Auth:** `Bearer <key>` + `x-api-version: 2025-11-01` first; on **401 only**, retry once with legacy `Authorization: Token <key>` (no version header).
- **Credit safety (port of `crustdata.py`):** hard `MAX_LIMIT = 25` clamp on every request; `COST_PER_ROW = 0.03`; meter ONLY a 200 response, counting the first present list among `("companies","results","people","profiles")`; **failures are free** — a non-200 throws `CrustdataError` and is never metered; `job_listings` is metered `free` (0 on trial). No credit-ledger file — radar persists per-run spend in `campaigns.stats.creditsSpent` (a deliberate simplification vs crust-data's CLI ledger).
- **`job_listings` discipline:** 90s timeout + retry on `{404,502,503,504}` (2 attempts, 5s delay); 365-day `date_updated` window; ops titles filtered server-side via a nested `OR` group; enrich the **shortlist only** (funnel), never the full scan.
- **Missing = null, not zero** and **evidence non-empty** invariants (Plan 1) must survive the mapping: a company the adapter did NOT job-enrich has `jobPostings` unset → `opsPostings` null (unknown), NOT 0.
- **Key handling:** `CRUSTDATA_API_KEY` lives only in env (Task 1), never in code; the client accepts an explicit key for tests.
- **Tests:** client + adapter are DB-free with a **mocked `fetch`/client** → `tests/unit/`. Factory + CLI runner use the fixture source (no key) → `tests/integration/`. No test hits the live API. Follow radar's harness (`tests/integration/helpers/db.ts`; `@/` → `src`).
- **Branch:** create `feature/campaigns-live` off `main`. One commit per task.

---

### Task 1: `CRUSTDATA_API_KEY` env var

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `.env.example` (document the key)
- Test: `tests/unit/env.test.ts` (extend existing)

**Interfaces:**
- Produces: `env.CRUSTDATA_API_KEY: string | undefined` (optional — fixture campaigns need no key).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/env.test.ts` (inside the existing top-level `describe`, or add one):
```ts
import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

describe("CRUSTDATA_API_KEY", () => {
  const base = { DATABASE_URL: "postgres://u:p@h/db" };
  it("is accepted when present", () => {
    const env = parseEnv({ ...base, CRUSTDATA_API_KEY: "cr-abc123" });
    expect(env.CRUSTDATA_API_KEY).toBe("cr-abc123");
  });
  it("is optional (undefined when absent)", () => {
    const env = parseEnv(base);
    expect(env.CRUSTDATA_API_KEY).toBeUndefined();
  });
  it("treats empty string as absent", () => {
    const env = parseEnv({ ...base, CRUSTDATA_API_KEY: "" });
    expect(env.CRUSTDATA_API_KEY).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: FAIL — `CRUSTDATA_API_KEY` is not on the parsed env type/shape (the "accepted when present" case returns `undefined`).

- [ ] **Step 3: Add the env var**

In `src/lib/env.ts`, add inside `envSchema` (after `OUTREACH_FROM_EMAIL`):
```ts
  // Live company/people data provider (Crustdata). Optional — fixture campaigns need no key.
  CRUSTDATA_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
```

- [ ] **Step 4: Document it in `.env.example`**

Add to `.env.example`:
```
# Crustdata API key for live campaign sourcing (optional; get one at app.crustdata.com)
CRUSTDATA_API_KEY=
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/env.ts .env.example tests/unit/env.test.ts
git commit -m "feat(campaigns): add optional CRUSTDATA_API_KEY env var"
```

---

### Task 2: Metered Crustdata client

**Files:**
- Create: `src/lib/vendors/crustdata/client.ts`
- Create: `docs/crustdata-endpoints-reference.md` (port the verified reference)
- Test: `tests/unit/crustdata-client.test.ts`

**Interfaces:**
- Produces:
  - `class CrustdataError extends Error { readonly status: number }`
  - `class CrustdataClient` — `constructor(opts?: { key?: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> })`; methods `companySearch(filters, fields, limit?, sorts?, cursor?): Promise<any>`, `jobListings(conditions, limit?): Promise<any>`, `verifyKey(): Promise<boolean>`, `creditsSpent(): number`.
  - Consts `BASE_URL`, `API_VERSION`, `MAX_LIMIT`, `COST_PER_ROW`, `NON_VENTURE_ROUNDS`; pure fns `enforceLimit`, `billableRows`, `rowsToCost`, `rowsToDicts`.
- The client reads `env.CRUSTDATA_API_KEY` when `opts.key` is absent, throwing `CrustdataError` (status 0) if neither is set.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/crustdata-client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  CrustdataClient, CrustdataError, enforceLimit, billableRows, rowsToCost, rowsToDicts, MAX_LIMIT,
} from "@/lib/vendors/crustdata/client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("pure helpers", () => {
  it("enforceLimit clamps to [1, MAX_LIMIT]", () => {
    expect(enforceLimit(0)).toBe(1);
    expect(enforceLimit(5)).toBe(5);
    expect(enforceLimit(1000)).toBe(MAX_LIMIT);
    expect(enforceLimit(-3 as number)).toBe(1);
  });
  it("billableRows counts the first present billable list", () => {
    expect(billableRows({ companies: [1, 2, 3] })).toBe(3);
    expect(billableRows({ profiles: [1] })).toBe(1);
    expect(billableRows({ fields: [], rows: [[1]] })).toBe(0);
    expect(billableRows(null)).toBe(0);
  });
  it("rowsToCost is 0.03/row", () => {
    expect(rowsToCost(10)).toBe(0.3);
    expect(rowsToCost(0)).toBe(0);
  });
  it("rowsToDicts zips a tabular response", () => {
    const out = rowsToDicts([{ api_name: "title" }, { api_name: "date_updated" }], [["Warehouse Lead", "2026-02-01"]]);
    expect(out).toEqual([{ title: "Warehouse Lead", date_updated: "2026-02-01" }]);
  });
});

describe("CrustdataClient", () => {
  it("throws a clear error when no key is provided", () => {
    expect(() => new CrustdataClient({ key: "" })).toThrow(/CRUSTDATA_API_KEY/);
  });

  it("companySearch sends Bearer + version, caps limit, and meters rows on 200", async () => {
    const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return jsonResponse({ companies: [{}, {}, {}], next_cursor: null });
    }) as unknown as typeof fetch;
    const c = new CrustdataClient({ key: "k", fetchImpl });
    const body = await c.companySearch({ op: "and", conditions: [] }, ["basic_info"], 1000);
    expect(body.companies).toHaveLength(3);
    expect(calls[0].url).toContain("/company/search");
    expect(calls[0].headers.Authorization).toBe("Bearer k");
    expect(calls[0].headers["x-api-version"]).toBe("2025-11-01");
    expect(calls[0].body.limit).toBe(MAX_LIMIT); // 1000 clamped
    expect(c.creditsSpent()).toBe(0.09); // 3 rows * 0.03
  });

  it("falls back to legacy Token on 401, then succeeds", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      seen.push(auth);
      if (auth.startsWith("Bearer")) return new Response("unauthorized", { status: 401 });
      return jsonResponse({ companies: [{}] });
    }) as unknown as typeof fetch;
    const c = new CrustdataClient({ key: "k", fetchImpl });
    const body = await c.companySearch({}, ["basic_info"], 1);
    expect(body.companies).toHaveLength(1);
    expect(seen).toEqual(["Bearer k", "Token k"]);
  });

  it("throws CrustdataError (free — unmetered) on a non-200 after fallback", async () => {
    const fetchImpl = (async () => new Response("bad", { status: 400 })) as unknown as typeof fetch;
    const c = new CrustdataClient({ key: "k", fetchImpl });
    await expect(c.companySearch({}, ["basic_info"], 1)).rejects.toBeInstanceOf(CrustdataError);
    expect(c.creditsSpent()).toBe(0); // failures cost nothing
  });

  it("jobListings retries transient 503 then succeeds, and does not meter (free)", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) return new Response("try later", { status: 503 });
      return jsonResponse({ fields: [{ api_name: "title" }], rows: [["Warehouse Lead"]], is_trial_user: true });
    }) as unknown as typeof fetch;
    const c = new CrustdataClient({ key: "k", fetchImpl, sleep: async () => {} });
    const body = await c.jobListings([{ column: "title", type: "(.)", value: "warehouse" }]);
    expect(n).toBe(2);
    expect(body.rows).toHaveLength(1);
    expect(c.creditsSpent()).toBe(0); // job_listings free on trial
  });

  it("verifyKey is true on a 200 autocomplete", async () => {
    const fetchImpl = (async (url: string) => {
      expect(String(url)).toContain("/person/search/autocomplete");
      return jsonResponse({ suggestions: [] });
    }) as unknown as typeof fetch;
    const c = new CrustdataClient({ key: "k", fetchImpl });
    expect(await c.verifyKey()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/crustdata-client.test.ts`
Expected: FAIL — cannot find module `@/lib/vendors/crustdata/client`.

- [ ] **Step 3: Write the client**

Create `src/lib/vendors/crustdata/client.ts`:
```ts
import { env } from "@/lib/env";

export const BASE_URL = "https://api.crustdata.com";
export const API_VERSION = "2025-11-01";
export const MAX_LIMIT = 25;
export const COST_PER_ROW = 0.03;

// company_type is unreliable; exclude non-venture rounds by last_round_type instead.
export const NON_VENTURE_ROUNDS = ["post_ipo_debt", "post_ipo_equity", "post_ipo_secondary", "grant"];

const JOB_RETRY_STATUSES = new Set([404, 502, 503, 504]);
const JOB_MAX_ATTEMPTS = 2;
const JOB_RETRY_DELAY_MS = 5000;
const JOB_TIMEOUT_MS = 90_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const BILLABLE_LIST_KEYS = ["companies", "results", "people", "profiles"] as const;

export class CrustdataError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "CrustdataError";
  }
}

/** Clamp a requested row count to [1, MAX_LIMIT]. Never silently huge. */
export function enforceLimit(requested: number): number {
  if (!Number.isInteger(requested) || requested < 1) return 1;
  return Math.min(requested, MAX_LIMIT);
}

/** Rows that drive per-row billing on a 200 body: length of the first present billable list. */
export function billableRows(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  for (const key of BILLABLE_LIST_KEYS) {
    const items = (body as Record<string, unknown>)[key];
    if (Array.isArray(items)) return items.length;
  }
  return 0;
}

export function rowsToCost(rows: number): number {
  return Math.round(Math.max(rows, 0) * COST_PER_ROW * 1e4) / 1e4;
}

/** Zip a data_lab tabular response ({fields:[{api_name}], rows:[[...]]}) into dicts. */
export function rowsToDicts(fields: { api_name: string }[], rows: unknown[][]): Record<string, unknown>[] {
  const names = fields.map((f) => f.api_name);
  return rows.map((row) => Object.fromEntries(names.map((n, i) => [n, row[i]])));
}

type FetchImpl = typeof fetch;

export class CrustdataClient {
  private readonly key: string;
  private readonly fetchImpl: FetchImpl;
  private readonly sleep: (ms: number) => Promise<void>;
  private runSpend = 0;

  constructor(opts: { key?: string; fetchImpl?: FetchImpl; sleep?: (ms: number) => Promise<void> } = {}) {
    const key = (opts.key ?? env.CRUSTDATA_API_KEY ?? "").trim();
    if (!key) throw new CrustdataError("CRUSTDATA_API_KEY is not set — add it to .env.local to run a live campaign.", 0);
    this.key = key;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  creditsSpent(): number {
    return Math.round(this.runSpend * 1e4) / 1e4;
  }

  private bearerHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.key}`, "x-api-version": API_VERSION, "Content-Type": "application/json" };
  }
  private tokenHeaders(): Record<string, string> {
    return { Authorization: `Token ${this.key}`, "Content-Type": "application/json" };
  }

  /** POST with Bearer(+version) first; on 401 ONLY, retry once with legacy Token. */
  private async post(path: string, payload: unknown, timeoutMs: number): Promise<Response> {
    const url = `${BASE_URL}${path}`;
    let last: Response | null = null;
    for (const headers of [this.bearerHeaders(), this.tokenHeaders()]) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        last = await this.fetchImpl(url, { method: "POST", headers, body: JSON.stringify(payload), signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (last.status !== 401) return last;
    }
    return last as Response;
  }

  private async postWithRetry(
    path: string, payload: unknown, timeoutMs: number,
    retryStatuses: Set<number>, maxAttempts: number, retryDelayMs: number,
  ): Promise<Response> {
    let last: Response | null = null;
    for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt++) {
      if (attempt > 0 && retryDelayMs > 0) await this.sleep(retryDelayMs);
      last = await this.post(path, payload, timeoutMs);
      if (!retryStatuses.has(last.status)) return last;
    }
    return last as Response;
  }

  /** Parse a 200 (metering rows unless free); throw CrustdataError on any non-200 (unmetered — failures are free). */
  private async parseAndMeter(resp: Response, free: boolean): Promise<any> {
    if (resp.status !== 200) {
      const text = await resp.text().catch(() => "");
      const msg = resp.status === 401
        ? "Crustdata rejected the API key (401) — check or regenerate CRUSTDATA_API_KEY."
        : `Crustdata request failed (${resp.status}): ${text.slice(0, 200)}`;
      throw new CrustdataError(msg, resp.status);
    }
    const body = await resp.json();
    if (!free) this.runSpend = Math.round((this.runSpend + rowsToCost(billableRows(body))) * 1e4) / 1e4;
    return body;
  }

  async companySearch(
    filters: unknown, fields: string[], limit = 1,
    sorts?: unknown, cursor?: string,
  ): Promise<any> {
    const payload: Record<string, unknown> = { filters, fields, limit: enforceLimit(limit) };
    if (sorts) payload.sorts = sorts;
    if (cursor) payload.cursor = cursor;
    return this.parseAndMeter(await this.post("/company/search", payload, DEFAULT_TIMEOUT_MS), false);
  }

  async jobListings(conditions: unknown[], limit = MAX_LIMIT): Promise<any> {
    const payload = {
      tickers: [], dataset: { name: "job_listings", id: "joblisting" },
      filters: { op: "and", conditions }, offset: 0, limit: enforceLimit(limit),
      sorts: [], groups: [], aggregations: [], functions: [],
    };
    const resp = await this.postWithRetry(
      "/data_lab/job_listings/Table/", payload, JOB_TIMEOUT_MS,
      JOB_RETRY_STATUSES, JOB_MAX_ATTEMPTS, JOB_RETRY_DELAY_MS,
    );
    return this.parseAndMeter(resp, true); // free on trial; do not meter until re-measured off trial
  }

  async verifyKey(): Promise<boolean> {
    const resp = await this.post("/person/search/autocomplete", { field: "basic_profile.name", query: "a", limit: 1 }, DEFAULT_TIMEOUT_MS);
    return resp.status === 200;
  }
}
```

- [ ] **Step 4: Port the reference doc**

Copy `/Users/dhaval/Code/crust-data/docs/CRUSTDATA_ENDPOINTS_REFERENCE.md` to `docs/crustdata-endpoints-reference.md` verbatim (it is the verified integration contract; keep it as radar's self-contained reference).

Run: `cp /Users/dhaval/Code/crust-data/docs/CRUSTDATA_ENDPOINTS_REFERENCE.md docs/crustdata-endpoints-reference.md`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/crustdata-client.test.ts`
Expected: PASS (all cases — clamp, metering, Token fallback, free-on-failure, retry, verifyKey).

- [ ] **Step 6: Commit**

```bash
git add src/lib/vendors/crustdata/client.ts docs/crustdata-endpoints-reference.md tests/unit/crustdata-client.test.ts
git commit -m "feat(campaigns): metered credit-safe Crustdata client + endpoints reference"
```

---

### Task 3: Live Crustdata company adapter

**Files:**
- Create: `src/lib/sourcing/adapters/crustdata-company.ts`
- Modify: `src/lib/sourcing/company-schema.ts` (export the ops operator terms — one-line change)
- Test: `tests/unit/crustdata-company.test.ts`

**Interfaces:**
- Consumes: `CrustdataClient`, `NON_VENTURE_ROUNDS` (Task 2); `companyRecordSchema`, `CompanySourceAdapter`, `CompanyRecord`, `CompanyQuery` (Plan 1).
- Produces: `createCrustdataCompanyAdapter(client: CrustdataClient, opts?: { jobEnrichCap?: number; now?: () => Date }): CompanySourceAdapter` — implements `fetch(query)` and `creditsSpent()`.
- Modifies: `company-schema.ts` — change `const OPS_OPERATOR_TERMS` to `export const OPS_OPERATOR_TERMS` so the adapter reuses the exact operator terms for the server-side job-title filter (no duplicated list).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/crustdata-company.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createCrustdataCompanyAdapter } from "@/lib/sourcing/adapters/crustdata-company";
import { CrustdataClient } from "@/lib/vendors/crustdata/client";
import type { CompanyQuery } from "@/lib/sourcing/company-schema";

// A CrustdataClient whose HTTP layer is mocked via fetchImpl.
function clientReturning(companyPages: any[][], jobsByDomain: Record<string, any>) {
  let page = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = String(url);
    if (u.includes("/company/search")) {
      const companies = companyPages[page] ?? [];
      const next_cursor = page < companyPages.length - 1 ? `c${page + 1}` : null;
      page++;
      return new Response(JSON.stringify({ companies, next_cursor }), { status: 200 });
    }
    if (u.includes("/data_lab/job_listings")) {
      const domain = JSON.parse(String(init.body)).filters.conditions[0].value;
      return new Response(JSON.stringify(jobsByDomain[domain] ?? { fields: [], rows: [] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return new CrustdataClient({ key: "k", fetchImpl });
}

const NOW = () => new Date("2026-07-06T00:00:00Z");
const QUERY: CompanyQuery = { geography: "IND", target: 2, fundedSinceDays: 365, signalFamilies: ["money", "hiring", "expansion"] };

const anveshan = {
  basic_info: { name: "Anveshan", primary_domain: "anveshan.com" },
  locations: { country: "IND" },
  funding: { last_round_type: "series_b", last_round_amount_usd: 12700000, last_fundraise_date: "2026-05-29" },
  headcount: { total: 162, growth_percent: { "12m": 30 } },
};

describe("createCrustdataCompanyAdapter", () => {
  it("maps /company/search into CompanyRecord with correct field paths and nulls", async () => {
    const client = clientReturning([[anveshan]], {});
    const adapter = createCrustdataCompanyAdapter(client, { now: NOW });
    const { records } = await adapter.fetch({ ...QUERY, signalFamilies: ["money"] }); // no hiring → no job calls
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.name).toBe("Anveshan");
    expect(r.domain).toBe("anveshan.com");
    expect(r.sourceName).toBe("crustdata");
    expect(r.sourceRef).toBe("anveshan.com");
    expect(r.funding?.date).toBe("2026-05-29");
    expect(r.funding?.amountUsd).toBe(12700000);
    expect(r.headcount?.growth12mPct).toBe(30);
  });

  it("enriches the hiring shortlist with job_listings and attaches jobPostings", async () => {
    const client = clientReturning([[anveshan]], {
      "anveshan.com": { fields: [{ api_name: "title" }, { api_name: "date_updated" }], rows: [["Warehouse Lead", "2026-06-01"], ["DevOps Engineer", "2026-06-02"]] },
    });
    const adapter = createCrustdataCompanyAdapter(client, { now: NOW });
    const { records } = await adapter.fetch(QUERY);
    expect(records[0].jobPostings?.map((p) => p.title)).toEqual(["Warehouse Lead", "DevOps Engineer"]);
  });

  it("caps discovery at query.target and job-enrich at jobEnrichCap", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      basic_info: { name: `Co ${i}`, primary_domain: `co${i}.com` }, locations: { country: "IND" },
      funding: { last_fundraise_date: "2026-05-01" },
    }));
    const client = clientReturning([many], {});
    const adapter = createCrustdataCompanyAdapter(client, { now: NOW, jobEnrichCap: 1 });
    const { records } = await adapter.fetch({ ...QUERY, target: 3 });
    expect(records).toHaveLength(3); // target cap
  });

  it("does not job-enrich when hiring is not a requested family", async () => {
    let jobCalls = 0;
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("/data_lab/job_listings")) jobCalls++;
      if (String(url).includes("/company/search")) return new Response(JSON.stringify({ companies: [anveshan], next_cursor: null }), { status: 200 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const adapter = createCrustdataCompanyAdapter(new CrustdataClient({ key: "k", fetchImpl }), { now: NOW });
    await adapter.fetch({ ...QUERY, signalFamilies: ["money", "expansion"] });
    expect(jobCalls).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/crustdata-company.test.ts`
Expected: FAIL — cannot find module `@/lib/sourcing/adapters/crustdata-company`.

- [ ] **Step 3: Export the ops operator terms**

In `src/lib/sourcing/company-schema.ts`, change the line
```ts
const OPS_OPERATOR_TERMS = [
```
to
```ts
export const OPS_OPERATOR_TERMS = [
```
(No other change; the adapter reuses these exact terms as the server-side job-title filter.)

- [ ] **Step 4: Write the adapter**

Create `src/lib/sourcing/adapters/crustdata-company.ts`:
```ts
import {
  companyRecordSchema, OPS_OPERATOR_TERMS,
  type CompanySourceAdapter, type CompanyRecord, type CompanyQuery,
} from "@/lib/sourcing/company-schema";
import { CrustdataClient, NON_VENTURE_ROUNDS, rowsToDicts } from "@/lib/vendors/crustdata/client";

const COMPANY_FIELDS = ["basic_info", "funding", "headcount", "locations"];

function isoDaysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Safe nested read via dot path. */
function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/** Map one raw /company/search company into an unvalidated CompanyRecord shape. */
function toRawRecord(c: unknown): Record<string, unknown> {
  const domain = (get(c, "basic_info.primary_domain") as string | undefined) ?? undefined;
  const name = get(c, "basic_info.name") as string;
  return {
    name,
    domain,
    country: (get(c, "locations.country") as string | undefined) ?? undefined,
    funding: {
      lastRoundType: (get(c, "funding.last_round_type") as string | undefined) ?? undefined,
      amountUsd: (get(c, "funding.last_round_amount_usd") as number | undefined) ?? null,
      date: (get(c, "funding.last_fundraise_date") as string | undefined) ?? undefined,
    },
    headcount: {
      total: (get(c, "headcount.total") as number | undefined) ?? null,
      growth12mPct: (get(c, "headcount.growth_percent.12m") as number | undefined) ?? null,
    },
    sourceName: "crustdata",
    sourceRef: domain ?? name,
  };
}

/**
 * Live Crustdata adapter. Cheap /company/search discovery (paginated, capped at target),
 * then /data_lab/job_listings enrichment on the shortlist ONLY (funnel + credit discipline).
 * A company NOT job-enriched keeps jobPostings unset → opsPostings null (unknown, not zero).
 */
export function createCrustdataCompanyAdapter(
  client: CrustdataClient,
  opts: { jobEnrichCap?: number; now?: () => Date } = {},
): CompanySourceAdapter {
  const jobEnrichCap = opts.jobEnrichCap ?? 5;
  const nowFn = opts.now ?? (() => new Date());

  return {
    sourceName: "crustdata",
    creditsSpent: () => client.creditsSpent(),
    async fetch(query: CompanyQuery) {
      const now = nowFn();
      const fundedSince = isoDaysAgo(query.fundedSinceDays ?? 365, now);

      // 1. Cheap discovery: paginate /company/search up to target.
      const rawCompanies: unknown[] = [];
      let cursor: string | undefined;
      while (rawCompanies.length < query.target) {
        const filters = { op: "and", conditions: [
          { field: "locations.country", type: "=", value: query.geography },
          { field: "funding.last_fundraise_date", type: ">", value: fundedSince },
          { field: "funding.last_round_type", type: "not_in", value: NON_VENTURE_ROUNDS },
        ]};
        const sorts = [{ field: "funding.last_fundraise_date", order: "desc" }];
        const pageLimit = query.target - rawCompanies.length;
        const body = await client.companySearch(filters, COMPANY_FIELDS, pageLimit, sorts, cursor);
        const companies: unknown[] = Array.isArray(body?.companies) ? body.companies : [];
        rawCompanies.push(...companies);
        cursor = (body?.next_cursor as string | undefined) ?? undefined;
        if (!cursor || companies.length === 0) break;
      }

      const rawRecords = rawCompanies.slice(0, query.target).map(toRawRecord);

      // 2. Hiring enrich (shortlist only): job_listings per domain, in parallel, capped.
      if (query.signalFamilies.includes("hiring")) {
        const dateSince = isoDaysAgo(365, now);
        const shortlist = rawRecords.filter((r) => r.domain).slice(0, jobEnrichCap);
        await Promise.all(shortlist.map(async (r) => {
          const conditions = [
            { column: "company_website_domain", type: "=", value: r.domain },
            { column: "date_updated", type: "=>", value: dateSince },
            { op: "or", conditions: OPS_OPERATOR_TERMS.map((t) => ({ column: "title", type: "(.)", value: t })) },
          ];
          try {
            const body = await client.jobListings(conditions);
            const fields = Array.isArray(body?.fields) ? body.fields : [];
            const rows = Array.isArray(body?.rows) ? body.rows : [];
            r.jobPostings = rowsToDicts(fields, rows)
              .map((d) => ({ title: String(d.title ?? ""), updatedAt: (d.date_updated as string | undefined) ?? undefined }))
              .filter((p) => p.title);
          } catch {
            // one flaky/slow job_listings call must not sink the run; leave jobPostings unset (null opsPostings)
          }
        }));
      }

      // 3. Validate → CompanyRecord[], counting malformed.
      const records: CompanyRecord[] = [];
      let skippedMalformed = 0;
      for (const raw of rawRecords) {
        const parsed = companyRecordSchema.safeParse(raw);
        if (parsed.success) records.push(parsed.data);
        else skippedMalformed++;
      }
      return { records, skippedMalformed };
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/crustdata-company.test.ts`
Expected: PASS. Then confirm the Plan-1 detector unit test still passes after the export change: `npx vitest run tests/unit/company-detectors.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sourcing/adapters/crustdata-company.ts src/lib/sourcing/company-schema.ts tests/unit/crustdata-company.test.ts
git commit -m "feat(campaigns): live Crustdata company adapter (search + job-listings enrich)"
```

---

### Task 4: Source factory + surface credits in campaign stats

**Files:**
- Create: `src/lib/campaigns/adapter.ts`
- Modify: `src/lib/sourcing/company-schema.ts` (add optional `creditsSpent?()` to the `CompanySourceAdapter` interface)
- Modify: `src/lib/campaigns/run.ts` (read `creditsSpent` into stats)
- Test: `tests/integration/campaigns-credits.test.ts`

**Interfaces:**
- Modifies `CompanySourceAdapter` (Plan 1): add optional `creditsSpent?(): number;` — backward compatible (the fixture adapter simply omits it).
- Produces: `adapterForSource(source: string): CompanySourceAdapter` — `"crustdata"` → `createCrustdataCompanyAdapter(new CrustdataClient())`, anything else → `createCompanyFixtureAdapter()`.
- `runCampaign` (Plan 1) now sets `stats.creditsSpent = opts.adapter.creditsSpent?.() ?? 0` instead of the hardcoded `0`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/campaigns-credits.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { seedSignals } from "@/db/seed-signals";
import { seedOpsSignals } from "@/db/seed-ops-signals";
import { vendorProfiles } from "@/db/schema";
import { createCampaign, getCampaign } from "@/lib/campaigns/data";
import { runCampaign } from "@/lib/campaigns/run";
import { createCompanyFixtureAdapter } from "@/lib/sourcing/adapters/company-fixture";
import { adapterForSource } from "@/lib/campaigns/adapter";
import type { CompanySourceAdapter } from "@/lib/sourcing/company-schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["campaign_leads", "company_snapshots", "leads", "campaigns", "signal_observations", "mappings", "signal_definitions", "companies", "vendor_profiles"]);
});
afterAll(async () => { await closeTestDb(); });

describe("adapterForSource", () => {
  it("returns the fixture adapter for a non-crustdata source", () => {
    expect(adapterForSource("company-fixture").sourceName).toBe("company-fixture");
  });
});

describe("runCampaign surfaces creditsSpent from the adapter", () => {
  it("reads adapter.creditsSpent() into stats", async () => {
    await seedSignals(testDb); await seedOpsSignals(testDb);
    const [v] = await testDb.insert(vendorProfiles).values({ name: "V", vendorType: "Infra" }).returning();
    const { campaignId } = await createCampaign(testDb, { vendorId: v.vendorId, label: "x", source: "company-fixture", config: { geography: "IND", target: 10 } });

    // A fixture adapter that reports a fake spend, to prove the wiring.
    const base = createCompanyFixtureAdapter();
    const metered: CompanySourceAdapter = { ...base, creditsSpent: () => 0.42 };

    const stats = await runCampaign(testDb, { campaignId, adapter: metered });
    expect(stats.creditsSpent).toBe(0.42);
    const c = await getCampaign(testDb, campaignId);
    expect((c!.stats as { creditsSpent: number }).creditsSpent).toBe(0.42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/campaigns-credits.test.ts`
Expected: FAIL — `@/lib/campaigns/adapter` not found, and `stats.creditsSpent` is `0` not `0.42`.

- [ ] **Step 3: Extend the adapter interface**

In `src/lib/sourcing/company-schema.ts`, add the optional method to the interface:
```ts
export interface CompanySourceAdapter {
  readonly sourceName: string;
  fetch(query: CompanyQuery): Promise<{ records: CompanyRecord[]; skippedMalformed: number }>;
  creditsSpent?(): number;
}
```

- [ ] **Step 4: Wire creditsSpent into runCampaign stats**

In `src/lib/campaigns/run.ts`, change the stats construction so `creditsSpent` reads the adapter (find the `const stats: CampaignStats = { … creditsSpent: 0 };` block):
```ts
    const stats: CampaignStats = {
      companiesFetched: ingest.touched.length,
      observationsWritten: ingest.written,
      leadsCreated, leadsUpdated,
      creditsSpent: opts.adapter.creditsSpent?.() ?? 0,
    };
```

- [ ] **Step 5: Write the factory**

Create `src/lib/campaigns/adapter.ts`:
```ts
import type { CompanySourceAdapter } from "@/lib/sourcing/company-schema";
import { createCompanyFixtureAdapter } from "@/lib/sourcing/adapters/company-fixture";
import { createCrustdataCompanyAdapter } from "@/lib/sourcing/adapters/crustdata-company";
import { CrustdataClient } from "@/lib/vendors/crustdata/client";

/** Pick the company source adapter for a campaign's `source`. "crustdata" needs CRUSTDATA_API_KEY. */
export function adapterForSource(source: string): CompanySourceAdapter {
  if (source === "crustdata") return createCrustdataCompanyAdapter(new CrustdataClient());
  return createCompanyFixtureAdapter();
}
```

- [ ] **Step 6: Run test + Plan-1 regression to verify**

Run: `npx vitest run tests/integration/campaigns-credits.test.ts tests/integration/campaigns-run.test.ts`
Expected: both PASS (the new credits test, and the unchanged Plan-1 orchestrator test — proving the interface + stats edits didn't regress it).

- [ ] **Step 7: Commit**

```bash
git add src/lib/campaigns/adapter.ts src/lib/sourcing/company-schema.ts src/lib/campaigns/run.ts tests/integration/campaigns-credits.test.ts
git commit -m "feat(campaigns): source-adapter factory + surface creditsSpent in campaign stats"
```

---

### Task 5: `db:campaign:run` CLI runner

**Files:**
- Create: `src/db/campaign-run.ts`
- Modify: `package.json` (add `db:campaign:run` script)
- Test: `tests/integration/campaign-run-cli.test.ts`

**Interfaces:**
- Produces: `runCampaignForVendor(db, input: { vendorId: string; source: string; geography: string; target: number }): Promise<{ campaignId: string; stats: CampaignStats }>` — resolves the vendor's name for the label, creates the campaign with `source`, picks the adapter via `adapterForSource`, runs `runCampaign`, returns the campaign id + stats.
- Consumes: `createCampaign` (Plan 1 data), `runCampaign` (Plan 1), `adapterForSource` (Task 4), `vendorProfiles` schema.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/campaign-run-cli.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { seedSignals } from "@/db/seed-signals";
import { seedOpsSignals } from "@/db/seed-ops-signals";
import { vendorProfiles, campaigns, leads } from "@/db/schema";
import { runCampaignForVendor } from "@/db/campaign-run";
import { eq } from "drizzle-orm";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["campaign_leads", "company_snapshots", "leads", "campaigns", "signal_observations", "mappings", "signal_definitions", "companies", "vendor_profiles"]);
});
afterAll(async () => { await closeTestDb(); });

describe("runCampaignForVendor (fixture source — no key needed)", () => {
  it("creates and runs a campaign end-to-end, producing leads", async () => {
    await seedSignals(testDb); await seedOpsSignals(testDb);
    const [v] = await testDb.insert(vendorProfiles).values({ name: "RackPro Infra", vendorType: "Infra" }).returning();

    const { campaignId, stats } = await runCampaignForVendor(testDb, {
      vendorId: v.vendorId, source: "company-fixture", geography: "IND", target: 10,
    });

    expect(stats.leadsCreated).toBeGreaterThan(0);
    const [c] = await testDb.select().from(campaigns).where(eq(campaigns.campaignId, campaignId));
    expect(c.status).toBe("done");
    expect(c.source).toBe("company-fixture");
    expect(c.label).toContain("RackPro Infra");
    const vendorLeads = await testDb.select().from(leads).where(eq(leads.vendorId, v.vendorId));
    expect(vendorLeads.length).toBe(stats.leadsCreated);
  });

  it("throws a clear error when the vendor does not exist", async () => {
    await expect(runCampaignForVendor(testDb, {
      vendorId: "00000000-0000-0000-0000-000000000000", source: "company-fixture", geography: "IND", target: 5,
    })).rejects.toThrow(/vendor/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/campaign-run-cli.test.ts`
Expected: FAIL — cannot find module `@/db/campaign-run`.

- [ ] **Step 3: Write the runner + CLI**

Create `src/db/campaign-run.ts`:
```ts
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, or } from "drizzle-orm";
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
```
Note the unused `or` import — remove it if your linter flags it (it is not used above; kept out intentionally). If `eslint` fails on an unused import, delete `, or` from the `drizzle-orm` import line.

- [ ] **Step 4: Add the npm script**

In `package.json`, add after `"db:brief:generate"`:
```json
    "db:campaign:run": "tsx src/db/campaign-run.ts",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/campaign-run-cli.test.ts`
Expected: PASS (both the fixture end-to-end run and the missing-vendor error).

- [ ] **Step 6: Full typecheck + feature suite**

Run: `npm run typecheck && npx vitest run tests/unit/crustdata-client.test.ts tests/unit/crustdata-company.test.ts tests/unit/env.test.ts tests/integration/campaigns-credits.test.ts tests/integration/campaign-run-cli.test.ts tests/integration/campaigns-run.test.ts`
Expected: typecheck clean; all pass. (Integration tests share one Neon branch and run serially — a transient TRUNCATE/latency failure is known flakiness; re-run 2–3× before investigating.)

- [ ] **Step 7: Commit**

```bash
git add src/db/campaign-run.ts package.json tests/integration/campaign-run-cli.test.ts
git commit -m "feat(campaigns): db:campaign:run CLI — create + run a live campaign for a vendor"
```

---

## How the operator goes live (after this plan)

1. Add `CRUSTDATA_API_KEY=…` to `.env.local`.
2. Seed config (once): `npm run db:seed:signals && npm run db:seed:ops-signals`.
3. Create an **Infra** vendor in radar's existing UI (`/vendors` → add → set `vendorType` "Infra" via interview/edit).
4. Run a live campaign: `npm run db:campaign:run -- --vendor "<vendor name>" --source crustdata --geo IND --target 20`.
5. Real companies flow into `signal_observations` → scored `leads` (visible in the existing Leads UI). Credits spent print in the CLI output and persist in `campaigns.stats`.

(Plan 2 — the "Find Leads" button + Campaigns UI — later replaces step 4 with a click.)

## Self-Review

**1. Spec coverage:**
- §6.2 metered client (base URL, version, Bearer→Token fallback, 25-cap, 0.03/row metering, retry, free-on-failure) → Task 2 ✓
- §6.1 `createCrustdataCompanyAdapter` (`/company/search` + `/data_lab/job_listings` → `CompanyRecord`) → Task 3 ✓
- §4.5/§6.5 wire behind `source` flag → Task 4 (`adapterForSource`) + Task 5 (CLI creates campaign with `source`) ✓
- `stats.creditsSpent` surfaced → Task 4 ✓
- env key → Task 1 ✓; reference doc ported → Task 2 ✓
- Funnel discipline (discover cheap, enrich shortlist) → Task 3 (`jobEnrichCap`, parallel, shortlist-only) ✓
- "missing = null" preserved (unenriched company → `jobPostings` unset → `opsPostings` null) → Task 3 ✓
- **Deferred (correctly out of scope):** `/person/search` contact enrichment (V2), the UI (Plan 2). Noted.

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". The only conditional instruction is the `or` unused-import note in Task 5 Step 3, made explicit ("delete `, or` if eslint flags it"). Every code step shows complete code.

**3. Type consistency:** `CrustdataClient` method names (`companySearch`/`jobListings`/`verifyKey`/`creditsSpent`) match their uses in Task 3 & 4; `createCrustdataCompanyAdapter(client, opts)` signature matches Task 4's factory call; `CompanySourceAdapter.creditsSpent?()` (Task 4) matches the adapter's provided `creditsSpent` (Task 3) and `run.ts`'s `opts.adapter.creditsSpent?.()` read; `runCampaignForVendor` return `{ campaignId, stats }` matches Task 5's test and CLI. `CompanyRecord` field paths (`funding.date`, `funding.amountUsd`, `headcount.growth12mPct`, `jobPostings[].title`) match Plan 1's schema and the mapping in Task 3.

**4. Scope check:** Self-contained and independently shippable — after this plan a live campaign runs end-to-end via CLI. UI is a separate plan. Good.
