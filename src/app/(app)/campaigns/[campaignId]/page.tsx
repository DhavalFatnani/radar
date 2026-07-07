import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getCampaign } from "@/lib/campaigns/data";
import { campaignLeads, leads, companies } from "@/db/schema";
import { PageHeader } from "@/app/components/ui/page-header";
import type { CampaignStatsShape } from "../view-model";

export default async function CampaignDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const campaign = await getCampaign(db, campaignId);
  if (!campaign) notFound();

  const surfaced = await db
    .select({ leadId: leads.leadId, companyName: companies.name, score: leads.score, wasNew: campaignLeads.wasNew })
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.leadId))
    .innerJoin(companies, eq(leads.companyId, companies.companyId))
    .where(eq(campaignLeads.campaignId, campaignId));

  const stats = campaign.stats as CampaignStatsShape | null;

  return (
    <>
      <Link href="/campaigns" className="back-link">← All campaigns</Link>
      <PageHeader eyebrow="Operate" title={campaign.label} />
      <span className={`badge badge-${campaign.status}`}>{campaign.status}</span>
      {campaign.error && <p role="alert">{campaign.error}</p>}

      {stats && (
        <dl className="lead-facts" aria-label="Campaign stats">
          <div className="fact"><dt>Companies</dt><dd>{stats.companiesFetched}</dd></div>
          <div className="fact"><dt>Observations</dt><dd>{stats.observationsWritten}</dd></div>
          <div className="fact"><dt>Leads</dt><dd>{stats.leadsCreated}</dd></div>
          <div className="fact"><dt>Credits</dt><dd>{stats.creditsSpent}</dd></div>
        </dl>
      )}

      <h2 className="signal-group-head">Leads surfaced</h2>
      {surfaced.length === 0 ? (
        <p className="mapping-empty">No leads surfaced by this run.</p>
      ) : (
        <ul className="mapping-list">
          {surfaced.map((l) => (
            <li key={l.leadId}>
              <Link href={`/leads/${l.leadId}`}>{l.companyName}</Link>
              <p className="mapping-meta">score {l.score ?? "—"}{l.wasNew ? " · new" : " · updated"}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
