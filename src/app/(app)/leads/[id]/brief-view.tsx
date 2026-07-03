import type { LeadBrief } from "@/ai/brief/schema";
import { formatBriefDate } from "@/lib/leads/schema";

export function BriefView({ brief }: { brief: LeadBrief }) {
  return (
    <section className="brief-view" aria-label="Reverse brief">
      <h2>Reverse brief</h2>
      <div className="brief-field">
        <h3>Why them</h3>
        <p>{brief.why_them}</p>
      </div>
      <div className="brief-field">
        <h3>What they need</h3>
        <p>{brief.what_they_need}</p>
      </div>
      <div className="brief-field">
        <h3>Hook</h3>
        <p>{brief.hook}</p>
      </div>
      <div className="brief-field">
        <h3>Why this vendor</h3>
        <p>{brief.why_this_vendor}</p>
      </div>
      {brief.why_now.length > 0 && (
        <div className="brief-field">
          <h3>Why now</h3>
          <ul className="brief-proofs">
            {brief.why_now.map((proof, i) => (
              <li key={`${proof.signalId}-${i}`} className="brief-proof">
                <p className="proof-claim">{proof.claim}</p>
                <p className="proof-meta">
                  {formatBriefDate(proof.date)} · {proof.source}
                </p>
                {proof.evidence.length > 0 && (
                  <ul className="proof-evidence">
                    {proof.evidence.map((e, j) => (
                      <li key={j}>{e}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {brief.objections.length > 0 && (
        <div className="brief-field">
          <h3>Objections</h3>
          <ul className="brief-objections">
            {brief.objections.map((o, i) => (
              <li key={i} className="objection">
                <p className="objection-q">{o.objection}</p>
                <p className="objection-a">{o.response}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="brief-generated">Brief generated {formatBriefDate(brief.generatedAt)}</p>
    </section>
  );
}
