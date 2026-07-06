import { db } from "@/db/client";
import { listCampaigns } from "@/lib/campaigns/data";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { CampaignList, type CampaignRow } from "./campaign-list";

export const metadata = { title: "Campaigns — Radar" };

export default async function CampaignsPage() {
  const rows = (await listCampaigns(db)) as unknown as CampaignRow[];
  return (
    <>
      <PageHeader eyebrow="Operate" title="Campaigns" />
      {rows.length === 0 ? (
        <EmptyState icon="campaigns" title="No campaigns yet"
          description="Open a vendor and hit “Find Leads” to run your first campaign." />
      ) : (
        <CampaignList campaigns={rows} />
      )}
    </>
  );
}
