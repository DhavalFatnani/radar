import type {
  VendorReadinessClass,
  VendorTypeOption,
  InterviewHistoryEntry,
} from "./schema";

/** List/profile readiness at a glance. Note: this is the type→serving-mapping heuristic
 * (spec §4). It is intentionally lighter than the full signal-resolving getSourcingReadiness. */
export function classifyVendorReadiness(input: {
  vendorType: string | null;
  mappingCount: number;
}): VendorReadinessClass {
  if (!input.vendorType || input.vendorType.trim().length === 0) return "no_type";
  return input.mappingCount > 0 ? "runnable" : "needs_mapping";
}

export function readinessLabel(cls: VendorReadinessClass): string {
  switch (cls) {
    case "runnable":
      return "Runnable";
    case "needs_mapping":
      return "Needs mapping";
    case "no_type":
      return "No type";
  }
}

export function readinessPillClass(cls: VendorReadinessClass): string {
  switch (cls) {
    case "runnable":
      return "pill-runnable";
    case "needs_mapping":
      return "pill-needs";
    case "no_type":
      return "pill-notype";
  }
}

export function capabilitiesPreview(caps: string[], max = 3): string {
  const clean = caps.map((c) => c.trim()).filter(Boolean);
  if (clean.length === 0) return "—";
  const head = clean.slice(0, max).join(", ");
  const extra = clean.length - max;
  return extra > 0 ? `${head} +${extra}` : head;
}

export function lastChange(history: InterviewHistoryEntry[]): string | null {
  if (!history || history.length === 0) return null;
  return history.reduce((newest, e) => (e.at > newest ? e.at : newest), history[0].at);
}

export function relativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const s = Math.max(0, Math.round((nowMs - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

function findOption(value: string, options: VendorTypeOption[]): VendorTypeOption | undefined {
  const key = value.trim().toLowerCase();
  return options.find((o) => o.type.toLowerCase() === key);
}

export function typeHint(
  value: string,
  options: VendorTypeOption[],
): { tone: "ok" | "warn" | "muted"; text: string } {
  const t = value.trim();
  if (!t) {
    return {
      tone: "muted",
      text: "Pick or create a type — it gates which mappings can source for this vendor.",
    };
  }
  const match = findOption(t, options);
  const count = match?.mappingCount ?? 0;
  if (count > 0) {
    const plural = count === 1 ? "mapping serves" : "mappings serve";
    return { tone: "ok", text: `${count} ${plural} ${match!.type} — runnable.` };
  }
  return { tone: "warn", text: `No mapping serves “${t}” yet — add one in Mappings to source.` };
}

export function toComboboxOptions(
  options: VendorTypeOption[],
): { value: string; label: string; meta: string }[] {
  return options.map((o) => ({
    value: o.type,
    label: o.type,
    meta: o.mappingCount > 0 ? `${o.mappingCount} mapping${o.mappingCount === 1 ? "" : "s"}` : "no mapping yet",
  }));
}
