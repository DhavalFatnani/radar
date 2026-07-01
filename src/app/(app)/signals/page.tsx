import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { listSignals } from "@/lib/signals/data";
import { LIFECYCLE_STATUSES, SIGNAL_FAMILIES } from "@/lib/signals/schema";
import type { LifecycleStatus, SignalFamily } from "@/lib/signals/schema";
import { SignalList } from "./signal-list";

export const metadata = { title: "Signals — Radar" };

// Build a /signals?... href, merging next params over current active params,
// dropping any undefined/empty values.
function hrefWith(
  active: { status?: LifecycleStatus; family?: SignalFamily },
  next: { status?: LifecycleStatus; family?: SignalFamily },
): string {
  const merged: Record<string, string> = {};
  const combined = { ...active, ...next };
  if (combined.status) merged.status = combined.status;
  if (combined.family) merged.family = combined.family;
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/signals?${qs}` : "/signals";
}

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; family?: string }>;
}) {
  // Next.js 15: searchParams is a Promise — must await before reading.
  const sp = await searchParams;

  // Validate raw strings against the option arrays (untrusted URL input).
  const status = LIFECYCLE_STATUSES.includes(sp.status as LifecycleStatus)
    ? (sp.status as LifecycleStatus)
    : undefined;
  const family = SIGNAL_FAMILIES.includes(sp.family as SignalFamily)
    ? (sp.family as SignalFamily)
    : undefined;

  const signals = await listSignals({ status, family });

  const active = { status, family };

  return (
    <>
      <PageHeader eyebrow="Build" title="Signals" />
      {/* AddSignalForm wired in Task 6 */}

      <nav aria-label="Filter signals" className="filter-bar">
        <div className="filter-row">
          <Link
            href={hrefWith(active, { status: undefined })}
            className={!status ? "is-active" : ""}
            aria-current={!status ? "true" : undefined}
          >
            All statuses
          </Link>
          {LIFECYCLE_STATUSES.map((s) => (
            <Link
              key={s}
              href={hrefWith(active, { status: s })}
              className={status === s ? "is-active" : ""}
              aria-current={status === s ? "true" : undefined}
            >
              {s}
            </Link>
          ))}
        </div>
        <div className="filter-row">
          <Link
            href={hrefWith(active, { family: undefined })}
            className={!family ? "is-active" : ""}
            aria-current={!family ? "true" : undefined}
          >
            All families
          </Link>
          {SIGNAL_FAMILIES.map((f) => (
            <Link
              key={f}
              href={hrefWith(active, { family: f })}
              className={family === f ? "is-active" : ""}
              aria-current={family === f ? "true" : undefined}
            >
              {f}
            </Link>
          ))}
        </div>
      </nav>

      {signals.length === 0 && !status && !family ? (
        <EmptyState
          icon="signals"
          title="No signals yet"
          description="Seed the library with `npm run db:seed:signals`, or propose a signal — each enters as proposed for your approval."
        />
      ) : (
        <SignalList signals={signals} activeStatus={status} activeFamily={family} />
      )}
    </>
  );
}
