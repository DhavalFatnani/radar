import type { ContactBlock } from "@/lib/sourcing/contacts-schema";

export function ContactBlockView({ block }: { block: ContactBlock }) {
  return (
    <section className="contact-block" aria-label="Contacts">
      <h2>Contacts</h2>
      <p className="contact-status">
        Status: {block.status === "resolved" ? "Resolved" : "Pending enrichment"}
      </p>
      {block.decision_makers.length === 0 ? (
        <p className="lead-empty-note">No decision-makers identified yet.</p>
      ) : (
        <ul className="decision-makers">
          {block.decision_makers.map((dm, i) => (
            <li key={`${dm.name}-${i}`} className="decision-maker">
              <p className="dm-name">
                {dm.name} <span className="dm-role">· {dm.role}</span>
              </p>
              {dm.why && <p className="dm-why">{dm.why}</p>}
              <p className={`warm-badge warm-${dm.warm.status}`}>
                {dm.warm.status === "warm" ? "Warm intro" : "Cold"}
                {dm.warm.detail ? `: ${dm.warm.detail}` : ""}
              </p>
              {dm.paths.length > 0 && (
                <ul className="contact-paths">
                  {dm.paths.map((p, j) => (
                    <li key={`${p.type}-${j}`} className="contact-path">
                      <span className="path-type">{p.type}</span>
                      <span className="path-val">{p.val ?? "—"}</span>
                      {p.conf && <span className="path-conf">{p.conf}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
