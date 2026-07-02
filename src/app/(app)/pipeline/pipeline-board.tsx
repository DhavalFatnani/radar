import {
  BOARD_ORDER,
  STAGE_LABELS,
  type LeadCard,
  type PipelineStage,
} from "@/lib/pipeline/schema";
import { StageControls } from "./stage-controls";

function formatScore(score: number | null): string {
  return score == null ? "—" : score.toFixed(1);
}

export function PipelineBoard({ leads }: { leads: LeadCard[] }) {
  const byStage = new Map<PipelineStage, LeadCard[]>();
  for (const stage of BOARD_ORDER) byStage.set(stage, []);
  for (const lead of leads) byStage.get(lead.stage)?.push(lead);

  const columns = BOARD_ORDER.map((stage) => ({
    stage,
    items: byStage.get(stage) ?? [],
  })).filter((c) => c.items.length > 0);

  return (
    <div className="pipeline-board">
      {columns.map(({ stage, items }) => (
        <section
          key={stage}
          className="pipeline-column"
          aria-label={`${STAGE_LABELS[stage]} (${items.length})`}
        >
          <h2 className="pipeline-column-head">
            <span className={`stage-badge stage-dot-${stage}`}>{STAGE_LABELS[stage]}</span>
            <span className="pipeline-count">{items.length}</span>
          </h2>
          <ul className="lead-list">
            {items.map((lead) => (
              <li key={lead.leadId} className="lead-card">
                <p className="lead-company">{lead.companyName}</p>
                <p className="lead-vendor">for {lead.vendorName}</p>
                {lead.intent && <p className="lead-intent">{lead.intent}</p>}
                <p className="lead-meta">
                  <span className="lead-score">score {formatScore(lead.score)}</span>
                  {lead.hasBrief && <span className="lead-tag">brief</span>}
                  {lead.hasContactBlock && <span className="lead-tag">contacts</span>}
                </p>
                <StageControls leadId={lead.leadId} stage={lead.stage} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
