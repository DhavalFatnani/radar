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
          } catch (err) {
            // One flaky/slow job_listings call must not sink the run; leave jobPostings unset
            // (null opsPostings = unknown, not zero). Surface it — never swallow silently.
            console.warn(
              `[crustdata] job_listings enrichment failed for ${r.domain}: ${err instanceof Error ? err.message : String(err)}`,
            );
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
