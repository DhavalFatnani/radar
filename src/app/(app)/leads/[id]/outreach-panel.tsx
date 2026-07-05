"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OUTREACH_LABELS, type OutreachMode } from "@/lib/leads/schema";
import {
  OUTREACH_STATUS_LABELS,
  canMarkSent,
  type OutreachStatus,
  type OutreachDraft,
} from "@/lib/outreach/schema";
import {
  setOutreachModeAction,
  generateOutreachDraftAction,
  setOutreachStatusAction,
  sendOutreachAction,
} from "../actions";

const MODES: OutreachMode[] = ["operator_handles", "handed_to_vendor"];

export function OutreachPanel({
  leadId,
  mode,
  status,
  draft,
  hasBrief,
  sendConfigured,
  recipientEmail,
}: {
  leadId: string;
  mode: OutreachMode | null;
  status: OutreachStatus;
  draft: OutreachDraft | null;
  hasBrief: boolean;
  sendConfigured: boolean;
  recipientEmail: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const r = await action();
      if (r.ok) router.refresh();
      else setError(r.error ?? "Action failed.");
    });
  }

  return (
    <section className="outreach-panel" aria-label="Outreach">
      <header className="outreach-head">
        <h2>Outreach</h2>
        <span className={`outreach-status outreach-status-${status}`}>
          {OUTREACH_STATUS_LABELS[status]}
        </span>
      </header>

      <div className="outreach-modes" role="group" aria-label="Outreach mode">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={m === mode ? "btn btn-sm btn-primary" : "btn btn-sm"}
            aria-pressed={m === mode}
            disabled={pending}
            onClick={() => run(() => setOutreachModeAction(leadId, m))}
          >
            {OUTREACH_LABELS[m]}
          </button>
        ))}
      </div>

      <div className="outreach-generate">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={pending || !hasBrief}
          onClick={() => run(() => generateOutreachDraftAction(leadId))}
        >
          {draft ? "Regenerate draft" : "Generate draft"}
        </button>
        {!hasBrief && (
          <p className="outreach-note">
            Generate the brief first — the draft is written from it.
          </p>
        )}
      </div>

      {draft && (
        <form className="outreach-draft" aria-label="Generated draft">
          <label className="outreach-field">
            <span>Subject</span>
            <input type="text" readOnly value={draft.subject} />
          </label>
          <label className="outreach-field">
            <span>Body</span>
            <textarea readOnly rows={6} value={draft.body} />
          </label>
        </form>
      )}

      {status === "drafted" && (mode === "operator_handles" || mode === null) && (
        <div className="outreach-send" role="group" aria-label="Send outreach email">
          {!confirming ? (
            <>
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending || !sendConfigured || !recipientEmail}
                onClick={() => setConfirming(true)}
              >
                Send now
              </button>
              {sendConfigured && recipientEmail && (
                <p className="outreach-hint">To: {recipientEmail}</p>
              )}
              {!sendConfigured && (
                <p className="outreach-hint">Email sending isn&apos;t configured.</p>
              )}
              {sendConfigured && !recipientEmail && (
                <p className="outreach-hint">No email address on file for this lead.</p>
              )}
            </>
          ) : (
            <>
              <p className="outreach-confirm">Send to {recipientEmail}?</p>
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending}
                onClick={() => run(() => sendOutreachAction(leadId))}
              >
                Confirm send
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {canMarkSent(status) && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={pending}
          onClick={() => run(() => setOutreachStatusAction(leadId, "sent"))}
        >
          Mark as sent
        </button>
      )}

      {error && (
        <p role="alert" className="outreach-error">
          {error}
        </p>
      )}
    </section>
  );
}
