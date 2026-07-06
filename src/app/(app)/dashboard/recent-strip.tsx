import Link from "next/link";

export type StripCampaign = { campaignId: string; label: string; status: "queued" | "running" | "done" | "failed"; leadsCreated: number | null };
export type StripLead = { leadId: string; companyName: string; score: number | null };

export function RecentStrip({ campaigns, leads }: { campaigns: StripCampaign[]; leads: StripLead[] }) {
  return (
    <div className="cmd-bento">
      <section className="tile third" aria-label="Recent campaigns">
        <h2 className="signal-group-head">Recent campaigns</h2>
        {campaigns.length === 0 ? <p className="mapping-empty">None yet.</p> : (
          <ul className="mapping-list">
            {campaigns.map((c) => (
              <li key={c.campaignId}>
                <Link href={`/campaigns/${c.campaignId}`}>{c.label}</Link>
                <span className={`badge badge-${c.status}`}>{c.status}</span>
                {c.leadsCreated != null && <p className="mapping-meta">{c.leadsCreated} leads</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="tile third" aria-label="Fresh leads">
        <h2 className="signal-group-head">Fresh leads</h2>
        {leads.length === 0 ? <p className="mapping-empty">None yet.</p> : (
          <ul className="mapping-list">
            {leads.map((l) => (
              <li key={l.leadId}>
                <Link href={`/leads/${l.leadId}`}>{l.companyName}</Link>
                <p className="mapping-meta">score {l.score ?? "—"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
