import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { listVendors } from "@/lib/vendors/data";

export const metadata = { title: "Vendors — Radar" };

export default async function VendorsPage() {
  const vendors = await listVendors();
  return (
    <>
      <PageHeader eyebrow="Build" title="Vendors" />
      {vendors.length === 0 ? (
        <EmptyState
          icon="vendors"
          title="No vendors yet"
          description="Add a vendor above to prove the pipe — full profiles from the SIA intake interview will appear here."
        />
      ) : (
        <ul className="row-list">
          {vendors.map((v) => (
            <li key={v.vendorId} className="row-item">
              <Link href={`/vendors/${v.vendorId}`} className="row-link">
                <span className="row-main">
                  <span className="row-title">{v.name}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
