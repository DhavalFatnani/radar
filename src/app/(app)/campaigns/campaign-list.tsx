"use client";
import { useMemo, useState } from "react";
import { StatTile } from "@/app/components/ui/stat-tile";
import { Gauge } from "@/app/components/ui/gauge";
import { SearchInput, FilterChips, Segmented } from "@/app/components/ui/controls";
import { CampaignTable } from "./campaign-table";
import { deriveListKpis, CREDIT_BUDGET, type CampaignListRow } from "./view-model";

const STATUS_OPTS = [
  { value: "all", label: "All" }, { value: "done", label: "Done" },
  { value: "running", label: "Running" }, { value: "failed", label: "Failed" },
];
const SOURCE_OPTS = [{ value: "all", label: "All" }, { value: "crustdata", label: "Live" }, { value: "fixture", label: "Test" }];

const ATTN_ABBR: Record<string, string> = { running: "run", failed: "fail", queued: "queue", done: "done" };
function attnSub(r: CampaignListRow): string {
  if (r.status === "running") return `running · ${r.companies} fetched`;
  if (r.status === "failed") return "failed · needs a look";
  return "queued · starts next";
}

export function CampaignListView({ rows, nowMs }: { rows: CampaignListRow[]; nowMs: number }) {
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [minYield, setMinYield] = useState(0);

  const kpis = useMemo(() => deriveListKpis(rows, now), [rows, now]);
  const used = useMemo(() => rows.reduce((s, r) => s + r.credits, 0), [rows]);
  const pctUsed = CREDIT_BUDGET > 0 ? (used / CREDIT_BUDGET) * 100 : 0;
  const counts = {
    live: rows.filter((r) => r.status === "running").length,
    failed: rows.filter((r) => r.status === "failed").length,
    high: rows.filter((r) => r.yield >= 40).length,
    all: rows.length,
  };

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
          <SearchInput value={search} onChange={setSearch} placeholder="Filter these campaigns…" />
          <FilterChips options={STATUS_OPTS} value={status} onChange={setStatus} />
          <Segmented options={SOURCE_OPTS} value={source} onChange={setSource} />
        </div>
        <CampaignTable rows={filtered} now={now} />
        <div className="list-note">{rows.length} campaign{rows.length === 1 ? "" : "s"} · click a row to open its detail.</div>
      </div>

      <aside className="ctx-rail">
        <div className="ctx-panel">
          <h3>Credit budget</h3>
          <div className="gauge-cluster">
            <Gauge value={used} max={CREDIT_BUDGET} />
            <div><div className="big">{used.toFixed(1)}</div><div className="sm">of {CREDIT_BUDGET} · {pctUsed.toFixed(1)}% used</div></div>
          </div>
        </div>
        <div className="ctx-panel">
          <h3>Quick views</h3>
          <div className="qview" onClick={() => { setStatus("running"); setMinYield(0); }}>Live runs <span className="n">{counts.live}</span></div>
          <div className="qview" onClick={() => { setStatus("failed"); setMinYield(0); }}>Failed — retry <span className="n">{counts.failed}</span></div>
          <div className="qview" onClick={() => { setStatus("all"); setMinYield(40); }}>High yield ≥40% <span className="n">{counts.high}</span></div>
          <div className="qview" onClick={() => { setStatus("all"); setSource("all"); setSearch(""); setMinYield(0); }}>All campaigns <span className="n">{counts.all}</span></div>
        </div>
        <div className="ctx-panel">
          <h3>Needs attention</h3>
          {attention.length === 0 ? <p className="qv-empty">Nothing needs attention.</p> : (
            attention.map((r) => (
              <div className="attn" key={r.campaignId}>
                <span className={`pill pill-${r.status}`}>{ATTN_ABBR[r.status]}</span>
                <div className="attn-co"><b>{r.label}</b><span>{attnSub(r)}</span></div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
