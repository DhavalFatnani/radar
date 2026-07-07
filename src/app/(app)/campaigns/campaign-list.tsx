"use client";
import { useMemo, useState } from "react";
import { StatTile } from "@/app/components/ui/stat-tile";
import { Gauge } from "@/app/components/ui/gauge";
import { StatusPill } from "@/app/components/ui/status-pill";
import { SearchInput, FilterChips, Segmented } from "@/app/components/ui/controls";
import { CampaignTable } from "./campaign-table";
import { deriveListKpis, CREDIT_BUDGET, type CampaignListRow } from "./view-model";

const STATUS_OPTS = [
  { value: "all", label: "All" }, { value: "done", label: "Done" },
  { value: "running", label: "Running" }, { value: "failed", label: "Failed" },
];
const SOURCE_OPTS = [{ value: "all", label: "All" }, { value: "crustdata", label: "Live" }, { value: "fixture", label: "Test" }];

export function CampaignListView({ rows, nowMs }: { rows: CampaignListRow[]; nowMs: number }) {
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [minYield, setMinYield] = useState(0);

  const kpis = useMemo(() => deriveListKpis(rows, now), [rows, now]);
  const used = useMemo(() => rows.reduce((s, r) => s + r.credits, 0), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (source === "crustdata" && r.source !== "crustdata") return false;
      if (source === "fixture" && r.source === "crustdata") return false;
      if (minYield > 0 && r.yield < minYield) return false;
      if (q && !(`${r.label} ${r.vendorName}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, status, source, minYield]);

  const attention = rows.filter((r) => r.status === "running" || r.status === "failed" || r.status === "queued");

  return (
    <div className="ctx-grid">
      <div className="ctx-main">
        <div className="stat-row">
          {kpis.map((k) => <StatTile key={k.label} {...k} />)}
        </div>
        <div className="cmdbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search campaigns…" />
          <FilterChips options={STATUS_OPTS} value={status} onChange={setStatus} />
          <Segmented options={SOURCE_OPTS} value={source} onChange={setSource} />
        </div>
        <CampaignTable rows={filtered} now={now} />
      </div>

      <aside className="ctx-rail">
        <div className="ctx-panel">
          <h3>Credit budget</h3>
          <div className="gauge-cluster">
            <Gauge value={used} max={CREDIT_BUDGET} />
            <div><div className="big">{used.toFixed(1)}</div><div className="sm">of {CREDIT_BUDGET} credits</div></div>
          </div>
        </div>
        <div className="ctx-panel">
          <h3>Quick views</h3>
          <div className="qv">
            <button type="button" onClick={() => { setStatus("all"); setSource("all"); setSearch(""); setMinYield(0); }}>All campaigns</button>
            <button type="button" onClick={() => { setStatus("running"); setMinYield(0); }}>Live runs</button>
            <button type="button" onClick={() => { setStatus("failed"); setMinYield(0); }}>Failed runs</button>
            <button type="button" onClick={() => { setStatus("all"); setMinYield(40); }}>High-yield ≥40%</button>
          </div>
        </div>
        <div className="ctx-panel">
          <h3>Needs attention</h3>
          {attention.length === 0 ? <p className="qv-empty">Nothing needs attention.</p> : (
            <ul className="attn">
              {attention.map((r) => (
                <li key={r.campaignId}><span className="attn-label">{r.label}</span><StatusPill status={r.status} /></li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
