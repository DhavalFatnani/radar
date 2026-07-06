import type { ReactNode } from "react";
export function KvList({ rows }: { rows: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="kv-list">
      {rows.map((r) => (
        <div className="kv" key={r.k}><dt className="kv-k">{r.k}</dt><dd className="kv-v">{r.v}</dd></div>
      ))}
    </dl>
  );
}
