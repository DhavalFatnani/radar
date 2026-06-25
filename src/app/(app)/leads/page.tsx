import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Leads — Radar" };

export default function LeadsPage() {
  return (
    <>
      <PageHeader eyebrow="Operate" title="Leads" />
      <EmptyState icon="leads" title="No leads yet"
        description="Companies matched to a vendor with a reverse brief and contact block will appear here." />
    </>
  );
}
