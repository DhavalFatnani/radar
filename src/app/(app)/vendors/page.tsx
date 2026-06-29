import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { listVendors } from "@/lib/vendors/data";
import { AddVendorForm } from "./add-vendor-form";

export const metadata = { title: "Vendors — Radar" };

export default async function VendorsPage() {
  const vendors = await listVendors();
  return (
    <>
      <PageHeader eyebrow="Build" title="Vendors" />
      <AddVendorForm />
      {vendors.length === 0 ? (
        <EmptyState
          icon="vendors"
          title="No vendors yet"
          description="Add a vendor above to prove the pipe — full profiles from the SIA intake interview will appear here."
        />
      ) : (
        <ul className="vendor-list">
          {vendors.map((v) => (
            <li key={v.vendorId}>
              <Link href={`/vendors/${v.vendorId}`}>{v.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
