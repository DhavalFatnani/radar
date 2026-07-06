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
