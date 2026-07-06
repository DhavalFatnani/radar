import { Sparkline } from "./sparkline";

export function StatTile({ label, value, unit, delta, deltaDir, points }: {
  label: string; value: string; unit?: string; delta?: string; deltaDir?: "up" | "down"; points?: number[];
}) {
  return (
    <div className="stat-tile">
      <div className="stat-k">{label}</div>
      <div className="stat-v">{value}{unit ? <small>{unit}</small> : null}</div>
      {delta ? <div className={`stat-delta ${deltaDir ?? ""}`}>{delta}</div> : null}
      {points && points.length > 1 ? <div className="stat-spark"><Sparkline points={points} /></div> : null}
    </div>
  );
}
