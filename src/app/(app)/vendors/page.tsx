import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { listVendorRows, getVendorTypeOptions } from "@/lib/vendors/data";
import { VendorListView } from "./vendor-list-view";

export const metadata = { title: "Vendors — Radar" };

export default async function VendorsPage() {
  const [rows, types] = await Promise.all([listVendorRows(), getVendorTypeOptions()]);
  const newCta = (
    <Link href="/vendors/new" className="btn btn-primary">
      + New vendor
    </Link>
  );
  return (
    <>
      <PageHeader
        eyebrow="Build"
        title="Vendors"
        sub="Every vendor, its type, and whether it can source yet."
        actions={newCta}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon="vendors"
          title="No vendors yet"
          description="Create your first vendor and set its type — a runnable type lets mappings source for it right away."
        />
      ) : (
        <VendorListView rows={rows} types={types} nowMs={Date.now()} />
      )}
    </>
  );
}
