import Link from "next/link";
import type { SignalDefinition, LifecycleStatus } from "@/lib/signals/schema";
import { LIFECYCLE_STATUSES } from "@/lib/signals/schema";

interface SignalListProps {
  signals: SignalDefinition[];
}

export function SignalList({ signals }: SignalListProps) {
  if (signals.length === 0) {
    return <p className="signal-empty">No signals match this filter.</p>;
  }

  // Group by status in fixed order: proposed → approved → retired
  const groups: { status: LifecycleStatus; items: SignalDefinition[] }[] = LIFECYCLE_STATUSES.map(
    (status) => ({ status, items: signals.filter((s) => s.status === status) }),
  ).filter((g) => g.items.length > 0);

  return (
    <div className="signal-groups">
      {groups.map(({ status, items }) => (
        <section key={status}>
          <h2 className="signal-group-head">{status}</h2>
          <ul className="row-list">
            {items.map((s) => (
              <li key={s.signalId} className="row-item">
                <Link href={`/signals/${s.signalId}`} className="row-link">
                  <span className="row-main">
                    <span className="row-title">{s.name}</span>
                    <span className="row-meta">
                      {s.signalId} &middot; {s.family}{s.strength ? ` · ${s.strength}` : ""}
                    </span>
                  </span>
                  <span className="row-aside">
                    <span className={`badge badge-${s.status}`}>{s.status}</span>
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
