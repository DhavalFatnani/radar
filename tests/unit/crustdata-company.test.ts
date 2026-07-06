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
