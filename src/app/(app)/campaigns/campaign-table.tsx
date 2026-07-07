"use client";
import Link from "next/link";
import { useSort, useRowSelection } from "@/app/components/ui/use-table";
import { ScoreMeter } from "@/app/components/ui/score-meter";
import { StatusPill } from "@/app/components/ui/status-pill";
import { sourceTag, relativeTime, type CampaignListRow } from "./view-model";

function arrow(active: boolean, dir: 1 | -1) {
  return active ? <span className="arw">{dir === 1 ? "▲" : "▼"}</span> : null;
}

export function CampaignTable({ rows, now }: { rows: CampaignListRow[]; now: Date }) {
  const { sorted, sortKey, sortDir, toggle } = useSort<CampaignListRow>(rows, "createdAt", -1);
  const sel = useRowSelection(rows.map((r) => r.campaignId));

  // Sortable headers are real <button>s: keyboard-navigable + queryable by role.
  const sortBtn = (key: keyof CampaignListRow & string, label: string) => (
    <button type="button" className="th-sort" onClick={() => toggle(key)}>{label}{arrow(sortKey === key, sortDir)}</button>
  );
  const numHead = (key: keyof CampaignListRow & string, label: string) => (
    <th className="num sortable">{sortBtn(key, label)}</th>
  );

  return (
    <div>
      {sel.selected.size > 0 ? (
        <div className="bulkbar">
          <span>{sel.selected.size} selected</span>
          <div className="bulkbar-actions">
            <button type="button" className="btn btn-sm">Re-run</button>
            <button type="button" className="btn btn-sm">Export</button>
            <button type="button" className="btn btn-sm">Dismiss</button>
          </div>
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="chk"><input type="checkbox" aria-label="Select all campaigns" checked={sel.allChecked} onChange={sel.toggleAll} /></th>
              <th className="sortable">{sortBtn("label", "Campaign")}</th>
              <th>Source</th>
              <th>Status</th>
              {numHead("companies", "Companies")}
              {numHead("leads", "Leads")}
              {numHead("yield", "Yield")}
              {numHead("credits", "Credits")}
              {numHead("createdAt", "Run")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const tag = sourceTag(c.source);
              return (
                <tr key={c.campaignId}>
                  <td className="chk"><input type="checkbox" aria-label={`Select ${c.label}`} checked={sel.selected.has(c.campaignId)} onChange={() => sel.toggle(c.campaignId)} /></td>
                  <td className="cell-co"><Link href={`/campaigns/${c.campaignId}`}><b>{c.label}</b></Link><span>{c.vendorName}</span></td>
                  <td><span className={`src-tag ${tag.kind}`}>{tag.label}</span></td>
                  <td><StatusPill status={c.status} /></td>
                  <td className="num">{c.companies}</td>
                  <td className="num">{c.leads}</td>
                  <td className="num"><ScoreMeter value={c.yield} size="sm" /></td>
                  <td className="num money">{c.credits.toFixed(2)}</td>
                  <td className="num">{relativeTime(c.createdAt, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
