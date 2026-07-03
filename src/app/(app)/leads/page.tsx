import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { db } from "@/db/client";
import { listPipelineLeads } from "@/lib/pipeline/data";
import { LeadsList } from "./leads-list";

export const metadata = { title: "Leads — Radar" };

export default async function LeadsPage() {
  const leads = await listPipelineLeads(db);
  return (
    <>
      <PageHeader eyebrow="Operate" title="Leads" />
      {leads.length === 0 ? (
        <EmptyState
          icon="leads"
          title="No leads yet"
          description="Companies matched to a vendor with a reverse brief and contact block will appear here. Run `npm run db:source:leads` to generate leads."
        />
      ) : (
        <LeadsList leads={leads} />
      )}
    </>
  );
}
