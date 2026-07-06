/** Score-heat threshold → strength-ramp token (cool→hot; high score = strong). */
export function scoreHeatVar(value: number): string {
  if (value >= 75) return "--strength-vhigh";
  if (value >= 50) return "--strength-high";
  if (value >= 25) return "--strength-medium";
  return "--strength-low";
}

export function ScoreMeter({ value, size }: { value: number; size?: "sm" }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className={`score${size === "sm" ? " score-sm" : ""}`}>
      <span className="score-bar">
        <span className="score-fill" style={{ width: `${v}%`, background: `var(${scoreHeatVar(v)})` }} />
      </span>
      <span className="score-num">{v}</span>
    </span>
  );
}
