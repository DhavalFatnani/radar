import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { getVendorTypeOptions } from "@/lib/vendors/data";
import { NewVendorForm } from "./new-vendor-form";

export const metadata = { title: "New vendor — Radar" };

export default async function NewVendorPage() {
  const types = await getVendorTypeOptions();
  return (
    <>
      <Link href="/vendors" className="back-link">← All vendors</Link>
      <PageHeader eyebrow="Build" title="New vendor" sub="Name it and set its type — the type is what lets mappings source for it." />
      <div className="ctx-grid">
        <div className="ctx-main">
          <NewVendorForm types={types} />
        </div>
        <aside className="ctx-rail">
          <div className="ctx-panel">
            <h3>Why type matters</h3>
            <p className="list-note">
              Sourcing matches a vendor’s <b>type</b> → approved <b>mappings</b> → the <b>signals</b> they hunt.
              Pick a type that already has mappings and this vendor can source immediately. No type is fine —
              you can set it later, but the vendor stays “no type” until you do.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
