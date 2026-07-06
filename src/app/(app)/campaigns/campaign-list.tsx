import Link from "next/link";

export type CampaignStatsShape = { companiesFetched: number; observationsWritten: number; leadsCreated: number; leadsUpdated: number; creditsSpent: number };
export type CampaignRow = {
  campaignId: string;
  label: string;
  source: string;
  status: "queued" | "running" | "done" | "failed";
  stats: CampaignStatsShape | null;
};

export function CampaignList({ campaigns }: { campaigns: CampaignRow[] }) {
  if (campaigns.length === 0) return <p className="mapping-empty">No campaigns yet.</p>;
  return (
    <ul className="mapping-list">
      {campaigns.map((c) => (
        <li key={c.campaignId}>
          <Link href={`/campaigns/${c.campaignId}`}>{c.label}</Link>
          <p className="mapping-meta">
            {c.source === "crustdata" ? "Live" : "Test"}
            {c.stats ? ` · ${c.stats.leadsCreated} leads · ${c.stats.creditsSpent} credits` : ""}
          </p>
          <span className={`badge badge-${c.status}`}>{c.status}</span>
        </li>
      ))}
    </ul>
  );
}
