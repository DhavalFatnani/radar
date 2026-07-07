import Link from "next/link";

export type StripCampaign = { campaignId: string; label: string; status: "queued" | "running" | "done" | "failed"; leadsCreated: number | null };
export type StripLead = { leadId: string; companyName: string; score: number | null };

export function RecentStrip({ campaigns, leads }: { campaigns: StripCampaign[]; leads: StripLead[] }) {
  return (
    <div className="cmd-bento">
      <section className="tile third" aria-label="Recent campaigns">
        <h2 className="signal-group-head">Recent campaigns</h2>
        {campaigns.length === 0 ? <p className="mapping-empty">None yet.</p> : (
          <ul className="row-list">
            {campaigns.map((c) => (
              <li key={c.campaignId} className="row-item">
                <Link href={`/campaigns/${c.campaignId}`} className="row-link">
                  <span className="row-main">
                    <span className="row-title">{c.label}</span>
                    {c.leadsCreated != null ? <span className="row-meta">{c.leadsCreated} leads</span> : null}
                  </span>
                  <span className="row-aside"><span className={`badge badge-${c.status}`}>{c.status}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="tile third" aria-label="Fresh leads">
        <h2 className="signal-group-head">Fresh leads</h2>
        {leads.length === 0 ? <p className="mapping-empty">None yet.</p> : (
          <ul className="row-list">
            {leads.map((l) => (
              <li key={l.leadId} className="row-item">
                <Link href={`/leads/${l.leadId}`} className="row-link">
                  <span className="row-main"><span className="row-title">{l.companyName}</span></span>
                  <span className="row-aside"><span className="row-meta">score {l.score ?? "—"}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
