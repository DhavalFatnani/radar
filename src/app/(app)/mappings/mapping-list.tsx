import Link from "next/link";
import type { MappingDefinition, LifecycleStatus } from "@/lib/mappings/schema";
import { LIFECYCLE_STATUSES } from "@/lib/mappings/schema";

interface MappingListProps {
  mappings: MappingDefinition[];
}

export function MappingList({ mappings }: MappingListProps) {
  if (mappings.length === 0) {
    return <p className="mapping-empty">No mappings match this filter.</p>;
  }

  const groups: { status: LifecycleStatus; items: MappingDefinition[] }[] = LIFECYCLE_STATUSES.map(
    (status) => ({ status, items: mappings.filter((m) => m.status === status) }),
  ).filter((g) => g.items.length > 0);

  return (
    <div className="mapping-groups">
      {groups.map(({ status, items }) => (
        <section key={status}>
          <h2 className="signal-group-head">{status}</h2>
          <ul className="row-list">
            {items.map((m) => (
              <li key={m.mappingId} className="row-item">
                <Link href={`/mappings/${m.mappingId}`} className="row-link">
                  <span className="row-main">
                    <span className="row-title">{m.name}</span>
                    <span className="row-meta">
                      {m.servesVendorType ? `${m.servesVendorType} · ` : ""}
                      {m.requiredSignals?.length ?? 0} required · {m.supportingSignals?.length ?? 0} supporting
                    </span>
                  </span>
                  <span className="row-aside">
                    <span className={`badge badge-${m.status}`}>{m.status}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
