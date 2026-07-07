"use client";
import { StatTile } from "@/app/components/ui/stat-tile";
import { ScoreMeter } from "@/app/components/ui/score-meter";
import { KvList } from "@/app/components/ui/kv-list";
import { SurfacedLeadsTable } from "./surfaced-leads-table";
import type { SurfacedLeadRow, CampaignStatsShape } from "./view-model";

export function CampaignDetailView({ stats, runDetails, leads }: {
  stats: CampaignStatsShape | null; runDetails: { k: string; v: string }[]; leads: SurfacedLeadRow[];
}) {
  const best = leads.reduce<SurfacedLeadRow | null>((b, l) => (!b || l.score > b.score ? l : b), null);
  const avg = leads.length ? Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length) : 0;
  const newCount = leads.filter((l) => l.wasNew).length;

  return (
    <div className="ctx-grid">
      <div className="ctx-main">
        <div className="stat-row">
          <StatTile label="Companies fetched" value={String(stats?.companiesFetched ?? 0)} />
          <StatTile label="Observations" value={String(stats?.observationsWritten ?? 0)} />
          <StatTile label="Leads created" value={String(stats?.leadsCreated ?? 0)} delta={`▲ ${newCount} new`} deltaDir="up" />
          <StatTile label="Credits" value={(stats?.creditsSpent ?? 0).toFixed(2)} />
        </div>
        <h2 className="signal-group-head">Leads surfaced</h2>
        {leads.length === 0 ? <p className="mapping-empty">No leads surfaced by this run.</p> : <SurfacedLeadsTable rows={leads} />}
      </div>

      <aside className="ctx-rail">
        <div className="ctx-panel">
          <h3>Actions</h3>
          <div className="actions-list">
            <button type="button" className="btn btn-sm">Re-run</button>
            <button type="button" className="btn btn-sm">Export CSV</button>
            <button type="button" className="btn btn-sm">Add all to pipeline</button>
            <button type="button" className="btn btn-sm btn-ghost">Dismiss</button>
          </div>
        </div>
        <div className="ctx-panel">
          <h3>Run details</h3>
          <KvList rows={runDetails} />
        </div>
        <div className="ctx-panel">
          <h3>Yield</h3>
          {best ? (
            <div className="yield-panel">
              <div className="yield-row"><span>Best lead</span><b>{best.companyName}</b></div>
              <div className="yield-row"><span>Top score</span><ScoreMeter value={best.score} size="sm" /></div>
              <div className="yield-row"><span>Avg score</span><b>{avg}</b></div>
              <div className="yield-row"><span>New / updated</span><b>{newCount} / {leads.length - newCount}</b></div>
            </div>
          ) : <p className="qv-empty">No yield yet.</p>}
        </div>
      </aside>
    </div>
  );
}
