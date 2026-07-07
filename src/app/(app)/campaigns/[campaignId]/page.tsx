import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getCampaign } from "@/lib/campaigns/data";
import { campaignLeads, leads, companies, companySnapshots, vendorProfiles } from "@/db/schema";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusPill } from "@/app/components/ui/status-pill";
import { CampaignDetailView } from "../campaign-detail-view";
import { toSurfacedLeadRow, sourceTag, type CampaignStatsShape } from "../view-model";

export default async function CampaignDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const campaign = await getCampaign(db, campaignId);
  if (!campaign) notFound();

  const [vendor] = await db.select({ name: vendorProfiles.name }).from(vendorProfiles).where(eq(vendorProfiles.vendorId, campaign.vendorId)).limit(1);

  const raw = await db
    .select({
      leadId: leads.leadId, companyName: companies.name, score: leads.score,
      wasNew: campaignLeads.wasNew, profile: companies.profile, snapshot: companySnapshots.snapshot,
    })
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.leadId))
    .innerJoin(companies, eq(leads.companyId, companies.companyId))
    .leftJoin(companySnapshots, and(eq(companySnapshots.campaignId, campaignId), eq(companySnapshots.companyId, companies.companyId)))
    .where(eq(campaignLeads.campaignId, campaignId));

  const surfaced = raw.map(toSurfacedLeadRow);
  const stats = campaign.stats as CampaignStatsShape | null;
  const cfg = (campaign.config ?? {}) as Record<string, unknown>;
  const tag = sourceTag(campaign.source);

  const runDetails = [
    { k: "Vendor", v: vendor?.name ?? "—" },
    { k: "Geography", v: String(cfg.geography ?? "—") },
    { k: "Target", v: String(cfg.target ?? "—") },
    { k: "Source", v: tag.label },
    { k: "Started", v: campaign.startedAt ? new Date(campaign.startedAt).toLocaleString() : "—" },
    { k: "Finished", v: campaign.finishedAt ? new Date(campaign.finishedAt).toLocaleString() : "—" },
  ];

  return (
    <>
      <Link href="/campaigns" className="back-link">← All campaigns</Link>
      <PageHeader eyebrow="Operate" title={campaign.label}
        actions={<><StatusPill status={campaign.status} /><span className={`src-tag ${tag.kind}`}>{tag.label}</span></>} />
      {campaign.error && <p role="alert" className="run-error">{campaign.error}</p>}
      <CampaignDetailView stats={stats} runDetails={runDetails} leads={surfaced} />
    </>
  );
}
