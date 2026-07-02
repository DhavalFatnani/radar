import type { SignalRef } from "@/lib/mappings/schema";

function ReadinessItem({ r }: { r: SignalRef }) {
  const label = r.status ?? "missing";
  return (
    <li>
      <span>{r.name ?? r.signalId}</span>
      <span className={`badge badge-${label}`}>{label}</span>
      <span className="readiness-id">{r.signalId}</span>
    </li>
  );
}

export function ReadinessPanel({
  requiredRefs,
  supportingRefs,
}: {
  requiredRefs: SignalRef[];
  supportingRefs: SignalRef[];
}) {
  const allRequiredApproved =
    requiredRefs.length > 0 && requiredRefs.every((r) => r.status === "approved");

  return (
    <section className="readiness-panel" aria-label="Signal readiness">
      <h2>Signal readiness</h2>
      <p className={allRequiredApproved ? "readiness-ok" : "readiness-warn"}>
        {allRequiredApproved
          ? "All required signals are approved — this mapping can be approved."
          : "Some required signals are not approved — approval is blocked until they are."}
      </p>
      <h3>Required</h3>
      <ul className="readiness-list">
        {requiredRefs.map((r) => (
          <ReadinessItem key={r.signalId} r={r} />
        ))}
      </ul>
      {supportingRefs.length > 0 && (
        <>
          <h3>Supporting</h3>
          <ul className="readiness-list">
            {supportingRefs.map((r) => (
              <ReadinessItem key={r.signalId} r={r} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
