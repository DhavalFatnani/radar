import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Dashboard — Radar" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader eyebrow="Operate" title="Dashboard" />
      <EmptyState icon="dashboard" title="Your operating day will appear here"
        description="Once leads, signals, and pipeline activity exist, this becomes your prioritized daily flow." />
    </>
  );
}
