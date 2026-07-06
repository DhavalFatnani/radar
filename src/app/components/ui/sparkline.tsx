/** A tiny area+line sparkline. Pure — computes an SVG path from the point array. */
export function Sparkline({ points, width = 60, height = 24 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const max = Math.max(...points), min = Math.min(...points), span = max - min || 1;
  const pts = points.map((y, i) => [ (i / (points.length - 1)) * width, height - 2 - ((y - min) / span) * (height - 4) ]);
  const line = "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill="var(--accent)" opacity="0.08" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx={ex.toFixed(1)} cy={ey.toFixed(1)} r="2" fill="var(--accent)" />
    </svg>
  );
}
