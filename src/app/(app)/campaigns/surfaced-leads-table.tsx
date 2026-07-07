"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ScoreMeter } from "@/app/components/ui/score-meter";
import { Segmented } from "@/app/components/ui/controls";
import type { SurfacedLeadRow } from "./view-model";

const VIEW_OPTS = [{ value: "score", label: "By score" }, { value: "new", label: "New only" }];
const dash = (v: string | number | null) => (v === null || v === "" ? "—" : String(v));

export function SurfacedLeadsTable({ rows }: { rows: SurfacedLeadRow[] }) {
  const [view, setView] = useState("score");
  const shown = useMemo(() => {
    const base = view === "new" ? rows.filter((r) => r.wasNew) : rows;
    return [...base].sort((a, b) => b.score - a.score);
  }, [rows, view]);

  return (
    <div>
      <div className="cmdbar" style={{ justifyContent: "flex-end" }}>
        <Segmented options={VIEW_OPTS} value={view} onChange={setView} />
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Company</th><th className="num">Signals</th><th>Funding</th>
              <th className="num">Headcount</th><th className="num">Score</th><th>State</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.leadId}>
                <td className="cell-co"><b>{l.companyName}</b><span>{dash(l.domain)}</span></td>
                <td className="num">{dash(l.signals)}</td>
                <td>{dash(l.funding)}</td>
                <td className="num">{dash(l.headcount)}</td>
                <td className="num"><ScoreMeter value={l.score} size="sm" /></td>
                <td><span className={`src-tag ${l.wasNew ? "live" : ""}`}>{l.wasNew ? "new" : "updated"}</span></td>
                <td className="num"><Link href={`/leads/${l.leadId}`} className="open-link">Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
