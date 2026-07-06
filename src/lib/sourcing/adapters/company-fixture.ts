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
