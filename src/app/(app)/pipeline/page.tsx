import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { db } from "@/db/client";
import { listPipelineLeads } from "@/lib/pipeline/data";
import { PipelineBoard } from "./pipeline-board";

export const metadata = { title: "Pipeline — Radar" };

export default async function PipelinePage() {
  const leads = await listPipelineLeads(db);

  return (
    <>
      <PageHeader eyebrow="Operate" title="Pipeline" />
      {leads.length === 0 ? (
        <EmptyState
          icon="pipeline"
          title="No pipeline activity yet"
          description="Leads from the sourcing engine appear here, tracked from sourced to paid. Run `npm run db:source:leads` to generate leads."
        />
      ) : (
        <PipelineBoard leads={leads} />
      )}
    </>
  );
}
