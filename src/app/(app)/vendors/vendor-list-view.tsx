"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SearchInput, Segmented } from "@/app/components/ui/controls";
import { readinessLabel, readinessPillClass, relativeTime } from "@/lib/vendors/view-model";
import type { VendorListRow, VendorTypeOption } from "@/lib/vendors/schema";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "runnable", label: "Runnable" },
  { value: "needs", label: "Needs setup" },
];

export function VendorListView({
  rows,
  types,
  nowMs,
}: {
  rows: VendorListRow[];
  types: VendorTypeOption[];
  nowMs: number;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const counts = useMemo(
    () => ({
      runnable: rows.filter((r) => r.readiness === "runnable").length,
      needs_mapping: rows.filter((r) => r.readiness === "needs_mapping").length,
      no_type: rows.filter((r) => r.readiness === "no_type").length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "runnable" && r.readiness !== "runnable") return false;
      if (filter === "needs" && r.readiness === "runnable") return false;
      if (
        q &&
        !(r.name.toLowerCase().includes(q) || (r.vendorType ?? "").toLowerCase().includes(q))
      )
        return false;
      return true;
    });
  }, [rows, search, filter]);

  const typesInUse = types.filter((t) => t.vendorCount > 0);

  return (
    <div className="ctx-grid">
      <div className="ctx-main">
        <div className="cmdbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Filter vendors…" />
          <Segmented options={FILTERS} value={filter} onChange={setFilter} />
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Type</th>
                <th>Readiness</th>
                <th className="num">Ver</th>
                <th className="num">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.vendorId}
                  className="clickable"
                  onClick={() => router.push(`/vendors/${r.vendorId}`)}
                >
                  <td className="cell-co">
                    <Link href={`/vendors/${r.vendorId}`} onClick={(e) => e.stopPropagation()}>
                      <b>{r.name}</b>
                    </Link>
                    <span>{r.capabilitiesPreview}</span>
                  </td>
                  <td>
                    {r.vendorType ? (
                      <span className="badge">{r.vendorType}</span>
                    ) : (
                      <span className="muted">— no type</span>
                    )}
                  </td>
                  <td>
                    <span className={`pill ${readinessPillClass(r.readiness)}`}>
                      {readinessLabel(r.readiness)}
                    </span>
                  </td>
                  <td className="num">v{r.version}</td>
                  <td className="num">{relativeTime(r.lastChangeAt, nowMs)}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="list-note">
                    No vendors match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="ctx-rail">
        <div className="ctx-panel">
          <h3>Readiness</h3>
          <dl className="kv-list">
            <div className="kv">
              <dt className="kv-k">Runnable</dt>
              <dd className="kv-v">{counts.runnable}</dd>
            </div>
            <div className="kv">
              <dt className="kv-k">Needs mapping</dt>
              <dd className="kv-v">{counts.needs_mapping}</dd>
            </div>
            <div className="kv">
              <dt className="kv-k">No type</dt>
              <dd className="kv-v">{counts.no_type}</dd>
            </div>
          </dl>
        </div>
        <div className="ctx-panel">
          <h3>Types in use</h3>
          {typesInUse.length === 0 ? (
            <p className="qv-empty">No types set yet.</p>
          ) : (
            <div className="chips">
              {typesInUse.map((t) => (
                <span key={t.type} className="chip">
                  {t.type} · {t.vendorCount}
                </span>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
