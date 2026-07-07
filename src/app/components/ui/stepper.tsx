"use client";
export function Stepper({ value, onChange, min = 1, max = 25, name }: { value: number; onChange: (v: number) => void; min?: number; max?: number; name?: string }) {
  return (
    <div className="stepper">
      <input type="range" min={min} max={max} value={value} aria-label="target" onChange={(e) => onChange(Number(e.target.value))} />
      <span className="stepper-val">{value}</span>
      {name ? <input type="hidden" name={name} value={value} readOnly /> : null}
    </div>
  );
}
