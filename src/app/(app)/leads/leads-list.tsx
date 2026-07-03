import Link from "next/link";
import { STAGE_LABELS, type LeadCard } from "@/lib/pipeline/schema";
import { formatScore } from "@/lib/leads/schema";

export function LeadsList({ leads }: { leads: LeadCard[] }) {
  return (
    <ul className="leads-list">
      {leads.map((lead) => (
        <li key={lead.leadId} className="leads-list-row">
          <Link href={`/leads/${lead.leadId}`} className="leads-list-link">
            <span className="ll-company">{lead.companyName}</span>
            <span className="ll-vendor">{lead.vendorName}</span>
            <span className={`stage-badge stage-dot-${lead.stage}`}>
              {STAGE_LABELS[lead.stage]}
            </span>
            <span className="ll-score">{formatScore(lead.score)}</span>
            <span className="ll-tags">
              {lead.hasBrief && <span className="lead-tag">brief</span>}
              {lead.hasContactBlock && <span className="lead-tag">contacts</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
