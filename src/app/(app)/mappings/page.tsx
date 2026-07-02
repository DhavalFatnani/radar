import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { listMappings } from "@/lib/mappings/data";
import { listSignals } from "@/lib/signals/data";
import { LIFECYCLE_STATUSES } from "@/lib/mappings/schema";
import type { LifecycleStatus } from "@/lib/mappings/schema";
import { MappingList } from "./mapping-list";
import { AddMappingForm } from "./add-mapping-form";

export const metadata = { title: "Mappings — Radar" };

function hrefWith(status?: LifecycleStatus): string {
  return status ? `/mappings?status=${status}` : "/mappings";
}

export default async function MappingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  // Next.js 15: searchParams is a Promise — must await before reading.
  const sp = await searchParams;
  const status = LIFECYCLE_STATUSES.includes(sp.status as LifecycleStatus)
    ? (sp.status as LifecycleStatus)
    : undefined;

  const mappings = await listMappings({ status });
  const approvedSignals = (await listSignals({ status: "approved" })).map((s) => ({
    signalId: s.signalId,
    name: s.name,
  }));

  return (
    <>
      <PageHeader eyebrow="Build" title="Mappings" />
      <AddMappingForm approvedSignals={approvedSignals} />

      <nav aria-label="Filter mappings" className="filter-bar">
        <div className="filter-row">
          <Link
            href={hrefWith(undefined)}
            className={!status ? "is-active" : ""}
            aria-current={!status ? "true" : undefined}
          >
            All statuses
          </Link>
          {LIFECYCLE_STATUSES.map((s) => (
            <Link
              key={s}
              href={hrefWith(s)}
              className={status === s ? "is-active" : ""}
              aria-current={status === s ? "true" : undefined}
            >
              {s}
            </Link>
          ))}
        </div>
      </nav>

      {mappings.length === 0 && !status ? (
        <EmptyState
          icon="mappings"
          title="No mappings yet"
          description="Seed the library with `npm run db:seed:mappings`, or propose a mapping — each enters as proposed for your approval."
        />
      ) : (
        <MappingList mappings={mappings} />
      )}
    </>
  );
}
