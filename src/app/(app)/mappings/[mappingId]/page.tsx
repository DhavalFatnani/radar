import { notFound } from "next/navigation";
import Link from "next/link";
import { getMapping, resolveSignalRefs } from "@/lib/mappings/data";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusControls } from "../status-controls";
import { ReadinessPanel } from "../readiness-panel";

export const metadata = { title: "Mapping — Radar" };

export default async function MappingDetailPage({
  params,
}: {
  params: Promise<{ mappingId: string }>;
}) {
  const { mappingId } = await params;
  const mapping = await getMapping(mappingId);
  if (!mapping) notFound();

  const requiredRefs = await resolveSignalRefs(mapping.requiredSignals ?? []);
  const supportingRefs = await resolveSignalRefs(mapping.supportingSignals ?? []);

  const fmt = (v: string | number | null | undefined) =>
    v !== null && v !== undefined && v !== "" ? String(v) : "—";

  return (
    <div className="v2-content">
      <Link href="/mappings" className="back-link">
        ← All mappings
      </Link>
      <PageHeader eyebrow="Build" title={mapping.name} />
      <span className={`badge badge-${mapping.status}`}>{mapping.status}</span>
      <StatusControls mappingId={mapping.mappingId} status={mapping.status} />
      <ReadinessPanel requiredRefs={requiredRefs} supportingRefs={supportingRefs} />
      <dl className="mapping-detail">
        <dt>Intent</dt>
        <dd>{fmt(mapping.intentDescription)}</dd>

        <dt>Serves Vendor Type</dt>
        <dd>{fmt(mapping.servesVendorType)}</dd>

        <dt>Threshold Rule</dt>
        <dd>{fmt(mapping.thresholdRule)}</dd>

        <dt>Timing Window (days)</dt>
        <dd>{fmt(mapping.timingWindowDays)}</dd>

        <dt>Strength Logic</dt>
        <dd>{fmt(mapping.strengthLogic)}</dd>

        <dt>Disqualifiers</dt>
        <dd>{mapping.disqualifiers && mapping.disqualifiers.length > 0 ? mapping.disqualifiers.join("; ") : "—"}</dd>

        <dt>Origin</dt>
        <dd>{fmt(mapping.origin)}</dd>
      </dl>
    </div>
  );
}
