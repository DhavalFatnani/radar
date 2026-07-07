import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, vendorProfiles } from "@/db/schema";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { CampaignListView } from "./campaign-list";
import { yieldPct, type CampaignListRow, type CampaignStatsShape } from "./view-model";

export const metadata = { title: "Campaigns — Radar" };

export default async function CampaignsPage() {
  const raw = await db
    .select({
      campaignId: campaigns.campaignId, label: campaigns.label, source: campaigns.source,
      status: campaigns.status, stats: campaigns.stats, createdAt: campaigns.createdAt,
      vendorName: vendorProfiles.name,
    })
    .from(campaigns)
    .innerJoin(vendorProfiles, eq(campaigns.vendorId, vendorProfiles.vendorId))
    .orderBy(desc(campaigns.createdAt));

  const rows: CampaignListRow[] = raw.map((r) => {
    const s = (r.stats as CampaignStatsShape | null);
    const companies = s?.companiesFetched ?? 0;
    const leads = s?.leadsCreated ?? 0;
    return {
      campaignId: r.campaignId, label: r.label, vendorName: r.vendorName ?? "—",
      source: r.source, status: r.status, companies, leads,
      credits: s?.creditsSpent ?? 0, yield: yieldPct(companies, leads),
      createdAt: (r.createdAt ?? new Date()).toISOString(),
    };
  });

  const newCta = <Link href="/campaigns/new" className="btn btn-primary btn-sm">New Campaign</Link>;

  return (
    <>
      <PageHeader eyebrow="Operate" title="Campaigns" sub="Every sourcing run, its yield, and what needs a look." actions={newCta} />
      {rows.length === 0 ? (
        <EmptyState icon="campaigns" title="No campaigns yet"
          description="Open a vendor and hit “Find Leads” to run your first campaign." />
      ) : (
        <CampaignListView rows={rows} nowMs={Date.now()} />
      )}
    </>
  );
}
