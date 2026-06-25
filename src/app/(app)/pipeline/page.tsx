import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Pipeline — Radar" };

export default function PipelinePage() {
  return (
    <>
      <PageHeader eyebrow="Operate" title="Pipeline" />
      <EmptyState icon="pipeline" title="No pipeline activity yet"
        description="Leads tracked from sourced to paid, with commission, will appear here." />
    </>
  );
}
