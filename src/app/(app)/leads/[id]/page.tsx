import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db/client";
import { getLeadDetail } from "@/lib/leads/data";
import { PageHeader } from "@/app/components/ui/page-header";
import { STAGE_LABELS } from "@/lib/pipeline/schema";
import { formatScore, OUTREACH_LABELS } from "@/lib/leads/schema";
import { StageControls } from "@/app/(app)/pipeline/stage-controls";
import { BriefView } from "./brief-view";
import { ContactBlockView } from "./contact-block-view";

export const metadata = { title: "Lead — Radar" };

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = await getLeadDetail(db, id);
  if (!lead) notFound();

  return (
    <>
      <Link href="/leads" className="back-link">
        ← All leads
      </Link>
      <PageHeader eyebrow="Operate" title={lead.companyName} />
      <div className="lead-detail">
        <section className="lead-summary" aria-label="Lead summary">
          <dl className="lead-facts">
            <div className="fact">
              <dt>Vendor</dt>
              <dd>{lead.vendorName}</dd>
            </div>
            {lead.intent && (
              <div className="fact">
                <dt>Intent</dt>
                <dd>{lead.intent}</dd>
              </div>
            )}
            <div className="fact">
              <dt>Stage</dt>
              <dd>
                <span className={`stage-badge stage-dot-${lead.stage}`}>
                  {STAGE_LABELS[lead.stage]}
                </span>
              </dd>
            </div>
            <div className="fact">
              <dt>Score</dt>
              <dd>{formatScore(lead.score)}</dd>
            </div>
            {lead.outreachMode && (
              <div className="fact">
                <dt>Outreach</dt>
                <dd>{OUTREACH_LABELS[lead.outreachMode]}</dd>
              </div>
            )}
          </dl>
          <StageControls leadId={lead.leadId} stage={lead.stage} />
        </section>
        {lead.brief ? (
          <BriefView brief={lead.brief} />
        ) : (
          <p className="lead-empty-note">No reverse brief generated yet.</p>
        )}
        {lead.contactBlock ? (
          <ContactBlockView block={lead.contactBlock} />
        ) : (
          <p className="lead-empty-note">No contact block resolved yet.</p>
        )}
      </div>
    </>
  );
}
