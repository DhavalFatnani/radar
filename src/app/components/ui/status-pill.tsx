export type CampaignStatus = "queued" | "running" | "done" | "failed";
export function StatusPill({ status }: { status: CampaignStatus }) {
  return <span className={`pill pill-${status}`}>{status}</span>;
}
