import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Mappings — Radar" };

export default function MappingsPage() {
  return (
    <>
      <PageHeader eyebrow="Build" title="Mappings" />
      <EmptyState icon="mappings" title="No mappings yet"
        description="Approved rules that combine signals into buying intent per vendor will appear here." />
    </>
  );
}
