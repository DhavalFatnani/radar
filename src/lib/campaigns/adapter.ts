import type { CompanySourceAdapter } from "@/lib/sourcing/company-schema";
import { createCompanyFixtureAdapter } from "@/lib/sourcing/adapters/company-fixture";
import { createCrustdataCompanyAdapter } from "@/lib/sourcing/adapters/crustdata-company";
import { CrustdataClient } from "@/lib/vendors/crustdata/client";

/** Pick the company source adapter for a campaign's `source`. "crustdata" needs CRUSTDATA_API_KEY. */
export function adapterForSource(source: string): CompanySourceAdapter {
  if (source === "crustdata") return createCrustdataCompanyAdapter(new CrustdataClient());
  return createCompanyFixtureAdapter();
}
