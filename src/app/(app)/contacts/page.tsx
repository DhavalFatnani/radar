import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";

export const metadata = { title: "Contacts — Radar" };

export default function ContactsPage() {
  return (
    <>
      <PageHeader eyebrow="Operate" title="Contacts" />
      <EmptyState icon="contacts" title="No contacts yet"
        description="Every decision-maker the engine finds flows into this compounding, deduplicated contact book." />
    </>
  );
}
