"use client";
import { useState } from "react";
import { StatTile } from "@/app/components/ui/stat-tile";
import { ScoreMeter } from "@/app/components/ui/score-meter";
import { KvList } from "@/app/components/ui/kv-list";
import { Segmented } from "@/app/components/ui/controls";
import { SurfacedLeadsTable } from "./surfaced-leads-table";
import type { SurfacedLeadRow, CampaignStatsShape } from "./view-model";

const VIEW_OPTS = [{ value: "score", label: "By score" }, { value: "new", label: "New only" }];

function ActionIcon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

export function CampaignDetailView({ stats, runDetails, leads }: {
  stats: CampaignStatsShape | null; runDetails: { k: string; v: string }[]; leads: SurfacedLeadRow[];
}) {
  const [view, setView] = useState<"score" | "new">("score");
  const best = leads.reduce<SurfacedLeadRow | null>((b, l) => (!b || l.score > b.score ? l : b), null);
  const avg = leads.length ? Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length) : 0;
  const newCount = leads.filter((l) => l.wasNew).length;
  // score profile of this run's leads (low→high) — a real per-run distribution.
  const scorePts = leads.length >= 2 ? leads.map((l) => l.score).sort((a, b) => a - b) : undefined;

  return (
    <div className="ctx-grid">
      <div className="ctx-main">
        <div className="stat-row">
          <StatTile label="Companies fetched" value={String(stats?.companiesFetched ?? 0)} />
          <StatTile label="Observations" value={String(stats?.observationsWritten ?? 0)} />
          <StatTile label="Leads created" value={String(stats?.leadsCreated ?? 0)} delta={`▲ ${newCount} new`} deltaDir="up" points={scorePts} />
          <StatTile label="Credits" value={(stats?.creditsSpent ?? 0).toFixed(2)} />
        </div>

        <div className="section-head">
          <div>
            <div className="eyebrow">Leads surfaced</div>
            <h2>{leads.length} {leads.length === 1 ? "company" : "companies"} scored</h2>
          </div>
          {leads.length > 0 ? <Segmented options={VIEW_OPTS} value={view} onChange={(v) => setView(v as "score" | "new")} /> : null}
        </div>

        {leads.length === 0 ? <p className="mapping-empty">No leads surfaced by this run.</p> : <SurfacedLeadsTable rows={leads} view={view} />}
      </div>

      <aside className="ctx-rail">
        <div className="ctx-panel">
          <h3>Actions</h3>
          <div className="actions-list">
            <button type="button" className="btn btn-sm btn-ghost"><ActionIcon d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />Re-run campaign</button>
            <button type="button" className="btn btn-sm btn-ghost"><ActionIcon d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />Export CSV</button>
            <button type="button" className="btn btn-sm btn-ghost"><ActionIcon d="M12 5v14M5 12h14" />Add all to pipeline</button>
            <button type="button" className="btn btn-sm btn-ghost"><ActionIcon d="M18 6 6 18M6 6l12 12" />Dismiss run</button>
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
