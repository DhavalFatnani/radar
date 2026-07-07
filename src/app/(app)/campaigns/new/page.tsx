import Link from "next/link";
import { db } from "@/db/client";
import { listVendors, getVendor } from "@/lib/vendors/data";
import { getSourcingReadiness } from "@/lib/campaigns/readiness";
import { listCampaigns } from "@/lib/campaigns/data";
import { PageHeader } from "@/app/components/ui/page-header";
import { NewCampaignForm, type VendorSnapshot } from "../new-campaign-form";
import { relativeTime, type CampaignStatsShape } from "../view-model";

export const metadata = { title: "New Campaign — Radar" };

export default async function NewCampaignPage() {
  const vendorList = await listVendors();
  const now = new Date();

  const vendors: VendorSnapshot[] = await Promise.all(
    vendorList.map(async (v) => {
      const [readiness, profile, runs] = await Promise.all([
        getSourcingReadiness(db, v.vendorId),
        getVendor(v.vendorId),
        listCampaigns(db, v.vendorId),
      ]);
      const recentRuns = (runs as { label: string; stats: CampaignStatsShape | null; createdAt: Date | null }[])
        .slice(0, 3)
        .map((r) => ({ label: r.label, leads: r.stats?.leadsCreated ?? 0, when: relativeTime((r.createdAt ?? now).toISOString(), now) }));
      return {
        vendorId: v.vendorId, name: v.name, vendorType: readiness.vendorType, version: profile?.version ?? 1,
        capabilities: profile?.capabilities ?? [], runnable: readiness.runnable, signalFamilies: readiness.signalFamilies,
        recentRuns,
      };
    }),
  );

  return (
    <>
      <Link href="/campaigns" className="back-link">← All campaigns</Link>
      <PageHeader eyebrow="Operate" title="New campaign" sub="Pick a vendor and pull real companies showing its buying signals." />
      {vendors.length === 0
        ? <p className="mapping-empty">No vendors yet — create one first.</p>
        : <NewCampaignForm vendors={vendors} />}
    </>
  );
}
