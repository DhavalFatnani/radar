import type { CampaignStatus } from "@/app/components/ui/status-pill";

export type CampaignStatsShape = {
  companiesFetched: number; observationsWritten: number;
  leadsCreated: number; leadsUpdated: number; creditsSpent: number;
};

export type CampaignListRow = {
  campaignId: string;
  label: string;
  vendorName: string;
  source: string;
  status: CampaignStatus;
  companies: number;
  leads: number;
  credits: number;
  yield: number;
  createdAt: string;
};

/** Leads per company scanned, as a rounded percent. Guards divide-by-zero. */
export function yieldPct(companiesFetched: number, leadsCreated: number): number {
  if (companiesFetched <= 0) return 0;
  return Math.round((leadsCreated / companiesFetched) * 100);
}

/** Coarse relative time: just now / Nm / Nh / Nd, falling back to "Mon D" past a week. */
export function relativeTime(when: string | Date, now: Date): string {
  const then = typeof when === "string" ? new Date(when) : when;
  const secs = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function sourceTag(source: string): { label: "Live" | "Test"; kind: "live" | "test" } {
  return source === "crustdata" ? { label: "Live", kind: "live" } : { label: "Test", kind: "test" };
}

// forward-looking: becomes vendor/org config in a later spec.
export const CREDIT_BUDGET = 600;

export type KpiTile = { label: string; value: string; unit?: string; delta?: string; deltaDir?: "up" | "down"; points?: number[] };

function withinDays(iso: string, now: Date, days: number): boolean {
  return now.getTime() - new Date(iso).getTime() <= days * 86400_000;
}
function seriesTail(rows: CampaignListRow[], pick: (r: CampaignListRow) => number, n = 8): number[] {
  // rows arrive newest-first; sparkline reads oldest→newest.
  return rows.slice(0, n).map(pick).reverse();
}
function trend(points: number[]): { delta?: string; deltaDir?: "up" | "down" } {
  if (points.length < 4) return {};
  const half = Math.floor(points.length / 2);
  const older = points.slice(0, half), newer = points.slice(half);
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const o = avg(older), n = avg(newer);
  if (o === 0) return {};
  const pct = Math.round(((n - o) / o) * 100);
  if (pct === 0) return {};
  return pct > 0 ? { delta: `▲ ${pct}%`, deltaDir: "up" } : { delta: `▼ ${Math.abs(pct)}%`, deltaDir: "down" };
}

export function deriveListKpis(rows: CampaignListRow[], now: Date): KpiTile[] {
  const leadsPts = seriesTail(rows, (r) => r.leads);
  const coPts = seriesTail(rows, (r) => r.companies);
  const yieldPts = seriesTail(rows, (r) => r.yield);
  const withYield = rows.filter((r) => r.companies > 0);
  const avgYield = withYield.length ? Math.round(withYield.reduce((s, r) => s + r.yield, 0) / withYield.length) : 0;
  return [
    { label: "Campaigns 30d", value: String(rows.filter((r) => withinDays(r.createdAt, now, 30)).length) },
    { label: "Leads sourced", value: String(rows.reduce((s, r) => s + r.leads, 0)), points: leadsPts, ...trend(leadsPts) },
    { label: "Companies scanned", value: String(rows.reduce((s, r) => s + r.companies, 0)), points: coPts, ...trend(coPts) },
    { label: "Avg yield", value: String(avgYield), unit: "%", points: yieldPts, ...trend(yieldPts) },
  ];
}

export type SurfacedLeadRow = {
  leadId: string; companyName: string;
  domain: string | null; signals: number | null; funding: string | null; headcount: number | null;
  score: number; wasNew: boolean;
};

export function toSurfacedLeadRow(raw: {
  leadId: string; companyName: string; score: number | null; wasNew: boolean; profile: unknown; snapshot: unknown;
}): SurfacedLeadRow {
  const p = (raw.profile ?? {}) as Record<string, unknown>;
  const s = (raw.snapshot ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    leadId: raw.leadId,
    companyName: raw.companyName,
    domain: str(p.domain) ?? str(p.website),
    signals: num(s.opsPostings),
    funding: str(s.fundraiseDate),
    headcount: num(s.headcountTotal),
    score: raw.score ?? 0,
    wasNew: raw.wasNew,
  };
}
