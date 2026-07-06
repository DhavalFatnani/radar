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
