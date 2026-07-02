"use client";

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
          <ul className="mapping-list">
            {items.map((m) => (
              <li key={m.mappingId}>
                <Link href={`/mappings/${m.mappingId}`}>{m.name}</Link>
                <p className="mapping-meta">
                  {m.servesVendorType ? `${m.servesVendorType} · ` : ""}
                  {m.requiredSignals?.length ?? 0} required · {m.supportingSignals?.length ?? 0} supporting
                </p>
                <span className={`badge badge-${m.status}`}>{m.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
