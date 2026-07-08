import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/app/components/ui/page-header";
import { getVendor, getVendorTypeOptions } from "@/lib/vendors/data";
import { getActiveInterview } from "@/lib/interviews/data";
import { db } from "@/db/client";
import { getSourcingReadiness } from "@/lib/campaigns/readiness";
import { EditProfileForm } from "./edit-profile-form";
import { FindLeadsPanel } from "./find-leads-panel";

export const metadata = { title: "Vendor — Radar" };

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const vendor = await getVendor(vendorId);
  if (!vendor) notFound();

  const active = await getActiveInterview(vendorId);
  const readiness = await getSourcingReadiness(db, vendorId);
  const types = await getVendorTypeOptions();

  return (
    <>
      <PageHeader eyebrow="Build" title={vendor.name} />
      <p className="profile-meta">Version {vendor.version}</p>
      <p>
        <Link href={`/vendors/${vendorId}/interview`} className="btn btn-primary">
          {active ? "Continue interview" : "Start interview"}
        </Link>
      </p>
      <FindLeadsPanel vendorId={vendorId} readiness={readiness} />
      <EditProfileForm vendor={vendor} types={types} />
    </>
  );
}
