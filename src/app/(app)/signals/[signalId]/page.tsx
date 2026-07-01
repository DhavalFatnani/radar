import { notFound } from "next/navigation";
import Link from "next/link";
import { getSignal } from "@/lib/signals/data";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusControls } from "../status-controls";

export const metadata = { title: "Signal — Radar" };

export default async function SignalDetailPage({
  params,
}: {
  params: Promise<{ signalId: string }>;
}) {
  const { signalId } = await params;
  const signal = await getSignal(signalId);
  if (!signal) notFound();

  const fmt = (v: string | number | null | undefined) =>
    v !== null && v !== undefined && v !== "" ? String(v) : "—";

  return (
    <div className="v2-content">
      <Link href="/signals" className="back-link">
        ← All signals
      </Link>
      <PageHeader eyebrow="Build" title={signal.name} />
      <span className={`badge badge-${signal.status}`}>{signal.status}</span>
      <StatusControls signalId={signal.signalId} status={signal.status} />
      <dl className="signal-detail">
        <dt>Signal ID</dt>
        <dd>{fmt(signal.signalId)}</dd>

        <dt>Family</dt>
        <dd>{fmt(signal.family)}</dd>

        <dt>Description</dt>
        <dd>{fmt(signal.description)}</dd>

        <dt>Sources</dt>
        <dd>{signal.sources && signal.sources.length > 0 ? signal.sources.join(", ") : "—"}</dd>

        <dt>Detection Method</dt>
        <dd>{fmt(signal.detectionMethod)}</dd>

        <dt>Trigger Rule</dt>
        <dd>{fmt(signal.triggerRule)}</dd>

        <dt>Strength</dt>
        <dd>{fmt(signal.strength)}</dd>

        <dt>False Positive Risk</dt>
        <dd>{fmt(signal.falsePositiveRisk)}</dd>

        <dt>Freshness Window (days)</dt>
        <dd>{fmt(signal.freshnessWindowDays)}</dd>

        <dt>Polarity</dt>
        <dd>{fmt(signal.polarity)}</dd>

        <dt>Entity Type</dt>
        <dd>{fmt(signal.entityType)}</dd>

        <dt>Example</dt>
        <dd>{fmt(signal.example)}</dd>

        <dt>Origin</dt>
        <dd>{fmt(signal.origin)}</dd>

        <dt>Proposed By</dt>
        <dd>{fmt(signal.proposedBy)}</dd>

        <dt>Date Added</dt>
        <dd>{fmt(signal.dateAdded)}</dd>

        <dt>Last Reviewed</dt>
        <dd>{fmt(signal.lastReviewed)}</dd>
      </dl>
    </div>
  );
}
