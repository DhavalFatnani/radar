import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Signals — Radar" };

export default function SignalsPage() {
  return (
    <>
      <PageHeader eyebrow="Build" title="Signals" />
      <EmptyState icon="signals" title="No signals yet"
        description="The seed signal library and signals surfaced from interviews will appear here, each entering as proposed." />
    </>
  );
}
