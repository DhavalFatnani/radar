"use client";
import { useRef, useState, type MouseEvent } from "react";

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** A small area+line sparkline. Hover shows a guide + the value at that point.
 * The tooltip is drawn inside the SVG so a clipping parent never hides it. */
export function Sparkline({ points, width = 82, height = 30 }: { points: number[]; width?: number; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;

  const max = Math.max(...points), min = Math.min(...points), span = max - min || 1;
  const coords = points.map((y, i) => [
    (i / (points.length - 1)) * width,
    height - 3 - ((y - min) / span) * (height - 8),
  ] as const);
  const line = "M" + coords.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
  const [ex, ey] = coords[coords.length - 1];

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const rx = ((e.clientX - rect.left) / rect.width) * width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round((rx / width) * (points.length - 1)))));
  }

  const hi = hover != null ? coords[hover] : null;
  const labelX = hi ? Math.min(Math.max(hi[0], 9), width - 9) : 0;

  return (
    <svg ref={ref} className="sparkline" viewBox={`0 0 ${width} ${height}`} width={width} height={height}
      role="img" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill="var(--accent)" opacity="0.08" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx={ex.toFixed(1)} cy={ey.toFixed(1)} r="2" fill="var(--accent)" />
      {hi ? (
        <g>
          <line x1={hi[0]} y1="0" x2={hi[0]} y2={height} stroke="var(--border-strong)" strokeWidth="0.75" />
          <circle cx={hi[0]} cy={hi[1]} r="2.6" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1" />
          <text x={labelX} y="7" textAnchor="middle" className="spark-val">{fmt(points[hover!])}</text>
        </g>
      ) : null}
    </svg>
  );
}
