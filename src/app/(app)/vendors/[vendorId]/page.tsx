import { notFound } from "next/navigation";
import { PageHeader } from "@/app/components/ui/page-header";
import { getVendor } from "@/lib/vendors/data";
import { EditProfileForm } from "./edit-profile-form";

export const metadata = { title: "Vendor — Radar" };

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const vendor = await getVendor(vendorId);
  if (!vendor) notFound();

  return (
    <>
      <PageHeader eyebrow="Build" title={vendor.name} />
      <p className="profile-meta">Version {vendor.version}</p>
      <EditProfileForm vendor={vendor} />
    </>
  );
}
