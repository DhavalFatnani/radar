import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { listCampaigns } from "@/lib/campaigns/data";
import { leads, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { RecentStrip, type StripCampaign, type StripLead } from "./recent-strip";

export const metadata = { title: "Dashboard — Radar" };

export default async function DashboardPage() {
  const campaignRows = (await listCampaigns(db)).slice(0, 5);
  const stripCampaigns: StripCampaign[] = campaignRows.map((c) => ({
    campaignId: c.campaignId, label: c.label,
    status: c.status as StripCampaign["status"],
    leadsCreated: (c.stats as { leadsCreated?: number } | null)?.leadsCreated ?? null,
  }));

  const leadRows = await db
    .select({ leadId: leads.leadId, companyName: companies.name, score: leads.score, createdAt: leads.createdAt })
    .from(leads).innerJoin(companies, eq(leads.companyId, companies.companyId))
    .orderBy(desc(leads.createdAt)).limit(5);
  const stripLeads: StripLead[] = leadRows.map((l) => ({ leadId: l.leadId, companyName: l.companyName, score: l.score }));

  const isEmpty = stripCampaigns.length === 0 && stripLeads.length === 0;
  return (
    <>
      <PageHeader eyebrow="Operate" title="Dashboard" />
      {isEmpty ? (
        <EmptyState icon="dashboard" title="Your operating day will appear here"
          description="Once leads, signals, and pipeline activity exist, this becomes your prioritized daily flow." />
      ) : (
        <RecentStrip campaigns={stripCampaigns} leads={stripLeads} />
      )}
    </>
  );
}
