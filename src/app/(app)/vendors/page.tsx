import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Vendors — Radar" };

export default function VendorsPage() {
  return (
    <>
      <PageHeader eyebrow="Build" title="Vendors" />
      <EmptyState icon="vendors" title="No vendors yet"
        description="Vendor profiles from the SIA intake interview will appear here." />
    </>
  );
}
