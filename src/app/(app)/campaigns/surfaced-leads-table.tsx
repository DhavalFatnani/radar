"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScoreMeter } from "@/app/components/ui/score-meter";
import type { SurfacedLeadRow } from "./view-model";

const dash = (v: string | number | null) => (v === null || v === "" ? "—" : String(v));

export function SurfacedLeadsTable({ rows, view }: { rows: SurfacedLeadRow[]; view: "score" | "new" }) {
  const router = useRouter();
  const shown = useMemo(() => {
    const base = view === "new" ? rows.filter((r) => r.wasNew) : rows;
    return [...base].sort((a, b) => b.score - a.score);
  }, [rows, view]);

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Company</th>
            <th className="num">Signals</th>
            <th className="num">Funding</th>
            <th className="num">Headcount</th>
            <th className="col-yield">Score</th>
            <th>State</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((l) => (
            <tr key={l.leadId} className="clickable" onClick={() => router.push(`/leads/${l.leadId}`)}>
              <td className="cell-co"><b>{l.companyName}</b>{l.domain ? <span>{l.domain}</span> : null}</td>
              <td className="num">{dash(l.signals)}</td>
              <td className="num">{dash(l.funding)}</td>
              <td className="num">{dash(l.headcount)}</td>
              <td className="col-yield"><ScoreMeter value={l.score} size="sm" /></td>
              <td><span className={`src-tag ${l.wasNew ? "live" : ""}`}>{l.wasNew ? "new" : "updated"}</span></td>
              <td className="num"><Link href={`/leads/${l.leadId}`} onClick={(e) => e.stopPropagation()} className="open-link">Open →</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
