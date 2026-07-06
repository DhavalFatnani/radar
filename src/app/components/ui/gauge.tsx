/** A radial budget donut. The arc length encodes value/max on a ~100-unit circumference. */
export function Gauge({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const d = "M18 2.5a15.5 15.5 0 1 1 0 31 15.5 15.5 0 0 1 0-31";
  return (
    <svg className="gauge" viewBox="0 0 36 36" width="72" height="72" aria-hidden="true">
      <path d={d} fill="none" stroke="var(--surface-inset)" strokeWidth="3.4" />
      <path className="gauge-arc" d={d} fill="none" stroke="var(--accent)" strokeWidth="3.4" strokeLinecap="round" strokeDasharray={`${pct.toFixed(1)} 100`} />
    </svg>
  );
}
